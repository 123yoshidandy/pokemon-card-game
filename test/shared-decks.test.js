import { describe, it, expect, afterEach } from 'vitest';
import { createSharedDecks, parseSharedDeckMessage, MemorySharedDeckStore } from '../server/src/shared-decks.js';
import { applySharedDecks } from '../public/js/shared-decks.js';
import { DECKS } from '../public/js/decks.js';

const BUILT_INS = [...DECKS];
const setup = () => {
    let n = 0;
    return createSharedDecks(new MemorySharedDeckStore(), { now: () => 1000 + n, newId: () => `shared-${++n}` });
};
const [first, second] = BUILT_INS;

describe('共有デッキ（サーバー）', () => {
    it('初めは何も変わっていない', async () => {
        const handle = setup();
        expect(await handle({ action: 'getSharedDecks' })).toEqual({ type: 'sharedDecks', decks: {}, deleted: [] });
    });

    it('遊べるデッキなら保存して、全員に同じ内容を返す', async () => {
        const handle = setup();
        const reply = await handle({ action: 'saveSharedDeck', id: first.id, name: '  みんなのデッキ  ', cards: second.cards });
        expect(reply.decks[first.id]).toEqual({ name: 'みんなのデッキ', cards: second.cards, updatedAt: 1000, edited: true });
        expect((await handle({ action: 'getSharedDecks' })).decks).toEqual(reply.decks);
    });

    it('名前が空なら初期の名前、長すぎれば16文字に詰める', async () => {
        const handle = setup();
        expect((await handle({ action: 'saveSharedDeck', id: first.id, name: '', cards: first.cards })).decks[first.id].name).toBe(first.name);
        expect((await handle({ action: 'saveSharedDeck', id: first.id, name: 'あ'.repeat(20), cards: first.cards })).decks[first.id].name).toBe('あ'.repeat(16));
    });

    it('60枚の決まりに合わないデッキや、知らないデッキは受け付けない', async () => {
        const handle = setup();
        const [id, count] = Object.entries(first.cards)[0];
        const short = { ...first.cards, [id]: count - 1 };
        expect(await handle({ action: 'saveSharedDeck', id: first.id, cards: short })).toEqual({ type: 'sharedDecksError', message: 'デッキは60枚です' });
        expect((await handle({ action: 'saveSharedDeck', id: first.id, cards: { 'no-such-card': 60 } })).type).toBe('sharedDecksError');
        expect((await handle({ action: 'saveSharedDeck', id: first.id, cards: [1, 2] })).type).toBe('sharedDecksError');
        expect((await handle({ action: 'saveSharedDeck', id: 'custom-1', cards: first.cards })).type).toBe('sharedDecksError');
        expect((await handle({ action: 'createSharedDeck', name: 'x', cards: short })).type).toBe('sharedDecksError');
        expect(await handle({ action: 'getSharedDecks' })).toEqual({ type: 'sharedDecks', decks: {}, deleted: [] });
    });

    it('初期に戻すと、変えた内容が消える', async () => {
        const handle = setup();
        await handle({ action: 'saveSharedDeck', id: first.id, cards: second.cards });
        await handle({ action: 'saveSharedDeck', id: second.id, cards: first.cards });
        const reply = await handle({ action: 'resetSharedDeck', id: first.id });
        expect(Object.keys(reply.decks)).toEqual([second.id]);
    });

    it('共有デッキを作ると、新しいIDで全員に届き、構築済みと同じく編集・初期に戻す・削除ができる', async () => {
        const handle = setup();
        const created = await handle({ action: 'createSharedDeck', name: '自作', cards: first.cards });
        expect(created.created).toBe('shared-1');
        expect(created.decks['shared-1']).toEqual({ name: '自作', cards: first.cards, createdAt: 1001, updatedAt: 1001, edited: false });
        expect((await handle({ action: 'getSharedDecks' })).decks['shared-1'].name).toBe('自作');

        const saved = await handle({ action: 'saveSharedDeck', id: 'shared-1', name: '直した', cards: second.cards });
        expect(saved.decks['shared-1']).toMatchObject({ name: '直した', cards: second.cards, createdAt: 1001, edited: true });
        // 名前を空にしたら、今の名前のまま
        expect((await handle({ action: 'saveSharedDeck', id: 'shared-1', name: ' ', cards: second.cards })).decks['shared-1'].name).toBe('直した');

        // 初期に戻すと、作ったときの中身に戻る
        const reset = await handle({ action: 'resetSharedDeck', id: 'shared-1' });
        expect(reset.decks['shared-1']).toMatchObject({ name: '自作', cards: first.cards, edited: false });

        const removed = await handle({ action: 'deleteSharedDeck', id: 'shared-1' });
        expect(removed.decks).toEqual({});
        expect(removed.deleted).toEqual([]);
        expect((await handle({ action: 'saveSharedDeck', id: 'shared-1', cards: first.cards })).type).toBe('sharedDecksError');
    });

    it('構築済みデッキを削除すると、削除した印が残って全員に届く。もう編集も初期に戻すもできない', async () => {
        const handle = setup();
        await handle({ action: 'saveSharedDeck', id: first.id, cards: second.cards });
        const reply = await handle({ action: 'deleteSharedDeck', id: first.id });
        expect(reply.decks).toEqual({});
        expect(reply.deleted).toEqual([first.id]);
        expect((await handle({ action: 'saveSharedDeck', id: first.id, cards: first.cards })).type).toBe('sharedDecksError');
        expect((await handle({ action: 'resetSharedDeck', id: first.id })).type).toBe('sharedDecksError');
        expect((await handle({ action: 'deleteSharedDeck', id: first.id })).type).toBe('sharedDecksError');
    });

    it('最後の1つの共有デッキは削除できない', async () => {
        const handle = setup();
        for (const deck of BUILT_INS.slice(1)) await handle({ action: 'deleteSharedDeck', id: deck.id });
        expect(await handle({ action: 'deleteSharedDeck', id: first.id })).toEqual({ type: 'sharedDecksError', message: '最後の共有デッキは削除できません' });
        // 作った共有デッキがあれば、最後の構築済みデッキも消せる
        await handle({ action: 'createSharedDeck', name: '自作', cards: first.cards });
        expect((await handle({ action: 'deleteSharedDeck', id: first.id })).deleted).toHaveLength(BUILT_INS.length);
        expect((await handle({ action: 'deleteSharedDeck', id: 'shared-1' })).type).toBe('sharedDecksError');
    });

    it('共有デッキの操作だけを見分け、部屋の操作は部屋の処理に渡す', () => {
        expect(parseSharedDeckMessage('{"action":"getSharedDecks"}')).toEqual({ action: 'getSharedDecks' });
        expect(parseSharedDeckMessage('{"action":"createSharedDeck"}')).toEqual({ action: 'createSharedDeck' });
        expect(parseSharedDeckMessage('{"action":"deleteSharedDeck","id":"x"}')).toEqual({ action: 'deleteSharedDeck', id: 'x' });
        expect(parseSharedDeckMessage('{"action":"join","roomCode":"1234"}')).toBeNull();
        expect(parseSharedDeckMessage('not json')).toBeNull();
        expect(parseSharedDeckMessage('')).toBeNull();
        expect(parseSharedDeckMessage(JSON.stringify({ action: 'saveSharedDeck', name: 'x'.repeat(9000) }))).toBeNull();
    });
});

describe('共有デッキ（画面）', () => {
    afterEach(() => applySharedDecks({}, []));

    it('届いた内容で DECKS を並べ直す：変えた構築済みは中身を当て、削除したものを除き、作ったものを作った順に後ろに足す', () => {
        applySharedDecks({
            [first.id]: { name: '変えた', cards: second.cards, edited: true },
            'shared-b': { name: 'あと', cards: first.cards, createdAt: 2, edited: true },
            'shared-a': { name: 'さき', cards: first.cards, createdAt: 1, edited: false }
        }, [second.id]);
        expect(DECKS.map(deck => deck.id)).toEqual([first.id, ...BUILT_INS.slice(2).map(deck => deck.id), 'shared-a', 'shared-b']);
        expect(DECKS[0]).toBe(first); // 構築済みは同じものを書き換える（タイプや説明を残す）
        expect(first).toMatchObject({ name: '変えた', cards: second.cards, edited: true });
        expect(DECKS.at(-2)).toMatchObject({ name: 'さき', edited: false });

        applySharedDecks({}, []);
        expect(DECKS).toEqual(BUILT_INS);
        expect(first.edited).toBe(false);
    });
});
