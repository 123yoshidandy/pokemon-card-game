import { describe, it, expect } from 'vitest';
import { FILTER_GROUPS, matchesFilters, filterCount, toggleFilter } from '../public/js/card-filter.js';
import { CARD_POOL } from '../public/js/deck-builder.js';
import { getCard } from '../public/js/card-data.js';

const cards = CARD_POOL.map(getCard);
const pick = (kind, filters) => cards.filter(card => card.kind === kind && matchesFilters(card, filters));

describe('デッキ構築の詳しい条件', () => {
    it('条件がなければ、その種類のカードがすべて出る', () => {
        expect(pick('pokemon', {}).length).toBe(cards.filter(card => card.kind === 'pokemon').length);
        expect(pick('trainer', { stage: [] }).length).toBe(cards.filter(card => card.kind === 'trainer').length);
    });

    it('同じ項目の中は「または」：たねと1進化を選ぶと、どちらかのポケモン', () => {
        const result = pick('pokemon', { stage: ['0', '1'] });
        expect(result.length).toBeGreaterThan(0);
        expect(result.every(card => card.stage === 0 || card.stage === 1)).toBe(true);
        expect(result.length).toBe(pick('pokemon', { stage: ['0'] }).length + pick('pokemon', { stage: ['1'] }).length);
    });

    it('項目どうしは「かつ」：ポケモンex で特性があり、にげるが1', () => {
        const result = pick('pokemon', { rule: ['ex'], ability: ['yes'], retreat: ['1'] });
        expect(result.length).toBeGreaterThan(0);
        expect(result.every(card => card.rule === 'ex' && card.ability && card.retreat === 1)).toBe(true);
    });

    it('HP・弱点・抵抗力・テラスタル・古代・マーク', () => {
        expect(pick('pokemon', { hp: ['310-'] }).every(card => card.hp >= 310)).toBe(true);
        expect(pick('pokemon', { hp: ['70-100'] }).every(card => card.hp >= 70 && card.hp <= 100)).toBe(true);
        expect(pick('pokemon', { weakness: ['fire'] }).every(card => card.weakness === 'fire')).toBe(true);
        expect(pick('pokemon', { resistance: ['none'] }).every(card => !card.resistance)).toBe(true);
        expect(pick('pokemon', { rule: ['tera'] }).every(card => card.tera)).toBe(true);
        expect(pick('pokemon', { tag: ['ancient'] }).length).toBeGreaterThan(0);
        expect(pick('pokemon', { mark: ['J'] }).every(card => card.regulation === 'J')).toBe(true);
    });

    it('トレーナーズの種類は複数選べる：サポートとグッズ', () => {
        const result = pick('trainer', { trainerType: ['supporter', 'item'] });
        expect(result.length).toBeGreaterThan(0);
        expect(result.every(card => card.trainerType === 'supporter' || card.trainerType === 'item')).toBe(true);
        expect(result.some(card => card.trainerType === 'supporter') && result.some(card => card.trainerType === 'item')).toBe(true);
    });

    it('タイプも複数選べて、ほかの項目と組み合わせられる：草か炎の2進化', () => {
        const result = pick('pokemon', { type: ['grass', 'fire'], stage: ['2'] });
        expect(result.length).toBeGreaterThan(0);
        expect(result.every(card => (card.type === 'grass' || card.type === 'fire') && card.stage === 2)).toBe(true);
    });

    it('トレーナーズは ACE SPEC で、エネルギーはマークでしぼれる（基本エネルギーはマークなし）', () => {
        const ace = pick('trainer', { aceSpec: ['yes'] });
        expect(ace.length).toBeGreaterThan(0);
        expect(ace.every(card => card.aceSpec)).toBe(true);
        expect(pick('energy', { mark: ['none'] }).every(card => card.basic)).toBe(true);
    });

    it('どの HP のポケモンも、HP の選択肢のどれかに入る', () => {
        const hp = FILTER_GROUPS.pokemon.find(group => group.id === 'hp');
        expect(pick('pokemon', { hp: hp.options.map(option => option.id) }).length).toBe(pick('pokemon', {}).length);
    });

    it('選択肢の切り替えと、選んでいる数', () => {
        let filters = toggleFilter({}, 'stage', '0');
        filters = toggleFilter(filters, 'rule', 'ex');
        expect(filterCount('pokemon', filters)).toBe(2);
        filters = toggleFilter(filters, 'stage', '0');
        expect(filters.stage).toEqual([]);
        expect(filterCount('pokemon', filters)).toBe(1);
    });
});
