/**
 * CPU の戦略
 * 人間と同じ操作（command）を返すだけ。乱数は使わない（使うと記録から再現できなくなる）
 */

import { isBasicEnergy } from './card-data.js';

// 今、操作すべきプレイヤー（選択待ちならその人、なければ手番の人）
export function actingPlayerId(game) {
    if (game.phase === 'end') return null;
    if (game.pendingPrompt) return game.pendingPrompt.player.id;
    if (game.phase === 'main') return game.current;
    return null;
}

// CPU を1手だけ進める。進めたら true
export function runCpuStep(game) {
    const playerId = actingPlayerId(game);
    if (playerId === null || !game.players[playerId].isCPU) return false;
    const command = chooseCpuCommand(game, playerId);
    if (command && game.applyCommand(playerId, command)) return true;
    // 断られたら、必ずゲームを前に進める（最小の答え、または番を終える）
    const fallback = game.pendingPrompt ? { type: 'answer', answer: minimalAnswer(game.pendingPrompt) } : { type: 'endTurn' };
    if (game.applyCommand(playerId, fallback)) return true;
    throw new Error(`CPU が操作できません: ${game.lastError}`);
}

export function chooseCpuCommand(game, playerId) {
    const prompt = game.pendingPrompt;
    if (prompt) return prompt.player.id === playerId ? { type: 'answer', answer: answerPrompt(game, prompt) } : null;
    if (game.phase !== 'main' || game.current !== playerId) return null;
    return chooseMainAction(game, game.players[playerId]);
}

// ===== 手番の操作 =====

function chooseMainAction(game, player) {
    const legal = game.getLegalActions(player.id);
    const handCards = uid => game.cardOf(player.hand.find(inst => inst.uid === uid));
    const playable = filter => Object.keys(legal.hand).filter(uid => filter(handCards(uid), legal.hand[uid]));
    const opponent = game.opponentOf(player);

    // 特性とスタジアム
    if (legal.abilities.length) return { type: 'useAbility', target: legal.abilities[0] };
    if (legal.stadium) return { type: 'useStadium' };

    // サポート
    const supporter = chooseSupporter(game, player, playable(card => card.trainerType === 'supporter'));
    if (supporter) return { type: 'playTrainer', uid: supporter };

    // たねポケモンをベンチに出す
    const basic = playable(card => card.kind === 'pokemon' && card.stage === 0)[0];
    if (basic) return { type: 'playBasic', uid: basic };

    // 進化（バトルポケモンを先に）
    for (const uid of playable(card => card.kind === 'pokemon' && card.stage > 0)) {
        const targets = legal.hand[uid];
        const target = targets.includes(player.active?.id) ? player.active.id : targets[0];
        return { type: 'evolve', uid, target };
    }

    // グッズ
    const items = playable(card => card.trainerType === 'item');
    const pick = id => items.find(uid => handCards(uid).id === id);
    const candy = pick('rare-candy');
    if (candy) return { type: 'playTrainer', uid: candy };
    const nest = pick('nest-ball');
    if (nest && player.deck.some(inst => game.cardOf(inst).kind === 'pokemon' && game.cardOf(inst).stage === 0)) return { type: 'playTrainer', uid: nest };
    const ultra = pick('ultra-ball');
    if (ultra && wantsEvolution(game, player)) return { type: 'playTrainer', uid: ultra };
    const generator = pick('electric-generator');
    if (generator) return { type: 'playTrainer', uid: generator };
    const retrieval = pick('energy-retrieval');
    if (retrieval && !game.turnState.energyAttached && !player.hand.some(inst => game.cardOf(inst).kind === 'energy')) {
        return { type: 'playTrainer', uid: retrieval };
    }

    // エネルギーをつける
    const energy = playable(card => card.kind === 'energy')[0];
    if (energy) {
        const target = chooseEnergyTarget(game, player);
        if (target) return { type: 'attachEnergy', uid: energy, target: target.id };
    }

    // どうぐ（バトルポケモンを先に）
    for (const uid of playable(card => card.trainerType === 'tool')) {
        const targets = legal.hand[uid];
        return { type: 'playTrainer', uid, target: targets.includes(player.active?.id) ? player.active.id : targets[0] };
    }

    // スタジアム
    const stadium = playable(card => card.trainerType === 'stadium')[0];
    if (stadium) return { type: 'playTrainer', uid: stadium };

    // 回復
    const potion = pick('potion');
    if (potion && game.inPlay(player).some(pokemon => pokemon.damage >= 30)) return { type: 'playTrainer', uid: potion };

    // バトルポケモンがワザを使えず、ベンチに使えるポケモンがいれば入れ替える
    const active = player.active;
    if (active && bestAttack(game, player, active, opponent) === null) {
        const benchAttacker = player.bench.find(pokemon => bestAttack(game, player, pokemon, opponent) !== null);
        if (benchAttacker) {
            const switchCard = pick('switch');
            if (switchCard) return { type: 'playTrainer', uid: switchCard };
            if (legal.retreat.includes(benchAttacker.id)) return { type: 'retreat', target: benchAttacker.id };
        }
    }

    // ワザ
    const attack = bestAttack(game, player, active, opponent, legal);
    if (attack !== null) return { type: 'attack', index: attack };
    return { type: 'endTurn' };
}

