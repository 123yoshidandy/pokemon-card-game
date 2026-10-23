/**
 * カードの定義
 * スタンダードレギュレーション（regulation.js）の実在カードを、名前と効果で1種類として持つ
 * テキストは Limitless TCG（limitlesstcg.com/cards/jp）で確かめた版に合わせ、source にその版（セットと番号）を書く
 *
 * ポケモン：{ kind: 'pokemon', stage(0=たね,1,2), evolvesFrom(進化元のカードID), hp, type, weakness, resistance, retreat,
 *            rule('ex' ならきぜつでサイド2枚、'mega' はメガシンカexで3枚), tera(ベンチでワザのダメージを受けない), ability, attacks }
 *   ワザ：{ name, cost: [タイプ...], damage, damageText, text, before(ctx), after(ctx), expected(ctx) }
 *     before はダメージの前（ダメージの増減）、after はダメージの後（特殊状態・入れ替えなど）に呼ぶ
 *     expected は CPU がダメージを見積もるときに使う（乱数を使わない。コインはオモテ・ウラの平均で見る）
 *     ctx：{ game, player, opponent, attacker, defender, attack, damage }
 *   特性：{ name, text, type: 'activated'（自分の番に使う）| 'onEvolve'（手札から進化させたとき）, canUse, use }
 * トレーナーズ：{ kind: 'trainer', trainerType: 'item' | 'supporter' | 'stadium' | 'tool', text, canPlay, play }
 *   サポートの firstTurnOk：先攻の最初の番でも使える
 *   どうぐ：hpBonus(ポケモンのカード)・retreatReduction・damageBonus({ game, attacker, target })
 *   スタジアム：hpModifier(ポケモンのカード)・canUse / use（自分の番に1回使える効果）
 * エネルギー：{ kind: 'energy', basic, energyType }
 */

export const TYPE_NAMES = {
    grass: '草',
    fire: '炎',
    water: '水',
    lightning: '雷',
    psychic: '超',
    fighting: '闘',
    darkness: '悪',
    metal: '鋼',
    dragon: 'ドラゴン',
    colorless: '無色'
};

export const TRAINER_TYPE_NAMES = {
    item: 'グッズ',
    supporter: 'サポート',
    stadium: 'スタジアム',
    tool: 'ポケモンのどうぐ'
};

export const RULE_TEXTS = {
    ex: 'ポケモンexがきぜつしたとき、相手はサイドを2枚とる。',
    mega: 'メガシンカexがきぜつしたとき、相手はサイドを3枚とる。'
};

const isBasicEnergy = (card, type) => card.kind === 'energy' && card.basic && (!type || card.energyType === type);
const isBasicPokemon = card => card.kind === 'pokemon' && card.stage === 0;
const hasRule = card => Boolean(card.rule);
const isPokemonEx = card => card.rule === 'ex' || card.rule === 'mega';

const pokemon = data => ({
    kind: 'pokemon',
    stage: 0,
    evolvesFrom: null,
    resistance: null,
    rule: null,
    tera: false,
    ability: null,
    ...data,
    attacks: data.attacks.map(attack => ({ damage: 0, text: '', ...attack, damageText: attack.damageText ?? (attack.damage ? String(attack.damage) : '') }))
});

const trainer = data => ({ kind: 'trainer', canPlay: () => true, play: () => {}, ...data });

const basicEnergy = (type) => ({
    id: `basic-${type}-energy`,
    kind: 'energy',
    basic: true,
    energyType: type,
    name: `基本${TYPE_NAMES[type]}エネルギー`
});

// 相手のバトルポケモンが条件に合えばダメージを足す（before と expected の両方に使う）
const bonusIf = (amount, condition) => ({
    before: ctx => { if (condition(ctx)) ctx.damage += amount; },
    expected: ctx => ctx.damage + (condition(ctx) ? amount : 0)
});

// コインがオモテならダメージを足す（CPU は半分の値で見積もる）
const coinBonus = amount => ({
    before: ctx => { if (ctx.game.flipCoin()) ctx.damage += amount; },
    expected: ctx => ctx.damage + amount / 2
});

// ===== ポケモン =====

