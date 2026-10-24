/**
 * グッズの効果（カードの名前で引く）。書き方は cards/HOOKS.md
 *
 * まだ書いていないグッズ（ゲームの本体に仕組みが要るもの）
 *   古びた〜の化石（7種）：トレーナーズをたねポケモンとして場に出す仕組みがない
 *   覚醒のドラム・リブートポッド・ガラスのラッパ・テラスタルオーブ：カードのデータに「古代」「未来」「テラスタル」の印がない
 *   変化の書：2枚同時に使う仕組みがない
 *   ロケット団のおじゃまロボ：サイドをオモテのままにする仕組みがない
 *   ポケバイタルA：「トラッシュにあるかぎり、手札に加えられず、山札にもどせない」を、ほかのカードの効果に守らせる仕組みがない
 *     （トラッシュから手札・山札にもどす効果の側が確かめない）
 * （パワープロテイン・アイアンディフェンダー・アンフェアスタンプは trainers/extras.js に書いた）
 */

import { shuffle } from '../../random.js';

const isBasicEnergy = (card, type) => card.kind === 'energy' && card.basic && (!type || card.energyType === type);
const isSpecialEnergy = card => card.kind === 'energy' && !card.basic;
const isBasicPokemon = card => card.kind === 'pokemon' && card.stage === 0;
const isPokemon = card => card.kind === 'pokemon';
const nameStarts = prefix => card => card.name.startsWith(prefix);

const remainingHp = (game, pokemon) => game.maxHp(pokemon) - pokemon.damage;
const cardsIn = (game, list, filter) => list.filter(inst => filter(game.cardOf(inst)));
const hasIn = (game, list, filter) => list.some(inst => filter(game.cardOf(inst)));
const names = (game, insts) => insts.map(inst => game.cardName(inst)).join('と');
const allIndices = (count) => Array.from({ length: count }, (_, index) => index);
const isSecondPlayersFirstTurn = (game, player) => player.id !== game.firstPlayer && player.turnsTaken === 1;

