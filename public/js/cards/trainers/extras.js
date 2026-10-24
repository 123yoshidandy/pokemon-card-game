/**
 * トレーナーズの効果（プレイヤーにかかる効果のフックや、使ったカードの行き先などを使うもの）。書き方は cards/HOOKS.md
 */

import { compileAttackText } from '../attack-effects.js';

const isPokemonEx = card => card.rule === 'ex' || card.rule === 'mega';

// どうぐに書かれたワザ（ワザの形は card-data.js のワザと同じ）
const CORE_MEMORY_ATTACK = (() => {
    const text = 'このポケモンについているエネルギーを、すべてトラッシュする。';
    return { name: 'ジオバスター', cost: ['fighting', 'fighting', 'fighting', 'fighting'], damage: 350, damageText: '350', text, supported: true, ...compileAttackText(text) };
})();

const FLUORITE_ATTACK = (() => {
    const text = 'このポケモンについているエネルギーをすべてトラッシュし、自分の「テラスタル」のポケモン全員のHPを、すべて回復する。';
    return {
        name: 'GWP フローライト',
        cost: ['grass', 'water', 'psychic'],
        damage: 0,
        damageText: '',
        text,
        supported: true,
        after: ctx => {
            const { game, player, attacker } = ctx;
            game.discardEnergyFrom(attacker, Infinity);
            game.inPlay(player).filter(pokemon => game.topCard(pokemon).tera && pokemon.damage > 0).forEach(pokemon => game.heal(pokemon, pokemon.damage));
        }
    };
})();

const N_TEAM = ['Nのヒヒダルマ', 'Nのゾロアークex', 'Nのバイバニラ', 'Nのギギギアル', 'Nのレシラム', 'Nのゼクロム'];
const isBasicCard = card => card.kind === 'pokemon' && card.stage === 0;

