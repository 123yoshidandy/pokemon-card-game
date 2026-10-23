/**
 * カードの描き方（手札・選択・説明・場のポケモンで共通）
 * 絵は仮のもの：タイプの色とタイプの記号だけで描く
 */

import { getCard, TYPE_NAMES, TRAINER_TYPE_NAMES } from '../card-data.js';
import { CONDITION_NAMES } from '../game.js';

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

export function energyDot(type) {
    return `<span class="energy type-${type}" title="${TYPE_NAMES[type]}">${emblemSvg(type)}</span>`;
}

export function costDots(cost) {
    return `<span class="cost">${cost.map(energyDot).join('')}</span>`;
}

function escape(text) {
    return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// カード1枚の表（手札・選択・タイトルの絵）
export function cardFace(id) {
    const card = getCard(id);
    if (card.kind === 'pokemon') {
        return `<div class="card card-pokemon type-${card.type}" data-card="${id}">
            <div class="card-head"><span class="card-stage">${STAGE_NAMES[card.stage]}</span><span class="card-hp">${card.hp}</span></div>
            <div class="card-art">${emblemSvg(card.type)}</div>
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
    const energies = pokemon.energies.map(id => energyDot(getCard(id).energyType)).join('');
    return `<div class="mon type-${card.type} ${active ? 'mon-active' : ''} ${pokemon.faceDown ? 'mon-facedown' : ''}" data-pokemon="${pokemon.id}">
        <div class="mon-name">${escape(card.name)}</div>
        <div class="mon-art">${emblemSvg(card.type)}</div>
        <div class="mon-hp ${hpClass}"><span class="mon-hp-bar" style="width:${ratio * 100}%"></span><span class="mon-hp-text">${remaining}/${pokemon.hp}</span></div>
        <div class="mon-energies">${energies}</div>
        ${pokemon.tool ? `<span class="mon-tool" title="${escape(getCard(pokemon.tool).name)}"><svg viewBox="0 0 24 24" fill="currentColor">${TRAINER_ICONS.tool}</svg></span>` : ''}
        ${conditions ? `<div class="mon-conds">${conditions}</div>` : ''}
    </div>`;
}

// 説明のシートの中身
export function cardDetail(id, pokemon = null) {
    const card = getCard(id);
    if (card.kind === 'pokemon') {
        const parts = [];
        const sub = [STAGE_NAMES[card.stage], card.evolvesFrom ? `${getCard(card.evolvesFrom).name}から進化` : null, card.rule === 'ex' ? 'ex（きぜつするとサイド2枚）' : null].filter(Boolean).join(' ・ ');
        parts.push(`<div class="detail-head type-${card.type}">${emblemSvg(card.type)}<div><div class="detail-name">${escape(card.name)}</div><div class="detail-sub">${sub}</div></div><div class="detail-hp">HP<b>${pokemon ? `${Math.max(0, pokemon.hp - pokemon.damage)}/${pokemon.hp}` : card.hp}</b></div></div>`);
        if (card.tera) parts.push('<div class="detail-rule">テラスタル：このポケモンがベンチにいるかぎり、ワザのダメージを受けない。</div>');
        if (card.ability) {
            parts.push(`<div class="detail-block" data-ability><div class="detail-title"><span class="tag tag-ability">特性</span>${escape(card.ability.name)}</div><p>${escape(card.ability.text)}</p></div>`);
        }
        card.attacks.forEach((attack, index) => {
            parts.push(`<div class="detail-block" data-attack="${index}"><div class="detail-title">${costDots(attack.cost)}<span class="attack-name">${escape(attack.name)}</span><span class="attack-damage">${attack.damageText}</span></div>${attack.text ? `<p>${escape(attack.text)}</p>` : ''}</div>`);
        });
        const weak = card.weakness ? `${energyDot(card.weakness)}×2` : 'なし';
        const resist = card.resistance ? `${energyDot(card.resistance)}−30` : 'なし';
        parts.push(`<div class="detail-stats"><span>弱点 ${weak}</span><span>抵抗力 ${resist}</span><span>にげる ${card.retreat ? costDots(Array(card.retreat).fill('colorless')) : 'なし'}</span></div>`);
        if (pokemon) {
            const extras = [];
            if (pokemon.energies.length) extras.push(`エネルギー ${pokemon.energies.map(e => energyDot(getCard(e).energyType)).join('')}`);
            if (pokemon.tool) extras.push(`どうぐ：${escape(getCard(pokemon.tool).name)}（${escape(getCard(pokemon.tool).text)}）`);
            if (pokemon.conditions.length) extras.push(`特殊状態：${pokemon.conditions.map(c => CONDITION_NAMES[c]).join('・')}`);
            if (pokemon.cards.length > 1) extras.push(`進化元：${pokemon.cards.slice(0, -1).map(c => escape(getCard(c).name)).join(' → ')}`);
            if (extras.length) parts.push(`<div class="detail-extra">${extras.map(e => `<div>${e}</div>`).join('')}</div>`);
        }
        return parts.join('');
    }
    if (card.kind === 'trainer') {
        return `<div class="detail-head trainer-${card.trainerType}"><svg class="emblem" viewBox="0 0 24 24" fill="currentColor">${TRAINER_ICONS[card.trainerType]}</svg><div><div class="detail-name">${escape(card.name)}</div><div class="detail-sub">${TRAINER_TYPE_NAMES[card.trainerType]}</div></div></div>
            <div class="detail-block"><p>${escape(card.text)}</p></div>
            ${card.trainerType === 'supporter' ? '<div class="detail-rule">サポートは、自分の番に1枚しか使えない。</div>' : ''}
            ${card.trainerType === 'stadium' ? '<div class="detail-rule">スタジアムは、自分の番に1枚しか出せない。</div>' : ''}`;
    }
    return `<div class="detail-head type-${card.energyType}">${emblemSvg(card.energyType)}<div><div class="detail-name">${escape(card.name)}</div><div class="detail-sub">基本エネルギー</div></div></div>
        <div class="detail-block"><p>${TYPE_NAMES[card.energyType]}エネルギー1個ぶんとして働く。</p></div>`;
}
