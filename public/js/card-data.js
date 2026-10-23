/**
 * カードの定義
 * ポケモン・トレーナーズ・エネルギーを、データと効果の関数で表す。効果はゲーム（game.js）の道具だけを使って書く
 *
 * ポケモン：{ kind: 'pokemon', stage(0=たね,1,2), evolvesFrom(進化元のカードID), hp, type, weakness, resistance, retreat,
 *            rule('ex' ならきぜつでサイド2枚), tera(ベンチでワザのダメージを受けない), ability, attacks }
 *   ワザ：{ name, cost: [タイプ...], damage, damageText, text, before(ctx), after(ctx) }
 *     before はダメージの前（ダメージの増減）、after はダメージの後（特殊状態・入れ替えなど）に呼ぶ
 *     ctx：{ game, player, opponent, attacker, defender, damage }
 *   特性：{ name, text, type: 'activated'（自分の番に使う）| 'onEvolve'（手札から進化させたとき）, canUse, use }
 * トレーナーズ：{ kind: 'trainer', trainerType: 'item' | 'supporter' | 'stadium' | 'tool', text, canPlay, play }
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

const isBasicEnergy = (card, type) => card.kind === 'energy' && card.basic && (!type || card.energyType === type);
const isBasicPokemon = card => card.kind === 'pokemon' && card.stage === 0;

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

// ===== ポケモン =====

const POKEMON = [
    pokemon({
        id: 'charmander',
        name: 'ヒトカゲ',
        hp: 70,
        type: 'fire',
        weakness: 'water',
        retreat: 1,
        attacks: [
            { name: 'ひっかく', cost: ['colorless'], damage: 10 },
            {
                name: 'ひのこ',
                cost: ['fire'],
                damage: 30,
                text: 'このポケモンについている炎エネルギーを1個トラッシュする。',
                after: ({ game, attacker }) => game.discardEnergyFrom(attacker, 1, 'fire')
            }
        ]
    }),
    pokemon({
        id: 'charmeleon',
        name: 'リザード',
        stage: 1,
        evolvesFrom: 'charmander',
        hp: 100,
        type: 'fire',
        weakness: 'water',
        retreat: 2,
        attacks: [
            { name: 'きりさく', cost: ['colorless', 'colorless'], damage: 30 },
            { name: 'ほのおのしっぽ', cost: ['fire', 'fire', 'colorless'], damage: 80 }
        ]
    }),
    pokemon({
        id: 'charizard-ex',
        name: 'リザードンex',
        stage: 2,
        evolvesFrom: 'charmeleon',
        hp: 330,
        type: 'darkness',
        weakness: 'grass',
        retreat: 2,
        rule: 'ex',
        tera: true,
        ability: {
            name: 'れんごくしはい',
            type: 'onEvolve',
            text: '自分の番に、このカードを手札から出して進化させたとき、1回使える。自分の山札から基本炎エネルギーを3枚まで選び、自分のポケモンに好きなようにつける。そして山札を切る。',
            canUse: (game, player) => player.deck.length > 0,
            use: (game, player) => game.searchDeck({
                player,
                filter: card => isBasicEnergy(card, 'fire'),
                max: 3,
                title: 'れんごくしはい：つける基本炎エネルギーを選ぶ',
                purpose: 'infernal-reign',
                onSelected: energies => game.attachAnyWay(player, energies, () => true, 'infernal-reign-target')
            })
        },
        attacks: [
            {
                name: 'バーニングダーク',
                cost: ['fire', 'fire'],
                damage: 180,
                damageText: '180+',
                text: '相手がすでにとったサイドの枚数×30ダメージ追加。',
                before: ctx => { ctx.damage += 30 * ctx.game.prizesTaken(ctx.opponent); }
            }
        ]
    }),
    pokemon({
        id: 'growlithe',
        name: 'ガーディ',
        hp: 80,
        type: 'fire',
        weakness: 'water',
        retreat: 1,
        attacks: [
            {
                name: 'ほのおのキバ',
                cost: ['fire'],
                damage: 10,
                text: '相手のバトルポケモンをやけどにする。',
                after: ({ game, defender }) => game.addCondition(defender, 'burned')
            },
            { name: 'かみつく', cost: ['colorless', 'colorless'], damage: 30 }
        ]
    }),
    pokemon({
        id: 'arcanine',
        name: 'ウインディ',
        stage: 1,
        evolvesFrom: 'growlithe',
        hp: 140,
        type: 'fire',
        weakness: 'water',
        retreat: 2,
        attacks: [
            {
                name: 'ヒートタックル',
                cost: ['fire', 'fire', 'colorless'],
                damage: 160,
                text: 'このポケモンにも30ダメージ。',
                after: ({ game, attacker }) => game.putDamage(attacker, 30)
            }
        ]
    }),
    pokemon({
        id: 'pikachu',
        name: 'ピカチュウ',
        hp: 70,
        type: 'lightning',
        weakness: 'fighting',
        retreat: 1,
        attacks: [
            {
                name: 'でんきショック',
                cost: ['lightning'],
                damage: 20,
                text: 'コインを1回投げオモテなら、相手のバトルポケモンをマヒにする。',
                after: ({ game, defender }) => { if (game.flipCoin()) game.addCondition(defender, 'paralyzed'); }
            }
        ]
    }),
    pokemon({
        id: 'raichu',
        name: 'ライチュウ',
        stage: 1,
        evolvesFrom: 'pikachu',
        hp: 120,
        type: 'lightning',
        weakness: 'fighting',
        retreat: 1,
        attacks: [
            {
                name: 'かみなり',
                cost: ['lightning', 'lightning', 'colorless'],
                damage: 140,
                text: 'このポケモンにも30ダメージ。',
                after: ({ game, attacker }) => game.putDamage(attacker, 30)
            }
        ]
    }),
    pokemon({
        id: 'miraidon-ex',
        name: 'ミライドンex',
        hp: 220,
        type: 'lightning',
        weakness: 'fighting',
        retreat: 1,
        rule: 'ex',
        ability: {
            name: 'タンデムユニット',
            type: 'activated',
            text: '自分の番に1回使える。自分の山札から雷タイプのたねポケモンを2枚まで選び、ベンチに出す。そして山札を切る。',
            canUse: (game, player) => player.bench.length < game.benchSize && player.deck.length > 0,
            use: (game, player) => game.benchFromDeck(player, card => isBasicPokemon(card) && card.type === 'lightning', 2, 'tandem-unit')
        },
        attacks: [
            {
                name: 'フォトンブラスター',
                cost: ['lightning', 'lightning', 'colorless'],
                damage: 220,
                text: '次の自分の番、このポケモンはワザが使えない。',
                after: ({ game, attacker }) => game.addEffect(attacker, 'cannotAttack', game.turn + 2)
            }
        ]
    }),
    pokemon({
        id: 'magnemite',
        name: 'コイル',
        hp: 60,
        type: 'lightning',
        weakness: 'fighting',
        retreat: 1,
        attacks: [
            { name: 'でんきだま', cost: ['lightning', 'colorless'], damage: 30 }
        ]
    }),
    pokemon({
        id: 'magneton',
        name: 'レアコイル',
        stage: 1,
        evolvesFrom: 'magnemite',
        hp: 90,
        type: 'lightning',
        weakness: 'fighting',
        retreat: 2,
        attacks: [
            {
                name: 'ジャイロボール',
                cost: ['lightning', 'colorless', 'colorless'],
                damage: 60,
                text: 'のぞむなら、このポケモンをベンチポケモンと入れ替える。',
                after: ({ game, player }) => {
                    if (player.bench.length === 0) return;
                    game.promptConfirm({
                        player,
                        title: 'ジャイロボール：ベンチポケモンと入れ替えますか？',
                        purpose: 'gyro-ball-confirm',
                        callback: yes => {
                            if (yes) game.promptSwitchOwnActive(player, 'gyro-ball-switch');
                        }
                    });
                }
            }
        ]
    })
];

// ===== トレーナーズ =====

const TRAINERS = [
    trainer({
        id: 'professors-research',
        name: '博士の研究',
        trainerType: 'supporter',
        text: '自分の手札をすべてトラッシュし、山札を7枚引く。',
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => {
            game.discardHand(player);
            game.draw(player, 7);
        }
    }),
    trainer({
        id: 'iono',
        name: 'ナンジャモ',
        trainerType: 'supporter',
        text: '各プレイヤーは、それぞれ手札をすべてウラにして切り、山札の下にもどす。その後、それぞれ自分のサイドの残り枚数ぶん、山札を引く。',
        play: (game, player) => {
            const players = [player, game.opponentOf(player)];
            players.forEach(p => game.putHandOnDeckBottom(p));
            players.forEach(p => game.draw(p, p.prizes.length));
        }
    }),
    trainer({
        id: 'judge',
        name: 'ジャッジマン',
        trainerType: 'supporter',
        text: '各プレイヤーは、それぞれ手札を山札にもどして切る。その後、それぞれ山札を4枚引く。',
        play: (game, player) => {
            const players = [player, game.opponentOf(player)];
            players.forEach(p => game.shuffleHandIntoDeck(p));
            players.forEach(p => game.draw(p, 4));
        }
    }),
    trainer({
        id: 'bosss-orders',
        name: 'ボスの指令',
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
    trainer({
        id: 'nest-ball',
        name: 'ネストボール',
        trainerType: 'item',
        text: '自分の山札からたねポケモンを1枚選び、ベンチに出す。そして山札を切る。',
        canPlay: (game, player) => player.bench.length < game.benchSize,
        play: (game, player) => game.benchFromDeck(player, isBasicPokemon, 1, 'nest-ball')
    }),
    trainer({
        id: 'ultra-ball',
        name: 'ハイパーボール',
        trainerType: 'item',
        text: 'このカードは、自分の手札を2枚トラッシュしなければ使えない。自分の山札からポケモンを1枚選び、相手に見せて、手札に加える。そして山札を切る。',
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
                        purpose: 'ultra-ball-search',
                        onSelected: found => game.addToHand(player, found, { reveal: true })
                    });
                }
            });
        }
    }),
    trainer({
        id: 'rare-candy',
        name: 'ふしぎなアメ',
        trainerType: 'item',
        text: '自分の手札の2進化ポケモンを1枚選び、その2進化ポケモンへと進化する自分の場のたねポケモンにのせ、1進化をとばして進化させる。（最初の自分の番や、出したばかりのポケモンには使えない。）',
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
        trainerType: 'item',
        text: '自分のバトルポケモンをベンチポケモンと入れ替える。',
        canPlay: (game, player) => player.bench.length > 0 && Boolean(player.active),
        play: (game, player) => game.promptSwitchOwnActive(player, 'switch')
    }),
    trainer({
        id: 'potion',
        name: 'キズぐすり',
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
        trainerType: 'item',
        text: '自分のトラッシュから基本エネルギーを2枚まで選び、相手に見せて、手札に加える。',
        canPlay: (game, player) => player.discard.some(inst => isBasicEnergy(game.cardOf(inst))),
        play: (game, player) => game.promptCards({
            player,
            cards: player.discard.filter(inst => isBasicEnergy(game.cardOf(inst))),
            min: 1,
            max: 2,
            title: '手札に加える基本エネルギーを選ぶ',
            purpose: 'energy-retrieval',
            callback: selected => {
                selected.forEach(inst => game.moveCard(player.discard, player.hand, inst));
                game.log(`${player.name}は${selected.map(inst => game.cardName(inst)).join('と')}を手札に加えた`);
            }
        })
    }),
    trainer({
        id: 'electric-generator',
        name: 'エレキジェネレーター',
        trainerType: 'item',
        text: '自分の山札を上から5枚見て、その中から基本雷エネルギーを2枚まで選び、ベンチの雷ポケモンに好きなようにつける。残りのカードは山札にもどして切る。',
        canPlay: (game, player) => player.deck.length > 0 && player.bench.some(pk => game.topCard(pk).type === 'lightning'),
        play: (game, player) => {
            const top = player.deck.slice(0, 5);
            const energies = top.filter(inst => isBasicEnergy(game.cardOf(inst), 'lightning'));
            game.log(`${player.name}は山札を上から${top.length}枚見た`);
            const finish = () => game.shuffleDeck(player);
            if (energies.length === 0) {
                game.log('基本雷エネルギーはなかった');
                finish();
                return;
            }
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: 2,
                title: 'ベンチの雷ポケモンにつける基本雷エネルギーを選ぶ',
                purpose: 'electric-generator',
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.deck, inst));
                    game.runNext(
                        () => game.attachAnyWay(player, selected, pk => player.bench.includes(pk) && game.topCard(pk).type === 'lightning', 'electric-generator-target'),
                        finish
                    );
                }
            });
        }
    }),
    trainer({
        id: 'bravery-charm',
        name: 'ゆうきのおまもり',
        trainerType: 'tool',
        text: 'このカードをつけているたねポケモンの最大HPは「+50」される。',
        hpBonus: card => (card.stage === 0 ? 50 : 0)
    }),
    trainer({
        id: 'artazon',
        name: 'ボウルタウン',
        trainerType: 'stadium',
        text: 'おたがいのプレイヤーは、自分の番ごとに1回、自分の山札から「ルールを持たないたねポケモン」を1枚選び、ベンチに出してよい。そして山札を切る。',
        canUse: (game, player) => player.bench.length < game.benchSize && player.deck.length > 0,
        use: (game, player) => game.benchFromDeck(player, card => isBasicPokemon(card) && !card.rule, 1, 'artazon')
    })
];

const ENERGIES = [basicEnergy('fire'), basicEnergy('lightning')];

export const CARDS = Object.fromEntries([...POKEMON, ...TRAINERS, ...ENERGIES].map(card => [card.id, card]));

export function getCard(id) {
    const card = CARDS[id];
    if (!card) throw new Error(`不明なカード: ${id}`);
    return card;
}

export { isBasicEnergy, isBasicPokemon };
