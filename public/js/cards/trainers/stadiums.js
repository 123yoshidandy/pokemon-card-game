/**
 * スタジアムの効果（カードの名前で引く）。書き方は cards/HOOKS.md
 *
 * スタジアムの hooks の source.pokemon は null。おたがいに働くものは、持ち主を確かめずに値を返す
 * canUse / use：自分の番に1回使える効果
 * cpuWants：CPU が今出したいか（自分に損なときは false）
 */

const isBasicPokemon = card => card.kind === 'pokemon' && card.stage === 0;
const isBasicLightning = card => card.kind === 'energy' && card.basic && card.energyType === 'lightning';
const ownedBy = prefix => card => card.name.startsWith(prefix);

function isActive(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active === pokemon;
}

// 場で条件に合うポケモンの数（自分 − 相手）。CPU が出したいかの目安
function countDiff(game, player, test) {
    const count = p => game.inPlay(p).filter(pokemon => test(game.topCard(pokemon), pokemon)).length;
    return count(player) - count(game.opponentOf(player));
}

// 自分のポケモン全員のHPを、それぞれ amount 回復する
function healAll(game, player, amount) {
    game.inPlay(player).filter(pokemon => pokemon.damage > 0).forEach(pokemon => game.heal(pokemon, amount));
}

// 偉大な大樹で進化させられる、場のたねポケモン
function treeBases(game, player) {
    return game.inPlay(player).filter(pokemon => game.topCard(pokemon).stage === 0 && !game.checkCanEvolveNow(player, pokemon));
}

