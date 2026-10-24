/**
 * サポートの効果（カードの名前で引く）。書き方は cards/HOOKS.md
 *
 * canPlay は手札から出す前に呼ぶ（このカード自身はまだ手札にある）。play のときは、このカードはもう手札にない
 * cpuWants も手札から出す前に呼ぶので、手札の枚数は handSize（このカードをのぞいた枚数）で見る
 *
 * まだ書いていないサポート（ゲームの本体に仕組みが要るもの）
 *   アセロラのいたずら：「相手のポケモンexからワザの効果を受けない」を、ポケモンにつく効果で表せない
 *   ギーマの一手：「ポケモンを1枚選び、ベンチに出す」の、進化ポケモンを出せるのかが確かめられない
 *   バーベナとヘレナ：「〜がいなければ使えない」が、どれか1匹か全員かが確かめられない。サイドを多くとる効果もフックがない
 *   ホミカの演奏：「どくのポケモンはにげられない（新しくどくにしたポケモンもふくむ）」を表す、プレイヤーにつく効果がない
 *   フウとランの修行・管理人：使ったカードをトラッシュせず、手札・山札にもどす仕組みがない
 *   からておうの稽古・スグリ：「相手のバトル場のポケモンexへのダメージ+」の、ダメージを受ける側で決まる効果がない
 *   ブライア：「サイドを1枚多くとる」を、この番だけ働かせる仕組みがない
 *   ミカンのまなざし：ベンチのポケモンや、後から場に出したポケモンへのダメージを減らす効果がない
 *   ネリネ：「この番の終わりに」働く効果を、サポートから残せない
 */

import { CATALOG } from '../catalog.js';

// ===== カードの判定 =====

const isPokemon = card => card.kind === 'pokemon';
const isBasicPokemon = card => isPokemon(card) && card.stage === 0;
const isEvolutionPokemon = card => isPokemon(card) && card.stage > 0;
const isBasicEnergy = (card, type) => card.kind === 'energy' && card.basic && (!type || card.energyType === type);
const isEnergy = card => card.kind === 'energy';
const isTrainer = card => card.kind === 'trainer';
const hasRule = card => Boolean(card.rule);
const isPokemonEx = card => card.rule === 'ex' || card.rule === 'mega';
const isMega = card => card.rule === 'mega';
const isRocket = card => isPokemon(card) && card.name.startsWith('ロケット団の');
const isEthan = card => isPokemon(card) && card.name.startsWith('ヒビキの');

// 名前からカードのデータを引く（きぜつしたポケモンは名前だけが残るため）
const MEGA_NAMES = new Set(CATALOG.filter(card => card.kind === 'pokemon' && card.rule === 'mega').map(card => card.name));
const ROCKET_NAMES = new Set(CATALOG.filter(card => card.kind === 'pokemon' && card.name.startsWith('ロケット団の')).map(card => card.name));
// タイム：答えられるHP（スタンダードのポケモンにあるHPのすべて）
const HP_OPTIONS = [...new Set(CATALOG.filter(card => card.kind === 'pokemon').map(card => card.hp))].sort((a, b) => a - b);

// ===== 小さな道具 =====

const handSize = player => player.hand.length - 1; // cpuWants・canPlay のとき、このカードをのぞいた手札の枚数
const canDraw = (game, player) => player.deck.length > 0;
const remainingHp = (game, pokemon) => game.maxHp(pokemon) - pokemon.damage;
const deckHas = (game, player, filter) => player.deck.some(inst => filter(game.cardOf(inst)));
const handHas = (game, player, filter) => player.hand.some(inst => filter(game.cardOf(inst)));
const discardOf = (game, player, filter) => player.discard.filter(inst => filter(game.cardOf(inst)));
const ownPokemon = (game, player, filter) => game.inPlay(player).filter(pokemon => filter(game.topCard(pokemon)));
const canAttackNow = (game, player) => Boolean(player.active)
    && game.topCard(player.active).attacks.some((_, index) => game.checkAttack(player, index) === null);
const totalHeal = (game, pokemons, amount) => pokemons.reduce((sum, pokemon) => sum + Math.min(amount, pokemon.damage), 0);

// 前の相手の番に、ワザのダメージで自分のポケモンがきぜつしていたか（filter：きぜつしたポケモンの名前で絞る）
// ゲームは、ワザのダメージによるきぜつだけを記録している。特性などでのきぜつは数えないので、使えない側に倒れる
const knockedOutLastTurn = (game, player, filter = () => true) => player.knockedOutByAttackTurn === game.turn - 1
    && player.knockedOutByAttackNames.some(filter);

function drawUntil(game, player, count) {
    const need = count - player.hand.length;
    if (need > 0) game.draw(player, need);
}

