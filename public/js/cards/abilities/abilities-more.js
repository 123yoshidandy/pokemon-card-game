/**
 * 特性の効果（エネルギーの数・にげる・手札から出せない・進化先・山札からのトラッシュ など、本体の仕組みを使うもの）。書き方は cards/HOOKS.md
 */

// 手札のこのカードを、ベンチに出す（進化ポケモンでも、たねポケモンのように出したばかりとして置く）
function benchFromHand(game, player, inst) {
    game.removeCard(player.hand, inst);
    player.bench.push(game.createPokemon(inst));
    game.log(`${player.name}は${game.cardName(inst)}をベンチに出した`);
}

// 自分の場に、そのタイプの「メガシンカex」がいるか
const hasMega = (game, player, type) => game.inPlay(player).some(pokemon => game.topCard(pokemon).rule === 'mega' && game.typesOf(pokemon).includes(type));

function isActive(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active === pokemon;
}

export const ABILITY_EFFECTS = {
    'エキサイトパワー': {
        type: 'passive',
        hooks: {
            damageDealt: (game, source, ctx, target) => (ctx.attacker === source.pokemon && hasMega(game, source.player, 'darkness')
                && game.ownerOf(target) !== source.player && isActive(game, target) ? 120 : 0)
        }
    },
    'エキサイトヒール': {
        type: 'activated',
        canUse: (game, player) => hasMega(game, player, 'grass') && game.inPlay(player).some(pokemon => pokemon.damage > 0),
        use: (game, player) => game.promptPokemon({
            player,
            pokemon: game.inPlay(player).filter(pokemon => pokemon.damage > 0),
            min: 1,
            max: 1,
            title: 'HPを60回復するポケモンを選ぶ',
            purpose: 'potion',
            callback: ([target]) => game.heal(target, 60)
        }),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => pokemon.damage >= 60)
    },
    'エキサイトターボ': {
        // 自分の番に何回でも使える。自分の手札から「基本[R]エネルギー」を1枚選び、ベンチの[R]ポケモンにつける
        type: 'activated',
        unlimited: true,
        canUse: (game, player) => hasMega(game, player, 'fire')
            && player.hand.some(inst => game.cardOf(inst).basic && game.cardOf(inst).energyType === 'fire')
            && player.bench.some(pokemon => game.typesOf(pokemon).includes('fire')),
        use: (game, player) => {
            const energy = player.hand.find(inst => game.cardOf(inst).basic && game.cardOf(inst).energyType === 'fire');
            const targets = player.bench.filter(pokemon => game.typesOf(pokemon).includes('fire'));
            const attach = target => {
                game.removeCard(player.hand, energy);
                game.attachFromOutside(target, energy);
            };
            if (targets.length === 1) {
                attach(targets[0]);
                return;
            }
            game.promptPokemon({ player, pokemon: targets, min: 1, max: 1, title: '基本炎エネルギーをつけるベンチの炎ポケモンを選ぶ', purpose: 'attach-energy-target', callback: ([target]) => attach(target) });
        },
        cpuWants: () => true
    },
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
