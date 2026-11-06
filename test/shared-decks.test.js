import { describe, it, expect } from 'vitest';
import { createSharedDecks, parseSharedDeckMessage, MemorySharedDeckStore } from '../server/src/shared-decks.js';
import { DECKS } from '../public/js/decks.js';

const setup = () => createSharedDecks(new MemorySharedDeckStore(), { now: () => 1000 });
const [first, second] = DECKS;

describe('共有デッキ（サーバー）', () => {
    it('初めは何も変わっていない', async () => {
        const handle = setup();
        expect(await handle({ action: 'getSharedDecks' })).toEqual({ type: 'sharedDecks', decks: {} });
    });

    it('遊べるデッキなら保存して、全員に同じ内容を返す', async () => {
        const handle = setup();
        const reply = await handle({ action: 'saveSharedDeck', id: first.id, name: '  みんなのデッキ  ', cards: second.cards });
        expect(reply.decks[first.id]).toEqual({ name: 'みんなのデッキ', cards: second.cards, updatedAt: 1000 });
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
        expect((await handle({ action: 'getSharedDecks' })).decks).toEqual({});
    });

    it('初期に戻すと、変えた内容が消える', async () => {
        const handle = setup();
        await handle({ action: 'saveSharedDeck', id: first.id, cards: second.cards });
        await handle({ action: 'saveSharedDeck', id: second.id, cards: first.cards });
        const reply = await handle({ action: 'resetSharedDeck', id: first.id });
        expect(Object.keys(reply.decks)).toEqual([second.id]);
    });

    it('共有デッキの操作だけを見分け、部屋の操作は部屋の処理に渡す', () => {
        expect(parseSharedDeckMessage('{"action":"getSharedDecks"}')).toEqual({ action: 'getSharedDecks' });
        expect(parseSharedDeckMessage('{"action":"join","roomCode":"1234"}')).toBeNull();
        expect(parseSharedDeckMessage('not json')).toBeNull();
        expect(parseSharedDeckMessage('')).toBeNull();
        expect(parseSharedDeckMessage(JSON.stringify({ action: 'saveSharedDeck', name: 'x'.repeat(9000) }))).toBeNull();
    });
});