function chooseSupporter(game, player, uids) {
    const byId = id => uids.find(uid => game.cardOf(player.hand.find(inst => inst.uid === uid)).id === id);
    const opponent = game.opponentOf(player);
    const boss = byId('bosss-orders');
    if (boss && player.active) {
        const damage = maxDamage(game, player, player.active, opponent);
        const activeKo = opponent.active && damage >= remainingHp(game, opponent.active);
        if (!activeKo && opponent.bench.some(pokemon => damage >= remainingHp(game, pokemon))) return boss;
    }
    const handSize = player.hand.length - 1;
    const research = byId('professors-research');
    if (research && handSize <= 4) return research;
    const iono = byId('iono');
    if (iono && (handSize <= 2 || (opponent.prizes.length <= 2 && handSize < player.prizes.length))) return iono;
    const judge = byId('judge');
    if (judge && handSize <= 2) return judge;
    return null;
}

// 進化先が山札にあり、場に進化元がいれば、ハイパーボールで探す価値がある
function wantsEvolution(game, player) {
    const inPlayIds = new Set(game.inPlay(player).map(pokemon => game.topCard(pokemon).id));
    return player.deck.some(inst => {
        const card = game.cardOf(inst);
        return card.kind === 'pokemon' && card.stage > 0 && inPlayIds.has(card.evolvesFrom);
    });
}

// エネルギーのつけ先：バトルポケモンがまだワザを使えなければバトル場、それ以外はワザの強いポケモン
function chooseEnergyTarget(game, player) {
    const needs = pokemon => topAttacks(game, pokemon).some(attack => !game.canPayCost(pokemon, attack.cost));
    if (player.active && needs(player.active)) return player.active;
    const candidates = player.bench.filter(needs).sort((a, b) => potential(game, b) - potential(game, a));
    return candidates[0] ?? null;
}

function topAttacks(game, pokemon) {
    return game.topCard(pokemon).attacks;
}

// 進化した後も含めた、そのポケモンのワザの強さの目安
function potential(game, pokemon) {
    return Math.max(...topAttacks(game, pokemon).map(attack => attack.damage), 0) + game.topCard(pokemon).stage * 40;
}

function remainingHp(game, pokemon) {
    return game.maxHp(pokemon) - pokemon.damage;
}

function estimateDamage(game, player, attacker, attack, defender) {
    let damage = attack.damage;
    if (game.topCard(attacker).id === 'charizard-ex') damage += 30 * game.prizesTaken(game.opponentOf(player));
    if (defender && game.topCard(defender).weakness === game.topCard(attacker).type) damage *= 2;
    return damage;
}

