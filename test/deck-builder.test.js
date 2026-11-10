import { describe, it, expect } from 'vitest';
import { addCard, removeCard, canAdd, totalCount, deckProblem, mainEnergyType, sortedEntries, CARD_POOL, deckToText, deckFromText } from '../public/js/deck-builder.js';
import { createDeckStore } from '../public/js/deck-store.js';
import { DECKS } from '../public/js/decks.js';
import { TEST_DECKS } from './test-decks.js';
import { getCard, CARDS, resolveCardId } from '../public/js/card-data.js';
import { C } from './helpers.js';

const empty = () => ({ id: 'd', name: 'テスト', cards: {} });
const addMany = (deck, id, count) => Array.from({ length: count }).reduce(d => addCard(d, id), deck);

function memoryStorage(initial = {}) {
    const data = { ...initial };
    return { getItem: key => data[key] ?? null, setItem: (key, value) => { data[key] = value; }, data };
}

describe('デッキの編集', () => {
    it('同じ名前のカードは4枚まで。基本エネルギーは何枚でも入る', () => {
        let deck = addMany(empty(), C.pikachu, 6);
        expect(deck.cards[C.pikachu]).toBe(4);
        expect(canAdd(deck, C.pikachu)).toBe(false);
        deck = addMany(deck, 'basic-lightning-energy', 20);
        expect(deck.cards['basic-lightning-energy']).toBe(20);
    });

    it('60枚より多くは入らない', () => {
        const deck = addMany(empty(), 'basic-fire-energy', 70);
        expect(totalCount(deck)).toBe(60);
        expect(canAdd(deck, C.pikachu)).toBe(false);
    });

    it('減らして0枚になったら消える。元のデッキは変えない', () => {
        const before = addCard(empty(), C.potion);
        const after = removeCard(before, C.potion);
        expect(after.cards).toEqual({});
        expect(before.cards).toEqual({ [C.potion]: 1 });
        expect(removeCard(after, C.potion)).toBe(after);
    });

    it('遊べるかを確かめる：枚数・たねポケモン', () => {
        expect(deckProblem(addMany(empty(), C.pikachu, 4))).toBe('あと56枚');
        expect(deckProblem(addMany(empty(), 'basic-fire-energy', 60))).toContain('たねポケモン');
        DECKS.forEach(deck => expect(deckProblem(deck)).toBeNull());
    });

    it('一番多い基本エネルギーのタイプと、並べる順', () => {
        expect(mainEnergyType(TEST_DECKS[0])).toBe('fire');
        expect(mainEnergyType(empty())).toBeNull();
        const entries = sortedEntries({ cards: { 'basic-fire-energy': 2, [C.potion]: 1, [C.charmander]: 3 } });
        expect(entries.map(([id]) => id)).toEqual([C.charmander, C.potion, 'basic-fire-energy']);
        expect(CARD_POOL.indexOf(C.charmander)).toBeLessThan(CARD_POOL.indexOf(C.potion));
    });
});

describe('デッキの保存', () => {
    it('作る・保存する・読み直す・消す', () => {
        const storage = memoryStorage();
        const store = createDeckStore(storage);
        const deck = store.create();
        expect(deck.name).toBe('デッキ1');
        store.save({ ...deck, name: 'ぼくのデッキ', cards: { [C.pikachu]: 2 } });
        const reloaded = createDeckStore(storage);
        expect(reloaded.find(deck.id)).toEqual({ id: deck.id, name: 'ぼくのデッキ', cards: { [C.pikachu]: 2 } });
        expect(reloaded.create().name).toBe('デッキ1');
        reloaded.remove(deck.id);
        expect(createDeckStore(storage).find(deck.id)).toBeNull();
    });

    it('構築済みデッキをコピーできる。コピーを変えても元は変わらない', () => {
        const store = createDeckStore(memoryStorage());
        const copy = store.create(TEST_DECKS[0]);
        expect(copy.name).toBe(`${TEST_DECKS[0].name}のコピー`);
        store.save(removeCard(copy, C.charmander));
        expect(TEST_DECKS[0].cards[C.charmander]).toBe(4);
        expect(store.find(copy.id).cards[C.charmander]).toBe(3);
        expect(store.all().filter(deck => deck.shared)).toHaveLength(DECKS.length);
    });

    it('同じデッキを2回コピーすると、名前に番号がつく（16文字に収まる）', () => {
        const store = createDeckStore(memoryStorage());
        store.create(TEST_DECKS[0]);
        const second = store.create(TEST_DECKS[0]);
        expect(second.name.endsWith('のコピー2')).toBe(true);
        expect(second.name.length).toBeLessThanOrEqual(16);
        const long = { name: 'とてもながいなまえのデッキです', cards: {} };
        expect(store.create(long).name).toHaveLength(16);
        const longSecond = store.create(long);
        expect(longSecond.name.endsWith('のコピー2')).toBe(true);
        expect(longSecond.name).toHaveLength(16);
    });

    it('壊れた保存値・知らないカード・保存できない環境でも動く。前の版のカードIDは今のIDに読み替える', () => {
        expect(createDeckStore(memoryStorage({ 'pokemon-card-game:decks': '{壊れ' })).custom()).toEqual([]);
        const saved = JSON.stringify([{ id: 'x', name: 'x', cards: { pikachu: 2, 'no-such-card': 3, potion: -1 } }]);
        expect(createDeckStore(memoryStorage({ 'pokemon-card-game:decks': saved })).find('x').cards).toEqual({ [C.pikachu]: 2 });
        const broken = { getItem: () => { throw new Error('使えない'); }, setItem: () => { throw new Error('使えない'); } };
        const store = createDeckStore(broken);
        expect(store.custom()).toEqual([]);
        expect(() => store.create()).not.toThrow();
        expect(createDeckStore(null).all()).toHaveLength(DECKS.length);
    });
});