// 点の高い順に count 個のインデックスを選ぶ（CPU の答え）
function topIndices(items, score, count) {
    return items
        .map((item, index) => ({ index, score: score(item) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, count)
        .map(entry => entry.index)
        .sort((a, b) => a - b);
}

// 手放してよいカードほど小さい値（CPU が手札をトラッシュするとき）
function keepValue(game, player, inst) {
    const card = game.cardOf(inst);
    const sameCount = player.hand.filter(other => other.id === inst.id).length;
    if (isBasicEnergy(card)) return 30 - sameCount * 5;
    if (isPokemon(card)) return 60 + card.stage * 10 + (isPokemonEx(card) ? 20 : 0);
    if (card.trainerType === 'stadium') return 10;
    return 40 - sameCount * 5;
}

const cpuDiscardLeast = (game, prompt) => topIndices(prompt.cards, inst => -keepValue(game, prompt.player, inst), prompt.max);
const cpuFirst = (game, prompt) => Array.from({ length: prompt.max }, (_, index) => index);
const cpuPreferActive = (game, prompt) => {
    const index = prompt.pokemon.indexOf(prompt.player.active);
    return [index >= 0 ? index : 0];
};
const cpuMostDamaged = (game, prompt) => topIndices(prompt.pokemon, pokemon => pokemon.damage, 1);

// 手札を count 枚トラッシュしてから then（「〜しなければ使えない」のトラッシュ）
function discardFromHand(game, player, count, then) {
    const n = Math.min(count, player.hand.length);
    if (n === 0) {
        then();
        return;
    }
    game.promptCards({
        player,
        cards: player.hand,
        min: n,
        max: n,
        title: `トラッシュする手札を${n}枚選ぶ`,
        purpose: 'supporter-discard-hand',
        cpuAnswer: cpuDiscardLeast,
        callback: discarded => {
            discarded.forEach(inst => game.moveCard(player.hand, player.discard, inst));
            game.log(`${player.name}は${discarded.map(inst => game.cardName(inst)).join('と')}をトラッシュした`);
            then();
        }
    });
}

// 山札から条件に合うカードを max 枚まで選び、相手に見せて手札に加える（最後に山札を切る）
function searchToHand(game, player, filter, max, title, cpuAnswer = cpuFirst) {
    game.searchDeck({
        player,
        filter,
        max,
        title,
        purpose: 'search-card',
        cpuAnswer,
        onSelected: found => game.addToHand(player, found, { reveal: true })
    });
}

// 山札から、種類ごとに1枚ずつ選ぶ（kinds：[{ filter, title }]）。選んだカードを相手に見せて手札に加え、山札を切る
function searchOneEach(game, player, kinds, onDone = picked => game.addToHand(player, picked, { reveal: true })) {
    const picked = [];
    const step = index => {
        if (index >= kinds.length) {
            picked.forEach(inst => game.removeCard(player.deck, inst));
            if (picked.length === 0) game.log(`${player.name}は山札を見たが、選べるカードはなかった`);
            onDone(picked);
            game.shuffleDeck(player);
            return;
        }
        const candidates = player.deck.filter(inst => !picked.includes(inst) && kinds[index].filter(game.cardOf(inst)));
        if (candidates.length === 0) {
            step(index + 1);
            return;
        }
        game.promptCards({
            player,
            cards: candidates,
            min: 0,
            max: 1,
            title: kinds[index].title,
            purpose: 'search-card',
            cpuAnswer: cpuFirst,
            callback: selected => {
                picked.push(...selected);
                step(index + 1);
            }
        });
    };
    step(0);
}

// トラッシュから条件に合うカードを max 枚まで選び、相手に見せて手札に加える
function discardToHand(game, player, filter, max, title, score) {
    const candidates = discardOf(game, player, filter);
    if (candidates.length === 0) return;
    game.promptCards({
        player,
        cards: candidates,
        min: 0,
        max: Math.min(max, candidates.length),
        title,
        purpose: 'discard-to-hand',
        cpuAnswer: (g, prompt) => topIndices(prompt.cards, inst => score(g.cardOf(inst)), prompt.max),
        callback: selected => {
            selected.forEach(inst => game.removeCard(player.discard, inst));
            game.addToHand(player, selected, { reveal: true });
        }
    });
}

// 山札の上から count 枚を見て、条件に合うカードを max 枚まで手札に加える。残りは rest（'shuffle'：山札にもどして切る / 'discard'：トラッシュ）
function lookTopToHand(game, player, { count, filter = () => true, min = 0, max, title, rest = 'shuffle', reveal = false }) {
    const top = player.deck.slice(0, count);
    const candidates = top.filter(inst => filter(game.cardOf(inst)));
    const finish = selected => {
        selected.forEach(inst => game.removeCard(player.deck, inst));
        game.addToHand(player, selected, { reveal });
        if (rest === 'discard') {
            const others = top.filter(inst => !selected.includes(inst));
            others.forEach(inst => game.moveCard(player.deck, player.discard, inst));
            if (others.length) game.log(`${player.name}は残りの${others.map(inst => game.cardName(inst)).join('・')}をトラッシュした`);
        } else {
            game.shuffleDeck(player);
        }
    };
    game.log(`${player.name}は山札を上から${top.length}枚見た`);
    if (candidates.length === 0) {
        finish([]);
        return;
    }
    game.promptCards({
        player,
        cards: candidates,
        min: Math.min(min, candidates.length),
        max: Math.min(max, candidates.length),
        title,
        purpose: 'search-card',
        cpuAnswer: cpuFirst,
        callback: finish
    });
}

// エネルギー（場の外のカード）を、targets のうち1匹にすべてつける
function attachAllToOne(game, player, energies, targets, title, then = () => {}) {
    if (energies.length === 0 || targets.length === 0) {
        then(null);
        return;
    }
    const attach = target => {
        energies.forEach(inst => game.attachFromOutside(target, inst));
        then(target);
    };
    if (targets.length === 1) {
        attach(targets[0]);
        return;
    }
    game.promptPokemon({
        player,
        pokemon: targets,
        min: 1,
        max: 1,
        title,
        purpose: 'attach-energy-target',
        cpuAnswer: cpuPreferActive,
        callback: ([target]) => attach(target)
    });
}

// 自分のポケモン1匹を選んで回復する（amount が null ならすべて）
function healOne(game, player, targets, amount, title, after = () => {}) {
    if (targets.length === 0) return;
    game.promptPokemon({
        player,
        pokemon: targets,
        min: 1,
        max: 1,
        title,
        purpose: 'potion',
        cpuAnswer: cpuMostDamaged,
        callback: ([target]) => {
            game.heal(target, amount ?? target.damage);
            after(target);
        }
    });
}

// バトルポケモンとベンチポケモンを入れ替え、ベンチに下がったポケモンを then に渡す
function switchOwn(game, player, then = () => {}, candidates = player.bench) {
    if (!player.active || candidates.length === 0) {
        then(null, null);
        return;
    }
    game.promptPokemon({
        player,
        pokemon: candidates,
        min: 1,
        max: 1,
        title: 'バトル場に出すベンチポケモンを選ぶ',
        purpose: 'switch',
        callback: ([target]) => {
            const old = player.active;
            game.switchActive(player, target);
            then(old, target);
        }
    });
}

// 相手のベンチポケモンを1匹選び、バトルポケモンと入れ替える
function gustOpponent(game, player, filter = () => true, then = () => {}) {
    const opponent = game.opponentOf(player);
    const candidates = opponent.bench.filter(pokemon => filter(game.topCard(pokemon)));
    if (candidates.length === 0) return;
    game.promptPokemon({
        player,
        pokemon: candidates,
        min: 1,
        max: 1,
        title: 'バトル場に呼び出す相手のポケモンを選ぶ',
        purpose: 'boss-target',
        callback: ([target]) => {
            game.switchActive(opponent, target);
            then(target);
        }
    });
}

// 自分は mine 枚、相手は theirs 枚、山札を引く
function drawBoth(game, player, mine, theirs) {
    const opponent = game.opponentOf(player);
    game.draw(player, mine);
    game.draw(opponent, theirs);
}

function takePrize(game, player) {
    if (player.prizes.length === 0) return;
    const [inst] = player.prizes.splice(0, 1);
    player.hand.push(inst);
    game.log(`${player.name}はサイドを1枚取った（残り${player.prizes.length}枚）`);
    game.log(`サイドから${game.cardName(inst)}を手札に加えた`, { to: player.id });
}

const clearSpecialConditions = (game, pokemon) => {
    pokemon.rotation = null;
    pokemon.poisoned = false;
    pokemon.poisonDamage = null;
    pokemon.burned = false;
    game.log(`${game.topCard(pokemon).name}の特殊状態がすべて回復した`);
};

// 3枚引くだけのサポート
const draw3 = {
    canPlay: canDraw,
    play: (game, player) => game.draw(player, 3),
    cpuWants: (game, player) => handSize(player) <= 5 && player.deck.length > 5
};

// セイジ：場のポケモンから進化する、特性を持たないポケモンか
const sageEvolves = (game, pokemon, card) => isEvolutionPokemon(card) && !card.ability && card.evolvesFrom === game.topCard(pokemon).name;

export const TRAINER_EFFECTS = {
    // ===== 山札を引く =====
    'ネモ': draw3,
    'チェレン': draw3,
    'パルデアの仲間たち': draw3,
    'ビリオとネア': {
        canPlay: canDraw,
        play: (game, player) => {
            game.draw(player, 2);
            if (player.hand.length >= 10) game.draw(player, 2);
        },
        cpuWants: (game, player) => handSize(player) <= 5 && player.deck.length > 5
    },
    '博士の研究': {
        canPlay: canDraw,
        play: (game, player) => {
            game.discardHand(player);
            game.draw(player, 7);
        },
        cpuWants: (game, player) => handSize(player) <= 3 && player.deck.length > 10
    },
    'ジェット': {
        canPlay: canDraw,
        play: (game, player) => {
            const count = ownPokemon(game, game.opponentOf(player), isMega).length;
            if (count > 0) game.draw(player, count);
            else game.log('相手の場にメガシンカexがいないので、引けなかった');
        },
        cpuWants: (game, player) => ownPokemon(game, game.opponentOf(player), isMega).length >= 2 && handSize(player) <= 5
    },
    'マチエール': {
        canPlay: canDraw,
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            game.revealHand(opponent, player);
            const count = opponent.hand.filter(inst => isPokemon(game.cardOf(inst))).length;
            game.log(`${opponent.name}の手札のポケモンは${count}枚`);
            if (count > 0) game.draw(player, count);
        },
        cpuWants: (game, player) => handSize(player) <= 3 && game.opponentOf(player).hand.length >= 4
    },
    'マツバの確信': {
        canPlay: (game, player) => handSize(player) >= 1 && canDraw(game, player),
        play: (game, player) => discardFromHand(game, player, 1, () => game.draw(player, game.opponentOf(player).bench.length)),
        cpuWants: (game, player) => game.opponentOf(player).bench.length >= 3 && handSize(player) >= 1 && handSize(player) <= 4
    },
    'ピュール': {
        canPlay: canDraw,
        play: (game, player) => {
            const finish = () => drawUntil(game, player, 5);
            if (player.hand.length === 0) {
                finish();
                return;
            }
            game.promptCards({
                player,
                cards: player.hand,
                min: 0,
                max: player.hand.length,
                title: '山札を引く前にトラッシュする手札を選ぶ（トラッシュしないなら選ばない）',
                purpose: 'supporter-discard-any',
                cpuAnswer: () => [],
                callback: discarded => {
                    discarded.forEach(inst => game.moveCard(player.hand, player.discard, inst));
                    if (discarded.length) game.log(`${player.name}は手札を${discarded.length}枚トラッシュした`);
                    finish();
                }
            });
        },
        cpuWants: (game, player) => handSize(player) <= 2
    },
    'アイリスの闘志': {
        canPlay: (game, player) => handSize(player) >= 1 && canDraw(game, player),
        play: (game, player) => discardFromHand(game, player, 1, () => drawUntil(game, player, 6)),
        cpuWants: (game, player) => handSize(player) >= 1 && handSize(player) <= 3
    },
    'ロケット団のアテナ': {
        canPlay: canDraw,
        play: (game, player) => drawUntil(game, player, game.inPlay(player).every(pokemon => isRocket(game.topCard(pokemon))) ? 8 : 5),
        cpuWants: (game, player) => {
            const target = game.inPlay(player).every(pokemon => isRocket(game.topCard(pokemon))) ? 8 : 5;
            return target - handSize(player) >= 3;
        }
    },
    'タロ': {
        play: (game, player) => {
            game.shuffleHandIntoDeck(player);
            game.draw(player, game.opponentOf(player).prizes.length <= 3 ? 8 : 4);
        },
        cpuWants: (game, player) => handSize(player) <= 3
    },
    'ドラセナ': {
        play: (game, player) => {
            game.shuffleHandIntoDeck(player);
            game.draw(player, game.flipCoin() ? 8 : 3);
        },
        cpuWants: (game, player) => handSize(player) <= 2
    },
    'ムク': {
        canPlay: (game, player) => handHas(game, player, card => isPokemon(card) && !hasRule(card)),
        play: (game, player) => {
            const candidates = player.hand.filter(inst => { const card = game.cardOf(inst); return isPokemon(card) && !hasRule(card); });
            if (candidates.length === 0) return;
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: Math.min(2, candidates.length),
                title: 'トラッシュするポケモンを2枚まで選ぶ（1枚につき山札を3枚引く）',
                purpose: 'supporter-discard-pokemon',
                cpuAnswer: (g, prompt) => topIndices(prompt.cards, inst => -keepValue(g, prompt.player, inst), prompt.max),
                callback: discarded => {
                    discarded.forEach(inst => game.moveCard(player.hand, player.discard, inst));
                    if (discarded.length === 0) return;
                    game.log(`${player.name}は${discarded.map(inst => game.cardName(inst)).join('と')}をトラッシュした`);
                    game.draw(player, discarded.length * 3);
                }
            });
        },
        cpuWants: (game, player) => handSize(player) <= 4 && player.deck.length >= 6
            && handHas(game, player, card => isPokemon(card) && !hasRule(card))
    },
    'ハイダイ': {
        canPlay: (game, player) => handSize(player) >= 2,
        play: (game, player) => {
            game.promptCards({
                player,
                cards: player.hand,
                min: 2,
                max: 2,
                title: '山札の下にもどす手札を2枚選ぶ',
                purpose: 'supporter-hand-to-bottom',
                cpuAnswer: cpuDiscardLeast,
                callback: selected => {
                    game.promptCards({
                        player,
                        cards: selected,
                        min: 1,
                        max: 1,
                        title: '山札の一番下にするカードを選ぶ',
                        purpose: 'supporter-bottom-order',
                        cpuAnswer: () => [0],
                        callback: ([bottom]) => {
                            const ordered = [...selected.filter(inst => inst !== bottom), bottom];
                            ordered.forEach(inst => game.moveCard(player.hand, player.deck, inst));
                            game.log(`${player.name}は手札を2枚、山札の下にもどした`);
                            game.draw(player, 4);
                        }
                    });
                }
            });
        },
        cpuWants: (game, player) => handSize(player) >= 2 && handSize(player) <= 4
    },
    'サーファー': {
        canPlay: (game, player) => Boolean(player.active) && player.bench.length > 0,
        play: (game, player) => switchOwn(game, player, () => drawUntil(game, player, 5)),
        cpuWants: (game, player) => handSize(player) <= 2
    },

    // ===== おたがいの手札 =====
    'ナンジャモ': {
        play: (game, player) => {
            const players = [player, game.opponentOf(player)];
            players.forEach(p => game.putHandOnDeckBottom(p));
            players.forEach(p => game.draw(p, p.prizes.length));
        },
        cpuWants: (game, player) => handSize(player) <= 2 && player.prizes.length >= 3
    },
    'クラウン': {
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            [player, opponent].forEach(p => game.shuffleHandIntoDeck(p));
            const heads = game.flipCoin();
            drawBoth(game, player, heads ? 5 : 3, heads ? 3 : 5);
        },
        cpuWants: (game, player) => handSize(player) <= 2
    },
    'ゴヨウ': {
        play: (game, player) => {
            const players = [player, game.opponentOf(player)];
            players.forEach(p => game.putHandOnDeckBottom(p));
            players.forEach(p => {
                game.log(`${p.name}がコインを投げる`);
                game.draw(p, game.flipCoin() ? 6 : 3);
            });
        },
        cpuWants: (game, player) => handSize(player) <= 2
    },
    'ロケット団のアポロ': {
        canPlay: (game, player) => knockedOutLastTurn(game, player, name => ROCKET_NAMES.has(name)),
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            [player, opponent].forEach(p => game.shuffleHandIntoDeck(p));
            drawBoth(game, player, 5, 3);
        },
        cpuWants: (game, player) => handSize(player) <= 3
    },
    'マチスの取引': {
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            game.promptConfirm({
                player: opponent,
                title: `${player.name}の「マチスの取引」：「おたがいのプレイヤーは、それぞれサイドを1枚とる。」をのぞみますか？（のぞまないなら、${player.name}が山札を4枚引く）`,
                purpose: 'surge-deal',
                // 相手（答える側）がサイドで勝っているか、取れば勝てるならのぞむ
                cpuAnswer: (g, prompt) => {
                    const me = prompt.player;
                    return me.prizes.length <= 1 || me.prizes.length < g.opponentOf(me).prizes.length;
                },
                callback: yes => {
                    if (yes) {
                        game.log(`${opponent.name}はのぞんだ`);
                        [player, opponent].forEach(p => takePrize(game, p));
                        game.checkWinner();
                    } else {
                        game.log(`${opponent.name}はのぞまなかった`);
                        game.draw(player, 4);
                    }
                }
            });
        },
        cpuWants: (game, player) => handSize(player) <= 4 && player.deck.length >= 4
    },
    'タイム': {
        canPlay: (game, player) => handHas(game, player, isPokemon),
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            const pokemons = player.hand.filter(inst => isPokemon(game.cardOf(inst)));
            if (pokemons.length === 0) return;
            game.promptCards({
                player,
                cards: pokemons,
                min: 1,
                max: 1,
                title: 'ウラにして置くポケモンを選ぶ（相手がHPを答える）',
                purpose: 'tyme-pokemon',
                cpuAnswer: (g, prompt) => topIndices(prompt.cards, inst => g.cardOf(inst).hp, 1),
                callback: ([inst]) => {
                    const card = game.cardOf(inst);
                    game.log(`${player.name}は「${card.name}」をウラにして置いた`);
                    game.promptChoose({
                        player: opponent,
                        options: HP_OPTIONS.map(hp => `HP${hp}`),
                        title: `「${card.name}」のHPを答える`,
                        purpose: 'tyme-answer',
                        // CPU は、同じ名前のポケモンで一番多いHPを答える
                        cpuAnswer: () => {
                            const counts = new Map();
                            CATALOG.filter(data => data.kind === 'pokemon' && data.name === card.name)
                                .forEach(data => counts.set(data.hp, (counts.get(data.hp) ?? 0) + 1));
                            const guess = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? HP_OPTIONS[0];
                            return [Math.max(0, HP_OPTIONS.indexOf(guess))];
                        },
                        callback: ([index]) => {
                            const answered = HP_OPTIONS[index];
                            game.log(`${opponent.name}は「HP${answered}」と答えた。${card.name}のHPは${card.hp}`);
                            if (answered === card.hp) {
                                game.log('正解');
                                game.draw(opponent, 4);
                            } else {
                                game.log('不正解');
                                game.draw(player, 4);
                            }
                            game.log(`${player.name}は${card.name}を手札にもどした`);
                        }
                    });
                }
            });
        },
        cpuWants: (game, player) => handSize(player) <= 3 && handHas(game, player, isPokemon)
    },
    'クセロシキのたくらみ': {
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            const count = opponent.hand.length - 3;
            if (count <= 0) {
                game.log(`${opponent.name}の手札は3枚以下なので、トラッシュしなかった`);
                return;
            }
            game.promptCards({
                player: opponent,
                cards: opponent.hand,
                min: count,
                max: count,
                title: `手札が3枚になるように、トラッシュする手札を${count}枚選ぶ`,
                purpose: 'discard-to-three',
                cpuAnswer: cpuDiscardLeast,
                callback: discarded => {
                    discarded.forEach(inst => game.moveCard(opponent.hand, opponent.discard, inst));
                    game.log(`${opponent.name}は${discarded.map(inst => game.cardName(inst)).join('と')}をトラッシュした`);
                }
            });
        },
        cpuWants: (game, player) => game.opponentOf(player).hand.length >= 6
    },
    'ビワ': {
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            game.revealHand(opponent, player);
            const items = opponent.hand.filter(inst => game.cardOf(inst).trainerType === 'item');
            if (items.length === 0) return;
            game.promptCards({
                player,
                cards: items,
                min: 0,
                max: Math.min(2, items.length),
                title: 'トラッシュする相手のグッズを2枚まで選ぶ',
                purpose: 'discard-opponent-hand',
                cpuAnswer: cpuFirst,
                callback: selected => {
                    selected.forEach(inst => game.moveCard(opponent.hand, opponent.discard, inst));
                    if (selected.length) game.log(`${opponent.name}の${selected.map(inst => game.cardName(inst)).join('と')}をトラッシュした`);
                }
            });
        },
        cpuWants: (game, player) => game.opponentOf(player).hand.length >= 4
    },

    // ===== 山札から探す =====
    'ヒカリ': {
        canPlay: canDraw,
        play: (game, player) => searchOneEach(game, player, [
            { filter: card => isPokemon(card) && card.stage === 0, title: '手札に加えるたねポケモンを選ぶ' },
            { filter: card => isPokemon(card) && card.stage === 1, title: '手札に加える1進化ポケモンを選ぶ' },
            { filter: card => isPokemon(card) && card.stage === 2, title: '手札に加える2進化ポケモンを選ぶ' }
        ]),
        cpuWants: (game, player) => handSize(player) <= 6 && deckHas(game, player, isEvolutionPokemon)
    },
    'トウコ': {
        canPlay: canDraw,
        play: (game, player) => searchOneEach(game, player, [
            { filter: isEvolutionPokemon, title: '手札に加える進化ポケモンを選ぶ' },
            { filter: isEnergy, title: '手札に加えるエネルギーを選ぶ' }
        ]),
        cpuWants: (game, player) => handSize(player) <= 6 && deckHas(game, player, isEvolutionPokemon)
    },
    'アクロマの執念': {
        canPlay: canDraw,
        play: (game, player) => searchOneEach(game, player, [
            { filter: card => card.trainerType === 'stadium', title: '手札に加えるスタジアムを選ぶ' },
            { filter: isEnergy, title: '手札に加えるエネルギーを選ぶ' }
        ]),
        cpuWants: (game, player) => !handHas(game, player, isEnergy) && deckHas(game, player, isEnergy)
    },
    'アオキの手際': {
        canPlay: canDraw,
        play: (game, player) => {
            game.discardHand(player);
            searchOneEach(game, player, [
                { filter: isPokemon, title: '手札に加えるポケモンを選ぶ' },
                { filter: card => card.trainerType === 'supporter', title: '手札に加えるサポートを選ぶ' },
                { filter: card => isBasicEnergy(card), title: '手札に加える基本エネルギーを選ぶ' }
            ]);
        },
        cpuWants: (game, player) => handSize(player) <= 2 && player.deck.length >= 10
    },
    'タケシのスカウト': {
        canPlay: canDraw,
        play: (game, player) => {
            game.promptChoose({
                player,
                options: ['たねポケモンを2枚まで', '進化ポケモンを1枚'],
                title: '山札から手札に加えるポケモンを選ぶ',
                purpose: 'brock-mode',
                cpuAnswer: (g, prompt) => [prompt.player.bench.length < 3 || !deckHas(g, prompt.player, isEvolutionPokemon) ? 0 : 1],
                callback: ([index]) => {
                    if (index === 0) searchToHand(game, player, isBasicPokemon, 2, '手札に加えるたねポケモンを2枚まで選ぶ');
                    else searchToHand(game, player, isEvolutionPokemon, 1, '手札に加える進化ポケモンを選ぶ');
                }
            });
        },
        cpuWants: (game, player) => handSize(player) <= 6 && deckHas(game, player, isPokemon)
    },
    'シアノ': {
        canPlay: canDraw,
        play: (game, player) => searchToHand(game, player, isPokemonEx, 3, '手札に加えるポケモンexを3枚まで選ぶ'),
        cpuWants: (game, player) => handSize(player) <= 5 && deckHas(game, player, isPokemonEx)
    },
    'カナリィ': {
        canPlay: (game, player) => handSize(player) >= 1 && canDraw(game, player),
        play: (game, player) => discardFromHand(game, player, 1, () =>
            searchToHand(game, player, card => isPokemon(card) && card.type === 'lightning', 4, '手札に加える雷ポケモンを4枚まで選ぶ')),
        cpuWants: (game, player) => handSize(player) >= 1 && handSize(player) <= 5
            && deckHas(game, player, card => isPokemon(card) && card.type === 'lightning')
    },
    'ひふきやろう': {
        canPlay: canDraw,
        play: (game, player) => searchToHand(game, player, card => isBasicEnergy(card), 7, '手札に加える基本エネルギーを7枚まで選ぶ'),
        cpuWants: (game, player) => !handHas(game, player, isEnergy)
            && player.deck.filter(inst => isBasicEnergy(game.cardOf(inst))).length >= 2
    },
    'ギリー': {
        canPlay: canDraw,
        play: (game, player) => searchToHand(game, player, card => card.trainerType === 'supporter' || card.trainerType === 'stadium', 3,
            '手札に加えるサポートとスタジアムを合計3枚まで選ぶ'),
        cpuWants: (game, player) => handSize(player) <= 4
            && deckHas(game, player, card => card.trainerType === 'supporter' || card.trainerType === 'stadium')
    },
    'ロケット団のラムダ': {
        canPlay: canDraw,
        play: (game, player) => searchToHand(game, player, isTrainer, 1, '手札に加えるトレーナーズを選ぶ'),
        cpuWants: (game, player) => handSize(player) <= 5 && deckHas(game, player, isTrainer)
    },
    'ロケット団のランス': {
        firstTurnOk: true,
        canPlay: canDraw,
        play: (game, player) => searchToHand(game, player, card => isBasicPokemon(card) && isRocket(card), 3,
            '手札に加える、たねポケモンの「ロケット団のポケモン」を3枚まで選ぶ'),
        cpuWants: (game, player) => player.bench.length < 4 && deckHas(game, player, card => isBasicPokemon(card) && isRocket(card))
    },
    'ヒビキの冒険': {
        canPlay: canDraw,
        play: (game, player) => searchToHand(game, player, card => isEthan(card) || isBasicEnergy(card, 'fire'), 3,
            '手札に加える「ヒビキのポケモン」と「基本炎エネルギー」を合計3枚まで選ぶ'),
        cpuWants: (game, player) => handSize(player) <= 5 && deckHas(game, player, card => isEthan(card) || isBasicEnergy(card, 'fire'))
    },
    'カシオペア': {
        canPlay: (game, player) => player.hand.length === 1 && canDraw(game, player),
        play: (game, player) => searchToHand(game, player, () => true, 2, '手札に加えるカードを2枚まで選ぶ'),
        cpuWants: (game, player) => player.hand.length === 1 && player.deck.length > 0
    },
    'サザレ': {
        canPlay: (game, player) => handHas(game, player, isPokemon),
        play: (game, player) => {
            const pokemons = player.hand.filter(inst => isPokemon(game.cardOf(inst)));
            game.promptCards({
                player,
                cards: pokemons,
                min: 0,
                max: Math.min(2, pokemons.length),
                title: '山札にもどすポケモンを2枚まで選ぶ',
                purpose: 'supporter-return-pokemon',
                // 場に進化元がいない進化ポケモンを、先にもどす
                cpuAnswer: (g, prompt) => {
                    const names = g.inPlay(prompt.player).map(pokemon => g.topCard(pokemon).name);
                    const stuck = prompt.cards.map((inst, index) => ({ card: g.cardOf(inst), index }))
                        .filter(({ card }) => card.stage > 0 && !names.includes(card.evolvesFrom))
                        .map(({ index }) => index);
                    return stuck.slice(0, prompt.max);
                },
                callback: returned => {
                    returned.forEach(inst => game.moveCard(player.hand, player.deck, inst));
                    if (returned.length === 0) return;
                    game.log(`${player.name}は${returned.map(inst => game.cardName(inst)).join('と')}を山札にもどした`);
                    searchToHand(game, player, isPokemon, returned.length, `手札に加えるポケモンを${returned.length}枚まで選ぶ`,
                        (g, prompt) => topIndices(prompt.cards, inst => {
                            const card = g.cardOf(inst);
                            const names = g.inPlay(prompt.player).map(pokemon => g.topCard(pokemon).name);
                            return (card.stage === 0 || names.includes(card.evolvesFrom) ? 1000 : 0) + card.stage * 10;
                        }, prompt.max));
                }
            });
        },
        cpuWants: (game, player) => {
            const names = game.inPlay(player).map(pokemon => game.topCard(pokemon).name);
            return handHas(game, player, card => isEvolutionPokemon(card) && !names.includes(card.evolvesFrom))
                && deckHas(game, player, isPokemon);
        }
    },
    '暗号マニアの解読': {
        canPlay: canDraw,
        play: (game, player) => {
            const count = Math.min(2, player.deck.length);
            game.promptCards({
                player,
                cards: player.deck,
                min: count,
                max: count,
                title: `山札の上に置くカードを${count}枚選ぶ`,
                purpose: 'search-card',
                cpuAnswer: cpuFirst,
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.deck, inst));
                    game.shuffleDeck(player);
                    const putOnTop = top => {
                        const ordered = [top, ...selected.filter(inst => inst !== top)];
                        player.deck.unshift(...ordered);
                        game.log(`${player.name}は選んだカードを${ordered.length}枚、山札の上にもどした`);
                    };
                    if (selected.length < 2) {
                        putOnTop(selected[0]);
                        return;
                    }
                    game.promptCards({
                        player,
                        cards: selected,
                        min: 1,
                        max: 1,
                        title: '山札の一番上にするカードを選ぶ',
                        purpose: 'supporter-top-order',
                        cpuAnswer: () => [0],
                        callback: ([top]) => putOnTop(top)
                    });
                }
            });
        },
        cpuWants: (game, player) => handSize(player) <= 1 && player.deck.length >= 2
    },
    'セイジ': {
        canPlay: (game, player) => canDraw(game, player),
        play: (game, player) => {
            const targets = game.inPlay(player);
            game.promptPokemon({
                player,
                pokemon: targets,
                min: 1,
                max: 1,
                title: '進化させるポケモンを選ぶ',
                purpose: 'sage-target',
                // CPU は、山札に進化先があるポケモン（バトルポケモンを先に）
                cpuAnswer: (g, prompt) => topIndices(prompt.pokemon, pokemon => (deckHas(g, prompt.player, card => sageEvolves(g, pokemon, card)) ? 1000 : 0)
                    + (pokemon === prompt.player.active ? 10 : 0), 1),
                callback: ([target]) => game.searchDeck({
                    player,
                    filter: card => sageEvolves(game, target, card),
                    max: 1,
                    title: `${game.topCard(target).name}から進化するカードを選ぶ`,
                    purpose: 'search-evolution',
                    cpuAnswer: cpuFirst,
                    onSelected: ([inst]) => { if (inst) game.evolveFromOutside(player, target, inst); }
                })
            });
        },
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => deckHas(game, player, card => sageEvolves(game, pokemon, card)))
    },

    // ===== 山札の上を見る =====
    'カキツバタ': {
        canPlay: canDraw,
        play: (game, player) => {
            const top = player.deck.slice(0, 7);
            game.log(`${player.name}は山札を上から${top.length}枚見た`);
            const kinds = [
                { filter: isPokemon, title: '手札に加えるポケモンを選ぶ' },
                { filter: isTrainer, title: '手札に加えるトレーナーズを選ぶ' }
            ];
            const picked = [];
            const step = index => {
                if (index >= kinds.length) {
                    picked.forEach(inst => game.removeCard(player.deck, inst));
                    game.addToHand(player, picked, { reveal: true });
                    game.shuffleDeck(player);
                    return;
                }
                const candidates = top.filter(inst => kinds[index].filter(game.cardOf(inst)));
                if (candidates.length === 0) {
                    step(index + 1);
                    return;
                }
                game.promptCards({
                    player,
                    cards: candidates,
                    min: 0,
                    max: 1,
                    title: kinds[index].title,
                    purpose: 'search-card',
                    cpuAnswer: cpuFirst,
                    callback: selected => {
                        picked.push(...selected);
                        step(index + 1);
                    }
                });
            };
            step(0);
        },
        cpuWants: (game, player) => handSize(player) <= 4 && player.deck.length >= 8
    },
    'ハッサク': {
        canPlay: (game, player) => canDraw(game, player) && knockedOutLastTurn(game, player),
        play: (game, player) => lookTopToHand(game, player, { count: 8, max: 3, title: '手札に加えるカードを3枚まで選ぶ' }),
        cpuWants: (game, player) => player.deck.length >= 3
    },
    '探検家の先導': {
        canPlay: canDraw,
        play: (game, player) => lookTopToHand(game, player, { count: 6, min: 2, max: 2, title: '手札に加えるカードを2枚選ぶ（残りはトラッシュ）', rest: 'discard' }),
        cpuWants: (game, player) => handSize(player) <= 4 && player.deck.length >= 12
    },
    'ウエートレス': {
        canPlay: canDraw,
        play: (game, player) => {
            const top = player.deck.slice(0, 6);
            game.log(`${player.name}は山札を上から${top.length}枚見た`);
            const energies = top.filter(inst => isBasicEnergy(game.cardOf(inst)));
            const finish = () => game.shuffleDeck(player);
            if (energies.length === 0) {
                finish();
                return;
            }
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: 1,
                title: 'つける基本エネルギーを選ぶ',
                purpose: 'search-card',
                cpuAnswer: cpuFirst,
                callback: ([inst]) => {
                    if (!inst) {
                        finish();
                        return;
                    }
                    game.removeCard(player.deck, inst);
                    attachAllToOne(game, player, [inst], game.inPlay(player), `${game.cardName(inst)}をつけるポケモンを選ぶ`, finish);
                }
            });
        },
        cpuWants: (game, player) => Boolean(player.active) && player.deck.length >= 6 && handSize(player) <= 5
    },

    // ===== トラッシュから =====
    'タラゴン': {
        canPlay: (game, player) => discardOf(game, player, card => isPokemon(card) || isBasicEnergy(card)).length > 0,
        play: (game, player) => discardToHand(game, player, card => isPokemon(card) || isBasicEnergy(card), 4,
            '手札に加えるポケモンと基本エネルギーを合計4枚まで選ぶ', card => (isPokemon(card) ? 100 + card.stage * 10 : 50)),
        cpuWants: (game, player) => handSize(player) <= 5 && discardOf(game, player, card => isPokemon(card) || isBasicEnergy(card)).length >= 2
    },
    'スイレンのお世話': {
        canPlay: (game, player) => discardOf(game, player, card => (isPokemon(card) && !hasRule(card)) || isBasicEnergy(card)).length > 0,
        play: (game, player) => discardToHand(game, player, card => (isPokemon(card) && !hasRule(card)) || isBasicEnergy(card), 3,
            '手札に加えるポケモン（ルールを持つポケモンをのぞく）と基本エネルギーを合計3枚まで選ぶ', card => (isPokemon(card) ? 100 + card.stage * 10 : 50)),
        cpuWants: (game, player) => handSize(player) <= 5
            && discardOf(game, player, card => (isPokemon(card) && !hasRule(card)) || isBasicEnergy(card)).length >= 2
    },

    // ===== エネルギーをつける =====
    'デウロ': {
        canPlay: (game, player) => knockedOutLastTurn(game, player, name => MEGA_NAMES.has(name)),
        play: (game, player) => {
            const megas = ownPokemon(game, player, isMega);
            game.searchDeck({
                player,
                filter: card => isBasicEnergy(card),
                max: megas.length > 0 ? 2 : 0,
                title: 'メガシンカexにつける基本エネルギーを2枚まで選ぶ',
                purpose: 'search-card',
                cpuAnswer: cpuFirst,
                onSelected: found => attachAllToOne(game, player, found, ownPokemon(game, player, isMega), 'エネルギーをつけるメガシンカexを選ぶ')
            });
        },
        cpuWants: (game, player) => ownPokemon(game, player, isMega).length > 0 && deckHas(game, player, card => isBasicEnergy(card))
    },
    'カスミの元気': {
        canPlay: canDraw,
        play: (game, player) => {
            game.searchDeck({
                player,
                filter: card => isBasicEnergy(card, 'water'),
                max: 4,
                title: 'つける基本水エネルギーを4枚まで選ぶ',
                purpose: 'search-card',
                cpuAnswer: cpuFirst,
                onSelected: found => attachAllToOne(game, player, found, game.inPlay(player), 'エネルギーをつけるポケモンを選ぶ')
            });
            game.endTurnByEffect(player);
        },
        // 番が終わるので、ワザを使えないときだけ
        cpuWants: (game, player) => !canAttackNow(game, player) && handSize(player) <= 4
            && player.deck.filter(inst => isBasicEnergy(game.cardOf(inst), 'water')).length >= 2
    },
    'メイのはげまし': {
        canPlay: (game, player) => player.prizes.length > game.opponentOf(player).prizes.length
            && ownPokemon(game, player, card => card.stage === 2).length > 0
            && discardOf(game, player, card => isBasicEnergy(card)).length > 0,
        play: (game, player) => {
            const energies = discardOf(game, player, card => isBasicEnergy(card));
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: Math.min(2, energies.length),
                title: '2進化ポケモンにつける基本エネルギーを2枚まで選ぶ',
                purpose: 'discard-energy-attach',
                cpuAnswer: cpuFirst,
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.discard, inst));
                    attachAllToOne(game, player, selected, ownPokemon(game, player, card => card.stage === 2), 'エネルギーをつける2進化ポケモンを選ぶ');
                }
            });
        },
        cpuWants: () => true
    },
    'ジプソ': {
        canPlay: (game, player) => ownPokemon(game, player, card => card.type === 'metal').length > 0
            && discardOf(game, player, card => isBasicEnergy(card, 'metal')).length > 0,
        play: (game, player) => {
            const energies = discardOf(game, player, card => isBasicEnergy(card, 'metal'));
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: Math.min(2, energies.length),
                title: 'つける基本鋼エネルギーを2枚まで選ぶ',
                purpose: 'discard-energy-attach',
                cpuAnswer: cpuFirst,
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.discard, inst));
                    attachAllToOne(game, player, selected, ownPokemon(game, player, card => card.type === 'metal'), 'エネルギーをつける鋼ポケモンを選ぶ');
                }
            });
        },
        cpuWants: () => true
    },
    'アカマツ': {
        canPlay: canDraw,
        play: (game, player) => {
            const first = player.deck.filter(inst => isBasicEnergy(game.cardOf(inst)));
            const finish = () => game.shuffleDeck(player);
            if (first.length === 0) {
                game.log(`${player.name}は山札を見たが、選べるカードはなかった`);
                finish();
                return;
            }
            const resolve = picked => {
                picked.forEach(inst => game.removeCard(player.deck, inst));
                if (picked.length === 0) {
                    finish();
                    return;
                }
                game.log(`${player.name}は${picked.map(inst => game.cardName(inst)).join('と')}を見せた`);
                if (picked.length === 1) {
                    game.addToHand(player, picked, { reveal: true });
                    finish();
                    return;
                }
                game.promptCards({
                    player,
                    cards: picked,
                    min: 1,
                    max: 1,
                    title: '手札に加えるエネルギーを選ぶ（もう1枚は自分のポケモンにつける）',
                    purpose: 'akamatsu-hand',
                    cpuAnswer: () => [0],
                    callback: ([toHand]) => {
                        game.addToHand(player, [toHand], { reveal: true });
                        const rest = picked.filter(inst => inst !== toHand);
                        attachAllToOne(game, player, rest, game.inPlay(player), `${game.cardName(rest[0])}をつけるポケモンを選ぶ`, finish);
                    }
                });
            };
            game.promptCards({
                player,
                cards: first,
                min: 0,
                max: 1,
                title: '基本エネルギーを選ぶ（1枚目）',
                purpose: 'search-card',
                cpuAnswer: cpuFirst,
                callback: ([a]) => {
                    if (!a) {
                        resolve([]);
                        return;
                    }
                    const type = game.cardOf(a).energyType;
                    const second = player.deck.filter(inst => inst !== a && isBasicEnergy(game.cardOf(inst)) && game.cardOf(inst).energyType !== type);
                    if (second.length === 0) {
                        resolve([a]);
                        return;
                    }
                    game.promptCards({
                        player,
                        cards: second,
                        min: 0,
                        max: 1,
                        title: '1枚目とちがうタイプの基本エネルギーを選ぶ（2枚目）',
                        purpose: 'search-card',
                        cpuAnswer: cpuFirst,
                        callback: ([b]) => resolve(b ? [a, b] : [a])
                    });
                }
            });
        },
        cpuWants: (game, player) => handSize(player) <= 6
            && new Set(player.deck.map(inst => game.cardOf(inst)).filter(card => isBasicEnergy(card)).map(card => card.energyType)).size >= 2
    },
    'アンズの秘技': {
        canPlay: (game, player) => ownPokemon(game, player, card => card.type === 'darkness').length > 0 && canDraw(game, player),
        play: (game, player) => {
            const targets = ownPokemon(game, player, card => card.type === 'darkness');
            game.promptPokemon({
                player,
                pokemon: targets,
                min: 0,
                max: Math.min(2, targets.length),
                title: '基本悪エネルギーをつける悪ポケモンを2匹まで選ぶ',
                purpose: 'koga-targets',
                // CPU は、どくにならないベンチを先に選ぶ
                cpuAnswer: (g, prompt) => topIndices(prompt.pokemon, pokemon => (pokemon === prompt.player.active ? 0 : 10), prompt.max),
                callback: selected => {
                    selected.forEach(pokemon => {
                        const inst = player.deck.find(card => isBasicEnergy(game.cardOf(card), 'darkness'));
                        if (!inst) return;
                        game.removeCard(player.deck, inst);
                        game.attachFromOutside(pokemon, inst);
                        if (pokemon === player.active) game.addCondition(pokemon, 'poisoned');
                    });
                    game.shuffleDeck(player);
                }
            });
        },
        cpuWants: (game, player) => player.bench.some(pokemon => game.topCard(pokemon).type === 'darkness')
            && deckHas(game, player, card => isBasicEnergy(card, 'darkness'))
    },
    'Nの筋書き': {
        canPlay: (game, player) => Boolean(player.active) && player.bench.some(pokemon => pokemon.energies.length > 0),
        play: (game, player) => {
            const owners = new Map();
            player.bench.forEach(pokemon => pokemon.energies.forEach(inst => owners.set(inst, pokemon)));
            const energies = [...owners.keys()];
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: Math.min(2, energies.length),
                title: 'バトルポケモンにつけ替えるエネルギーを2個まで選ぶ',
                purpose: 'supporter-move-energy',
                cpuAnswer: cpuFirst,
                callback: selected => selected.forEach(inst => game.moveEnergy(owners.get(inst), player.active, inst))
            });
        },
        cpuWants: (game, player) => !canAttackNow(game, player) && player.bench.some(pokemon => pokemon.energies.length > 0)
    },

    // ===== 回復 =====
    'ユカリ': {
        play: (game, player) => healOne(game, player, game.inPlay(player), 150, 'HPを150回復するポケモンを選ぶ'),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => pokemon.damage >= 100)
    },
    'コック': {
        canPlay: (game, player) => Boolean(player.active),
        play: (game, player) => game.heal(player.active, 70),
        cpuWants: (game, player) => Boolean(player.active) && player.active.damage >= 60
    },
    'ベルのまごころ': {
        canPlay: (game, player) => game.inPlay(player).some(pokemon => pokemon.damage > 0 && remainingHp(game, pokemon) <= 30),
        play: (game, player) => healOne(game, player, game.inPlay(player).filter(pokemon => pokemon.damage > 0 && remainingHp(game, pokemon) <= 30),
            null, 'HPをすべて回復するポケモンを選ぶ（残りHP30以下）'),
        cpuWants: () => true
    },
    'ポケモンセンターのお姉さん': {
        play: (game, player) => healOne(game, player, game.inPlay(player), 60, 'HPを60回復し、特殊状態を回復するポケモンを選ぶ',
            target => clearSpecialConditions(game, target)),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => pokemon.damage >= 60)
    },
    'ミツルの思いやり': {
        canPlay: (game, player) => ownPokemon(game, player, isMega).length > 0,
        play: (game, player) => healOne(game, player, ownPokemon(game, player, isMega), null, 'HPをすべて回復するメガシンカexを選ぶ', target => {
            const energies = [...target.energies];
            energies.forEach(inst => game.moveCard(target.energies, player.hand, inst));
            if (energies.length) game.log(`${game.topCard(target).name}のエネルギーを${energies.length}枚手札にもどした`);
        }),
        cpuWants: (game, player) => ownPokemon(game, player, isMega).some(pokemon => remainingHp(game, pokemon) * 3 <= game.maxHp(pokemon))
    },
    'グリ': {
        play: (game, player) => [player, game.opponentOf(player)].forEach(p => game.inPlay(p).forEach(pokemon => game.heal(pokemon, 50))),
        cpuWants: (game, player) => totalHeal(game, game.inPlay(player), 50) - totalHeal(game, game.inPlay(game.opponentOf(player)), 50) >= 50
    },
    'マコモ': {
        play: (game, player) => game.inPlay(player).forEach(pokemon => game.heal(pokemon, 40)),
        cpuWants: (game, player) => totalHeal(game, game.inPlay(player), 40) >= 80
    },
    'シトロンの機転': {
        play: (game, player) => ownPokemon(game, player, card => card.type === 'lightning').forEach(pokemon => game.heal(pokemon, 60)),
        cpuWants: (game, player) => totalHeal(game, ownPokemon(game, player, card => card.type === 'lightning'), 60) >= 60
    },

    // ===== 入れ替え =====
    'AZの安らぎ': {
        canPlay: (game, player) => Boolean(player.active) && player.bench.length > 0,
        play: (game, player) => switchOwn(game, player, old => {
            if (old && isPokemonEx(game.topCard(old))) game.heal(old, 80);
        }),
        cpuWants: (game, player) => Boolean(player.active) && isPokemonEx(game.topCard(player.active)) && player.active.damage >= 80
    },
    'ヒガナの信頼': {
        canPlay: (game, player) => Boolean(player.active) && player.bench.length > 0,
        play: (game, player) => switchOwn(game, player, (old, now) => {
            if (!old || old.energies.length === 0) return;
            game.promptCards({
                player,
                cards: old.energies,
                min: 1,
                max: 1,
                title: `${game.topCard(now).name}につけ替えるエネルギーを選ぶ`,
                purpose: 'supporter-move-energy',
                cpuAnswer: () => [0],
                callback: ([inst]) => game.moveEnergy(old, now, inst)
            });
        }),
        cpuWants: (game, player) => !canAttackNow(game, player) && player.bench.length > 0
    },
    'ロケット団のサカキ': {
        canPlay: (game, player) => game.opponentOf(player).bench.length > 0
            || (Boolean(player.active) && isRocket(game.topCard(player.active)) && ownPokemon(game, player, isRocket).some(pokemon => pokemon !== player.active)),
        play: (game, player) => {
            const rocketBench = player.active && isRocket(game.topCard(player.active))
                ? player.bench.filter(pokemon => isRocket(game.topCard(pokemon)))
                : [];
            switchOwn(game, player, () => gustOpponent(game, player), rocketBench);
        },
        cpuWants: (game, player) => game.opponentOf(player).bench.some(pokemon => remainingHp(game, pokemon) <= 60)
    },
    'ルチアのアピール': {
        canPlay: (game, player) => game.opponentOf(player).bench.some(pokemon => game.topCard(pokemon).stage === 0),
        play: (game, player) => gustOpponent(game, player, isBasicPokemon, target => game.addCondition(target, 'confused')),
        cpuWants: (game, player) => game.opponentOf(player).bench.some(pokemon => game.topCard(pokemon).stage === 0 && remainingHp(game, pokemon) <= 70)
    },

    // ===== 相手の場 =====
    'サビ組のしたっぱ': {
        canPlay: (game, player) => knockedOutLastTurn(game, player) && game.inPlay(game.opponentOf(player)).some(pokemon => pokemon.energies.length > 0),
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            const targets = game.inPlay(opponent).filter(pokemon => pokemon.energies.length > 0);
            game.promptPokemon({
                player,
                pokemon: targets,
                min: 1,
                max: 1,
                title: 'エネルギーをトラッシュする相手のポケモンを選ぶ',
                purpose: 'discard-opponent-energy-target',
                cpuAnswer: (g, prompt) => topIndices(prompt.pokemon, pokemon => (pokemon === opponent.active ? 100 : 0) + pokemon.energies.length, 1),
                callback: ([target]) => game.promptCards({
                    player,
                    cards: target.energies,
                    min: 1,
                    max: 1,
                    title: 'トラッシュするエネルギーを選ぶ',
                    purpose: 'discard-opponent-energy',
                    cpuAnswer: (g, prompt) => topIndices(prompt.cards, inst => (g.cardOf(inst).basic ? 0 : 10), 1),
                    callback: ([inst]) => {
                        game.moveCard(target.energies, opponent.discard, inst);
                        game.log(`${game.topCard(target).name}の${game.cardName(inst)}をトラッシュした`);
                    }
                })
            });
        },
        cpuWants: () => true
    },
    '怖いお兄さん': {
        canPlay: (game, player) => game.inPlay(game.opponentOf(player))
            .some(pokemon => pokemon.tool || pokemon.energies.some(inst => !game.cardOf(inst).basic)),
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            const special = pokemon => pokemon.energies.filter(inst => !game.cardOf(inst).basic);
            const targets = game.inPlay(opponent).filter(pokemon => pokemon.tool || special(pokemon).length > 0);
            game.promptPokemon({
                player,
                pokemon: targets,
                min: 1,
                max: 1,
                title: 'どうぐと特殊エネルギーをトラッシュする相手のポケモンを選ぶ',
                purpose: 'discard-opponent-tool-target',
                cpuAnswer: (g, prompt) => topIndices(prompt.pokemon, pokemon => (pokemon.tool ? 1 : 0) + Math.min(1, special(pokemon).length), 1),
                callback: ([target]) => {
                    game.discardTool(target);
                    const energies = special(target);
                    const discard = inst => {
                        game.moveCard(target.energies, opponent.discard, inst);
                        game.log(`${game.topCard(target).name}の${game.cardName(inst)}をトラッシュした`);
                    };
                    if (energies.length === 0) return;
                    if (energies.length === 1) {
                        discard(energies[0]);
                        return;
                    }
                    game.promptCards({
                        player,
                        cards: energies,
                        min: 1,
                        max: 1,
                        title: 'トラッシュする特殊エネルギーを選ぶ',
                        purpose: 'discard-opponent-energy',
                        cpuAnswer: () => [0],
                        callback: ([inst]) => discard(inst)
                    });
                }
            });
        },
        cpuWants: () => true
    },

    // ===== この番のワザ =====
    'グラジオの決戦': {
        // このカードだけが手札にあるときに使える
        canPlay: (game, player) => player.hand.length === 1,
        play: (game, player) => {
            // 相手のバトルポケモンへのダメージにだけ足す効果（attackDamageModifier）を、ルールを持たない自分のポケモンにつける
            ownPokemon(game, player, card => !hasRule(card))
                .forEach(pokemon => game.addEffect(pokemon, 'attackDamageModifier', game.turn, { amount: 80 }));
            game.log('この番、ルールを持たない自分のポケモンのワザの、相手のバトルポケモンへのダメージは+80される');
        },
        cpuWants: (game, player) => player.hand.length === 1 && Boolean(player.active) && !hasRule(game.topCard(player.active))
            && canAttackNow(game, player)
    }
};