// 点数の高い順に count 個のインデックス（答えは小さい順）
function bestIndices(items, score, count) {
    return items
        .map((item, index) => ({ index, score: score(item) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, count)
        .map(entry => entry.index)
        .sort((a, b) => a - b);
}

// 手放してよいカードほど高い点（CPU がトラッシュする手札を選ぶとき）
function discardScore(game, player, inst) {
    const card = game.cardOf(inst);
    const same = player.hand.filter(other => other.id === inst.id).length;
    if (isBasicEnergy(card)) return 70 + same * 5;
    if (card.kind === 'pokemon') return 40 - card.stage * 10 - (card.rule ? 20 : 0);
    if (card.trainerType === 'stadium') return 90;
    return 60 + same * 5;
}

const cpuDiscardFromHand = (game, prompt) => bestIndices(prompt.cards, inst => discardScore(game, prompt.player, inst), prompt.min);

// ワザを使えるか（CPU の目安）
function canAttackNow(game, player) {
    const active = player.active;
    if (!active) return false;
    return game.topCard(active).attacks.some(attack => game.canPayCost(active, game.attackCost(active, attack)));
}

/**
 * 1つの置き場（山札・トラッシュなど）から、条件ごとに順に選ばせ、最後に onDone(選んだカード) を呼ぶ
 *   groups：[{ filter(card), max, title }]（それぞれ0枚から選べる）
 *   選んだカードは置き場に残したまま渡す（onDone で動かす）
 */
function pickGroups(game, player, { from, groups, purpose, onDone, cpuAnswer }) {
    const chosen = [];
    const step = index => {
        if (index >= groups.length) {
            onDone(chosen);
            return;
        }
        const group = groups[index];
        const candidates = from.filter(inst => !chosen.includes(inst) && group.filter(game.cardOf(inst)));
        const max = Math.min(group.max, candidates.length);
        if (max <= 0) {
            step(index + 1);
            return;
        }
        game.promptCards({
            player,
            cards: candidates,
            min: 0,
            max,
            title: group.title,
            purpose,
            cpuAnswer: cpuAnswer ?? ((g, prompt) => allIndices(prompt.max)),
            callback: selected => {
                chosen.push(...selected);
                step(index + 1);
            }
        });
    };
    step(0);
}

// 山札から、条件ごとに1枚ずつ（groups の max まで）選んで手札に加え、山札を切る
function searchEachToHand(game, player, groups, purpose) {
    pickGroups(game, player, {
        from: player.deck,
        groups,
        purpose,
        onDone: chosen => {
            chosen.forEach(inst => game.removeCard(player.deck, inst));
            if (chosen.length === 0) game.log(`${player.name}は山札を見たが、カードを選ばなかった`);
            game.addToHand(player, chosen, { reveal: true });
            game.shuffleDeck(player);
        }
    });
}

// 山札から条件に合うカードを max 枚まで選び、相手に見せて手札に加える（最後に山札を切る）
function searchToHand(game, player, filter, max, title, purpose = 'search-card') {
    game.searchDeck({
        player,
        filter,
        max,
        title,
        purpose,
        onSelected: found => game.addToHand(player, found, { reveal: true })
    });
}

// トラッシュのカードを選んで山札にもどして切る
function discardToDeck(game, player, groups) {
    pickGroups(game, player, {
        from: player.discard,
        groups,
        purpose: 'discard-to-deck',
        onDone: chosen => {
            chosen.forEach(inst => game.moveCard(player.discard, player.deck, inst));
            if (chosen.length) game.log(`${player.name}はトラッシュの${names(game, chosen)}を山札にもどした`);
            game.shuffleDeck(player);
        }
    });
}

// トラッシュのカードを選んで、相手に見せて手札に加える
function discardToHand(game, player, filter, max, title, cpuAnswer) {
    const candidates = cardsIn(game, player.discard, filter);
    const count = Math.min(max, candidates.length);
    if (count === 0) return;
    game.promptCards({
        player,
        cards: candidates,
        min: 0,
        max: count,
        title,
        purpose: 'discard-to-hand',
        cpuAnswer: cpuAnswer ?? ((g, prompt) => allIndices(prompt.max)),
        callback: selected => {
            selected.forEach(inst => game.removeCard(player.discard, inst));
            game.addToHand(player, selected, { reveal: true });
        }
    });
}

// 山札の一部（上から・下から）を見て、条件に合うものを選び手札に加え、残りを山札にもどして切る
function lookAndTake(game, player, looked, filter, max, title) {
    game.log(`${player.name}は山札を${looked.length}枚見た`);
    game.log(`見たカード：${looked.map(inst => game.cardName(inst)).join('・') || 'なし'}`, { to: player.id });
    const candidates = cardsIn(game, looked, filter);
    const finish = selected => {
        selected.forEach(inst => game.removeCard(player.deck, inst));
        game.addToHand(player, selected, { reveal: true });
        game.shuffleDeck(player);
    };
    if (candidates.length === 0) {
        finish([]);
        return;
    }
    game.promptCards({
        player,
        cards: candidates,
        min: 0,
        max: Math.min(max, candidates.length),
        title,
        purpose: 'look-and-take',
        cpuAnswer: (g, prompt) => allIndices(prompt.max),
        callback: finish
    });
}

// トラッシュの基本エネルギーを1枚選び、条件に合うポケモンにつける
function attachFromDiscard(game, player, targetFilter, title) {
    const energies = cardsIn(game, player.discard, card => isBasicEnergy(card));
    game.promptCards({
        player,
        cards: energies,
        min: 1,
        max: 1,
        title,
        purpose: 'discard-energy-pick',
        callback: ([inst]) => {
            game.removeCard(player.discard, inst);
            game.attachAnyWay(player, [inst], targetFilter, 'attach-energy-target');
        }
    });
}

// ポケモンを選び、そのポケモンについている（条件に合う）エネルギーを1個選ぶ。onPicked(pokemon, inst)
function pickEnergyOn(game, player, pokemons, energyFilter, { title, purpose, onPicked }) {
    const candidates = pokemons.filter(pokemon => hasIn(game, pokemon.energies, energyFilter));
    if (candidates.length === 0) return;
    const pickEnergy = pokemon => {
        const energies = cardsIn(game, pokemon.energies, energyFilter);
        if (new Set(energies.map(inst => inst.id)).size === 1) {
            onPicked(pokemon, energies[0]);
            return;
        }
        game.promptCards({
            player,
            cards: energies,
            min: 1,
            max: 1,
            title: 'エネルギーを選ぶ',
            purpose: `${purpose}-energy`,
            callback: ([inst]) => onPicked(pokemon, inst)
        });
    };
    game.promptPokemon({
        player,
        pokemon: candidates,
        min: 1,
        max: 1,
        title,
        purpose,
        // バトルポケモンを先に、エネルギーの多いものから
        cpuAnswer: (g, prompt) => bestIndices(prompt.pokemon, pokemon => (game.ownerOf(pokemon)?.active === pokemon ? 100 : 0) + pokemon.energies.length, 1),
        callback: ([pokemon]) => pickEnergy(pokemon)
    });
}

// バトルポケモンの HP を回復する（回復できるときだけ使える）
const healActive = (amount, extraCondition = () => true) => ({
    canPlay: (game, player) => Boolean(player.active) && player.active.damage > 0 && extraCondition(game, player, player.active),
    play: (game, player) => game.heal(player.active, typeof amount === 'function' ? amount(game, player) : amount),
    cpuWants: (game, player) => Boolean(player.active) && player.active.damage >= 30 && extraCondition(game, player, player.active)
});

// 相手のベンチポケモンを1匹選び、バトルポケモンと入れ替える
function gustOpponent(game, player, then) {
    const opponent = game.opponentOf(player);
    game.promptPokemon({
        player,
        pokemon: opponent.bench,
        min: 1,
        max: 1,
        title: 'バトル場に呼び出す相手のポケモンを選ぶ',
        purpose: 'boss-target',
        callback: ([target]) => {
            game.switchActive(opponent, target);
            then?.();
        }
    });
}

// 呼び出すと得なベンチポケモンがいるか（CPU の目安：バトルポケモンより残りHPが少ない）
function cpuWantsGust(game, player) {
    const opponent = game.opponentOf(player);
    if (!canAttackNow(game, player) || !opponent.active) return false;
    return opponent.bench.some(pokemon => remainingHp(game, pokemon) < remainingHp(game, opponent.active));
}

const CONDITION_ORDER = ['paralyzed', 'asleep', 'confused', 'burned', 'poisoned'];
const CONDITION_LABELS = { paralyzed: 'マヒ', asleep: 'ねむり', confused: 'こんらん', burned: 'やけど', poisoned: 'どく' };

function removeCondition(game, pokemon, condition) {
    if (condition === 'poisoned') {
        pokemon.poisoned = false;
        pokemon.poisonDamage = null;
    } else if (condition === 'burned') pokemon.burned = false;
    else pokemon.rotation = null;
    game.log(`${game.topCard(pokemon).name}の${CONDITION_LABELS[condition]}が治った`);
}

export const TRAINER_EFFECTS = {
    // ===== 山札から探す =====
    'メガシグナル': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => searchToHand(game, player, card => card.rule === 'mega', 1, '手札に加えるメガシンカexを選ぶ'),
        cpuWants: (game, player) => hasIn(game, player.deck, card => card.rule === 'mega')
    },
    'ポケパッド': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => searchToHand(game, player, card => isPokemon(card) && !card.rule, 1, '手札に加えるポケモン（ルールを持つポケモンをのぞく）を選ぶ', 'search-pokemon'),
        cpuWants: (game, player) => hasIn(game, player.deck, card => isPokemon(card) && !card.rule)
    },
    'ファイトゴング': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => searchToHand(game, player,
            card => (isBasicPokemon(card) && card.type === 'fighting') || isBasicEnergy(card, 'fighting'),
            1, '手札に加える闘タイプのたねポケモンか基本闘エネルギーを選ぶ'),
        cpuWants: (game, player) => hasIn(game, player.deck, card => isBasicPokemon(card) && card.type === 'fighting')
            || (hasIn(game, player.deck, card => isBasicEnergy(card, 'fighting')) && !hasIn(game, player.hand, card => card.kind === 'energy'))
    },
    'ぼうけんのランタン': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => searchEachToHand(game, player, [
            { filter: card => isBasicEnergy(card, 'fire'), max: 1, title: '手札に加える基本炎エネルギーを選ぶ' },
            { filter: card => isBasicEnergy(card, 'lightning'), max: 1, title: '手札に加える基本雷エネルギーを選ぶ' }
        ], 'search-each'),
        cpuWants: (game, player) => !hasIn(game, player.hand, card => card.kind === 'energy')
            && hasIn(game, player.deck, card => isBasicEnergy(card, 'fire') || isBasicEnergy(card, 'lightning'))
    },
    'わざマシンマシン': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => searchToHand(game, player, card => card.trainerType === 'tool' && card.name.includes('ワザマシン'), 3, '手札に加える「ワザマシン」を選ぶ'),
        cpuWants: (game, player) => hasIn(game, player.deck, card => card.trainerType === 'tool' && card.name.includes('ワザマシン'))
    },
    'ロケット団のスーパーボール': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => {
            const heads = game.flipCoin();
            const filter = card => isPokemon(card) && card.name.startsWith('ロケット団の') && (heads ? card.stage > 0 : card.stage === 0);
            searchToHand(game, player, filter, 1, heads ? '手札に加える進化ポケモンの「ロケット団のポケモン」を選ぶ' : '手札に加えるたねポケモンの「ロケット団のポケモン」を選ぶ', 'search-pokemon');
        },
        cpuWants: (game, player) => hasIn(game, player.deck, card => isPokemon(card) && card.name.startsWith('ロケット団の'))
    },
    'ロケット団のレシーバー': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => searchToHand(game, player, card => card.trainerType === 'supporter' && card.name.includes('ロケット団'), 1, '手札に加える「ロケット団」のサポートを選ぶ'),
        cpuWants: (game, player) => !game.turnState.supporterPlayed
            && !hasIn(game, player.hand, card => card.trainerType === 'supporter' && card.name.includes('ロケット団'))
            && hasIn(game, player.deck, card => card.trainerType === 'supporter' && card.name.includes('ロケット団'))
    },
    'ハイパーアロマ': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => searchToHand(game, player, card => isPokemon(card) && card.stage === 1, 3, '手札に加える1進化ポケモンを選ぶ', 'search-evolution'),
        cpuWants: (game, player) => {
            const onField = new Set(game.inPlay(player).map(pokemon => game.topCard(pokemon).name));
            return hasIn(game, player.deck, card => isPokemon(card) && card.stage === 1 && onField.has(card.evolvesFrom));
        }
    },
    'ラブラブボール': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => {
            const targets = new Set(game.inPlay(game.opponentOf(player)).map(pokemon => game.topCard(pokemon).name));
            searchToHand(game, player, card => isPokemon(card) && targets.has(card.name), 1, '手札に加える、相手の場のポケモンと同じ名前のポケモンを選ぶ', 'search-pokemon');
        },
        cpuWants: (game, player) => {
            const targets = new Set(game.inPlay(game.opponentOf(player)).map(pokemon => game.topCard(pokemon).name));
            return hasIn(game, player.deck, card => isPokemon(card) && targets.has(card.name));
        }
    },
    'おとりよせボックス': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => {
            searchToHand(game, player, card => card.trainerType === 'item', 2, '手札に加えるグッズを選ぶ');
            game.endTurnByEffect(player);
        },
        // 番が終わるので、ワザを使えないときだけ
        cpuWants: (game, player) => !canAttackNow(game, player) && hasIn(game, player.deck, card => card.trainerType === 'item')
    },
    'シークレットボックス': {
        // 手札から出す前に数えるので、このカード自身を除いて3枚
        canPlay: (game, player) => player.hand.length >= 4,
        play: (game, player) => {
            game.promptCards({
                player,
                cards: player.hand,
                min: 3,
                max: 3,
                title: 'トラッシュする手札を3枚選ぶ',
                purpose: 'secret-box-discard',
                cpuAnswer: cpuDiscardFromHand,
                callback: discarded => {
                    discarded.forEach(inst => game.moveCard(player.hand, player.discard, inst));
                    game.log(`${player.name}は${names(game, discarded)}をトラッシュした`);
                    searchEachToHand(game, player, [
                        { filter: card => card.trainerType === 'item', max: 1, title: '手札に加えるグッズを選ぶ' },
                        { filter: card => card.trainerType === 'tool', max: 1, title: '手札に加えるポケモンのどうぐを選ぶ' },
                        { filter: card => card.trainerType === 'supporter', max: 1, title: '手札に加えるサポートを選ぶ' },
                        { filter: card => card.trainerType === 'stadium', max: 1, title: '手札に加えるスタジアムを選ぶ' }
                    ], 'search-each');
                }
            });
        },
        // 手札が少なく、山札に3種類以上あるとき
        cpuWants: (game, player) => player.hand.length >= 4 && player.hand.length <= 5
            && ['item', 'tool', 'supporter', 'stadium'].filter(type => hasIn(game, player.deck, card => card.trainerType === type)).length >= 3
    },
    'エネルギー転送PRO': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => {
            // 同じタイプの基本エネルギーはどれも同じなので、タイプごとに1枚を候補にする
            const byType = new Map();
            cardsIn(game, player.deck, card => isBasicEnergy(card)).forEach(inst => {
                const type = game.cardOf(inst).energyType;
                if (!byType.has(type)) byType.set(type, inst);
            });
            const candidates = [...byType.values()];
            if (candidates.length === 0) {
                game.log(`${player.name}は山札を見たが、選べるカードはなかった`);
                game.shuffleDeck(player);
                return;
            }
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: candidates.length,
                title: '手札に加える基本エネルギーを選ぶ（タイプはそれぞれちがうもの）',
                purpose: 'search-energy-types',
                cpuAnswer: (g, prompt) => allIndices(prompt.max),
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.deck, inst));
                    game.addToHand(player, selected, { reveal: true });
                    game.shuffleDeck(player);
                }
            });
        },
        cpuWants: (game, player) => !hasIn(game, player.hand, card => card.kind === 'energy') && hasIn(game, player.deck, card => isBasicEnergy(card))
    },
    'おたすけベル': {
        canPlay: (game, player) => isSecondPlayersFirstTurn(game, player) && player.deck.length > 0,
        play: (game, player) => searchToHand(game, player, card => card.trainerType === 'supporter', 1, '手札に加えるサポートを選ぶ'),
        cpuWants: (game, player) => !hasIn(game, player.hand, card => card.trainerType === 'supporter')
            && hasIn(game, player.deck, card => card.trainerType === 'supporter')
    },
    'トレジャーガジェット': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => searchToHand(game, player, card => card.trainerType === 'tool', 5, '手札に加えるポケモンのどうぐを選ぶ'),
        cpuWants: (game, player) => !hasIn(game, player.hand, card => card.trainerType === 'tool') && hasIn(game, player.deck, card => card.trainerType === 'tool')
    },
    'エネルギーコイン': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => {
            const first = game.flipCoin();
            const second = game.flipCoin();
            if (!first || !second) return;
            game.searchDeck({
                player,
                filter: card => isBasicEnergy(card),
                max: 1,
                title: 'つける基本エネルギーを選ぶ',
                purpose: 'search-energy',
                onSelected: found => game.attachAnyWay(player, found, () => true, 'attach-energy-target')
            });
        },
        cpuWants: (game, player) => hasIn(game, player.deck, card => isBasicEnergy(card))
    },

    // ===== 山札の一部を見る =====
    'ポケギア3.0': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => lookAndTake(game, player, player.deck.slice(0, 7), card => card.trainerType === 'supporter', 1, '手札に加えるサポートを選ぶ（加えなくてもよい）'),
        cpuWants: (game, player) => !game.turnState.supporterPlayed && !hasIn(game, player.hand, card => card.trainerType === 'supporter')
            && hasIn(game, player.deck, card => card.trainerType === 'supporter')
    },
    'むしとりセット': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => lookAndTake(game, player, player.deck.slice(0, 7),
            card => (isPokemon(card) && card.type === 'grass') || isBasicEnergy(card, 'grass'),
            2, '手札に加える草ポケモン・基本草エネルギーを合計2枚まで選ぶ'),
        cpuWants: (game, player) => hasIn(game, player.deck, card => (isPokemon(card) && card.type === 'grass') || isBasicEnergy(card, 'grass'))
    },
    'ダークボール': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => lookAndTake(game, player, player.deck.slice(-7), isPokemon, 1, '手札に加えるポケモンを選ぶ'),
        cpuWants: (game, player) => hasIn(game, player.deck, isPokemon) && player.bench.length < 3
    },
    '推理セット': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => {
            const top = player.deck.slice(0, 3);
            game.log(`${player.name}は山札を上から${top.length}枚見た`);
            game.log(`見たカード：${top.map(inst => game.cardName(inst)).join('・')}`, { to: player.id });
            game.promptChoose({
                player,
                options: ['好きな順番に入れ替えて、山札の上にもどす', 'すべてウラにして切り、山札の下にもどす'],
                title: '見たカードをどうするか選ぶ',
                purpose: 'deduction-kit',
                callback: ([choice]) => {
                    top.forEach(inst => game.removeCard(player.deck, inst));
                    if (choice === 1) {
                        player.deck.push(...shuffle([...top], game.random));
                        game.log(`${player.name}は${top.length}枚を山札の下にもどした`);
                        return;
                    }
                    // 上から1枚ずつ選んでいく
                    const ordered = [];
                    const pick = rest => {
                        if (rest.length <= 1) {
                            ordered.push(...rest);
                            player.deck.unshift(...ordered);
                            game.log(`${player.name}は${ordered.length}枚を山札の上にもどした`);
                            return;
                        }
                        game.promptCards({
                            player,
                            cards: rest,
                            min: 1,
                            max: 1,
                            title: `上から${ordered.length + 1}枚目にするカードを選ぶ`,
                            purpose: 'deduction-kit-order',
                            callback: ([inst]) => {
                                ordered.push(inst);
                                pick(rest.filter(other => other !== inst));
                            }
                        });
                    };
                    pick(top);
                }
            });
        },
        cpuWants: () => false
    },

    // ===== トラッシュから =====
    'エネルギーリサイクル': {
        canPlay: (game, player) => hasIn(game, player.discard, card => isBasicEnergy(card)),
        play: (game, player) => discardToDeck(game, player, [{ filter: card => isBasicEnergy(card), max: 5, title: '山札にもどす基本エネルギーを5枚まで選ぶ' }]),
        cpuWants: (game, player) => player.deck.length < 15 && cardsIn(game, player.discard, card => isBasicEnergy(card)).length >= 3
    },
    '大漁ネット': {
        canPlay: (game, player) => hasIn(game, player.discard, card => (isPokemon(card) && card.type === 'water') || isBasicEnergy(card, 'water')),
        play: (game, player) => discardToDeck(game, player, [
            { filter: card => isPokemon(card) && card.type === 'water', max: 3, title: '山札にもどす水ポケモンを3枚まで選ぶ' },
            { filter: card => isBasicEnergy(card, 'water'), max: 3, title: '山札にもどす基本水エネルギーを3枚まで選ぶ' }
        ]),
        cpuWants: (game, player) => player.deck.length < 15
            && cardsIn(game, player.discard, card => (isPokemon(card) && card.type === 'water') || isBasicEnergy(card, 'water')).length >= 3
    },
    'せいなるはい': {
        canPlay: (game, player) => hasIn(game, player.discard, isPokemon),
        play: (game, player) => discardToDeck(game, player, [{ filter: isPokemon, max: 5, title: '山札にもどすポケモンを5枚まで選ぶ' }]),
        cpuWants: (game, player) => player.deck.length < 15 && cardsIn(game, player.discard, isPokemon).length >= 3
    },
    '夜のタンカ': {
        canPlay: (game, player) => hasIn(game, player.discard, card => isPokemon(card) || isBasicEnergy(card)),
        play: (game, player) => {
            const candidates = cardsIn(game, player.discard, card => isPokemon(card) || isBasicEnergy(card));
            game.promptCards({
                player,
                cards: candidates,
                min: 1,
                max: 1,
                title: '手札に加えるポケモンか基本エネルギーを選ぶ',
                purpose: 'night-stretcher',
                // ポケモンを先に（HP の高いもの）
                cpuAnswer: (g, prompt) => bestIndices(prompt.cards, inst => (isPokemon(game.cardOf(inst)) ? 1000 + game.cardOf(inst).hp : 0), 1),
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.discard, inst));
                    game.addToHand(player, selected, { reveal: true });
                }
            });
        },
        cpuWants: (game, player) => hasIn(game, player.discard, isPokemon)
    },
    'つりざおMAX': {
        canPlay: (game, player) => hasIn(game, player.discard, card => isPokemon(card) || isBasicEnergy(card)),
        play: (game, player) => discardToHand(game, player, card => isPokemon(card) || isBasicEnergy(card), 5, '手札に加えるポケモン・基本エネルギーを合計5枚まで選ぶ'),
        cpuWants: (game, player) => cardsIn(game, player.discard, isPokemon).length >= 2
    },
    'ミラクルインカム': {
        canPlay: (game, player) => hasIn(game, player.discard, card => card.trainerType === 'supporter'),
        play: (game, player) => discardToHand(game, player, card => card.trainerType === 'supporter', 2, '手札に加えるサポートを2枚まで選ぶ'),
        cpuWants: (game, player) => !hasIn(game, player.hand, card => card.trainerType === 'supporter')
            && hasIn(game, player.discard, card => card.trainerType === 'supporter')
    },
    'ワンダーパッチ': {
        canPlay: (game, player) => player.bench.length > 0 && hasIn(game, player.discard, card => isBasicEnergy(card)),
        play: (game, player) => attachFromDiscard(game, player, pokemon => player.bench.includes(pokemon), 'ベンチのポケモンにつける基本エネルギーを選ぶ'),
        cpuWants: (game, player) => player.bench.length > 0 && hasIn(game, player.discard, card => isBasicEnergy(card))
    },
    'Nのポイントアップ': {
        canPlay: (game, player) => player.bench.some(pokemon => game.topCard(pokemon).name.startsWith('Nの'))
            && hasIn(game, player.discard, card => isBasicEnergy(card)),
        play: (game, player) => attachFromDiscard(game, player,
            pokemon => player.bench.includes(pokemon) && game.topCard(pokemon).name.startsWith('Nの'),
            'ベンチの「Nのポケモン」につける基本エネルギーを選ぶ'),
        cpuWants: (game, player) => player.bench.some(pokemon => game.topCard(pokemon).name.startsWith('Nの'))
            && hasIn(game, player.discard, card => isBasicEnergy(card))
    },

    // ===== ベンチに出す =====
    'プレシャスキャリー': {
        canPlay: (game, player) => player.bench.length < game.benchSize && player.deck.length > 0,
        play: (game, player) => game.benchFromDeck(player, isBasicPokemon, game.benchSize, 'bench-basic'),
        cpuWants: (game, player) => player.bench.length < 3 && hasIn(game, player.deck, isBasicPokemon)
    },
    'ホップのバッグ': {
        canPlay: (game, player) => player.bench.length < game.benchSize && player.deck.length > 0,
        play: (game, player) => game.benchFromDeck(player, card => isBasicPokemon(card) && card.name.startsWith('ホップの'), 2, 'bench-basic'),
        cpuWants: (game, player) => player.bench.length < 4 && hasIn(game, player.deck, card => isBasicPokemon(card) && card.name.startsWith('ホップの'))
    },
    'おはやし笛': {
        canPlay: (game, player) => game.opponentOf(player).deck.length > 0,
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            const top = opponent.deck.slice(0, 5);
            game.log(`${opponent.name}の山札の上から${top.length}枚：${top.map(inst => game.cardName(inst)).join('・')}`);
            const candidates = cardsIn(game, top, isBasicPokemon);
            const max = Math.min(candidates.length, game.benchSize - opponent.bench.length);
            if (max <= 0) {
                game.shuffleDeck(opponent);
                return;
            }
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max,
                title: '相手のベンチに出すたねポケモンを選ぶ',
                purpose: 'festival-flute',
                callback: selected => {
                    selected.forEach(inst => {
                        game.removeCard(opponent.deck, inst);
                        opponent.bench.push(game.createPokemon(inst));
                        game.log(`${opponent.name}のベンチに${game.cardName(inst)}が出た`);
                    });
                    game.shuffleDeck(opponent);
                }
            });
        },
        cpuWants: () => false
    },

    // ===== 回復 =====
    'ジャンボアイス': {
        ...healActive(80, (game, player, active) => active.energies.length >= 3),
        cpuWants: (game, player) => Boolean(player.active) && player.active.energies.length >= 3 && player.active.damage >= 50
    },
    'おいしいおむすび': healActive((game, player) => 30 + 30 * player.discard.filter(inst => game.cardName(inst) === 'おいしいおむすび').length),
    '竜の秘薬': {
        ...healActive(60, (game, player, active) => game.topCard(active).type === 'dragon'),
        cpuWants: (game, player) => Boolean(player.active) && game.topCard(player.active).type === 'dragon' && player.active.damage >= 40
    },
    'ペパーのサンドウィッチ': healActive((game, player) => (game.topCard(player.active).name.startsWith('ペパーの') ? 100 : 30)),
    'ミアレガレット': {
        canPlay: (game, player) => Boolean(player.active) && (player.active.damage > 0 || game.hasAnyCondition(player.active)),
        play: (game, player) => {
            const active = player.active;
            game.heal(active, 20);
            const conditions = CONDITION_ORDER.filter(condition => game.hasCondition(active, condition));
            if (conditions.length === 0) return;
            if (conditions.length === 1) {
                removeCondition(game, active, conditions[0]);
                return;
            }
            game.promptChoose({
                player,
                options: conditions.map(condition => CONDITION_LABELS[condition]),
                title: '回復する特殊状態を選ぶ',
                purpose: 'lumiose-galette',
                callback: ([index]) => removeCondition(game, active, conditions[index])
            });
        },
        cpuWants: (game, player) => Boolean(player.active)
            && (['paralyzed', 'asleep', 'confused'].some(condition => game.hasCondition(player.active, condition)) || player.active.damage >= 40)
    },
    'いいきずぐすり': {
        canPlay: (game, player) => game.inPlay(player).some(pokemon => pokemon.damage > 0),
        play: (game, player) => game.promptPokemon({
            player,
            pokemon: game.inPlay(player).filter(pokemon => pokemon.damage > 0),
            min: 1,
            max: 1,
            title: '回復するポケモンを選ぶ',
            purpose: 'potion',
            callback: ([target]) => {
                const healed = Math.min(60, target.damage);
                game.heal(target, 60);
                if (healed <= 0 || target.energies.length === 0) return;
                game.promptCards({
                    player,
                    cards: target.energies,
                    min: 1,
                    max: 1,
                    title: 'トラッシュするエネルギーを選ぶ',
                    purpose: 'discard-own-energy',
                    callback: ([inst]) => {
                        game.moveCard(target.energies, player.discard, inst);
                        game.log(`${game.topCard(target).name}の${game.cardName(inst)}をトラッシュした`);
                    }
                });
            }
        }),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => pokemon.damage >= 60)
    },

    // ===== 入れ替え =====
    'ポケモンキャッチャー': {
        canPlay: (game, player) => game.opponentOf(player).bench.length > 0,
        play: (game, player) => gustOpponent(game, player),
        cpuWants: cpuWantsGust
    },
    'プライムキャッチャー': {
        canPlay: (game, player) => game.opponentOf(player).bench.length > 0,
        play: (game, player) => gustOpponent(game, player, () => game.promptSwitchOwnActive(player, 'switch')),
        cpuWants: cpuWantsGust
    },
    'むしよけスプレー': {
        canPlay: (game, player) => game.opponentOf(player).bench.length > 0 && Boolean(game.opponentOf(player).active),
        // バトル場に出すポケモンは相手が選ぶ
        play: (game, player) => game.promptSwitchOwnActive(game.opponentOf(player), 'forced-switch'),
        cpuWants: (game, player) => {
            const opponent = game.opponentOf(player);
            return Boolean(opponent.active) && opponent.active.energies.length >= 2 && opponent.bench.some(pokemon => pokemon.energies.length === 0);
        }
    },
    'スクランブルスイッチ': {
        canPlay: (game, player) => Boolean(player.active) && player.bench.length > 0,
        play: (game, player) => {
            const old = player.active;
            game.promptPokemon({
                player,
                pokemon: player.bench,
                min: 1,
                max: 1,
                title: 'バトル場に出すベンチポケモンを選ぶ',
                purpose: 'switch',
                callback: ([target]) => {
                    game.switchActive(player, target);
                    if (old.energies.length === 0) return;
                    game.promptCards({
                        player,
                        cards: old.energies,
                        min: 0,
                        max: old.energies.length,
                        title: `${game.topCard(target).name}につけ替えるエネルギーを選ぶ`,
                        purpose: 'scramble-switch-energy',
                        cpuAnswer: (g, prompt) => allIndices(prompt.max),
                        callback: selected => selected.forEach(inst => game.moveEnergy(old, target, inst))
                    });
                }
            });
        },
        cpuWants: (game, player) => Boolean(player.active) && player.bench.length > 0 && player.active.energies.length > 0
            && remainingHp(game, player.active) <= 50
    },
    'ポケモン回収サイクロン': {
        canPlay: (game, player) => game.inPlay(player).length > 0,
        play: (game, player) => game.promptPokemon({
            player,
            pokemon: game.inPlay(player),
            min: 1,
            max: 1,
            title: '手札にもどすポケモンを選ぶ',
            purpose: 'scoop-up',
            // ダメージの割合が大きいもの（場に1匹だけなら、もどすと負けるのでベンチのいるとき使う）
            cpuAnswer: (g, prompt) => bestIndices(prompt.pokemon, pokemon => pokemon.damage / game.maxHp(pokemon), 1),
            callback: ([target]) => {
                game.returnToHand(player, target);
                // バトル場が空いたら、ベンチから出す
                game.runNext(() => game.checkKnockouts());
            }
        }),
        cpuWants: (game, player) => Boolean(player.active) && player.bench.length > 0 && player.active.damage * 2 >= game.maxHp(player.active)
    },

    // ===== 相手の場・手札 =====
    'スペシャルレッドカード': {
        canPlay: (game, player) => game.opponentOf(player).prizes.length <= 3,
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            game.putHandOnDeckBottom(opponent);
            game.draw(opponent, 3);
        },
        cpuWants: (game, player) => game.opponentOf(player).hand.length >= 5
    },
    'ぼうがいレター': {
        canPlay: (game, player) => game.opponentOf(player).hand.length > 0,
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            const count = opponent.hand.length;
            game.putHandOnDeckBottom(opponent);
            game.draw(opponent, count);
        },
        cpuWants: () => false
    },
    'ハンドトリマー': {
        canPlay: (game, player) => game.players.some(p => p.hand.length - (p === player ? 1 : 0) > 5),
        play: (game, player) => {
            const trim = (target, next) => {
                const count = target.hand.length - 5;
                if (count <= 0) {
                    next?.();
                    return;
                }
                game.promptCards({
                    player: target,
                    cards: target.hand,
                    min: count,
                    max: count,
                    title: `トラッシュする手札を${count}枚選ぶ（手札が5枚になるように）`,
                    purpose: 'hand-trimmer',
                    cpuAnswer: cpuDiscardFromHand,
                    callback: discarded => {
                        discarded.forEach(inst => game.moveCard(target.hand, target.discard, inst));
                        game.log(`${target.name}は${names(game, discarded)}をトラッシュした`);
                        next?.();
                    }
                });
            };
            // トラッシュは相手から
            trim(game.opponentOf(player), () => trim(player));
        },
        cpuWants: (game, player) => game.opponentOf(player).hand.length >= 7 && player.hand.length - 1 <= 5
    },
    'エネはたき': {
        canPlay: (game, player) => game.opponentOf(player).hand.length > 0,
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            game.revealHand(opponent, player);
            const energies = cardsIn(game, opponent.hand, card => card.kind === 'energy');
            if (energies.length === 0) return;
            game.promptCards({
                player,
                cards: energies,
                min: 1,
                max: 1,
                title: '相手の山札の下にもどすエネルギーを選ぶ',
                purpose: 'discard-opponent-hand',
                callback: ([inst]) => {
                    game.moveCard(opponent.hand, opponent.deck, inst);
                    game.log(`${opponent.name}の手札の${game.cardName(inst)}を山札の下にもどした`);
                }
            });
        },
        cpuWants: (game, player) => game.opponentOf(player).hand.length >= 3
    },
    'クラッシュハンマー': {
        canPlay: (game, player) => game.inPlay(game.opponentOf(player)).some(pokemon => pokemon.energies.length > 0),
        play: (game, player) => {
            if (!game.flipCoin()) return;
            pickEnergyOn(game, player, game.inPlay(game.opponentOf(player)), () => true, {
                title: 'エネルギーをトラッシュする相手のポケモンを選ぶ',
                purpose: 'crushing-hammer',
                onPicked: (pokemon, inst) => {
                    game.moveCard(pokemon.energies, game.ownerOf(pokemon).discard, inst);
                    game.log(`${game.topCard(pokemon).name}の${game.cardName(inst)}をトラッシュした`);
                }
            });
        },
        cpuWants: (game, player) => game.inPlay(game.opponentOf(player)).some(pokemon => pokemon.energies.length > 0)
    },
    '改造ハンマー': {
        canPlay: (game, player) => game.inPlay(game.opponentOf(player)).some(pokemon => hasIn(game, pokemon.energies, isSpecialEnergy)),
        play: (game, player) => pickEnergyOn(game, player, game.inPlay(game.opponentOf(player)), isSpecialEnergy, {
            title: '特殊エネルギーをトラッシュする相手のポケモンを選ぶ',
            purpose: 'enhanced-hammer',
            onPicked: (pokemon, inst) => {
                game.moveCard(pokemon.energies, game.ownerOf(pokemon).discard, inst);
                game.log(`${game.topCard(pokemon).name}の${game.cardName(inst)}をトラッシュした`);
            }
        }),
        cpuWants: (game, player) => game.inPlay(game.opponentOf(player)).some(pokemon => hasIn(game, pokemon.energies, isSpecialEnergy))
    },
    'のんびりじゃらし': {
        canPlay: (game, player) => isSecondPlayersFirstTurn(game, player)
            && game.inPlay(game.opponentOf(player)).some(pokemon => pokemon.energies.length > 0),
        play: (game, player) => pickEnergyOn(game, player, game.inPlay(game.opponentOf(player)), () => true, {
            title: 'エネルギーを手札にもどす相手のポケモンを選ぶ',
            purpose: 'chill-teaser',
            onPicked: (pokemon, inst) => {
                const owner = game.ownerOf(pokemon);
                game.moveCard(pokemon.energies, owner.hand, inst);
                game.log(`${game.topCard(pokemon).name}の${game.cardName(inst)}を${owner.name}の手札にもどした`);
            }
        }),
        cpuWants: (game, player) => game.inPlay(game.opponentOf(player)).some(pokemon => pokemon.energies.length > 0)
    },
    'ヒートバーナー': {
        canPlay: (game, player) => hasIn(game, player.hand, card => isBasicEnergy(card)) && heatBurnerTargets(game, player).length > 0,
        play: (game, player) => {
            game.promptCards({
                player,
                cards: cardsIn(game, player.hand, card => isBasicEnergy(card)),
                min: 1,
                max: 1,
                title: 'トラッシュする基本エネルギーを選ぶ',
                purpose: 'heat-burner-cost',
                cpuAnswer: (g, prompt) => bestIndices(prompt.cards, inst => discardScore(game, player, inst), 1),
                callback: ([inst]) => {
                    game.moveCard(player.hand, player.discard, inst);
                    game.log(`${player.name}は${game.cardName(inst)}をトラッシュした`);
                    const targets = heatBurnerTargets(game, player);
                    if (targets.length === 0) return;
                    game.promptChoose({
                        player,
                        options: targets.map(target => target.label),
                        title: 'トラッシュするカードを選ぶ',
                        purpose: 'heat-burner-target',
                        // 相手のスタジアム → どうぐ → 特殊エネルギー
                        cpuAnswer: (g, prompt) => bestIndices(targets, target => target.score, 1),
                        callback: ([index]) => targets[index].discard()
                    });
                }
            });
        },
        cpuWants: (game, player) => heatBurnerTargets(game, player).some(target => target.score > 0)
    },
    'メガトンブロアー': {
        canPlay: (game, player) => Boolean(game.stadium) || game.inPlay(game.opponentOf(player)).some(pokemon => pokemon.tool || hasIn(game, pokemon.energies, isSpecialEnergy)),
        play: (game, player) => {
            const opponent = game.opponentOf(player);
            game.inPlay(opponent).forEach(pokemon => {
                game.discardTool(pokemon);
                cardsIn(game, pokemon.energies, isSpecialEnergy).forEach(inst => {
                    game.moveCard(pokemon.energies, opponent.discard, inst);
                    game.log(`${game.topCard(pokemon).name}の${game.cardName(inst)}をトラッシュした`);
                });
            });
            game.discardStadium();
        },
        cpuWants: (game, player) => {
            const opponent = game.opponentOf(player);
            const count = game.inPlay(opponent).reduce((sum, pokemon) => sum + (pokemon.tool ? 1 : 0) + cardsIn(game, pokemon.energies, isSpecialEnergy).length, 0);
            return count >= 2 || (game.stadium?.owner === opponent.id && count >= 1);
        }
    },
    'ツールスクラッパー': {
        canPlay: (game, player) => game.players.some(p => game.inPlay(p).some(pokemon => pokemon.tool)),
        play: (game, player) => {
            const withTools = game.players.flatMap(p => game.inPlay(p).filter(pokemon => pokemon.tool));
            game.promptPokemon({
                player,
                pokemon: withTools,
                min: 1,
                max: Math.min(2, withTools.length),
                title: 'どうぐをトラッシュするポケモンを2匹まで選ぶ',
                purpose: 'tool-scrapper',
                // 相手のポケモンのどうぐだけ
                cpuAnswer: (g, prompt) => {
                    const theirs = prompt.pokemon.map((pokemon, index) => (game.ownerOf(pokemon) !== player ? index : -1)).filter(index => index >= 0);
                    return theirs.length ? theirs.slice(0, 2) : [0];
                },
                callback: selected => selected.forEach(pokemon => game.discardTool(pokemon))
            });
        },
        cpuWants: (game, player) => game.inPlay(game.opponentOf(player)).some(pokemon => pokemon.tool)
    },

    // ===== 特殊状態・ダメカン =====
    'ダークベル': {
        play: (game, player) => [player, game.opponentOf(player)].forEach(p => {
            if (p.active && game.topCard(p.active).type !== 'darkness') game.addCondition(p.active, 'confused');
        }),
        cpuWants: (game, player) => {
            const opponent = game.opponentOf(player);
            return Boolean(player.active && opponent.active) && game.topCard(player.active).type === 'darkness'
                && game.topCard(opponent.active).type !== 'darkness' && !game.hasCondition(opponent.active, 'confused');
        }
    },
    'デンジャラス光線': {
        canPlay: (game, player) => Boolean(game.opponentOf(player).active),
        play: (game, player) => {
            const target = game.opponentOf(player).active;
            game.addCondition(target, 'burned');
            game.addCondition(target, 'confused');
        },
        cpuWants: (game, player) => {
            const target = game.opponentOf(player).active;
            return Boolean(target) && !game.hasCondition(target, 'burned') && !game.hasCondition(target, 'confused');
        }
    },
    'ロケット団のびっくりボム': {
        play: (game, player) => {
            if (game.flipCoin()) {
                const targets = game.inPlay(game.opponentOf(player));
                if (targets.length === 0) return;
                game.promptPokemon({
                    player,
                    pokemon: targets,
                    min: 1,
                    max: 1,
                    amount: 20,
                    title: 'ダメカンを2個のせる相手のポケモンを選ぶ',
                    purpose: 'snipe-target',
                    callback: ([target]) => {
                        game.putDamage(target, 20);
                        game.runNext(() => game.checkKnockouts());
                    }
                });
                return;
            }
            if (!player.active) return;
            game.putDamage(player.active, 20);
            game.runNext(() => game.checkKnockouts());
        },
        cpuWants: (game, player) => Boolean(player.active) && remainingHp(game, player.active) > 20
            && game.inPlay(game.opponentOf(player)).some(pokemon => remainingHp(game, pokemon) <= 20)
    },

    // ===== 自分の山札・サイド =====
    'あなあけスコップ': {
        canPlay: (game, player) => player.deck.length > 0,
        play: (game, player) => game.millDeck(player, 2),
        cpuWants: () => false
    },
    'とりかえチケット': {
        canPlay: (game, player) => player.prizes.length > 0,
        play: (game, player) => {
            const count = player.prizes.length;
            player.deck.push(...shuffle(player.prizes.splice(0), game.random));
            player.prizes = player.deck.splice(0, count);
            game.log(`${player.name}はサイド${count}枚を山札の下にもどし、山札の上から${count}枚をサイドに置いた`);
        },
        cpuWants: () => false
    },

    // ===== 場のポケモンを変える =====
    'あやしい時計': {
        canPlay: (game, player) => devolveTargets(game, player).length > 0,
        play: (game, player) => game.promptPokemon({
            player,
            pokemon: devolveTargets(game, player),
            min: 1,
            max: 1,
            title: '退化させる超ポケモンを選ぶ',
            purpose: 'devolve-target',
            callback: ([target]) => {
                const evolutions = target.cards.length - 1;
                const devolve = count => {
                    const removed = target.cards.splice(target.cards.length - count, count);
                    player.hand.push(...removed);
                    // 退化したポケモンは、特殊状態と効果がなくなり、その番に進化できない
                    game.clearConditions(target);
                    target.enteredTurn = game.turn;
                    target.evolvedFrom = null;
                    game.log(`${player.name}は${names(game, removed)}をはがして手札にもどし、${game.topCard(target).name}に退化させた`);
                    game.runNext(() => game.checkKnockouts());
                };
                if (evolutions === 1) {
                    devolve(1);
                    return;
                }
                game.promptChoose({
                    player,
                    options: Array.from({ length: evolutions }, (_, index) => `${index + 1}枚はがす`),
                    title: 'はがす進化カードの枚数を選ぶ',
                    purpose: 'devolve-count',
                    callback: ([index]) => devolve(index + 1)
                });
            }
        }),
        cpuWants: () => false
    },
    '鬼の仮面': {
        canPlay: (game, player) => hasIn(game, player.discard, isOgerponEx) && game.inPlay(player).some(pokemon => isOgerponEx(game.topCard(pokemon))),
        play: (game, player) => game.promptCards({
            player,
            cards: cardsIn(game, player.discard, isOgerponEx),
            min: 1,
            max: 1,
            title: '場に出す「オーガポン」のポケモンexを選ぶ',
            purpose: 'ogres-mask-card',
            callback: ([inst]) => game.promptPokemon({
                player,
                pokemon: game.inPlay(player).filter(pokemon => isOgerponEx(game.topCard(pokemon))),
                min: 1,
                max: 1,
                title: '入れ替える場の「オーガポン」のポケモンexを選ぶ',
                purpose: 'ogres-mask-target',
                callback: ([target]) => {
                    const old = target.cards[target.cards.length - 1];
                    game.removeCard(player.discard, inst);
                    target.cards[target.cards.length - 1] = inst;
                    player.discard.push(old);
                    game.log(`${player.name}は${game.cardName(old)}を${game.cardName(inst)}と入れ替えた`);
                }
            })
        }),
        cpuWants: () => false
    }
};

