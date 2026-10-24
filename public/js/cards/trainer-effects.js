/**
 * トレーナーズの効果（カードの名前で引く。効果の文は catalog.js のものを使う）
 *
 * { canPlay(game, player), play(game, player), firstTurnOk, hooks, cpuWants(game, player) }
 *   サポートの firstTurnOk：先攻の最初の番でも使える
 *   どうぐ・スタジアムのいるだけで働く効果は hooks に書く（cards/HOOKS.md）
 *   スタジアム：canUse / use（自分の番に1回使える効果）
 *   cpuWants：CPU が今使いたいか（書かなければ、CPU は使わない。ここにある前からのカードは cpu-player.js が名前で判断する）
 * ここにないトレーナーズは、まだ動かないのでデッキに入れられない
 */

const isBasicEnergy = card => card.kind === 'energy' && card.basic;
const isBasicPokemon = card => card.kind === 'pokemon' && card.stage === 0;
const hasRule = card => Boolean(card.rule);
const isPokemonEx = card => card.rule === 'ex' || card.rule === 'mega';

const canDraw = (game, player) => player.deck.length > 0;

function searchPokemonToHand(game, player) {
    game.searchDeck({
        player,
        filter: card => card.kind === 'pokemon',
        max: 1,
        title: '手札に加えるポケモンを選ぶ',
        purpose: 'search-pokemon',
        onSelected: found => game.addToHand(player, found, { reveal: true })
    });
}

