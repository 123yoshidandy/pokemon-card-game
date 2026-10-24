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
    },
    '活力の森': {
        // おたがいの [G] ポケモン全員は、出したばかりの番（最初の自分の番をのぞく）でも [G] ポケモンに進化できる
        hooks: {
            allowEarlyEvolve: (game, source, player, target, card) => player.turnsTaken > 1
                && card.type === 'grass' && game.typesOf(target).includes('grass')
        },
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => game.typesOf(pokemon).includes('grass'))
    },

    // ===== テラスタル・古代・未来の印を使うもの（印は tools/data/limitless-tags.json から補っている）=====
    '覚醒のドラム': {
        canPlay: (game, player) => player.deck.length > 0 && countTagged(game, player, 'ancient') > 0,
        play: (game, player) => game.draw(player, countTagged(game, player, 'ancient')),
        cpuWants: (game, player) => countTagged(game, player, 'ancient') >= 2
    },
    'リブートポッド': {
        canPlay: (game, player) => countTagged(game, player, 'future') > 0 && basicEnergiesInDiscard(game, player).length > 0,
        play: (game, player) => attachFromDiscardToEach(game, player, game.inPlay(player).filter(pokemon => game.topCard(pokemon).future)),
        cpuWants: () => true
    },
    'ガラスのラッパ': {
        canPlay: (game, player) => countTagged(game, player, 'tera') > 0
            && player.bench.some(pokemon => game.topCard(pokemon).type === 'colorless') && basicEnergiesInDiscard(game, player).length > 0,
        play: (game, player) => {
            const benched = player.bench.filter(pokemon => game.topCard(pokemon).type === 'colorless');
            const pick = targets => attachFromDiscardToEach(game, player, targets);
            if (benched.length <= 2) {
                pick(benched);
                return;
            }
            game.promptPokemon({ player, pokemon: benched, min: 1, max: 2, title: 'エネルギーをつけるベンチの無色ポケモンを2匹まで選ぶ', purpose: 'attach-energy-target', callback: pick });
        },
        cpuWants: () => true
    },
    'テラスタルオーブ': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => game.searchDeck({
            player,
            filter: card => card.kind === 'pokemon' && card.tera,
            max: 1,
            title: '手札に加える「テラスタル」のポケモンを選ぶ',
            purpose: 'search-pokemon',
            onSelected: found => game.addToHand(player, found, { reveal: true })
        }),
        cpuWants: (game, player) => player.deck.some(inst => game.cardOf(inst).tera)
    },
    'ブライア': {
        canPlay: (game, player) => game.opponentOf(player).prizes.length === 2,
        play: (game, player) => game.addPlayerEffect(player, 'briar', game.turn, {
            hooks: {
                // この番、自分の「テラスタル」のポケモンのワザのダメージで、相手のバトルポケモンがきぜつしたなら、サイドを1枚多くとる
                prizeModifier: (g, source, pokemon, owner, info) => {
                    const attack = g.currentAttack;
                    if (!info.byAttack || !attack || attack.player !== source.player || owner === source.player) return 0;
                    return owner.active === pokemon && g.topCard(attack.attacker).tera ? 1 : 0;
                }
            }
        }),
        cpuWants: (game, player) => Boolean(player.active) && game.topCard(player.active).tera
    },
    'ブーストエナジー 古代': {
        hooks: {
            maxHp: (game, source, pokemon) => (pokemon === source.pokemon && game.topCard(pokemon).ancient ? 60 : 0),
            conditionImmune: (game, source, pokemon) => pokemon === source.pokemon && game.topCard(pokemon).ancient
        },
        cpuTarget: (game, player, pokemon) => Boolean(game.topCard(pokemon).ancient),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => game.topCard(pokemon).ancient && !pokemon.tool)
    },
    'ブーストエナジー 未来': {
        retreatReduction: 99,
        hooks: {
            retreatCost: (game, source, pokemon) => (pokemon === source.pokemon && game.topCard(pokemon).future ? -99 : 0),
            damageDealt: (game, source, ctx, target) => (ctx.attacker === source.pokemon && game.topCard(ctx.attacker).future
                && game.ownerOf(target) !== source.player && isActive(game, target) ? 20 : 0)
        },
        cpuTarget: (game, player, pokemon) => Boolean(game.topCard(pokemon).future),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => game.topCard(pokemon).future && !pokemon.tool)
    },
    'きらめく結晶': {
        hooks: {
            // 少なくするのは、どのタイプのエネルギーでもよい（払えるようになるものを選ぶ）
            attackCost: (game, source, pokemon, attack, cost) => {
                if (pokemon !== source.pokemon || !game.topCard(pokemon).tera || cost.length === 0) return undefined;
                const options = cost.map((_, index) => cost.filter((__, i) => i !== index));
                return options.find(reduced => game.canPayCost(pokemon, reduced)) ?? options[cost.lastIndexOf('colorless') >= 0 ? cost.lastIndexOf('colorless') : cost.length - 1];
            }
        },
        cpuTarget: (game, player, pokemon) => Boolean(game.topCard(pokemon).tera),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => game.topCard(pokemon).tera && !pokemon.tool)
    },
    '夜の鉱山': {
        hooks: {
            attackCost: (game, source, pokemon, attack, cost) => (game.topCard(pokemon).tera ? [...cost, 'colorless'] : undefined)
        },
        cpuWants: (game, player) => countTagged(game, game.opponentOf(player), 'tera') > countTagged(game, player, 'tera')
    },

    // ===== 文の記号を tools/data/text-fixes.json で直したもの =====
    '危ない廃墟': {
        hooks: {
            // おたがいのプレイヤーは、自分の番に、たねポケモン（[D]ポケモンをのぞく）をベンチに出すたび、そのポケモンにダメカンを2個のせる
            onPokemonBenched: (game, source, player, pokemon) => {
                if (game.current !== player.id || game.phase !== 'main') return;
                const card = game.topCard(pokemon);
                if (card.stage !== 0 || game.typesOf(pokemon).includes('darkness')) return;
                game.putDamage(pokemon, 20);
                game.runNext(() => game.checkKnockouts());
            }
        },
        // 自分の場に悪ポケモンが多いなら出す
        cpuWants: (game, player) => game.inPlay(player).filter(pokemon => game.typesOf(pokemon).includes('darkness')).length >= 2
    },
    'ギーマの一手': {
        // 山札を上から7枚見て、[D] ポケモンを1枚選び、ベンチに出す。残りはウラにして切り、山札の下にもどす（最初の自分の番には使えない）
        canPlay: (game, player) => player.turnsTaken > 1 && player.deck.length > 0 && player.bench.length < game.benchSize,
        play: (game, player) => {
            const looked = player.deck.slice(0, 7);
            const candidates = looked.filter(inst => { const card = game.cardOf(inst); return card.kind === 'pokemon' && card.stage === 0 && card.type === 'darkness'; });
            const finish = selected => {
                selected.forEach(inst => {
                    game.removeCard(player.deck, inst);
                    const pokemon = game.createPokemon(inst);
                    player.bench.push(pokemon);
                    game.log(`${player.name}は${game.cardName(inst)}をベンチに出した`);
                    game.hookAll('onPokemonBenched', player, pokemon);
                });
                const rest = looked.filter(inst => !selected.includes(inst));
                rest.forEach(inst => game.removeCard(player.deck, inst));
                for (let i = rest.length - 1; i > 0; i--) {
                    const j = Math.floor(game.random() * (i + 1));
                    [rest[i], rest[j]] = [rest[j], rest[i]];
                }
                player.deck.push(...rest);
                game.log(`${player.name}は残りの${rest.length}枚を切って山札の下にもどした`);
            };
            game.log(`${player.name}は山札を上から${looked.length}枚見た`);
            if (candidates.length === 0) {
                finish([]);
                return;
            }
            game.promptCards({ player, cards: candidates, min: 0, max: 1, title: 'ベンチに出す悪ポケモンを選ぶ', purpose: 'bench-basic', callback: finish });
        },
        cpuWants: (game, player) => player.bench.length < 3 && player.deck.some(inst => { const card = game.cardOf(inst); return card.kind === 'pokemon' && card.type === 'darkness' && card.stage === 0; })
    }
};

// 自分の場の、印（'tera' 'ancient' 'future'）のあるポケモンの数
function countTagged(game, player, tag) {
    return game.inPlay(player).filter(pokemon => game.topCard(pokemon)[tag]).length;
}

function basicEnergiesInDiscard(game, player) {
    return player.discard.filter(inst => { const card = game.cardOf(inst); return card.kind === 'energy' && card.basic; });
}

// ポケモン1匹ずつに、トラッシュから基本エネルギーを1枚ずつ選んでつける
function attachFromDiscardToEach(game, player, targets) {
    const steps = targets.map(target => () => {
        const energies = basicEnergiesInDiscard(game, player);
        if (energies.length === 0 || !game.inPlay(player).includes(target)) return;
        const attach = inst => {
            game.removeCard(player.discard, inst);
            game.attachFromOutside(target, inst);
        };
        if (new Set(energies.map(inst => inst.id)).size === 1) {
            attach(energies[0]);
            return;
        }
        game.promptCards({
            player,
            cards: energies,
            min: 1,
            max: 1,
            title: `${game.topCard(target).name}につける基本エネルギーを選ぶ`,
            purpose: 'energy-retrieval',
            callback: ([inst]) => attach(inst)
        });
    });
    game.runNext(...steps);
}
