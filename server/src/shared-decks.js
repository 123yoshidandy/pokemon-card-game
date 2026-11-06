/**
 * 共有デッキ：構築済みデッキを、誰でも編集できるようにする（変えた内容は全員に同じものを返す）
 * 部屋の外の操作なので、部屋の処理（server/netplay/）より先に受け取って答える
 *
 * 端末から受け付ける操作（返事はどれも { type: 'sharedDecks', decks: { デッキのID: { name, cards, updatedAt } } }）
 *   { action: 'getSharedDecks' }                     変えた内容をすべて返す
 *   { action: 'saveSharedDeck', id, name, cards }    60枚の決まりに合うときだけ保存する
 *   { action: 'resetSharedDeck', id }                初期の内容に戻す（変えた内容を消す）
 * 受け付けられないときは { type: 'sharedDecksError', message } を返す
 */

import { DECKS, expandDeck } from '../../public/js/decks.js';
import { validateDeck } from '../../public/js/deck-rules.js';

const ACTIONS = new Set(['getSharedDecks', 'saveSharedDeck', 'resetSharedDeck']);
const MAX_MESSAGE_LENGTH = 8192;
const MAX_NAME_LENGTH = 16; // public/js/deck-store.js と同じ
const DECK_IDS = DECKS.map(deck => deck.id);

// 共有デッキの操作なら、読んだメッセージを返す（それ以外は null で、部屋の処理に渡す）
export function parseSharedDeckMessage(raw) {
    const text = typeof raw === 'string' ? raw : String(raw ?? '');
    if (!text || text.length > MAX_MESSAGE_LENGTH) return null;
    try {
        const message = JSON.parse(text);
        return message && typeof message === 'object' && ACTIONS.has(message.action) ? message : null;
    } catch {
        return null;
    }
}

// store：getAll(ids) / put(id, deck) / remove(id)
export function createSharedDecks(store, { now = () => Date.now() } = {}) {
    const all = async () => ({ type: 'sharedDecks', decks: await store.getAll(DECK_IDS) });
    const fail = message => ({ type: 'sharedDecksError', message });

    return async function handle(message) {
        if (message.action === 'getSharedDecks') return all();
        if (!DECK_IDS.includes(message.id)) return fail('共有デッキが見つかりません');
        if (message.action === 'resetSharedDeck') {
            await store.remove(message.id);
            return all();
        }
        const cards = cleanCards(message.cards);
        if (!cards) return fail('デッキの中身を読めませんでした');
        const problem = validateDeck(expandDeck({ cards }));
        if (problem) return fail(problem);
        const name = String(message.name ?? '').trim().slice(0, MAX_NAME_LENGTH) || DECKS.find(deck => deck.id === message.id).name;
        await store.put(message.id, { name, cards, updatedAt: now() });
        return all();
    };
}

// 保存先（メモリ）。手元のテスト用サーバーとテストで使う（DynamoDB は shared-deck-store.js）
export class MemorySharedDeckStore {
    constructor() {
        this.decks = new Map();
    }

    async getAll(ids) {
        return Object.fromEntries(ids.filter(id => this.decks.has(id)).map(id => [id, structuredClone(this.decks.get(id))]));
    }

    async put(id, deck) {
        this.decks.set(id, structuredClone(deck));
    }

    async remove(id) {
        this.decks.delete(id);
    }
}

// { カードのID: 枚数 } の形か（枚数は1〜60の整数）
function cleanCards(cards) {
    if (!cards || typeof cards !== 'object' || Array.isArray(cards)) return null;
    const entries = Object.entries(cards);
    if (entries.length === 0 || entries.length > 60) return null;
    if (entries.some(([id, count]) => typeof id !== 'string' || !Number.isInteger(count) || count < 1 || count > 60)) return null;
    return Object.fromEntries(entries);
}
