import { describe, it, expect } from 'vitest';
import { addCard, removeCard, canAdd, totalCount, deckProblem, mainEnergyType, sortedEntries, CARD_POOL } from '../public/js/deck-builder.js';
import { createDeckStore } from '../public/js/deck-store.js';
import { DECKS } from '../public/js/decks.js';

const empty = () => ({ id: 'd', name: 'テスト', cards: {} });
const addMany = (deck, id, count) => Array.from({ length: count }).reduce(d => addCard(d, id), deck);

function memoryStorage(initial = {}) {
    const data = { ...initial };
    return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; }, data };
}

describe('デッキの編集', () => {
    it('同じ名前のカードは4枚まで。基本エネルギーは何枚でも入る', () => {
        let deck = addMany(empty(), 'pikachu', 6);
        expect(deck.cards.pikachu).toBe(4);
        expect(canAdd(deck, 'pikachu')).toBe(false);
        deck = addMany(deck, 'basic-lightning-energy', 20);
        expect(deck.cards['basic-lightning-energy']).toBe(20);
    });

    it('60枚より多くは入らない', () => {
        const deck = addMany(empty(), 'basic-fire-energy', 70);
        expect(totalCount(deck)).toBe(60);
        expect(canAdd(deck, 'pikachu')).toBe(false);
    });

    it('減らして0枚になったら消える。元のデッキは変えない', () => {
        const before = addCard(empty(), 'potion');
        const after = removeCard(before, 'potion');
        expect(after.cards).toEqual({});
        expect(before.cards).toEqual({ potion: 1 });
        expect(removeCard(after, 'potion')).toBe(after);
    });

    it('遊べるかを確かめる：枚数・たねポケモン', () => {
        expect(deckProblem(addMany(empty(), 'pikachu', 4))).toBe('あと56枚');
        expect(deckProblem(addMany(empty(), 'basic-fire-energy', 60))).toContain('たねポケモン');
        DECKS.forEach(deck => expect(deckProblem(deck)).toBeNull());
    });

    it('一番多い基本エネルギーのタイプと、並べる順', () => {
        expect(mainEnergyType(DECKS[0])).toBe('fire');
        expect(mainEnergyType(empty())).toBeNull();
        const entries = sortedEntries({ cards: { 'basic-fire-energy': 2, potion: 1, charmander: 3 } });
        expect(entries.map(([id]) => id)).toEqual(['charmander', 'potion', 'basic-fire-energy']);
        expect(CARD_POOL.indexOf('charmander')).toBeLessThan(CARD_POOL.indexOf('potion'));
    });
});

describe('デッキの保存', () => {
    it('作る・保存する・読み直す・消す', () => {
        const storage = memoryStorage();
        const store = createDeckStore(storage);
        const deck = store.create();
        expect(deck.name).toBe('デッキ1');
        store.save({ ...deck, name: 'ぼくのデッキ', cards: { pikachu: 2 } });
        const reloaded = createDeckStore(storage);
        expect(reloaded.find(deck.id)).toEqual({ id: deck.id, name: 'ぼくのデッキ', cards: { pikachu: 2 } });
        expect(reloaded.create().name).toBe('デッキ1');
        reloaded.remove(deck.id);
        expect(createDeckStore(storage).find(deck.id)).toBeNull();
    });

    it('構築済みデッキをコピーできる。コピーを変えても元は変わらない', () => {
        const store = createDeckStore(memoryStorage());
        const copy = store.create(DECKS[0]);
        expect(copy.name).toBe('リザードンexのコピー');
        store.save(removeCard(copy, 'charmander'));
        expect(DECKS[0].cards.charmander).toBe(4);
        expect(store.find(copy.id).cards.charmander).toBe(3);
        expect(store.all().filter(deck => deck.builtIn)).toHaveLength(DECKS.length);
    });

    it('壊れた保存値・知らないカード・保存できない環境でも動く', () => {
        expect(createDeckStore(memoryStorage({ 'pokemon-card-game:decks': '{壊れ' })).custom()).toEqual([]);
        const saved = JSON.stringify([{ id: 'x', name: 'x', cards: { pikachu: 2, 'no-such-card': 3, potion: -1 } }]);
        expect(createDeckStore(memoryStorage({ 'pokemon-card-game:decks': saved })).find('x').cards).toEqual({ pikachu: 2 });
        const broken = { getItem: () => { throw new Error('使えない'); }, setItem: () => { throw new Error('使えない'); } };
        const store = createDeckStore(broken);
        expect(store.custom()).toEqual([]);
        expect(() => store.create()).not.toThrow();
        expect(createDeckStore(null).all()).toHaveLength(DECKS.length);
    });
});
