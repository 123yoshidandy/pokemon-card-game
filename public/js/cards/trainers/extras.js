/**
 * トレーナーズの効果（プレイヤーにかかる効果のフックや、使ったカードの行き先などを使うもの）。書き方は cards/HOOKS.md
 */

const isPokemonEx = card => card.rule === 'ex' || card.rule === 'mega';

// そのポケモンが、持ち主のバトル場にいるか
function isActive(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active === pokemon;
}

// 相手のバトル場のポケモンへの、ワザのダメージか
const toOpponentActive = (game, source, ctx, target) => ctx.player === source.player && game.ownerOf(target) !== source.player && isActive(game, target);

// きのみ：相手の [タイプ] ポケモンから受けるワザのダメージを -60 し、このカードをトラッシュする
function berry(type) {
    const fromType = (game, ctx) => game.topCard(ctx.attacker).type === type;
    return {
        hooks: {
            damageTaken: (game, source, ctx, target) => (target === source.pokemon && fromType(game, ctx) ? -60 : 0),
            afterAttackDamage: (game, source, ctx, target) => {
                if (target === source.pokemon && fromType(game, ctx) && target.tool === source.inst) game.discardTool(target);
            }
        },
        // 弱点のタイプのきのみをつける（弱点のポケモンからダメージを受けやすいので）
        cpuTarget: (game, player, pokemon) => game.topCard(pokemon).weakness === type,
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => game.topCard(pokemon).weakness === type && !pokemon.tool)
    };
}

// 手札を山札にもどして、決まった枚数を引く（おたがいのプレイヤー）
function refreshHands(game, player, mine, theirs) {
    const opponent = game.opponentOf(player);
    [player, opponent].forEach(p => game.shuffleHandIntoDeck(p));
    game.draw(player, mine);
    game.draw(opponent, theirs);
}

