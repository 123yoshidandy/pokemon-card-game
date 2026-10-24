/**
 * カードの定義
 * スタンダードレギュレーション（regulation.js）の実在カードを、名前と効果で1種類として持つ
 * データは cards/catalog.js（tools/build-cards.mjs が TCGdex のデータから作る）。id は一番新しい版の番号（例：M6-010）
 *
 * ポケモン：{ kind: 'pokemon', stage(0=たね,1,2), evolvesFrom(進化元の名前), hp, type, weakness, resistance, retreat,
 *            rule('ex' ならきぜつでサイド2枚、'mega' はメガシンカexで3枚), tera(ベンチでワザのダメージを受けない), ability, attacks }
 *   ワザ：{ name, cost: [タイプ...], damage, damageText, text, before(ctx), after(ctx), expected(ctx) }
 *     before はダメージの前（ダメージの増減）、after はダメージの後（特殊状態・入れ替えなど）に呼ぶ
 *     expected は CPU がダメージを見積もるときに使う（乱数を使わない。コインはオモテ・ウラの平均で見る）
 *     効果は、文を読み替えて作る（cards/attack-effects.js）。読み替えられないものは cards/attack-overrides.js に書く
 *   特性：{ name, text, type, canUse, use }（cards/ability-effects.js）
 * トレーナーズ：{ kind: 'trainer', trainerType: 'item' | 'supporter' | 'stadium' | 'tool', text, canPlay, play }（cards/trainer-effects.js）
 * エネルギー：{ kind: 'energy', basic, energyType }
 *
 * supported：効果がすべて動くか。動かないカードはデッキに入れられない
 */

import { CATALOG, LEGACY_IDS } from './cards/catalog.js';
import { compileAttackText } from './cards/attack-effects.js';
import { ATTACK_OVERRIDES as OVERRIDES_BASE } from './cards/attack-overrides.js';
import { ATTACK_OVERRIDES as OVERRIDES_A } from './cards/attack-overrides-a.js';
import { ATTACK_OVERRIDES as OVERRIDES_B } from './cards/attack-overrides-b.js';
import { ABILITY_EFFECTS as ABILITIES_BASE } from './cards/ability-effects.js';
import { ABILITY_EFFECTS as ABILITIES_A } from './cards/abilities/abilities-a.js';
import { ABILITY_EFFECTS as ABILITIES_B } from './cards/abilities/abilities-b.js';
import { ABILITY_EFFECTS as ABILITIES_C } from './cards/abilities/abilities-c.js';
import { ABILITY_EFFECTS as ABILITIES_TAGS } from './cards/abilities/abilities-tags.js';
import { ABILITY_EFFECTS as ABILITIES_MORE } from './cards/abilities/abilities-more.js';
import { TRAINER_EFFECTS as TRAINERS_BASE } from './cards/trainer-effects.js';
import { TRAINER_EFFECTS as SUPPORTERS } from './cards/trainers/supporters.js';
import { TRAINER_EFFECTS as ITEMS } from './cards/trainers/items.js';
import { TRAINER_EFFECTS as TOOLS } from './cards/trainers/tools.js';
import { TRAINER_EFFECTS as STADIUMS } from './cards/trainers/stadiums.js';
import { TRAINER_EFFECTS as EXTRAS } from './cards/trainers/extras.js';
import { TRAINER_EFFECTS as FOSSILS } from './cards/trainers/fossils.js';
import { ENERGY_EFFECTS } from './cards/energy-effects.js';

// 読み替えられないワザは「カードのID/ワザ名」か「カード名/ワザ名」で引く
const ATTACK_OVERRIDES = { ...OVERRIDES_BASE, ...OVERRIDES_A, ...OVERRIDES_B };

// 効果は、種類ごとのファイルに分けて書く（同じ名前があれば、後のファイルのものを使う）
const TRAINER_EFFECTS = { ...TRAINERS_BASE, ...SUPPORTERS, ...ITEMS, ...TOOLS, ...STADIUMS, ...EXTRAS, ...FOSSILS };
// 特性は「カード名/特性名」か「特性名」で引く（同じ名前・同じ文の特性を持つカードは、特性名だけで書ける）
const ABILITY_EFFECTS = { ...ABILITIES_BASE, ...ABILITIES_A, ...ABILITIES_B, ...ABILITIES_C, ...ABILITIES_TAGS, ...ABILITIES_MORE };

export const TYPE_NAMES = {
    grass: '草',
    fire: '炎',
    water: '水',
    lightning: '雷',
    psychic: '超',
    fighting: '闘',
    darkness: '悪',
    metal: '鋼',
    dragon: 'ドラゴン',
    colorless: '無色'
};

export const TRAINER_TYPE_NAMES = {
    item: 'グッズ',
    supporter: 'サポート',
    stadium: 'スタジアム',
    tool: 'ポケモンのどうぐ'
};

