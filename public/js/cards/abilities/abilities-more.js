/**
 * 特性の効果（エネルギーの数・にげる・手札から出せない・進化先・山札からのトラッシュ など、本体の仕組みを使うもの）。書き方は cards/HOOKS.md
 */

// 手札のこのカードを、ベンチに出す（進化ポケモンでも、たねポケモンのように出したばかりとして置く）
function benchFromHand(game, player, inst) {
    game.removeCard(player.hand, inst);
    player.bench.push(game.createPokemon(inst));
    game.log(`${player.name}は${game.cardName(inst)}をベンチに出した`);
}

export const ABILITY_EFFECTS = {
    'おいしげる': {
        type: 'passive',
        hooks: {
            // 自分のポケモン全員についている「基本草エネルギー」は、それぞれ草エネルギー2個ぶん（重ならない：本体が hookAny で1つだけ使う）
            basicEnergyProvides: (game, source, pokemon, inst, card) => (game.ownerOf(pokemon) === source.player && card.energyType === 'grass'
                ? ['grass', 'grass'] : null)
        }
    },
    'ぬめぬめスリップ': {
        type: 'passive',
        hooks: {
            // 相手のバトルポケモンがにげるとき、相手はコインを1回投げる。ウラなら、にげられない（重ならない）
            retreatCoinFlip: (game, source, player) => player !== source.player
        }
    },
    'マイティソウル': {
        // このカードは、「イルカマン」の特性「マイティチェンジ」の効果によってしか場に出せない
        type: 'passive',
        cannotPlayFromHand: true
    },
    'にじいろDNA': {
        type: 'passive',
        hooks: {
            // このポケモンは、「イーブイ」から進化する「ポケモンex」を手札から出して、このポケモンにのせて進化できる
            allowEvolveOnto: (game, source, player, target, card) => target === source.pokemon
                && card.evolvesFrom === 'イーブイ' && (card.rule === 'ex' || card.rule === 'mega')
        }
    },
    'おまつりおんど': {
        // 場に「お祭り会場」が出ているなら、持っているワザを2回連続で使える（game.attack が見る）
        type: 'passive',
        attackTwice: game => Boolean(game.stadium) && game.cardName(game.stadium.inst) === 'お祭り会場'
    },
    'エキサイトダイブ': {
        // 自分の番に、このカードが手札にあり、自分の場に [C] タイプの「メガシンカex」がいるなら、1回使える。このカードをベンチに出す
        type: 'hand',
        canUse: (game, player) => player.bench.length < game.benchSize
            && game.inPlay(player).some(pokemon => game.topCard(pokemon).rule === 'mega' && game.typesOf(pokemon).includes('colorless')),
        use: (game, player, inst) => benchFromHand(game, player, inst)
    },
    'きんきゅうかいてん': {
        // 自分の番に、このカードが手札にあり、相手の場に2進化ポケモンがいるなら、1回使える。このカードをベンチに出す
        type: 'hand',
        canUse: (game, player) => player.bench.length < game.benchSize
            && game.inPlay(game.opponentOf(player)).some(pokemon => game.topCard(pokemon).stage === 2),
        use: (game, player, inst) => benchFromHand(game, player, inst)
    },
    'どっきりおとし': {
        type: 'passive',
        // 相手の番に、相手の効果で山札からトラッシュされたとき、相手の山札を上から8枚トラッシュする（game.millDeck が呼ぶ）
        onMilled: (game, owner) => game.millDeck(game.opponentOf(owner), 8)
    }
};
