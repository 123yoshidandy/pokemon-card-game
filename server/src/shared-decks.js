/**
 * 共有デッキ：誰でも作り・編集し・初期に戻し・削除できるデッキ（変えた内容は全員に同じものを返す）
 * 構築済みデッキ（decks.js）は、初めからある共有デッキとして、作った共有デッキと同じに扱う
 * 部屋の外の操作なので、部屋の処理（server/netplay/）より先に受け取って答える
 *
 * 端末から受け付ける操作
 *   { action: 'getSharedDecks' }                     今の共有デッキを返す
 *   { action: 'createSharedDeck', name, cards }      新しく作る（返事の created に、作ったデッキのID）
 *   { action: 'saveSharedDeck', id, name, cards }    編集を保存する
 *   { action: 'resetSharedDeck', id }                初期の内容（構築済みはコードの中身、作ったものは作ったときの中身）に戻す
 *   { action: 'deleteSharedDeck', id }               削除する（最後の1つは消せない）
 * 作る・保存するのは、60枚の決まりに合うときだけ
 *
 * 返事は { type: 'sharedDecks', decks: { デッキのID: { name, cards, updatedAt, edited, createdAt? } }, deleted: [構築済みデッキのID] }
 *   decks には、変えた構築済みデッキと、作った共有デッキが入る（変えていない構築済みデッキは入らない）
 *   deleted は、削除した構築済みデッキ。前の版の画面は decks しか見ないので、削除は別に送る
 * 受け付けられないときは { type: 'sharedDecksError', message } を返す
 *
 * 保存の形（store。キーはデッキのID）
 *   構築済みを変えた：{ name, cards, updatedAt }
 *   構築済みを消した：{ deleted: true, updatedAt }
 *   作った：{ name, cards, initial: { name, cards }, createdAt, updatedAt }（消したら項目ごと消す）
 */

import { DECKS, expandDeck } from '../../public/js/decks.js';
import { validateDeck } from '../../public/js/deck-rules.js';

const ACTIONS = new Set(['getSharedDecks', 'createSharedDeck', 'saveSharedDeck', 'resetSharedDeck', 'deleteSharedDeck']);
const MAX_MESSAGE_LENGTH = 8192;
const MAX_NAME_LENGTH = 16; // public/js/deck-store.js と同じ
const MAX_CREATED = 100; // 作れる共有デッキの数（いたずらで増え続けないように）
const BUILT_IN = new Map(DECKS.map(deck => [deck.id, deck]));

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

const newSharedId = () => `shared-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

// store：getAll() / put(id, entry) / remove(id)
export function createSharedDecks(store, { now = () => Date.now(), newId = newSharedId } = {}) {
    const fail = message => ({ type: 'sharedDecksError', message });

    // 保存したものから、端末に返す形を作る
    const reply = (entries, extra = {}) => {
        const decks = {};
        const deleted = [];
        for (const [id, entry] of Object.entries(entries)) {
            if (BUILT_IN.has(id)) {
                if (entry.deleted) deleted.push(id);
                else decks[id] = { name: entry.name, cards: entry.cards, updatedAt: entry.updatedAt, edited: true };
            } else if (entry.initial) {
                decks[id] = { name: entry.name, cards: entry.cards, createdAt: entry.createdAt, updatedAt: entry.updatedAt, edited: !sameDeck(entry, entry.initial) };
            }
        }
        return { type: 'sharedDecks', decks, deleted, ...extra };
    };

    return async function handle(message) {
        const entries = await store.getAll();
        if (message.action === 'getSharedDecks') return reply(entries);

        if (message.action === 'createSharedDeck') {
            const deck = checkedDeck(message);
            if (typeof deck === 'string') return fail(deck);
            if (Object.values(entries).filter(entry => entry.initial).length >= MAX_CREATED) return fail('これ以上、共有デッキを作れません');
            const id = newId();
            const time = now();
            const entry = { ...deck, initial: deck, createdAt: time, updatedAt: time };
            await store.put(id, entry);
            return reply({ ...entries, [id]: entry }, { created: id });
        }

        const id = typeof message.id === 'string' ? message.id : '';
        const entry = entries[id];
        const builtIn = BUILT_IN.get(id);
        const exists = builtIn ? !entry?.deleted : Boolean(entry?.initial);
        if (!exists) return fail('共有デッキが見つかりません');

        if (message.action === 'saveSharedDeck') {
            const deck = checkedDeck(message, builtIn?.name ?? entry.name);
            if (typeof deck === 'string') return fail(deck);
            const next = { ...entry, ...deck, updatedAt: now() };
            await store.put(id, next);
            return reply({ ...entries, [id]: next });
        }

        if (message.action === 'resetSharedDeck') {
            if (builtIn) {
                await store.remove(id);
                const { [id]: _, ...rest } = entries;
                return reply(rest);
            }
            const next = { ...entry, ...entry.initial, updatedAt: now() };
            await store.put(id, next);
            return reply({ ...entries, [id]: next });
        }

        // deleteSharedDeck：最後の1つは残す（デッキを選ぶ画面や、CPU のデッキが空にならないように）
        const alive = [...BUILT_IN.keys()].filter(key => !entries[key]?.deleted).length
            + Object.values(entries).filter(item => item.initial).length;
        if (alive <= 1) return fail('最後の共有デッキは削除できません');
        if (builtIn) {
            const next = { deleted: true, updatedAt: now() };
            await store.put(id, next);
            return reply({ ...entries, [id]: next });
        }
        await store.remove(id);
        const { [id]: _, ...rest } = entries;
        return reply(rest);
    };
}

// 名前とカードを確かめて { name, cards } を返す。だめなら理由の文
function checkedDeck(message, fallbackName = 'デッキ') {
    const cards = cleanCards(message.cards);
    if (!cards) return 'デッキの中身を読めませんでした';
    const problem = validateDeck(expandDeck({ cards }));
    if (problem) return problem;
    const name = String(message.name ?? '').trim().slice(0, MAX_NAME_LENGTH) || fallbackName;
    return { name, cards };
}

function sameDeck(a, b) {
    if (a.name !== b.name) return false;
    const keys = Object.keys(a.cards);
    return keys.length === Object.keys(b.cards).length && keys.every(id => a.cards[id] === b.cards[id]);
}

// 保存先（メモリ）。手元のテスト用サーバーとテストで使う（DynamoDB は shared-deck-store.js）
export class MemorySharedDeckStore {
    constructor() {
        this.decks = new Map();
    }

    async getAll() {
        return Object.fromEntries([...this.decks].map(([id, entry]) => [id, structuredClone(entry)]));
    }

    async put(id, entry) {
        this.decks.set(id, structuredClone(entry));
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