const POKEMON = [
    // --- 炎（MC：スタートデッキ100 バトルコレクション、M6：ステラミラクル）---
    pokemon({
        id: 'charmander',
        name: 'ヒトカゲ',
        regulation: 'J',
        source: 'MC 083',
        hp: 80,
        type: 'fire',
        weakness: 'water',
        retreat: 1,
        attacks: [
            { name: 'ほのおのツメ', cost: ['fire', 'colorless'], damage: 30 }
        ]
    }),
    pokemon({
        id: 'charmeleon',
        name: 'リザード',
        regulation: 'J',
        source: 'MC 084',
        stage: 1,
        evolvesFrom: 'charmander',
        hp: 100,
        type: 'fire',
        weakness: 'water',
        retreat: 1,
        attacks: [
            { name: 'ヒートブラスト', cost: ['fire', 'colorless'], damage: 50 }
        ]
    }),
    pokemon({
        id: 'mega-charizard-y-ex',
        name: 'メガリザードンYex',
        regulation: 'J',
        source: 'MC 085',
        stage: 2,
        evolvesFrom: 'charmeleon',
        hp: 360,
        type: 'fire',
        weakness: 'water',
        retreat: 1,
        rule: 'mega',
        attacks: [
            {
                name: 'プロージョンY',
                cost: ['fire', 'fire', 'colorless'],
                damageText: '',
                text: 'このポケモンについているエネルギーを3個トラッシュし、相手のポケモン1匹に、280ダメージ。［ベンチは弱点・抵抗力を計算しない。］',
                after: ctx => {
                    const { game, opponent, attacker } = ctx;
                    game.discardEnergyFrom(attacker, 3);
                    game.promptPokemon({
                        player: ctx.player,
                        pokemon: game.inPlay(opponent),
                        min: 1,
                        max: 1,
                        title: 'プロージョンY：280ダメージを与えるポケモンを選ぶ',
                        purpose: 'snipe-target',
                        callback: ([target]) => game.dealAttackDamage(ctx, target, 280)
                    });
                },
                expected: () => 280
            }
        ]
    }),
    pokemon({
        id: 'growlithe',
        name: 'ガーディ',
        regulation: 'J',
        source: 'M6 010',
        hp: 80,
        type: 'fire',
        weakness: 'water',
        retreat: 2,
        attacks: [
            {
                name: 'ほえる',
                cost: ['colorless'],
                text: '相手のバトルポケモンをベンチポケモンと入れ替える。［バトル場に出すポケモンは相手が選ぶ。］',
                after: ({ game, opponent }) => {
                    if (opponent.bench.length === 0 || !opponent.active) return;
                    game.promptPokemon({
                        player: opponent,
                        pokemon: opponent.bench,
                        min: 1,
                        max: 1,
                        title: 'バトル場に出すポケモンを選ぶ',
                        purpose: 'forced-switch',
                        callback: ([target]) => game.switchActive(opponent, target)
                    });
                }
            },
            { name: 'うしろげり', cost: ['fire', 'colorless', 'colorless'], damage: 50 }
        ]
    }),
    pokemon({
        id: 'arcanine',
        name: 'ウインディ',
        regulation: 'J',
        source: 'M6 011',
        stage: 1,
        evolvesFrom: 'growlithe',
        hp: 150,
        type: 'fire',
        weakness: 'water',
        retreat: 4,
        attacks: [
            {
                name: 'はりきりファング',
                cost: ['fire', 'colorless', 'colorless'],
                damage: 90,
                damageText: '90+',
                text: '相手のサイドの残り枚数が4枚以下なら、90ダメージ追加。',
                ...bonusIf(90, ({ opponent }) => opponent.prizes.length <= 4)
            },
            {
                name: 'ヒートタックル',
                cost: ['fire', 'fire', 'colorless', 'colorless'],
                damage: 200,
                text: 'このポケモンにも50ダメージ。',
                after: ({ game, attacker }) => game.putDamage(attacker, 50)
            }
        ]
    }),

    // --- 雷（MC：スタートデッキ100 バトルコレクション、M1S）---
    pokemon({
        id: 'miraidon-ex',
        name: 'ミライドンex',
        regulation: 'J',
        source: 'MC 284',
        hp: 220,
        type: 'lightning',
        weakness: 'fighting',
        retreat: 1,
        rule: 'ex',
        attacks: [
            { name: 'スラッシュクロー', cost: ['lightning'], damage: 40 },
            {
                name: 'ハドロンスパーク',
                cost: ['lightning', 'lightning', 'colorless'],
                damage: 120,
                damageText: '120+',
                text: '相手のバトルポケモンが「ポケモンex」なら、120ダメージ追加。',
                ...bonusIf(120, ({ game, defender }) => Boolean(defender) && isPokemonEx(game.topCard(defender)))
            }
        ]
    }),
    pokemon({
        id: 'pikachu',
        name: 'ピカチュウ',
        regulation: 'J',
        source: 'MC 225',
        hp: 70,
        type: 'lightning',
        weakness: 'fighting',
        retreat: 1,
        attacks: [
            { name: 'しっぽでたたく', cost: ['lightning'], damage: 10 },
            { name: 'プチボルト', cost: ['lightning', 'colorless'], damage: 30 }
        ]
    }),
    pokemon({
        id: 'raichu',
        name: 'ライチュウ',
        regulation: 'J',
        source: 'MC 226',
        stage: 1,
        evolvesFrom: 'pikachu',
        hp: 130,
        type: 'lightning',
        weakness: 'fighting',
        retreat: 1,
        attacks: [
            {
                name: 'クイックアタック',
                cost: ['lightning'],
                damage: 20,
                damageText: '20+',
                text: 'コインを1回投げオモテなら、50ダメージ追加。',
                ...coinBonus(50)
            },
            {
                name: 'ストロングボルト',
                cost: ['lightning', 'lightning', 'colorless'],
                damage: 150,
                text: 'このポケモンについている雷エネルギーを1個選び、トラッシュする。',
                after: ({ game, attacker }) => game.discardEnergyFrom(attacker, 1, 'lightning')
            }
        ]
    }),
    pokemon({
        id: 'magnemite',
        name: 'コイル',
        regulation: 'I',
        source: 'M1S 027',
        hp: 70,
        type: 'lightning',
        weakness: 'fighting',
        retreat: 1,
        attacks: [
            { name: 'ビーム', cost: ['lightning'], damage: 10 }
        ]
    }),
    pokemon({
        id: 'magneton',
        name: 'レアコイル',
        regulation: 'I',
        source: 'M1S 028',
        stage: 1,
        evolvesFrom: 'magnemite',
        hp: 90,
        type: 'lightning',
        weakness: 'fighting',
        retreat: 2,
        attacks: [
            {
                name: 'でんきショック',
                cost: ['lightning'],
                damage: 30,
                text: 'コインを1回投げオモテなら、相手のバトルポケモンをマヒにする。',
                after: ({ game, defender }) => { if (game.flipCoin()) game.addCondition(defender, 'paralyzed'); }
            }
        ]
    }),
    pokemon({
        id: 'magnezone',
        name: 'ジバコイル',
        regulation: 'I',
        source: 'M1S 029',
        stage: 2,
        evolvesFrom: 'magneton',
        hp: 160,
        type: 'lightning',
        weakness: 'fighting',
        retreat: 3,
        attacks: [
            {
                name: 'アッパースパーク',
                cost: ['lightning'],
                damage: 50,
                damageText: '50+',
                text: 'この番に、このポケモンが「レアコイル」から進化していたなら、120ダメージ追加。',
                ...bonusIf(120, ({ game, attacker }) => game.evolvedThisTurnFrom(attacker, 'magneton'))
            },
            {
                name: 'フラッシュボルト',
                cost: ['lightning', 'lightning'],
                damage: 160,
                text: '次の自分の番、このポケモンは「フラッシュボルト」が使えない。',
                after: ({ game, attacker, attack }) => game.addEffect(attacker, 'cannotUseAttack', game.turn + 2, { attack: attack.name })
            }
        ]
    })
];