function isOgerponEx(card) {
    return card.kind === 'pokemon' && card.name.includes('オーガポン') && (card.rule === 'ex' || card.rule === 'mega');
}

// 自分の進化している超ポケモン
function devolveTargets(game, player) {
    return game.inPlay(player).filter(pokemon => pokemon.cards.length > 1 && game.topCard(pokemon).stage > 0 && game.topCard(pokemon).type === 'psychic');
}

// ヒートバーナーでトラッシュできるもの：相手のポケモンのどうぐ・特殊エネルギーと、場のスタジアム
function heatBurnerTargets(game, player) {
    const opponent = game.opponentOf(player);
    const targets = [];
    game.inPlay(opponent).forEach(pokemon => {
        const name = game.topCard(pokemon).name;
        if (pokemon.tool) {
            targets.push({ label: `${name}の${game.cardName(pokemon.tool)}（どうぐ）`, score: 2, discard: () => game.discardTool(pokemon) });
        }
        cardsIn(game, pokemon.energies, isSpecialEnergy).forEach(inst => {
            targets.push({
                label: `${name}の${game.cardName(inst)}（特殊エネルギー）`,
                score: 1,
                discard: () => {
                    game.moveCard(pokemon.energies, opponent.discard, inst);
                    game.log(`${name}の${game.cardName(inst)}をトラッシュした`);
                }
            });
        });
    });
    if (game.stadium) {
        targets.push({ label: `${game.cardName(game.stadium.inst)}（スタジアム）`, score: game.stadium.owner === opponent.id ? 3 : 0, discard: () => game.discardStadium() });
    }
    return targets;
}