export const TRAINER_EFFECTS = {
    // ===== ポケモンのどうぐ =====
    'ウタンのみ': berry('psychic'),
    'オッカのみ': berry('fire'),
    'イトケのみ': berry('water'),
    'ナモのみ': berry('darkness'),
    'リリバのみ': berry('metal'),
    'ハバンのみ': berry('dragon'),

    // ===== グッズ =====
    'パワープロテイン': {
        play: (game, player) => game.addPlayerEffect(player, 'powerProtein', game.turn, {
            hooks: {
                damageDealt: (g, source, ctx, target) => (toOpponentActive(g, source, ctx, target) && g.topCard(ctx.attacker).type === 'fighting' ? 30 : 0)
            }
        }),
        cpuWants: (game, player) => Boolean(player.active) && game.topCard(player.active).type === 'fighting'
            && !game.turnState.attacked && game.topCard(player.active).attacks.some(attack => game.canPayCost(player.active, game.attackCost(player.active, attack)))
    },
    'アイアンディフェンダー': {
        // 新しく場に出したポケモンもふくむので、プレイヤーにかかる効果として、持ち主で判断する
        play: (game, player) => game.addPlayerEffect(player, 'ironDefender', game.turn + 1, {
            hooks: {
                damageTaken: (g, source, ctx, target) => (g.ownerOf(target) === source.player && ctx.player !== source.player ? -30 : 0)
            }
        }),
        cpuWants: () => false
    },
    'アンフェアスタンプ': {
        // 「前の相手の番に、自分のポケモンがきぜつしていなければ使えない」（きぜつの理由は問わない）
        canPlay: (game, player) => player.knockedOutTurn === game.turn - 1,
        play: (game, player) => refreshHands(game, player, 5, 2),
        cpuWants: (game, player) => game.opponentOf(player).hand.length >= 4
    },

    // ===== サポート =====
    'からておうの稽古': {
        play: (game, player) => game.addPlayerEffect(player, 'karateMaster', game.turn, {
            hooks: {
                damageDealt: (g, source, ctx, target) => (toOpponentActive(g, source, ctx, target) && isPokemonEx(g.topCard(target)) ? 40 : 0)
            }
        }),
        cpuWants: (game, player) => Boolean(game.opponentOf(player).active) && isPokemonEx(game.topCard(game.opponentOf(player).active))
    },
    'スグリ': {
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            game.promptChoose({
                player,
                options: ['自分のバトルポケモンをベンチポケモンと入れ替える', 'この番、相手のバトル場の「ポケモンex・V」へのダメージ+30'],
                title: 'スグリ：使う効果を選ぶ',
                purpose: 'choose-effect',
                cpuAnswer: g => [opponent.active && isPokemonEx(g.topCard(opponent.active)) ? 1 : 0],
                callback: ([index]) => {
                    if (index === 0) {
                        game.promptSwitchOwnActive(player, 'switch');
                        return;
                    }
                    game.addPlayerEffect(player, 'kieran', game.turn, {
                        hooks: {
                            damageDealt: (g, source, ctx, target) => (toOpponentActive(g, source, ctx, target) && isPokemonEx(g.topCard(target)) ? 30 : 0)
                        }
                    });
                }
            });
        },
        cpuWants: (game, player) => Boolean(game.opponentOf(player).active) && isPokemonEx(game.topCard(game.opponentOf(player).active))
    },
    'ミカンのまなざし': {
        play: (game, player) => game.addPlayerEffect(player, 'jasmine', game.turn + 1, {
            hooks: {
                damageTaken: (g, source, ctx, target) => (g.ownerOf(target) === source.player && ctx.player !== source.player ? -30 : 0)
            }
        }),
        cpuWants: () => false
    },
    'ホミカの演奏': {
        // 次の相手の番、相手のどくのポケモンはにげられない（新しくどくにしたポケモンもふくむ）
        play: (game, player) => game.addPlayerEffect(game.opponentOf(player), 'roxie', game.turn + 1, {
            hooks: {
                blockRetreat: (g, source, who, pokemon) => who === source.player && g.hasCondition(pokemon, 'poisoned')
            }
        }),
        cpuWants: (game, player) => {
            const active = game.opponentOf(player).active;
            return Boolean(active) && game.hasCondition(active, 'poisoned');
        }
    },
    'ネリネ': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => {
            game.draw(player, 4);
            game.addPlayerEffect(player, 'carmine', game.turn, {
                hooks: {
                    onTurnEnd: (g, source, ending) => {
                        if (ending !== source.player || source.player.hand.length < 5) return;
                        g.discardHand(source.player);
                    }
                }
            });
        },
        // 使った後の手札が5枚より少なければ、番の終わりにトラッシュされない
        cpuWants: (game, player) => player.hand.length <= 1 && player.deck.length > 0
    },
    'フウとランの修行': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => game.draw(player, 2),
        afterPlay: (game, player, inst) => {
            const stadium = game.stadium && game.cardOf(game.stadium.inst);
            if (stadium && stadium.name.includes('伝説')) {
                player.hand.push(inst);
                game.log(`${game.cardName(inst)}を手札にもどした`);
            } else {
                player.discard.push(inst);
            }
        },
        cpuWants: (game, player) => player.hand.length <= 4 && player.deck.length > 2
    },
    '管理人': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => game.draw(player, 2),
        afterPlay: (game, player, inst) => {
            const stadium = game.stadium && game.cardOf(game.stadium.inst);
            if (stadium && stadium.name === '公民館') {
                player.deck.push(inst);
                game.shuffleDeck(player);
                game.log(`${game.cardName(inst)}を山札にもどして切った`);
            } else {
                player.discard.push(inst);
            }
        },
        cpuWants: (game, player) => player.hand.length <= 4 && player.deck.length > 2
    },
    'アセロラのいたずら': {
        canPlay: (game, player) => game.opponentOf(player).prizes.length <= 2,
        play: (game, player) => game.promptPokemon({
            player,
            pokemon: game.inPlay(player),
            min: 1,
            max: 1,
            title: '次の相手の番、ポケモンexから守るポケモンを選ぶ',
            purpose: 'protect-target',
            cpuAnswer: g => [Math.max(0, g.inPlay(player).indexOf(player.active))],
            callback: ([chosen]) => {
                const fromEx = (g, ctx) => isPokemonEx(g.topCard(ctx.attacker));
                game.addPlayerEffect(player, 'acerola', game.turn + 1, {
                    hooks: {
                        preventDamage: (g, source, ctx, target) => target === chosen && fromEx(g, ctx),
                        preventEffects: (g, source, ctx, target) => target === chosen && fromEx(g, ctx)
                    }
                });
            }
        }),
        cpuWants: (game, player) => Boolean(game.opponentOf(player).active) && isPokemonEx(game.topCard(game.opponentOf(player).active))
    },

    // ===== スタジアム =====
    'ロケット団のファクトリー': {
        canUse: (game, player) => player.deck.length > 0 && game.turnState.supporterNames.some(name => name.startsWith('ロケット団')),
        use: (game, player) => game.draw(player, 2),
        cpuWants: () => true,
        cpuWantsUse: (game, player) => player.deck.length > 5
    },
    '伝説の海溝': {
        hooks: {
            doubleHeal: () => true
        },
        cpuWants: () => true
    },
    '危険な密林': {
        hooks: {
            poisonDamage: (game, source, pokemon) => (game.topCard(pokemon).type === 'darkness' ? 0 : 20)
        },
        cpuWants: (game, player) => {
            const active = game.opponentOf(player).active;
            return Boolean(active) && game.hasCondition(active, 'poisoned');
        }
    },
    'お祭り会場': {
        hooks: {
            conditionImmune: (game, source, pokemon) => pokemon.energies.length > 0
        },
        cpuWants: () => true
    }
};
