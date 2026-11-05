/**
 * カードの描き方（手札・選択・説明・場のポケモンで共通）
 * ポケモンの絵は、モチーフの動物・ものの自作の図柄（motifs.js）。トレーナーズとエネルギーは、種類とタイプの記号で描く
 */

import { getCard, TYPE_NAMES, TRAINER_TYPE_NAMES, RULE_TEXTS } from '../card-data.js';
import { CONDITION_NAMES } from '../game.js';
import { MOTIF_ICONS, POKEMON_MOTIFS } from './motifs.js';

// タイプの記号（24×24）
const EMBLEMS = {
    fire: '<path d="M12 2.5c.8 3.6 5.5 5.7 5.5 11a5.5 5.5 0 0 1-11 0c0-3 1.6-4.6 2.3-7 1.3 1 2 2.4 2 4 1.2-2.3 1.6-5 1.2-8z"/>',
    lightning: '<path d="M13.5 2 4.5 13.6h6.3L9.5 22l9-11.6h-6.3z"/>',
    darkness: '<path d="M15.5 3.2A9 9 0 1 0 20.8 16 7.2 7.2 0 0 1 15.5 3.2z"/>',
    colorless: '<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 6L12 16.7l-5.3 2.9 1.1-6-4.4-4.1 6-.8z"/>',
    grass: '<path d="M19.5 4.5C10 4.5 5 9 5 15c0 1.6.4 3 1 4.2C8 14 11 11 15 9c-3.5 2.5-6 5.6-7.4 10.6A8 8 0 0 0 11 20.5c6 0 8.5-6 8.5-16z"/>',
    water: '<path d="M12 2.8C9 7.5 5.8 11 5.8 14.8a6.2 6.2 0 0 0 12.4 0C18.2 11 15 7.5 12 2.8z"/>',
    psychic: '<path d="M12 6C6.5 6 3 12 3 12s3.5 6 9 6 9-6 9-6-3.5-6-9-6zm0 9.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4z"/>',
    fighting: '<path d="M7 9.5V7.2a1.6 1.6 0 0 1 3.2 0V6a1.6 1.6 0 0 1 3.2 0v.6a1.6 1.6 0 0 1 3.2.4v1a1.6 1.6 0 0 1 3 .8v5.4c0 3.6-2.6 6.3-6.2 6.3h-1.6C8.6 20.5 6 18 6 14.5v-2a2 2 0 0 1 1-1.8z"/>',
    metal: '<path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4zm0 5.2-3.8 2.2v4.4L12 16.8l3.8-2.2v-4.4z" fill-rule="evenodd"/>',
    dragon: '<path d="M12 2.5 15 9l6.5 3-6.5 3-3 6.5L9 15l-6.5-3L9 9z"/>'
};

const TRAINER_ICONS = {
    item: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 12h16" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
    supporter: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c.8-4.2 3.8-6.5 7.5-6.5s6.7 2.3 7.5 6.5z"/>',
    stadium: '<path d="M3 20.5h18M5 20.5v-8l7-5 7 5v8M9.5 20.5v-5h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
    tool: '<path d="M14.5 3.5a5 5 0 0 0-4.8 6.4L3.5 16.1l4.4 4.4 6.2-6.2a5 5 0 0 0 6.4-4.8l-3 3-3.2-1-1-3.2z"/>'
};

const STAGE_NAMES = ['たね', '1進化', '2進化'];

