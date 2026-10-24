/**
 * tools/data/tcgdex-ja/*.json（fetch-cards.mjs で取ったもの）から、public/js/cards/catalog.js を作る
 * 同じ名前・同じ効果のカードは、収録パックが違っても1種類にまとめる。文などは一番新しい版、id は一番古い版の番号
 * prints には、まとめた版の番号を新しい順に入れる
 *
 *   node tools/build-cards.mjs
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeText } from '../public/js/cards/text.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'tools', 'data', 'tcgdex-ja');
const OUT = join(ROOT, 'public', 'js', 'cards', 'catalog.js');

const TYPES = {
    Grass: 'grass', Fire: 'fire', Water: 'water', Lightning: 'lightning', Psychic: 'psychic',
    Fighting: 'fighting', Darkness: 'darkness', Metal: 'metal', Dragon: 'dragon', Colorless: 'colorless'
};
const BASIC_ENERGY_TYPES = { 草: 'grass', 炎: 'fire', 水: 'water', 雷: 'lightning', 超: 'psychic', 闘: 'fighting', 悪: 'darkness', 鋼: 'metal' };
const TRAINER_TYPES = { Item: 'item', Supporter: 'supporter', Stadium: 'stadium', Tool: 'tool' };
const STAGES = { Basic: 0, Stage1: 1, Stage2: 2 };

// 前の版で使っていたカードID → 代表の版（ブラウザに保存したデッキを読み替えるため）
const LEGACY = {
    'charmander': ['ヒトカゲ', 'MC-083'],
    'charmeleon': ['リザード', 'MC-084'],
    'mega-charizard-y-ex': ['メガリザードンYex', 'MC-085'],
    'growlithe': ['ガーディ', 'M6-010'],
    'arcanine': ['ウインディ', 'M6-011'],
    'miraidon-ex': ['ミライドンex', 'MC-284'],
    'pikachu': ['ピカチュウ', 'MC-225'],
    'raichu': ['ライチュウ', 'MC-226'],
    'magnemite': ['コイル', 'M1S-027'],
    'magneton': ['レアコイル', 'M1S-028'],
    'magnezone': ['ジバコイル', 'M1S-029'],
    'guy': ['ガイ'],
    'zeiyu': ['ゼイユ', 'MC-715'],
    'lillies-determination': ['リーリエの決心'],
    'mc-hype': ['MCの盛り上げ', 'M6-067'],
    'judge': ['ジャッジマン'],
    'bosss-orders': ['ボスの指令'],
    'ultra-ball': ['ハイパーボール'],
    'buddy-buddy-poffin': ['なかよしポフィン', 'MC-648'],
    'poke-ball': ['モンスターボール', 'MC-669'],
    'rare-candy': ['ふしぎなアメ'],
    'switch': ['ポケモンいれかえ'],
    'potion': ['きずぐすり'],
    'energy-retrieval': ['エネルギー回収', 'M4-104'],
    'energy-search': ['エネルギー転送', 'MC-639'],
    'energy-switch': ['エネルギーつけかえ', 'M5-103'],
    'float-stone': ['ふうせん'],
    'brave-bangle': ['ブレイブバングル', 'M5-107'],
    'lumiose-city': ['ミアレシティ', 'M3-077'],
    'gravity-mountain': ['グラビティーマウンテン', 'M2a-183']
};

// TCGdex のデータに進化元が入っていない進化ポケモンのうち、同じ名前の別の版でも補えないもの（進化の系統から書く）
const KNOWN_EVOLUTIONS = {
    'グレイシア': 'イーブイ', 'ヒスイ ウインディ': 'ヒスイ ガーディ', 'ワタシラガ': 'モンメン', 'カジリガメ': 'カムカメ', 'ランターン': 'チョンチー',
    'ヤドキング': 'ヤドン', 'マホイップ': 'マホミル', 'ガラガラ': 'カラカラ', 'サイドン': 'サイホーン', 'ドサイドン': 'サイドン',
    'マルノーム': 'ゴクリン', 'バイウールー': 'ウールー', 'クエスパトラ': 'マメバッタ', 'フライゴンex': 'ビブラーバ', 'アップリュー': 'カジッチュ',
    'タルップル': 'カジッチュ', 'トランセル': 'キャタピー', 'バタフリー': 'トランセル', 'サナギラス': 'ヨーギラス', 'バンギラス': 'サナギラス',
    'ホップのサダイジャ': 'ホップのスナヘビ', 'マタドガス': 'ドガース', 'Nのギギアル': 'Nのギアル', 'Nのギギギアル': 'Nのギギアル',
    'ヒビキのマグマラシ': 'ヒビキのヒノアラシ', 'ヒビキのバクフーン': 'ヒビキのマグマラシ', 'シロナのミロカロス': 'シロナのヒンバス',
    'カミツオロチ': 'カミッチュ', 'ペパーのヨクバリス': 'ペパーのホシガリス',
    // 化石から進化するもの（化石のグッズは、まだ場に出せない）
    'ズガイドス': '古びたずがいの化石', 'タテトプス': '古びたたての化石', 'リリーラ': '古びたねっこの化石', 'ユレイドル': 'リリーラ'
};

// 文の中のエネルギーの記号（[R] など）の数。版によって記号が抜けていることがあるので、多い版の文を使う
const symbolCount = card => (JSON.stringify(card).match(/\[[A-Z]\]/g) ?? []).length;

const sets = readdirSync(DATA_DIR).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')));
const releaseOf = new Map(sets.map(set => [set.id, set.releaseDate ?? '']));
const prints = sets.flatMap(set => set.cards);

const cost = list => (list ?? []).filter(type => type !== 'Void').map(type => TYPES[type] ?? 'unknown');

// ダメージの「30+」「20×」などをそろえる（数値と、表に出す書き方）
function parseDamage(value) {
    if (value === undefined || value === null || value === '') return { damage: 0, damageText: '' };
    const text = normalizeText(String(value)).replace(/x$/i, '×');
    const number = Number.parseInt(text, 10);
    return { damage: Number.isNaN(number) ? 0 : number, damageText: text };
}

function convert(card) {
    const regulation = card.regulationMark ?? null;
    if (card.category === 'Energy') {
        if (card.energyType === 'Normal') {
            const type = BASIC_ENERGY_TYPES[card.name.replace(/^基本|エネルギー$/g, '')];
            return { id: `basic-${type}-energy`, kind: 'energy', basic: true, energyType: type, name: card.name, regulation: null };
        }
        return { id: card.id, kind: 'energy', basic: false, name: card.name, text: card.effect ?? '', regulation };
    }
    if (card.category === 'Trainer') {
        const result = { id: card.id, kind: 'trainer', trainerType: TRAINER_TYPES[card.trainerType] ?? 'unknown', name: card.name, text: card.effect ?? '', regulation };
        if (card.rarity === 'ACE SPEC Rare') result.aceSpec = true;
        return result;
    }
    const stage = card.stage === 'MEGA' ? (card.evolveFrom ? 1 : 0) : (STAGES[card.stage] ?? -1);
    const result = {
        id: card.id,
        kind: 'pokemon',
        name: card.name,
        stage,
        evolvesFrom: card.evolveFrom ?? null,
        hp: card.hp,
        type: TYPES[card.types?.[0]] ?? 'colorless',
        weakness: card.weaknesses?.[0] ? TYPES[card.weaknesses[0].type] : null,
        resistance: card.resistances?.[0] ? TYPES[card.resistances[0].type] : null,
        retreat: card.retreat ?? 0,
        rule: card.suffix === 'EX' ? (card.name.startsWith('メガ') ? 'mega' : 'ex') : null,
        regulation
    };
    if (card.abilities?.length) result.abilities = card.abilities.map(ability => ({ name: ability.name, text: ability.effect ?? '' }));
    result.attacks = (card.attacks ?? []).map(attack => ({ name: attack.name, cost: cost(attack.cost), ...parseDamage(attack.damage), text: attack.effect ?? '' }));
    return result;
}

// 名前と効果が同じなら同じカード（id・マーク・どの版かは比べない。版によって抜けていることがある、エネルギーの記号と進化元も比べない）
function signature(card) {
    const { id, regulation, evolvesFrom, ...rest } = card;
    return JSON.stringify(rest, (key, value) => (typeof value === 'string' ? normalizeText(value).replace(/\[[A-Z]\]/g, '') : value));
}

// トレーナーズの文の終わりにつく、ルールの注意書き（効果ではないので消す）
const TRAINER_REMINDERS = [
    /\s*サポートは、自分の番に1枚しか使えない。$/,
    /\s*スタジアムは、自分の番に1枚、バトル場の横に出せる。別のスタジアムが場に出たなら、このカードをトラッシュする。同じ名前のスタジアムは場に出せない。$/,
    /\s*ポケモンのどうぐは、自分の番に何枚でも、自分のポケモンにつけられる。ポケモン1匹につき1枚だけつけられ、つけたままにする。$/,
    /\s*グッズは、自分の番に何枚でも使える。$/
];
const stripReminders = text => TRAINER_REMINDERS.reduce((result, re) => result.replace(re, ''), text);

// トレーナーズと特殊エネルギーは、名前が同じなら同じカード（版によって言い回しや注意書きが少し違うだけ）
// ポケモンは、名前が同じでもワザや HP が違えば別のカード
const groups = new Map();
for (const print of prints) {
    const card = convert(print);
    if (card.text !== undefined) card.text = stripReminders(card.text);
    const key = card.kind === 'pokemon' ? signature(card) : card.kind === 'energy' && card.basic ? card.id : `${card.kind}:${card.name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ card, print });
}

const newer = (a, b) => (releaseOf.get(b.print.set.id) ?? '').localeCompare(releaseOf.get(a.print.set.id) ?? '') || a.print.id.localeCompare(b.print.id);
// 中身は、エネルギーの記号が一番多い版（同じなら一番新しい版）のもの。id は一番古い版の番号（新しいパックで再録されても、id が変わらないように）
const catalog = [...groups.values()].map(entries => {
    entries.sort(newer);
    const best = entries.reduce((chosen, entry) => (symbolCount(entry.card) > symbolCount(chosen.card) ? entry : chosen), entries[0]);
    const card = { ...best.card };
    if (card.kind === 'pokemon' && !card.evolvesFrom) card.evolvesFrom = entries.find(entry => entry.card.evolvesFrom)?.card.evolvesFrom ?? null;
    if (!(card.kind === 'energy' && card.basic)) card.id = entries[entries.length - 1].print.id;
    const marks = entries.map(entry => entry.card.regulation).filter(Boolean).sort();
    if (card.regulation !== null) card.regulation = marks[marks.length - 1] ?? null;
    if (!(card.kind === 'energy' && card.basic)) card.prints = entries.map(entry => entry.print.id);
    if (entries.some(entry => entry.card.aceSpec)) card.aceSpec = true;
    return card;
});

// 進化元が入っていない進化ポケモンは、同じ名前の別のカード（ワザなどが違う版）か、進化の系統から補う
const fromByName = new Map(catalog.filter(card => card.kind === 'pokemon' && card.evolvesFrom).map(card => [card.name, card.evolvesFrom]));
const missingFrom = [];
catalog.filter(card => card.kind === 'pokemon' && card.stage > 0 && !card.evolvesFrom).forEach(card => {
    card.evolvesFrom = fromByName.get(card.name) ?? KNOWN_EVOLUTIONS[card.name] ?? null;
    if (!card.evolvesFrom) missingFrom.push(`${card.name}（${card.id}）`);
});
if (missingFrom.length) console.log(`進化元がわからない進化ポケモン：${missingFrom.join('・')}`);

const KIND_ORDER = { pokemon: 0, trainer: 1, energy: 2 };
catalog.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id));

// TCGdex にない印（テラスタル・古代・未来・ACE SPEC）を、Limitless TCG の検索結果から補う
const tags = JSON.parse(readFileSync(join(ROOT, 'tools', 'data', 'limitless-tags.json'), 'utf8'));
const toPrintId = text => {
    const [set, number] = text.split(' ');
    return `${set === 'SVP' ? 'SV-P' : set}-${number.padStart(3, '0')}`;
};
const tagged = name => new Set(tags[name].map(toPrintId));
const [teraPrints, ancientPrints, futurePrints] = ['tera', 'ancient', 'future'].map(tagged);
const aceSpecNames = new Set(tags.aceSpecNames);
const tagCounts = { tera: 0, ancient: 0, future: 0, aceSpec: 0 };
catalog.forEach(card => {
    const prints = card.prints ?? [];
    if (card.kind === 'pokemon' && prints.some(print => teraPrints.has(print))) { card.tera = true; tagCounts.tera++; }
    if (prints.some(print => ancientPrints.has(print))) { card.ancient = true; tagCounts.ancient++; }
    if (prints.some(print => futurePrints.has(print))) { card.future = true; tagCounts.future++; }
    if (card.kind !== 'pokemon' && aceSpecNames.has(card.name)) card.aceSpec = true;
    if (card.aceSpec) tagCounts.aceSpec++;
});
console.log(`印：テラスタル ${tagCounts.tera}・古代 ${tagCounts.ancient}・未来 ${tagCounts.future}・ACE SPEC ${tagCounts.aceSpec}`);

const legacyIds = {};
for (const [oldId, [name, printId]] of Object.entries(LEGACY)) {
    const found = (printId && catalog.find(card => card.prints?.includes(printId))) || catalog.find(card => card.name === name);
    if (!found) throw new Error(`前の版のカード ${oldId}（${name}）が見つかりません`);
    legacyIds[oldId] = found.id;
}

const lines = [
    '// tools/build-cards.mjs が tools/data/tcgdex-ja から作るファイル。手で直さない',
    '// データ：TCGdex（https://tcgdex.dev）',
    '',
    'export const CATALOG = [',
    ...catalog.map(card => `${JSON.stringify(card)},`),
    '];',
    '',
    `export const LEGACY_IDS = ${JSON.stringify(legacyIds, null, 4)};`,
    ''
];
writeFileSync(OUT, lines.join('\n'));
const count = kind => catalog.filter(card => card.kind === kind).length;
console.log(`${prints.length} 枚から ${catalog.length} 種類（ポケモン ${count('pokemon')}・トレーナーズ ${count('trainer')}・エネルギー ${count('energy')}）を書き出しました`);
