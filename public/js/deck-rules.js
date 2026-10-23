/**
 * デッキの決まり：60枚・同じ名前のカードは4枚まで（基本エネルギーは何枚でも）・たねポケモンが1枚以上
 */

import { CARDS, isBasicEnergy, isBasicPokemon } from './card-data.js';

export const DECK_SIZE = 60;
export const MAX_COPIES = 4;

// だめなら理由の文字列、よければ null
export function validateDeck(cards) {
    if (!Array.isArray(cards) || cards.length !== DECK_SIZE) return `デッキは${DECK_SIZE}枚です`;
    if (cards.some(id => typeof id !== 'string' || !Object.hasOwn(CARDS, id))) return 'デッキに不明なカードがあります';
    const counts = new Map();
    for (const id of cards) {
        const card = CARDS[id];
        if (isBasicEnergy(card)) continue;
        counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
    }
    const over = [...counts].find(([, count]) => count > MAX_COPIES);
    if (over) return `同じ名前のカードは${MAX_COPIES}枚までです（${over[0]}）`;
    if (!cards.some(id => isBasicPokemon(CARDS[id]))) return 'デッキにたねポケモンが必要です';
    return null;
}