export const TRAINER_EFFECTS = {
    // ===== サポート =====
    'ガイ': {
        canPlay: canDraw,
        play: (game, player) => game.draw(player, 3)
    },
    'ゼイユ': {
        firstTurnOk: true,
        canPlay: canDraw,
        play: (game, player) => {
            game.discardHand(player);
            game.draw(player, 5);
        }
    },
    'リーリエの決心': {
        play: (game, player) => {
            game.shuffleHandIntoDeck(player);
            game.draw(player, player.prizes.length === 6 ? 8 : 6);
        }
    },
    'MCの盛り上げ': {
        canPlay: canDraw,
        play: (game, player) => game.draw(player, game.opponentOf(player).prizes.length <= 3 ? 4 : 2)
    },
    'ジャッジマン': {
        play: (game, player) => {
            const players = [player, game.opponentOf(player)];
            players.forEach(p => game.shuffleHandIntoDeck(p));
            players.forEach(p => game.draw(p, 4));
        }
    },
    'ボスの指令': {
        canPlay: (game, player) => game.opponentOf(player).bench.length > 0,
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            game.promptPokemon({
                player,
                pokemon: opponent.bench,
                min: 1,
                max: 1,
                title: 'バトル場に呼び出す相手のポケモンを選ぶ',
                purpose: 'boss-target',
                callback: ([target]) => game.switchActive(opponent, target)
            });
        }
    },

    // ===== グッズ =====
    'ハイパーボール': {
        // 手札から出す前に数えるので、このカード自身を除いて2枚
        canPlay: (game, player) => player.hand.length >= 3,
        play: (game, player) => {
            game.promptCards({
                player,
                cards: player.hand,
                min: 2,
                max: 2,
                title: 'トラッシュする手札を2枚選ぶ',
                purpose: 'ultra-ball-discard',
                callback: discarded => {
                    discarded.forEach(inst => game.moveCard(player.hand, player.discard, inst));
                    game.log(`${player.name}は${discarded.map(inst => game.cardName(inst)).join('と')}をトラッシュした`);
                    searchPokemonToHand(game, player);
                }
            });
        }
    },
    'なかよしポフィン': {
        canPlay: (game, player) => player.bench.length < game.benchSize,
        play: (game, player) => game.benchFromDeck(player, card => isBasicPokemon(card) && card.hp <= 70, 2, 'bench-basic')
    },
    'モンスターボール': {
        play: (game, player) => {
            if (game.flipCoin()) searchPokemonToHand(game, player);
        }
    },
    'ふしぎなアメ': {
        canPlay: (game, player) => game.rareCandyPairs(player).length > 0,
        play: (game, player) => {
            const pairs = game.rareCandyPairs(player);
            const stage2s = [...new Set(pairs.map(pair => pair.inst))];
            game.promptCards({
                player,
                cards: stage2s,
                min: 1,
                max: 1,
                title: '進化させる2進化ポケモンを選ぶ',
                purpose: 'rare-candy-card',
                callback: ([inst]) => {
                    const targets = pairs.filter(pair => pair.inst === inst).map(pair => pair.pokemon);
                    game.promptPokemon({
                        player,
                        pokemon: targets,
                        min: 1,
                        max: 1,
                        title: '進化させるたねポケモンを選ぶ',
                        purpose: 'rare-candy-target',
                        callback: ([target]) => game.evolveInto(player, target, inst)
                    });
                }
            });
        }
    },
    'ポケモンいれかえ': {
        canPlay: (game, player) => player.bench.length > 0 && Boolean(player.active),
        play: (game, player) => game.promptSwitchOwnActive(player, 'switch')
    },
    'きずぐすり': {
        canPlay: (game, player) => game.inPlay(player).some(pk => pk.damage > 0),
        play: (game, player) => game.promptPokemon({
            player,
            pokemon: game.inPlay(player).filter(pk => pk.damage > 0),
            min: 1,
            max: 1,
            title: '回復するポケモンを選ぶ',
            purpose: 'potion',
            callback: ([target]) => game.heal(target, 30)
        })
    },
    'エネルギー回収': {
        canPlay: (game, player) => player.discard.some(inst => isBasicEnergy(game.cardOf(inst))),
        play: (game, player) => {
            const energies = player.discard.filter(inst => isBasicEnergy(game.cardOf(inst)));
            const count = Math.min(2, energies.length);
            game.promptCards({
                player,
                cards: energies,
                min: count,
                max: count,
                title: '手札に加える基本エネルギーを選ぶ',
                purpose: 'energy-retrieval',
                callback: selected => {
                    selected.forEach(inst => game.moveCard(player.discard, player.hand, inst));
                    game.log(`${player.name}は${selected.map(inst => game.cardName(inst)).join('と')}を手札に加えた`);
                }
            });
        }
    },
    'エネルギー転送': {
        canPlay: canDraw,
        play: (game, player) => game.searchDeck({
            player,
            filter: card => isBasicEnergy(card),
            max: 1,
            title: '手札に加える基本エネルギーを選ぶ',
            purpose: 'search-energy',
            onSelected: found => game.addToHand(player, found, { reveal: true })
        })
    },
    'エネルギーつけかえ': {
        canPlay: (game, player) => game.inPlay(player).length >= 2
            && game.inPlay(player).some(pk => pk.energies.some(inst => isBasicEnergy(game.cardOf(inst)))),
        play: (game, player) => {
            const sources = game.inPlay(player).filter(pk => pk.energies.some(inst => isBasicEnergy(game.cardOf(inst))));
            game.promptPokemon({
                player,
                pokemon: sources,
                min: 1,
                max: 1,
                title: 'エネルギーをはがすポケモンを選ぶ',
                purpose: 'energy-switch-source',
                callback: ([source]) => {
                    game.promptPokemon({
                        player,
                        pokemon: game.inPlay(player).filter(pk => pk !== source),
                        min: 1,
                        max: 1,
                        title: 'エネルギーをつけるポケモンを選ぶ',
                        purpose: 'energy-switch-target',
                        callback: ([target]) => game.moveBasicEnergy(source, target)
                    });
                }
            });
        }
    },

    // ===== ポケモンのどうぐ =====
    'ふうせん': {
        retreatReduction: 2, // CPU がつけ先を選ぶときの目安
        hooks: {
            retreatCost: (game, source, pokemon) => (pokemon === source.pokemon ? -2 : 0)
        }
    },
    'ブレイブバングル': {
        damageBonus: true, // CPU がつけ先を選ぶときの目安（ルールを持たないポケモンにつける）
        hooks: {
            damageDealt: (game, source, ctx, target) => {
                if (ctx.attacker !== source.pokemon) return 0;
                const owner = game.ownerOf(target);
                const isActive = owner && owner.active === target;
                return !hasRule(game.topCard(ctx.attacker)) && isActive && isPokemonEx(game.topCard(target)) ? 30 : 0;
            }
        }
    },

    // ===== スタジアム =====
    'ミアレシティ': {
        canUse: (game, player) => player.bench.length < game.benchSize && player.deck.length > 0,
        use: (game, player) => {
            game.benchFromDeck(player, isBasicPokemon, 1, 'bench-basic');
            game.endTurnByEffect(player);
        }
    },
    'グラビティーマウンテン': {
        hpModifier: card => (card.stage === 2 ? -30 : 0), // CPU が出すか決めるときの目安
        hooks: {
            maxHp: (game, source, pokemon) => (game.topCard(pokemon).stage === 2 ? -30 : 0)
        }
    }
};