export function emblemSvg(type, className = 'emblem') {
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${EMBLEMS[type] ?? EMBLEMS.colorless}</svg>`;
}

// ポケモンの絵：モチーフの動物・ものの図柄（motifs.js）。対応がなければタイプの記号
export function pokemonArt(card, className = 'emblem') {
    const icon = MOTIF_ICONS[POKEMON_MOTIFS[card.name]];
    if (!icon) return emblemSvg(card.type, className);
    return `<svg class="${className} motif" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${icon}</svg>`;
}

export function energyDot(type) {
    return `<span class="energy type-${type}" title="${TYPE_NAMES[type]}">${emblemSvg(type)}</span>`;
}

export function costDots(cost) {
    return `<span class="cost">${cost.map(energyDot).join('')}</span>`;
}

function escape(text) {
    return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// カードの面に出す特性とワザ（ワザは必要なエネルギーの色の丸・名前・ダメージ）。タイプの記号は後ろに薄く残す
function movesHtml(card) {
    const rows = [];
    if (card.ability) rows.push(`<div class="move move-ability"><span class="move-name">${escape(card.ability.name)}</span></div>`);
    card.attacks.forEach(attack => rows.push(`<div class="move"><span class="move-cost">${attack.cost.map(type => `<i class="move-dot type-${type}"></i>`).join('')}</span><span class="move-name">${escape(attack.name)}</span>${attack.damageText ? `<span class="move-dmg">${escape(attack.damageText)}</span>` : ''}</div>`));
    return rows.length ? `<div class="card-moves">${rows.join('')}</div>` : '';
}

// にげるコスト。場のポケモンで、効果で変わっているなら「元 → 今」と並べる
function retreatText(printed, actual) {
    const dots = n => (n ? costDots(Array(n).fill('colorless')) : 'なし');
    return actual === undefined || actual === printed ? dots(printed) : `<s>${dots(printed)}</s> → ${dots(actual)}`;
}

// カードの文。エネルギーの記号（[F] など）を、エネルギーの小さな印に置き換える
const ENERGY_CODES = { G: 'grass', R: 'fire', W: 'water', L: 'lightning', P: 'psychic', F: 'fighting', D: 'darkness', M: 'metal', N: 'dragon', C: 'colorless' };
function cardText(text) {
    return escape(text).replace(/\[([GRWLPFDMNC])\]/g, (_, code) => energyDot(ENERGY_CODES[code]));
}

// 場についたエネルギーの丸。特殊エネルギーは、出すタイプの色に縁取りを付けて見分ける
function attachedEnergyDot(card) {
    if (card.basic) return energyDot(card.energyType);
    const types = specialEnergyTypes(card);
    return energyDot(types.length === 1 ? types[0] : 'colorless').replace('class="energy ', 'class="energy energy-special ').replace(/title="[^"]*"/, `title="${escape(card.name)}"`);
}

// 特殊エネルギーが出すタイプ（どのタイプにもなる・わからないものは空）
function specialEnergyTypes(card) {
    try {
        const types = [...new Set((card.provides?.() ?? []).flatMap(entry => String(entry).split('|')))];
        return types.every(type => TYPE_NAMES[type] && type !== 'colorless') ? types : types.length === 1 && types[0] === 'colorless' ? ['colorless'] : [];
    } catch {
        return [];
    }
}

// カード1枚の表（手札・選択・タイトルの絵）
export function cardFace(id) {
    const card = getCard(id);
    if (card.kind === 'pokemon') {
        return `<div class="card card-pokemon type-${card.type}" data-card="${id}">
            <div class="card-head"><span class="card-stage">${STAGE_NAMES[card.stage]}</span><span class="card-hp">${card.hp}</span></div>
            <div class="card-art">${pokemonArt(card)}${movesHtml(card)}</div>
            <div class="card-name">${escape(card.name)}</div>
        </div>`;
    }
    if (card.kind === 'trainer') {
        return `<div class="card card-trainer trainer-${card.trainerType}" data-card="${id}">
            <div class="card-head"><span class="card-stage">${card.trainerType === 'tool' ? 'どうぐ' : TRAINER_TYPE_NAMES[card.trainerType]}</span></div>
            <div class="card-art"><svg class="emblem" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${TRAINER_ICONS[card.trainerType]}</svg></div>
            <div class="card-name">${escape(card.name)}</div>
        </div>`;
    }
    if (!card.basic) {
        // 特殊エネルギー：出すタイプの色と図柄。2タイプなら丸を並べ、どのタイプにもなるもの（レガシー・プリズムなど）は虹色
        const types = specialEnergyTypes(card);
        const main = types.length === 1 ? types[0] : 'colorless';
        const dots = types.length > 1 ? `<span class="special-types">${types.map(type => `<i class="move-dot type-${type}"></i>`).join('')}</span>` : '';
        return `<div class="card card-energy card-special type-${main} ${types.length === 0 ? 'any-type' : ''}" data-card="${id}">
        <span class="special-mark">特殊</span>
        <div class="card-art">${emblemSvg(main)}${dots}</div>
        <div class="card-name">${escape(card.name.replace('エネルギー', ''))}</div>
    </div>`;
    }
    return `<div class="card card-energy type-${card.energyType}" data-card="${id}">
        <div class="card-art">${emblemSvg(card.energyType)}</div>
        <div class="card-name">${escape(card.name.replace('エネルギー', ''))}</div>
    </div>`;
}

export function cardBack(extraClass = '') {
    return `<div class="card card-back ${extraClass}"><div class="card-back-mark"></div></div>`;
}

// 場のポケモン（view の pokemon）
export function pokemonTile(pokemon, { active = false } = {}) {
    if (pokemon.faceDown && !pokemon.top) return `<div class="mon mon-back ${active ? 'mon-active' : ''}" data-pokemon="${pokemon.id}">${cardBack()}</div>`;
    const card = getCard(pokemon.top);
    const remaining = Math.max(0, pokemon.hp - pokemon.damage);
    const ratio = remaining / pokemon.hp;
    const hpClass = ratio <= 0.25 ? 'hp-low' : ratio <= 0.5 ? 'hp-mid' : '';
    const conditions = pokemon.conditions.map(condition => `<span class="cond cond-${condition}">${CONDITION_NAMES[condition]}</span>`).join('');
    const energies = pokemon.energies.map(id => attachedEnergyDot(getCard(id))).join('');
    return `<div class="mon type-${card.type} ${active ? 'mon-active' : ''} ${pokemon.faceDown ? 'mon-facedown' : ''}" data-pokemon="${pokemon.id}">
        <div class="mon-head"><span class="mon-name">${escape(card.name)}</span><span class="mon-hp-num ${hpClass}">${remaining}</span></div>
        <div class="mon-art">${pokemonArt(card)}${movesHtml(card)}</div>
        <div class="mon-energies">${energies}</div>
        ${pokemon.tool ? `<span class="mon-tool" title="${escape([pokemon.tool, pokemon.tool2].filter(Boolean).map(tool => getCard(tool).name).join('・'))}"><svg viewBox="0 0 24 24" fill="currentColor">${TRAINER_ICONS.tool}</svg></span>` : ''}
        ${conditions ? `<div class="mon-conds">${conditions}</div>` : ''}
    </div>`;
}

// 代表の版（同じ名前の別のカードと見分けるため）
function printLabel(card) {
    return card.prints?.length ? escape(card.prints[0]) : null;
}

// レギュレーションマーク（基本エネルギーにはない）
function regulationMark(card) {
    return card.regulation ? `<span class="reg-mark" title="レギュレーション ${card.regulation}">${card.regulation}</span>` : '';
}

// 説明のシートの中身
export function cardDetail(id, pokemon = null) {
    const card = getCard(id);
    if (card.kind === 'pokemon') {
        const parts = [];
        const sub = [STAGE_NAMES[card.stage], card.evolvesFrom ? `${escape(card.evolvesFrom)}から進化` : null, printLabel(card)].filter(Boolean).join(' ・ ');
        parts.push(`<div class="detail-head type-${card.type}">${pokemonArt(card)}<div><div class="detail-name">${escape(card.name)}${regulationMark(card)}</div><div class="detail-sub">${sub}</div></div><div class="detail-hp">HP<b>${pokemon ? `${Math.max(0, pokemon.hp - pokemon.damage)}/${pokemon.hp}` : card.hp}</b></div></div>`);
        // 弱点・抵抗力・にげると、ついているエネルギー・特殊状態は、ワザより先に出す（説明が長くても、にげるコストなどが隠れないように）
        const weak = card.weakness ? `${energyDot(card.weakness)}×2` : 'なし';
        const resist = card.resistance ? `${energyDot(card.resistance)}−30` : 'なし';
        parts.push(`<div class="detail-stats"><span>弱点 ${weak}</span><span>抵抗力 ${resist}</span><span>にげる ${retreatText(card.retreat, pokemon?.retreat)}</span></div>`);
        if (pokemon) {
            const state = [];
            if (pokemon.energies.length) state.push(`エネルギー ${pokemon.energies.map(e => attachedEnergyDot(getCard(e))).join('')}`);
            if (pokemon.conditions.length) state.push(`特殊状態：${pokemon.conditions.map(c => CONDITION_NAMES[c]).join('・')}`);
            if (state.length) parts.push(`<div class="detail-extra">${state.map(e => `<div>${e}</div>`).join('')}</div>`);
        }
        if (card.rule) parts.push(`<div class="detail-rule">${RULE_TEXTS[card.rule]}</div>`);
        if (card.tera) parts.push('<div class="detail-rule">テラスタル：このポケモンがベンチにいるかぎり、ワザのダメージを受けない。</div>');
        if (card.ability) {
            parts.push(`<div class="detail-block" data-ability><div class="detail-title"><span class="tag tag-ability">特性</span>${escape(card.ability.name)}</div><p>${cardText(card.ability.text)}</p></div>`);
        }
        // カードのワザのあとに、どうぐ・特性などで使えるワザ（場のポケモンの extraAttacks）を続ける
        [...card.attacks, ...(pokemon?.extraAttacks ?? [])].forEach((attack, index) => {
            const extra = index >= card.attacks.length ? '<span class="tag tag-ability">ほかのカードのワザ</span>' : '';
            parts.push(`<div class="detail-block" data-attack="${index}"><div class="detail-title">${costDots(attack.cost)}<span class="attack-name">${escape(attack.name)}</span><span class="attack-damage">${escape(attack.damageText)}</span>${extra}</div>${attack.text ? `<p>${cardText(attack.text)}</p>` : ''}</div>`);
        });
        if (pokemon) {
            const extras = [];
            [pokemon.tool, pokemon.tool2].filter(Boolean).forEach(tool => extras.push(`どうぐ：${escape(getCard(tool).name)}（${cardText(getCard(tool).text)}）`));
            if (pokemon.cards.length > 1) extras.push(`進化元：${pokemon.cards.slice(0, -1).map(c => escape(getCard(c).name)).join(' → ')}`);
            if (extras.length) parts.push(`<div class="detail-extra">${extras.map(e => `<div>${e}</div>`).join('')}</div>`);
        }
        return parts.join('');
    }
    if (card.kind === 'trainer') {
        return `<div class="detail-head trainer-${card.trainerType}"><svg class="emblem" viewBox="0 0 24 24" fill="currentColor">${TRAINER_ICONS[card.trainerType]}</svg><div><div class="detail-name">${escape(card.name)}${regulationMark(card)}</div><div class="detail-sub">${[TRAINER_TYPE_NAMES[card.trainerType], card.aceSpec ? 'ACE SPEC' : null, printLabel(card)].filter(Boolean).join(' ・ ')}</div></div></div>
            <div class="detail-block"><p>${cardText(card.text)}</p></div>
            ${card.trainerType === 'supporter' ? '<div class="detail-rule">サポートは、自分の番に1枚しか使えない。</div>' : ''}
            ${card.trainerType === 'stadium' ? '<div class="detail-rule">スタジアムは、自分の番に1枚しか出せない。</div>' : ''}`;
    }
    if (!card.basic) {
        // 特殊エネルギー：カードの文をそのまま出す（色と図柄は、カードの面と同じく出すタイプで）
        const types = specialEnergyTypes(card);
        const main = types.length === 1 ? types[0] : 'colorless';
        const sub = ['特殊エネルギー', card.aceSpec ? 'ACE SPEC' : null, printLabel(card)].filter(Boolean).join(' ・ ');
        return `<div class="detail-head type-${main}">${emblemSvg(main)}<div><div class="detail-name">${escape(card.name)}${regulationMark(card)}</div><div class="detail-sub">${sub}</div></div></div>
        <div class="detail-block"><p>${cardText(card.text ?? '')}</p></div>`;
    }
    return `<div class="detail-head type-${card.energyType}">${emblemSvg(card.energyType)}<div><div class="detail-name">${escape(card.name)}</div><div class="detail-sub">基本エネルギー</div></div></div>
        <div class="detail-block"><p>${TYPE_NAMES[card.energyType]}エネルギー1個ぶんとして働く。</p></div>`;
}