// ===== トレーナーズ =====

const drawSupporter = data => trainer({ trainerType: 'supporter', canPlay: (game, player) => player.deck.length > 0, ...data });

const TRAINERS = [
    // --- サポート ---
    drawSupporter({
        id: 'guy',
        name: 'ガイ',
        regulation: 'J',
        source: 'MF 036',
        text: '自分の山札を3枚引く。',
        play: (game, player) => game.draw(player, 3)
    }),
    drawSupporter({
        id: 'zeiyu',
        name: 'ゼイユ',
        regulation: 'H',
        source: 'MC 715',
        firstTurnOk: true,
        text: 'このカードは、先攻プレイヤーの最初の番でも使える。自分の手札をすべてトラッシュし、山札を5枚引く。',
        play: (game, player) => {
            game.discardHand(player);
            game.draw(player, 5);
        }
    }),
    trainer({
        id: 'lillies-determination',
        name: 'リーリエの決心',
        regulation: 'I',
        source: 'MF 040',
        trainerType: 'supporter',
        text: '自分の手札をすべて山札にもどして切る。その後、山札を6枚引く。自分のサイドの残り枚数が6枚なら、引く枚数は8枚になる。',
        play: (game, player) => {
            game.shuffleHandIntoDeck(player);
            game.draw(player, player.prizes.length === 6 ? 8 : 6);
        }
    }),
    drawSupporter({
        id: 'mc-hype',
        name: 'MCの盛り上げ',
        regulation: 'J',
        source: 'M6 067',
        text: '自分の山札を2枚引く。相手のサイドの残り枚数が3枚以下なら、さらに2枚引く。',
        play: (game, player) => game.draw(player, game.opponentOf(player).prizes.length <= 3 ? 4 : 2)
    }),
    trainer({
        id: 'judge',
        name: 'ジャッジマン',
        regulation: 'J',
        source: 'MF 037',
        trainerType: 'supporter',
        text: 'おたがいのプレイヤーは、それぞれ、手札をすべて山札にもどし、山札を切る。その後、それぞれの山札を4枚引く。',
        play: (game, player) => {
            const players = [player, game.opponentOf(player)];
            players.forEach(p => game.shuffleHandIntoDeck(p));
            players.forEach(p => game.draw(p, 4));
        }
    }),
    trainer({
        id: 'bosss-orders',
        name: 'ボスの指令',
        regulation: 'I',
        source: 'MF 039',
        trainerType: 'supporter',
        text: '相手のベンチポケモンを1匹選び、バトルポケモンと入れ替える。',
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
    }),

    // --- グッズ ---
    trainer({
        id: 'ultra-ball',
        name: 'ハイパーボール',
        regulation: 'I',
        source: 'M6a 101',
        trainerType: 'item',
        text: 'このカードは、自分の手札を2枚トラッシュしなければ使えない。自分の山札からポケモンを1枚選び、相手に見せてから、手札に加える。そして山札を切る。',
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
                    game.searchDeck({
                        player,
                        filter: card => card.kind === 'pokemon',
                        max: 1,
                        title: '手札に加えるポケモンを選ぶ',
                        purpose: 'search-pokemon',
                        onSelected: found => game.addToHand(player, found, { reveal: true })
                    });
                }
            });
        }
    }),
    trainer({
        id: 'buddy-buddy-poffin',
        name: 'なかよしポフィン',
        regulation: 'H',
        source: 'MC 648',
        trainerType: 'item',
        text: '自分の山札から、HPが「70」以下のたねポケモンを2枚まで選び、ベンチに出す。そして山札を切る。',
        canPlay: (game, player) => player.bench.length < game.benchSize,
        play: (game, player) => game.benchFromDeck(player, card => isBasicPokemon(card) && card.hp <= 70, 2, 'bench-basic')
    }),
    trainer({
        id: 'poke-ball',
        name: 'モンスターボール',
        regulation: 'J',
        source: 'MC 669',
        trainerType: 'item',
        text: 'コインを1回投げオモテなら、自分の山札からポケモンを1枚選び、相手に見せてから、手札に加える。そして山札を切る。',
        play: (game, player) => {
            if (!game.flipCoin()) return;
            game.searchDeck({
                player,
                filter: card => card.kind === 'pokemon',
                max: 1,
                title: '手札に加えるポケモンを選ぶ',
                purpose: 'search-pokemon',
                onSelected: found => game.addToHand(player, found, { reveal: true })
            });
        }
    }),
    trainer({
        id: 'rare-candy',
        name: 'ふしぎなアメ',
        regulation: 'I',
        source: 'MEE 012',
        trainerType: 'item',
        text: '自分のたねポケモン1匹から進化する1進化の上の2進化ポケモンを、手札から1枚選び、そのたねポケモンにのせて進化させる。［最初の自分の番と、この番出したばかりのたねポケモンには使えない。］',
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
    }),
    trainer({
        id: 'switch',
        name: 'ポケモンいれかえ',
        regulation: 'I',
        source: 'M6a 103',
        trainerType: 'item',
        text: '自分のバトルポケモンをベンチポケモンと入れ替える。',
        canPlay: (game, player) => player.bench.length > 0 && Boolean(player.active),
        play: (game, player) => game.promptSwitchOwnActive(player, 'switch')
    }),
    trainer({
        id: 'potion',
        name: 'きずぐすり',
        regulation: 'J',
        source: 'MF 028',
        trainerType: 'item',
        text: '自分のポケモン1匹のHPを「30」回復する。',
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
    }),
    trainer({
        id: 'energy-retrieval',
        name: 'エネルギー回収',
        regulation: 'I',
        source: 'M4 104',
        trainerType: 'item',
        text: '自分のトラッシュから基本エネルギーを2枚選び、相手に見せてから、手札に加える。',
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
    }),
    trainer({
        id: 'energy-search',
        name: 'エネルギー転送',
        regulation: 'J',
        source: 'MC 639',
        trainerType: 'item',
        text: '自分の山札から基本エネルギーを1枚選び、相手に見せてから、手札に加える。そして山札を切る。',
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => game.searchDeck({
            player,
            filter: card => isBasicEnergy(card),
            max: 1,
            title: '手札に加える基本エネルギーを選ぶ',
            purpose: 'search-energy',
            onSelected: found => game.addToHand(player, found, { reveal: true })
        })
    }),
    trainer({
        id: 'energy-switch',
        name: 'エネルギーつけかえ',
        regulation: 'I',
        source: 'M5 103',
        trainerType: 'item',
        text: '自分のポケモンについている基本エネルギーを1個、自分の別のポケモンにつけ替える。',
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
    }),

    // --- ポケモンのどうぐ ---
    trainer({
        id: 'float-stone',
        name: 'ふうせん',
        regulation: 'I',
        source: 'MEE 014',
        trainerType: 'tool',
        text: 'このカードをつけているポケモンは、にげるためのエネルギーが2個ぶん少なくなる。',
        retreatReduction: 2
    }),
    trainer({
        id: 'brave-bangle',
        name: 'ブレイブバングル',
        regulation: 'I',
        source: 'M5 107',
        trainerType: 'tool',
        text: 'このカードをつけているポケモン（「ルールを持つポケモン」をのぞく）が使うワザの、相手のバトル場の「ポケモンex」へのダメージは「+30」される。',
        damageBonus: ({ game, attacker, target }) => {
            const owner = game.ownerOf(target);
            const isActive = owner && owner.active === target;
            return !hasRule(game.topCard(attacker)) && isActive && isPokemonEx(game.topCard(target)) ? 30 : 0;
        }
    }),

    // --- スタジアム ---
    trainer({
        id: 'lumiose-city',
        name: 'ミアレシティ',
        regulation: 'J',
        source: 'M3 077',
        trainerType: 'stadium',
        text: 'おたがいのプレイヤーは、自分の番ごとに1回、自分の山札からたねポケモンを1枚選び、ベンチに出してよい。そして山札を切る。この効果を使ったなら、自分の番は終わる。',
        canUse: (game, player) => player.bench.length < game.benchSize && player.deck.length > 0,
        use: (game, player) => {
            game.benchFromDeck(player, isBasicPokemon, 1, 'bench-basic');
            game.endTurnByEffect(player);
        }
    }),
    trainer({
        id: 'gravity-mountain',
        name: 'グラビティーマウンテン',
        regulation: 'H',
        source: 'M2a 183',
        trainerType: 'stadium',
        text: 'おたがいの場の2進化ポケモン全員の最大HPは、それぞれ「-30」される。',
        hpModifier: card => (card.stage === 2 ? -30 : 0)
    })
];

const ENERGIES = [basicEnergy('fire'), basicEnergy('lightning')];

export const CARDS = Object.fromEntries([...POKEMON, ...TRAINERS, ...ENERGIES].map(card => [card.id, card]));

export function getCard(id) {
    const card = CARDS[id];
    if (!card) throw new Error(`不明なカード: ${id}`);
    return card;
}

export { isBasicEnergy, isBasicPokemon, hasRule, isPokemonEx };