describe('カード一覧の並び', () => {
    const pokemon = CARD_POOL.map(getCard).filter(card => card.kind === 'pokemon');
    const positions = names => pokemon.flatMap((card, index) => (names.includes(card.name) ? [index] : []));

    it('進化ラインごとに続けて並び、ラインの中はたね → 1進化 → 2進化', () => {
        const line = positions(['ヒトカゲ', 'リザード', 'メガリザードンXex', 'メガリザードンYex']);
        expect(line.length).toBeGreaterThan(3);
        expect(line.at(-1) - line[0]).toBe(line.length - 1);
        const stages = line.map(index => pokemon[index].stage);
        expect(stages).toEqual([...stages].sort((a, b) => a - b));
    });

    it('進化でタイプが変わっても、たねポケモンのラインにまとめる。たねの ex も同じライン', () => {
        const line = positions(['イーブイ', 'イーブイex', 'シャワーズex', 'サンダースex', 'ブースターex', 'エーフィex', 'ブラッキーex', 'リーフィア', 'リーフィアex', 'グレイシア', 'グレイシアex', 'ニンフィア', 'ニンフィアex']);
        expect(line.at(-1) - line[0]).toBe(line.length - 1);
        expect(pokemon[line[0]].name).toBe('イーブイ');
    });
});

describe('進化元', () => {
    // TCGdex にないパックにしか、進化元のカードがないもの
    const NO_DATA = ['マリィのギモー', 'ダイゴのメタング'];
    const all = Object.values(CARDS).filter(card => card.kind === 'pokemon');
    const stagesOf = name => new Set(all.filter(card => card.name === name).map(card => card.stage));

    it('進化元は、進化の段階がちょうど1つ下のポケモン（化石は除く）', () => {
        const wrong = all
            .filter(card => card.evolvesFrom && !/化石/.test(card.evolvesFrom) && !NO_DATA.includes(card.evolvesFrom))
            .filter(card => !stagesOf(card.evolvesFrom).has(card.stage - 1))
            .map(card => `${card.name}（${card.id}）← ${card.evolvesFrom}`);
        expect(wrong).toEqual([]);
    });

    it('同じ名前のポケモンは、どの版でも進化元が同じ', () => {
        const fromOf = new Map();
        for (const card of all.filter(item => item.evolvesFrom)) fromOf.set(card.name, new Set([...(fromOf.get(card.name) ?? []), card.evolvesFrom]));
        expect([...fromOf].filter(([, froms]) => froms.size > 1).map(([name, froms]) => `${name}：${[...froms].join('／')}`)).toEqual([]);
    });

    it('TCGdex の誤りを直したもの：ナッシーはタマタマから、メガリザードンXex はリザードから進化する', () => {
        expect(getCard(resolveCardId('M1L-005')).evolvesFrom).toBe('タマタマ');
        expect(all.filter(card => card.name === 'メガリザードンXex').every(card => card.evolvesFrom === 'リザード')).toBe(true);
        expect(all.find(card => card.name === 'アローラ ゴローン').evolvesFrom).toBe('アローラ イシツブテ');
    });
});

describe('デッキの書き出しと取り込み', () => {
    it('書き出して取り込むと、同じ中身に戻る', () => {
        for (const deck of [...TEST_DECKS, ...DECKS]) {
            const { cards, unknown } = deckFromText(deckToText(deck));
            expect(unknown).toEqual([]);
            expect(cards).toEqual(deck.cards);
        }
    });

    it('1行に「枚数 名前 版の番号」。基本エネルギーは版の番号なし', () => {
        const lines = deckToText(TEST_DECKS[0]).split('\n');
        expect(lines).toContain(`4 ヒトカゲ ${getCard(C.charmander).prints[0]}`);
        expect(lines).toContain('17 基本炎エネルギー');
    });

    it('版の番号がなくても名前で読める。全角の数字・空白入りの名前・「×」も読む。読めない行は返す', () => {
        const { cards, unknown } = deckFromText('４ ヒトカゲ\n2× リザード\n\n1 アローラ ゴローン\n3 そんなカードはない\nメモ');
        const byName = Object.entries(cards).map(([id, count]) => [getCard(id).name, count]);
        expect(byName).toEqual([['ヒトカゲ', 4], ['リザード', 2], ['アローラ ゴローン', 1]]);
        expect(unknown).toEqual(['3 そんなカードはない', 'メモ']);
    });
});