export const RULE_TEXTS = {
    ex: 'ポケモンexがきぜつしたとき、相手はサイドを2枚とる。',
    mega: 'メガシンカexがきぜつしたとき、相手はサイドを3枚とる。'
};

const isBasicEnergy = (card, type) => card.kind === 'energy' && card.basic && (!type || card.energyType === type);
const isBasicPokemon = card => card.kind === 'pokemon' && card.stage === 0;
const hasRule = card => Boolean(card.rule);
const isPokemonEx = card => card.rule === 'ex' || card.rule === 'mega';

function buildAttack(card, attack) {
    const override = ATTACK_OVERRIDES[`${card.id}/${attack.name}`] ?? ATTACK_OVERRIDES[`${card.name}/${attack.name}`];
    if (override) return { ...attack, ...override, supported: true };
    if (!attack.text) return { ...attack, supported: true };
    const compiled = compileAttackText(attack.text);
    return compiled ? { ...attack, ...compiled, supported: true } : { ...attack, supported: false };
}

function buildPokemon(data) {
    const attacks = data.attacks.map(attack => buildAttack(data, attack));
    const abilityData = data.abilities?.[0] ?? null;
    const abilityEffect = abilityData ? (ABILITY_EFFECTS[`${data.name}/${abilityData.name}`] ?? ABILITY_EFFECTS[abilityData.name]) : null;
    const ability = abilityData ? { name: abilityData.name, text: abilityData.text, type: 'unknown', ...abilityEffect } : null;
    const supported = data.stage >= 0
        && (data.abilities?.length ?? 0) <= 1
        && (!abilityData || Boolean(abilityEffect))
        && attacks.every(attack => attack.supported && !attack.cost.includes('unknown'));
    const { abilities, ...rest } = data;
    return { ...rest, tera: Boolean(data.tera), ability, attacks, supported };
}

function buildTrainer(data) {
    const effect = TRAINER_EFFECTS[data.name];
    return { canPlay: () => true, play: () => {}, ...data, ...effect, supported: Boolean(effect) && data.trainerType !== 'unknown' };
}

// 特殊エネルギー：{ provides(game, pokemon, inst) → タイプの配列（'any' はどのタイプにもなる）, hooks, onAttach(game, player, pokemon, inst) }
function buildEnergy(data) {
    if (data.basic) return { ...data, supported: true };
    const effect = ENERGY_EFFECTS[data.name];
    return { ...data, ...effect, supported: Boolean(effect) };
}

const build = data => {
    if (data.kind === 'pokemon') return buildPokemon(data);
    if (data.kind === 'trainer') return buildTrainer(data);
    return buildEnergy(data);
};

export const CARDS = Object.fromEntries(CATALOG.map(data => [data.id, build(data)]));

// 場では別の形で働くカード（たねポケモンとして出した化石など）の、その形の定義（「<ID>#<形>」。デッキ構築には出ない）
const FORMS = Object.fromEntries(Object.values(CARDS).filter(card => card.asPokemon).map(card => {
    const form = card.asPokemon;
    const id = `${card.id}#pokemon`;
    return [id, {
        id,
        kind: 'pokemon',
        name: card.name,
        stage: 0,
        evolvesFrom: null,
        hp: form.hp,
        type: form.type,
        weakness: form.weakness ?? null,
        resistance: form.resistance ?? null,
        retreat: form.retreat ?? 0,
        rule: null,
        tera: false,
        regulation: card.regulation,
        prints: card.prints,
        formOf: card.id,
        ability: form.ability ?? null,
        attacks: form.attacks ?? [],
        supported: true
    }];
}));

export function getCard(id) {
    const card = CARDS[id] ?? FORMS[id];
    if (!card) throw new Error(`不明なカード: ${id}`);
    return card;
}

// どの版の番号からでも、そのカードのIDを引けるようにする
const PRINT_TO_ID = new Map(Object.values(CARDS).flatMap(card => (card.prints ?? []).map(print => [print, card.id])));

// 前の版のカードID（'charmander' など）や、まとめた版の番号を、今のIDに読み替える。知らないIDはそのまま
export function resolveCardId(id) {
    if (Object.hasOwn(CARDS, id)) return id;
    if (Object.hasOwn(LEGACY_IDS, id)) return LEGACY_IDS[id];
    return PRINT_TO_ID.get(id) ?? id;
}

// 1進化ポケモンの名前 → その進化元（たねポケモン）の名前（ふしぎなアメで使う）
const BASE_OF_STAGE1 = new Map(Object.values(CARDS)
    .filter(card => card.kind === 'pokemon' && card.stage === 1 && card.evolvesFrom)
    .map(card => [card.name, card.evolvesFrom]));

export function baseOfStage1(name) {
    return BASE_OF_STAGE1.get(name) ?? null;
}

export { isBasicEnergy, isBasicPokemon, hasRule, isPokemonEx };
