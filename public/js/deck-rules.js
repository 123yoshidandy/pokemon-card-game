/**
 * デッキの決まり：60枚・スタンダードで使えるカードだけ・同じ名前のカードは4枚まで（基本エネルギーは何枚でも）・
 * ACE SPEC は1枚まで・たねポケモンが1枚以上。まだ効果が動かないカードは入れられない
 */

import { CARDS, isBasicEnergy, isBasicPokemon } from './card-data.js';
import { isStandardLegal } from './regulation.js';

export const DECK_SIZE = 60;
export const MAX_COPIES = 4;
export const MAX_ACE_SPEC = 1;

// だめなら理由の文字列、よければ null
export function validateDeck(cards) {
    if (!Array.isArray(cards) || cards.length !== DECK_SIZE) return `デッキは${DECK_SIZE}枚です`;
    if (cards.some(id => typeof id !== 'string' || !Object.hasOwn(CARDS, id))) return 'デッキに不明なカードがあります';
    const illegal = cards.find(id => !isStandardLegal(CARDS[id]));
    if (illegal) return `スタンダードで使えないカードがあります（${CARDS[illegal].name}）`;
    const unsupported = cards.find(id => !CARDS[id].supported);
    if (unsupported) return `まだ使えないカードがあります（${CARDS[unsupported].name}）`;
    if (cards.filter(id => CARDS[id].aceSpec).length > MAX_ACE_SPEC) return `ACE SPEC のカードは${MAX_ACE_SPEC}枚までです`;
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