export const TRAINER_EFFECTS = {
    'なみのりビーチ': {
        canUse: (game, player) => Boolean(player.active) && game.topCard(player.active).type === 'water'
            && player.bench.some(pokemon => game.topCard(pokemon).type === 'water'),
        use: (game, player) => game.promptPokemon({
            player,
            pokemon: player.bench.filter(pokemon => game.topCard(pokemon).type === 'water'),
            min: 1,
            max: 1,
            title: 'バトル場の[W]ポケモンと入れ替える、ベンチの[W]ポケモンを選ぶ',
            purpose: 'surfing-beach',
            callback: ([target]) => game.switchActive(player, target)
        }),
        cpuWants: (game, player) => countDiff(game, player, card => card.type === 'water') >= 0
    },
    'ミステリーガーデン': {
        canUse: (game, player) => player.hand.some(inst => game.cardOf(inst).kind === 'energy'),
        use: (game, player) => game.promptCards({
            player,
            cards: player.hand.filter(inst => game.cardOf(inst).kind === 'energy'),
            min: 1,
            max: 1,
            title: 'トラッシュするエネルギーを選ぶ',
            purpose: 'mystery-garden',
            callback: ([inst]) => {
                game.moveCard(player.hand, player.discard, inst);
                game.log(`${player.name}は${game.cardName(inst)}をトラッシュした`);
                const psychic = game.inPlay(player).filter(pokemon => game.topCard(pokemon).type === 'psychic').length;
                const count = psychic - player.hand.length;
                if (count > 0) game.draw(player, count);
            }
        }),
        cpuWants: (game, player) => countDiff(game, player, card => card.type === 'psychic') >= 0
    },
    'プリズムタワー': {
        canUse: (game, player) => player.hand.length >= 2,
        use: (game, player) => game.promptCards({
            player,
            cards: player.hand,
            min: 2,
            max: 2,
            title: 'トラッシュする手札を2枚選ぶ',
            purpose: 'prism-tower',
            callback: discarded => {
                discarded.forEach(inst => game.moveCard(player.hand, player.discard, inst));
                game.log(`${player.name}は${discarded.map(inst => game.cardName(inst)).join('と')}をトラッシュした`);
                game.draw(player, 1);
            }
        }),
        cpuWants: () => true
    },
    '伝説の山頂': {
        hooks: {
            prizeModifier: (game, source, pokemon, player, { byAttack }) => (byAttack && game.topCard(pokemon).type === 'colorless' ? -1 : 0)
        },
        cpuWants: (game, player) => countDiff(game, player, card => card.type === 'colorless') >= 0
    },
    '伝説の溶岩洞': {
        hooks: {
            suppressAbility: (game, source, pokemon) => game.topCard(pokemon).stage > 0
        },
        cpuWants: (game, player) => countDiff(game, player, card => card.stage > 0 && Boolean(card.ability)) <= 0
    },
    'おいわいファンファーレ': {
        canUse: () => true,
        use: (game, player) => {
            healAll(game, player, 10);
            game.endTurnByEffect(player);
        },
        cpuWants: () => true
    },
    'エキサイトスタジアム': {
        hooks: {
            maxHp: (game, source, pokemon) => (isBasicPokemon(game.topCard(pokemon)) ? 30 : 0)
        },
        cpuWants: (game, player) => countDiff(game, player, isBasicPokemon) >= 0
    },
    'ロケット団の監視塔': {
        hooks: {
            suppressAbility: (game, source, pokemon) => game.topCard(pokemon).type === 'colorless'
        },
        cpuWants: (game, player) => countDiff(game, player, card => card.type === 'colorless' && Boolean(card.ability)) <= 0
    },
    '公民館': {
        canUse: (game, player) => game.turnState.supporterPlayed && game.inPlay(player).some(pokemon => pokemon.damage > 0),
        use: (game, player) => healAll(game, player, 10),
        cpuWants: () => true
    },
    'フルメタルラボ': {
        hooks: {
            damageTaken: (game, source, ctx, target) => (game.topCard(target).type === 'metal' ? -30 : 0)
        },
        cpuWants: (game, player) => countDiff(game, player, card => card.type === 'metal') >= 0
    },
    'ジャミングタワー': {
        hooks: {
            suppressTool: () => true
        },
        cpuWants: (game, player) => countDiff(game, player, (card, pokemon) => Boolean(pokemon.tool)) < 0
    },
    '夜のアカデミー': {
        canUse: (game, player) => player.hand.length >= 1,
        use: (game, player) => game.promptCards({
            player,
            cards: player.hand,
            min: 1,
            max: 1,
            title: '山札の上にもどす手札を1枚選ぶ',
            purpose: 'academy-at-night',
            callback: ([inst]) => {
                game.removeCard(player.hand, inst);
                player.deck.unshift(inst);
                game.log(`${player.name}は手札を1枚、山札の上にもどした`);
            }
        }),
        cpuWants: () => true
    },
    '偉大な大樹': {
        canUse: (game, player) => {
            const names = new Set(treeBases(game, player).map(pokemon => game.topCard(pokemon).name));
            return player.deck.some(inst => {
                const card = game.cardOf(inst);
                return card.kind === 'pokemon' && card.stage === 1 && names.has(card.evolvesFrom);
            });
        },
        use: (game, player) => {
            const bases = treeBases(game, player);
            const names = new Set(bases.map(pokemon => game.topCard(pokemon).name));
            game.searchDeck({
                player,
                filter: card => card.kind === 'pokemon' && card.stage === 1 && names.has(card.evolvesFrom),
                max: 1,
                title: '進化させる1進化ポケモンを選ぶ',
                purpose: 'grand-tree-stage1',
                onSelected: ([stage1]) => {
                    if (!stage1) return;
                    const stage1Card = game.cardOf(stage1);
                    const targets = bases.filter(pokemon => game.topCard(pokemon).name === stage1Card.evolvesFrom);
                    const evolve = target => {
                        game.evolveFromOutside(player, target, stage1);
                        // 続けて2進化ポケモンに進化させてよい
                        game.searchDeck({
                            player,
                            filter: card => card.kind === 'pokemon' && card.stage === 2 && card.evolvesFrom === stage1Card.name,
                            max: 1,
                            title: '続けて進化させる2進化ポケモンを選ぶ（進化させないなら選ばない）',
                            purpose: 'grand-tree-stage2',
                            onSelected: ([stage2]) => { if (stage2) game.evolveFromOutside(player, target, stage2); }
                        });
                    };
                    if (targets.length === 1) {
                        evolve(targets[0]);
                        return;
                    }
                    game.promptPokemon({
                        player,
                        pokemon: targets,
                        min: 1,
                        max: 1,
                        title: '進化させるたねポケモンを選ぶ',
                        purpose: 'grand-tree-target',
                        callback: ([target]) => evolve(target)
                    });
                }
            });
        },
        cpuWants: () => true
    },
    'Nの城': {
        hooks: {
            retreatCost: (game, source, pokemon) => (ownedBy('Nの')(game.topCard(pokemon)) ? -99 : 0)
        },
        cpuWants: (game, player) => countDiff(game, player, ownedBy('Nの')) >= 0
    },
    'ハッコウシティ': {
        canUse: (game, player) => player.discard.some(inst => isBasicLightning(game.cardOf(inst))),
        use: (game, player) => {
            const energies = player.discard.filter(inst => isBasicLightning(game.cardOf(inst)));
            game.promptCards({
                player,
                cards: energies,
                min: 1,
                max: Math.min(2, energies.length),
                title: '手札に加える基本雷エネルギーを2枚まで選ぶ',
                purpose: 'levincia',
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.discard, inst));
                    game.addToHand(player, selected, { reveal: true });
                }
            });
        },
        cpuWants: () => true
    },
    'ハロンタウン': {
        hooks: {
            damageDealt: (game, source, ctx, target) => (ownedBy('ホップの')(game.topCard(ctx.attacker)) && isActive(game, target) ? 30 : 0)
        },
        cpuWants: (game, player) => countDiff(game, player, ownedBy('ホップの')) >= 0
    }
};