const DELTA_GIFT_ATTACK = {
    name: 'デルタギフト',
    cost: ['colorless'],
    damage: 0,
    damageText: '',
    text: '「メガレックウザキャップ」がついている自分のポケモン全員に、山札から基本エネルギーを1枚ずつつける。そして山札を切る。',
    supported: true,
    after: ctx => {
        const { game, player } = ctx;
        const holders = game.inPlay(player).filter(pokemon => pokemon.tool && game.cardName(pokemon.tool) === 'メガレックウザキャップ');
        const steps = holders.map(target => () => game.searchDeck({
            player,
            filter: card => card.kind === 'energy' && card.basic,
            max: 1,
            title: `${game.topCard(target).name}につける基本エネルギーを選ぶ`,
            purpose: 'search-energy',
            onSelected: found => found.forEach(inst => game.attachFromOutside(target, inst))
        }));
        game.runNext(...steps);
    }
};

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

    // ===== カードに書かれたワザを使えるようにするどうぐ（ワザは Limitless TCG のカードのページで確かめた）=====
    'コアメモリ': {
        hooks: {
            extraAttacks: (game, source, pokemon) => (pokemon === source.pokemon && game.topCard(pokemon).name === 'メガジガルデex' ? [CORE_MEMORY_ATTACK] : [])
        },
        cpuTarget: (game, player, pokemon) => game.topCard(pokemon).name === 'メガジガルデex',
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => game.topCard(pokemon).name === 'メガジガルデex' && !pokemon.tool)
    },
    'メガレックウザキャップ': {
        hooks: {
            extraAttacks: (game, source, pokemon) => (pokemon === source.pokemon ? [DELTA_GIFT_ATTACK] : [])
        },
        cpuWants: () => true
    },

    'めまいの谷': {
        hooks: {
            // おたがいのこんらんのポケモンは、進化・退化してもこんらんが回復しない（game.clearConditionsOnStageChange が見る）
            keepConfusionOnStageChange: () => true
        },
        cpuWants: (game, player) => {
            const active = game.opponentOf(player).active;
            return Boolean(active) && game.hasCondition(active, 'confused');
        }
    },

    'ワザマシン フローライト': {
        // ワザは英語版（Technical Machine: Fluorite）のカードで、使うためのエネルギーが [G][W][P] だと確かめた
        hooks: {
            extraAttacks: (game, source, pokemon) => (pokemon === source.pokemon ? [FLUORITE_ATTACK] : []),
            onTurnEnd: (game, source, player) => {
                if (player === source.player && source.pokemon.tool === source.inst) game.discardTool(source.pokemon);
            }
        },
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => game.topCard(pokemon).tera && pokemon.damage >= 100)
    },
    'リトライバッジ': {
        hooks: {
            // 自分の番ごとに1回、このカードをつけている [C] ポケモンのワザで投げたコインを、はじめから投げなおしてよい
            // （本体が投げなおせるのは、ダメージの前に投げたコイン）
            allowCoinRetry: (game, source, ctx) => ctx.attacker === source.pokemon && game.typesOf(ctx.attacker).includes('colorless')
        },
        cpuTarget: (game, player, pokemon) => game.typesOf(pokemon).includes('colorless'),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => game.typesOf(pokemon).includes('colorless') && !pokemon.tool)
    },
    'バーベナとヘレナ': {
        // 自分の場に、並んだ「Nの〜」の6匹がすべていなければ使えない
        canPlay: (game, player) => N_TEAM.every(name => game.inPlay(player).some(pokemon => game.topCard(pokemon).name === name)),
        play: (game, player) => game.addPlayerEffect(player, 'verbenaHelena', game.turn, {
            hooks: {
                // この番、自分の「Nのポケモン」のワザのダメージで、相手のバトルポケモンがきぜつしたなら、サイドを3枚多くとる
                prizeModifier: (g, source, pokemon, owner, info) => {
                    const attack = g.currentAttack;
                    if (!info.byAttack || !attack || attack.player !== source.player || owner === source.player) return 0;
                    return owner.active === pokemon && g.topCard(attack.attacker).name.startsWith('Nの') ? 3 : 0;
                }
            }
        }),
        cpuWants: () => true
    },
    'アンジュフラエッテ': {
        // 場に出ている「プリズムタワー」をトラッシュしなければ場に出せず、「プリズムタワー」を出した番でも場に出せる
        canPlay: game => Boolean(game.stadium) && game.cardName(game.stadium.inst) === 'プリズムタワー',
        ignoreStadiumLimit: game => Boolean(game.stadium) && game.cardName(game.stadium.inst) === 'プリズムタワー',
        hooks: {
            maxHp: (game, source, pokemon) => (game.topCard(pokemon).name === 'メガフラエッテex' ? 150 : 0)
        },
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => game.topCard(pokemon).name === 'メガフラエッテex')
    },
    '変化の書': {
        // 2枚同時にしか使えない（効果は2枚で1回）。トラッシュのたねポケモン1枚と、場のたねポケモン1匹を入れ替える（ついているものはすべて引きつぐ）
        canPlay: (game, player) => player.hand.filter(inst => game.cardName(inst) === '変化の書').length >= 2
            && player.discard.some(inst => isBasicCard(game.cardOf(inst)))
            && game.inPlay(player).some(pokemon => pokemon.cards.length === 1 && isBasicCard(game.topCard(pokemon))),
        play: (game, player, inst) => {
            const partner = player.hand.find(card => card !== inst && game.cardName(card) === '変化の書');
            if (partner) {
                game.moveCard(player.hand, player.discard, partner);
                game.log(`${player.name}はもう1枚の${game.cardName(partner)}もいっしょに使った`);
            }
            const fromDiscard = player.discard.filter(card => isBasicCard(game.cardOf(card)));
            game.promptCards({
                player,
                cards: fromDiscard,
                min: 1,
                max: 1,
                title: '場に出すトラッシュのたねポケモンを選ぶ',
                purpose: 'search-pokemon',
                callback: ([chosen]) => {
                    const targets = game.inPlay(player).filter(pokemon => pokemon.cards.length === 1 && isBasicCard(game.topCard(pokemon)));
                    game.promptPokemon({
                        player,
                        pokemon: targets,
                        min: 1,
                        max: 1,
                        title: '入れ替える場のたねポケモンを選ぶ',
                        purpose: 'switch',
                        callback: ([target]) => {
                            const old = target.cards[0];
                            game.removeCard(player.discard, chosen);
                            target.cards = [chosen];
                            game.resetForms([old]);
                            player.discard.push(old);
                            game.log(`${player.name}は${game.cardName(old)}を${game.cardName(chosen)}と入れ替えた`);
                            game.runNext(() => game.checkKnockouts());
                        }
                    });
                }
            });
        },
        cpuWants: () => false
    },
    'ロケット団のおじゃまロボ': {
        // ウラの相手のサイド1枚と、相手の手札からオモテを見ないで1枚選び、オモテを見る。のぞむなら入れ替えさせる（そのサイドはオモテのまま）
        canPlay: (game, player) => game.opponentOf(player).prizes.some(inst => !inst.faceUp) && game.opponentOf(player).hand.length > 0,
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            const faceDown = opponent.prizes.filter(inst => !inst.faceUp);
            game.promptChoose({
                player,
                options: faceDown.map((_, index) => `ウラのサイド ${index + 1}枚目`),
                title: 'オモテを見る相手のサイドを選ぶ',
                purpose: 'choose-prize',
                cpuAnswer: () => [0],
                callback: ([index]) => {
                    const prize = faceDown[index];
                    const handCard = opponent.hand[Math.floor(game.random() * opponent.hand.length)];
                    prize.faceUp = true;
                    game.log(`${opponent.name}のサイドの${game.cardName(prize)}がオモテになった`);
                    game.log(`${opponent.name}の手札から選んだのは${game.cardName(handCard)}`, { to: player.id });
                    game.promptConfirm({
                        player,
                        title: `サイドの${game.cardName(prize)}と、手札の${game.cardName(handCard)}を入れ替えさせますか？`,
                        purpose: 'swap-prize',
                        cpuAnswer: () => true,
                        callback: yes => {
                            if (!yes) return;
                            const prizeIndex = opponent.prizes.indexOf(prize);
                            game.removeCard(opponent.hand, handCard);
                            opponent.prizes[prizeIndex] = handCard;
                            handCard.faceUp = true;
                            delete prize.faceUp;
                            opponent.hand.push(prize);
                            game.log(`${opponent.name}はサイドと手札のカードを入れ替えた（サイドの${game.cardName(handCard)}はオモテ）`);
                        }
                    });
                }
            });
        },
        cpuWants: (game, player) => game.opponentOf(player).hand.length >= 3
    },
    'ゼロの大空洞': {
        hooks: {
            // 自分の場に「テラスタル」のポケモンがいるプレイヤーは、ベンチに8匹まで出せる（多すぎるときは本体がトラッシュさせる）
            benchLimit: (game, source, player) => (game.inPlay(player).some(pokemon => game.topCard(pokemon).tera) ? 8 : 0)
        },
        cpuWants: (game, player) => countTagged(game, player, 'tera') > 0 && player.bench.length >= 4
    },

    'バトルコロシアム': {
        hooks: {
            // おたがいのベンチポケモン全員は、相手のワザや特性の効果で、ダメカンがのらない（ワザのダメージは受ける）
            preventEffectsFrom: (game, source, effect, target, effectKind) => effectKind === 'counters'
                && (effect.kind === 'attack' || effect.kind === 'ability') && !isActive(game, target)
        },
        cpuWants: () => true
    },
    'ポケバイタルA': {
        // 自分のポケモン1匹のHPを「150」回復する。このカードは、トラッシュにあるかぎり、手札に加えられず、山札にもどせない
        lockedInDiscard: true,
        canPlay: (game, player) => game.inPlay(player).some(pokemon => pokemon.damage > 0),
        play: (game, player) => game.promptPokemon({
            player,
            pokemon: game.inPlay(player).filter(pokemon => pokemon.damage > 0),
            min: 1,
            max: 1,
            title: 'HPを150回復するポケモンを選ぶ',
            purpose: 'potion',
            callback: ([target]) => game.heal(target, 150)
        }),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => pokemon.damage >= 120)
    },
    'ニュートラルセンター': {
        // おたがいのポケモン（ルールを持つポケモンをのぞく）全員は、相手の「ポケモンex・V」からワザのダメージを受けない
        // このカードは、トラッシュにあるかぎり、手札に加えられず、山札にもどせない
        lockedInDiscard: true,
        hooks: {
            preventDamage: (game, source, ctx, target) => !game.topCard(target).rule && isPokemonEx(game.topCard(ctx.attacker))
        },
        cpuWants: (game, player) => {
            const opponentActive = game.opponentOf(player).active;
            return Boolean(opponentActive) && isPokemonEx(game.topCard(opponentActive)) && game.inPlay(player).some(pokemon => !game.topCard(pokemon).rule);
        }
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
