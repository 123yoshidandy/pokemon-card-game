/**
 * デッキの編集（DOM に依存しない）
 * デッキは { id, name, cards: { カードID: 枚数 } } の形（構築済みデッキと同じ）
 */

import { CARDS, isBasicEnergy } from './card-data.js';
import { DECK_SIZE, MAX_COPIES, validateDeck } from './deck-rules.js';
import { expandDeck } from './decks.js';
import { isStandardLegal } from './regulation.js';

// デッキ構築で使えるカード（スタンダードで使えて、効果が動くものだけ）
// ポケモン（進化ラインごと）→ トレーナーズ（種類 → 名前）→ エネルギー の順
const KIND_ORDER = { pokemon: 0, trainer: 1, energy: 2 };
const TYPE_ORDER = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal', 'dragon', 'colorless'];
const TRAINER_ORDER = ['supporter', 'item', 'tool', 'stadium'];
const legalCards = Object.values(CARDS).filter(card => isStandardLegal(card) && card.supported);

// 進化ライン：進化元をたどった先（いちばん元のたねポケモン、または化石）の名前
// 同じ名前でも版によって進化元が違うことがある（ナッシー ← タマタマ／アローラナッシー）ので、いちばん多いものを使う
const FROM_VOTES = new Map();
for (const card of Object.values(CARDS)) {
    if (card.kind !== 'pokemon' || !card.evolvesFrom) continue;
    const votes = FROM_VOTES.get(card.name) ?? new Map();
    votes.set(card.evolvesFrom, (votes.get(card.evolvesFrom) ?? 0) + 1);
    FROM_VOTES.set(card.name, votes);
}
const EVOLVES_FROM = new Map([...FROM_VOTES].map(([name, votes]) => [name, [...votes].sort((a, b) => b[1] - a[1])[0][0]]));
// たねの ex（イーブイex）は、ex のつかない同じ名前のラインに入れる
function lineRoot(name) {
    const seen = new Set([name]);
    while (EVOLVES_FROM.has(name) && !seen.has(EVOLVES_FROM.get(name))) {
        name = EVOLVES_FROM.get(name);
        seen.add(name);
    }
    return name.replace(/ex$/, '');
}
// ラインの並び順は、そのラインでいちばん進化の段階が低いカードのタイプ（イーブイのように、進化でタイプが変わっても1か所にまとめる）
const LINE_TYPE = new Map();
for (const card of legalCards.filter(item => item.kind === 'pokemon').sort((a, b) => a.stage - b.stage)) {
    const root = lineRoot(card.name);
    if (!LINE_TYPE.has(root)) LINE_TYPE.set(root, TYPE_ORDER.indexOf(card.type));
}

// [大きな並び, ライン（ポケモンだけ）, ライン内の並び]
const orderKey = card => {
    if (card.kind === 'pokemon') {
        const root = lineRoot(card.name);
        return [LINE_TYPE.get(root), root, card.stage];
    }
    if (card.kind === 'trainer') return [TRAINER_ORDER.indexOf(card.trainerType), '', 0];
    return [card.basic ? TYPE_ORDER.indexOf(card.energyType) : 99, '', 0];
};
export const CARD_POOL = legalCards
    .sort((a, b) => {
        const [a1, a2, a3] = orderKey(a);
        const [b1, b2, b3] = orderKey(b);
        return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a1 - b1 || a2.localeCompare(b2, 'ja') || a3 - b3
            || a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id);
    })
    .map(card => card.id);
const POOL_INDEX = new Map(CARD_POOL.map((id, index) => [id, index]));

export const totalCount = deck => Object.values(deck.cards).reduce((sum, count) => sum + count, 0);

// 同じ名前のカード（違うIDでも名前が同じなら合わせて数える）の枚数
function sameNameCount(deck, card) {
    return Object.entries(deck.cards)
        .filter(([id]) => CARDS[id]?.name === card.name)
        .reduce((sum, [, count]) => sum + count, 0);
}

// あと1枚足せるか
export function canAdd(deck, id) {
    const card = CARDS[id];
    if (!card || totalCount(deck) >= DECK_SIZE) return false;
    return isBasicEnergy(card) || sameNameCount(deck, card) < MAX_COPIES;
}

// 1枚足した新しいデッキ（足せなければ元のまま）
export function addCard(deck, id) {
    if (!canAdd(deck, id)) return deck;
    return { ...deck, cards: { ...deck.cards, [id]: (deck.cards[id] ?? 0) + 1 } };
}

export function removeCard(deck, id) {
    const count = deck.cards[id] ?? 0;
    if (count === 0) return deck;
    const cards = { ...deck.cards };
    if (count === 1) delete cards[id];
    else cards[id] = count - 1;
    return { ...deck, cards };
}

// 遊べるデッキか（だめなら理由、よければ null）
export function deckProblem(deck) {
    const total = totalCount(deck);
    if (total < DECK_SIZE) return `あと${DECK_SIZE - total}枚`;
    return validateDeck(expandDeck(deck));
}

// デッキに一番多い基本エネルギーのタイプ（CPU の相手のデッキを選ぶときに使う）
export function mainEnergyType(deck) {
    const counts = {};
    Object.entries(deck.cards).forEach(([id, count]) => {
        const card = CARDS[id];
        if (card && isBasicEnergy(card)) counts[card.energyType] = (counts[card.energyType] ?? 0) + count;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// デッキの中身を、ポケモン → トレーナーズ → エネルギーの順に並べる（[id, 枚数] の配列）
export function sortedEntries(deck) {
    return Object.entries(deck.cards)
        .filter(([id]) => CARDS[id])
        .sort((a, b) => (POOL_INDEX.get(a[0]) ?? Infinity) - (POOL_INDEX.get(b[0]) ?? Infinity));
}