function maxDamage(game, player, attacker, opponent) {
    const index = bestAttack(game, player, attacker, opponent);
    return index === null ? 0 : estimateDamage(game, player, attacker, topAttacks(game, attacker)[index], opponent.active);
}

// エネルギーが足りるワザのうち、ダメージの一番大きいもの（なければ null）。legal を渡せば今使えるかも確かめる
function bestAttack(game, player, attacker, opponent, legal) {
    if (!attacker) return null;
    let best = null;
    let bestDamage = -1;
    topAttacks(game, attacker).forEach((attack, index) => {
        if (legal ? !legal.attacks[index] : !game.canPayCost(attacker, attack.cost)) return;
        const damage = estimateDamage(game, player, attacker, attack, opponent.active);
        if (damage > bestDamage) {
            best = index;
            bestDamage = damage;
        }
    });
    return best;
}

// ===== 選択への答え =====

function answerPrompt(game, prompt) {
    const player = prompt.player;
    const opponent = game.opponentOf(player);
    const indices = (items, score, count) => items
        .map((item, index) => ({ index, score: score(item) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, count)
        .map(entry => entry.index)
        .sort((a, b) => a - b);
    const cardScore = inst => {
        const card = game.cardOf(inst);
        return card.kind === 'pokemon' ? card.hp : 0;
    };

    switch (prompt.purpose) {
        case 'first-player':
            return [1]; // 後攻は最初の番からワザを使える
        case 'setup-active':
            return indices(prompt.cards, cardScore, 1);
        case 'setup-bench':
        case 'infernal-reign':
        case 'energy-retrieval':
        case 'electric-generator':
        case 'tandem-unit':
        case 'nest-ball':
        case 'artazon':
            return indices(prompt.cards, cardScore, prompt.max);
        case 'mulligan-draw':
            return [prompt.options.length - 1];
        case 'ultra-ball-search': {
            const inPlayIds = new Set(game.inPlay(player).map(pokemon => game.topCard(pokemon).id));
            return indices(prompt.cards, inst => {
                const card = game.cardOf(inst);
                return (inPlayIds.has(card.evolvesFrom) ? 1000 : 0) + card.stage * 100 + card.hp / 10;
            }, 1);
        }
        case 'ultra-ball-discard':
            return indices(prompt.cards, inst => -discardValue(game, player, inst), 2);
        case 'promote':
        case 'switch':
        case 'gyro-ball-switch':
            return indices(prompt.pokemon, pokemon => (bestAttack(game, player, pokemon, opponent) !== null ? 1000 : 0) + remainingHp(game, pokemon), 1);
        case 'boss-target':
            return indices(prompt.pokemon, pokemon => -remainingHp(game, pokemon), 1);
        case 'potion':
            return indices(prompt.pokemon, pokemon => pokemon.damage, 1);
        case 'infernal-reign-target':
        case 'electric-generator-target':
            return indices(prompt.pokemon, pokemon => (pokemon === player.active ? 50 : 0) + potential(game, pokemon) - pokemon.energies.length * 30, 1);
        case 'gyro-ball-confirm':
            return false;
    }
    if (prompt.type === 'confirm') return prompt.purpose.startsWith('ability-');
    if (prompt.type === 'cards' && prompt.purpose === 'rare-candy-card') return [0];
    return minimalAnswer(prompt);
}

// 手放してよいカードほど小さい値
function discardValue(game, player, inst) {
    const card = game.cardOf(inst);
    const sameCount = player.hand.filter(other => other.id === inst.id).length;
    if (isBasicEnergy(card)) return 30 - sameCount * 5;
    if (card.kind === 'pokemon') return 60 + card.stage * 10;
    if (card.trainerType === 'stadium') return 10;
    if (card.id === 'potion') return 15;
    return 40 - sameCount * 5;
}

// 条件を満たす最小の答え
export function minimalAnswer(prompt) {
    if (prompt.type === 'confirm') return false;
    return Array.from({ length: prompt.min }, (_, index) => index);
}
