/**
 * 作ったデッキの保存（localStorage）
 * 構築済みデッキ（decks.js）と同じ { id, name, cards } の形で、いくつでも保存できる
 */

import { DECKS } from './decks.js';
import { CARDS, resolveCardId } from './card-data.js';

const STORAGE_KEY = 'pokemon-card-game:decks';
export const MAX_NAME_LENGTH = 16;

const browserStorage = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function createDeckStore(storage = browserStorage()) {
    let decks = load();

    function load() {
        try {
            const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]');
            return Array.isArray(saved) ? saved.filter(isDeckLike).map(clean) : [];
        } catch {
            return [];
        }
    }

    function persist() {
        try {
            storage?.setItem(STORAGE_KEY, JSON.stringify(decks));
        } catch {
            // 保存できない環境でも、この画面を開いている間は使える
        }
    }

    return {
        // 作ったデッキ（新しい順）
        custom: () => decks,
        // 共有デッキ（DECKS。shared-decks.js がサーバーの内容で並べ直す）と、作ったデッキ
        all: () => [...DECKS.map(deck => ({ ...deck, shared: true })), ...decks],
        find: id => DECKS.find(deck => deck.id === id) ?? decks.find(deck => deck.id === id) ?? null,

        // 新しく作る（base を渡すと、その中身をコピーする）
        create(base = null) {
            const deck = {
                id: `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
                name: base ? copyName(base.name) : nextName(),
                cards: base ? { ...base.cards } : {}
            };
            decks = [deck, ...decks];
            persist();
            return deck;
        },

        save(deck) {
            const next = clean(deck);
            decks = decks.map(saved => (saved.id === next.id ? next : saved));
            persist();
            return next;
        },

        remove(id) {
            decks = decks.filter(deck => deck.id !== id);
            persist();
        }
    };

    function nextName() {
        for (let n = 1; ; n++) {
            const name = `デッキ${n}`;
            if (!decks.some(deck => deck.name === name)) return name;
        }
    }

    // 「〇〇のコピー」。もうあれば「〇〇のコピー2」…（長すぎるときは、元の名前のほうを詰める）
    function copyName(baseName) {
        for (let n = 1; ; n++) {
            const suffix = `のコピー${n === 1 ? '' : n}`;
            const name = baseName.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
            if (!decks.some(deck => deck.name === name)) return name;
        }
    }
}

function isDeckLike(deck) {
    return deck && typeof deck.id === 'string' && typeof deck.name === 'string' && deck.cards && typeof deck.cards === 'object';
}

// 前の版のカードIDは今のIDに読み替える。知らないカード（カードを外したときなど）や、おかしな枚数は捨てる
function clean(deck) {
    const cards = {};
    Object.entries(deck.cards).forEach(([savedId, count]) => {
        const id = resolveCardId(savedId);
        if (!Object.hasOwn(CARDS, id) || !Number.isInteger(count) || count <= 0) return;
        cards[id] = (cards[id] ?? 0) + count;
    });
    const name = String(deck.name).trim().slice(0, MAX_NAME_LENGTH) || 'デッキ';
    return { id: deck.id, name, cards };
}
