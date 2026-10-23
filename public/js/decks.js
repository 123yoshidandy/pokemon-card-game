/**
 * 構築済みデッキ（60枚）
 */

export const DECKS = [
    {
        id: 'charizard',
        name: 'リザードンex',
        type: 'fire',
        cards: {
            'charmander': 4,
            'charmeleon': 2,
            'charizard-ex': 2,
            'growlithe': 3,
            'arcanine': 2,
            'professors-research': 4,
            'bosss-orders': 2,
            'judge': 2,
            'nest-ball': 4,
            'ultra-ball': 4,
            'rare-candy': 3,
            'switch': 2,
            'potion': 2,
            'energy-retrieval': 2,
            'bravery-charm': 2,
            'artazon': 2,
            'basic-fire-energy': 18
        }
    },
    {
        id: 'miraidon',
        name: 'ミライドンex',
        type: 'lightning',
        cards: {
            'miraidon-ex': 2,
            'pikachu': 4,
            'raichu': 3,
            'magnemite': 3,
            'magneton': 2,
            'professors-research': 4,
            'iono': 2,
            'bosss-orders': 2,
            'nest-ball': 4,
            'ultra-ball': 3,
            'switch': 3,
            'potion': 2,
            'energy-retrieval': 2,
            'bravery-charm': 2,
            'electric-generator': 4,
            'artazon': 2,
            'basic-lightning-energy': 16
        }
    }
];

export const DECK_SIZE = 60;

export function getDeck(id) {
    return DECKS.find(deck => deck.id === id) ?? null;
}

// デッキのカードIDの配列（{ id: 枚数 } を展開したもの）
export function expandDeck(deck) {
    return Object.entries(deck.cards).flatMap(([id, count]) => Array(count).fill(id));
}
