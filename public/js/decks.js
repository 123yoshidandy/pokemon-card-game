/**
 * 構築済みデッキ（60枚。スタンダードのカードだけ）
 */

export const DECKS = [
    {
        id: 'charizard',
        name: 'メガリザードンYex',
        type: 'fire',
        cards: {
            'charmander': 4,
            'charmeleon': 2,
            'mega-charizard-y-ex': 3,
            'growlithe': 4,
            'arcanine': 2,
            'guy': 4,
            'zeiyu': 2,
            'bosss-orders': 2,
            'rare-candy': 4,
            'ultra-ball': 4,
            'poke-ball': 1,
            'lumiose-city': 2,
            'switch': 2,
            'potion': 1,
            'energy-retrieval': 2,
            'energy-search': 2,
            'float-stone': 2,
            'basic-fire-energy': 17
        }
    },
    {
        id: 'miraidon',
        name: 'ミライドンex',
        type: 'lightning',
        cards: {
            'miraidon-ex': 3,
            'pikachu': 4,
            'raichu': 3,
            'magnemite': 4,
            'magneton': 2,
            'magnezone': 2,
            'guy': 3,
            'lillies-determination': 2,
            'mc-hype': 2,
            'bosss-orders': 2,
            'judge': 1,
            'rare-candy': 2,
            'ultra-ball': 3,
            'buddy-buddy-poffin': 4,
            'switch': 2,
            'potion': 2,
            'energy-switch': 2,
            'brave-bangle': 2,
            'basic-lightning-energy': 15
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
