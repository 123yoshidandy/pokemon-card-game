/**
 * CPU の戦略
 * 人間と同じ操作（command）を返すだけ。乱数は使わない（使うと記録から再現できなくなる）
 */

import { isBasicEnergy, hasRule, isPokemonEx, baseOfStage1 } from './card-data.js';
import { DECKS, expandDeck } from './decks.js';

// 今、操作すべきプレイヤー（選択待ちならその人、なければ手番の人）
// デッキを決める段階では、まだ決めていない人（CPU を先に）
export function actingPlayerId(game) {
    if (game.phase === 'end') return null;
    if (game.phase === 'deck') {
        const waiting = game.players.filter(player => !game.decks[player.id]);
        return (waiting.find(player => player.isCPU) ?? waiting[0])?.id ?? null;
    }
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
    if (game.phase === 'deck') {
        return game.decks[playerId] ? null : { type: 'deck', cards: expandDeck(DECKS[playerId % DECKS.length]) };
    }
    const prompt = game.pendingPrompt;
    if (prompt) return prompt.player.id === playerId ? { type: 'answer', answer: answerPrompt(game, prompt) } : null;
    if (game.phase !== 'main' || game.current !== playerId) return null;
    return chooseMainAction(game, game.players[playerId]);
}

// ===== 手番の操作 =====

function chooseMainAction(game, player) {
    const legal = game.getLegalActions(player.id);
    const instOf = uid => player.hand.find(inst => inst.uid === uid);
    const cardOf = uid => game.cardOf(instOf(uid));
    const playable = filter => Object.keys(legal.hand).filter(uid => filter(cardOf(uid), legal.hand[uid]));
    const pick = name => playable(card => card.name === name)[0];
    const opponent = game.opponentOf(player);
    const active = player.active;

    // 特性（cpuWants が false なら使わない。何回でも使える特性は、1つの番に3回まで）
    const ability = legal.abilities.find(id => {
        const pokemon = game.inPlay(player).find(pk => pk.id === id);
        const card = game.topCard(pokemon);
        if ((game.turnState.abilityUseCount[id] ?? 0) >= 3) return false;
        return card.ability.cpuWants ? card.ability.cpuWants(game, player, pokemon) : true;
    });
    if (ability) return { type: 'useAbility', target: ability };

    // サポート
    const supporter = chooseSupporter(game, player, playable(card => card.trainerType === 'supporter'));
    if (supporter) return { type: 'playTrainer', uid: supporter };

    // たねポケモンをベンチに出す
    const basic = playable(card => card.kind === 'pokemon' && card.stage === 0)[0];
    if (basic) return { type: 'playBasic', uid: basic };

    // 進化（バトルポケモンを先に）
    for (const uid of playable(card => card.kind === 'pokemon' && card.stage > 0)) {
        const targets = legal.hand[uid];
        return { type: 'evolve', uid, target: targets.includes(active?.id) ? active.id : targets[0] };
    }

    // ポケモンを出す・探す
    const candy = pick('ふしぎなアメ');
    if (candy) return { type: 'playTrainer', uid: candy };
    const poffin = pick('なかよしポフィン');
    if (poffin && player.deck.some(inst => { const card = game.cardOf(inst); return card.kind === 'pokemon' && card.stage === 0 && card.hp <= 70; })) {
        return { type: 'playTrainer', uid: poffin };
    }
    const ultra = pick('ハイパーボール');
    if (ultra && (wantsEvolution(game, player) || needsBench(game, player))) return { type: 'playTrainer', uid: ultra };
    const pokeBall = pick('モンスターボール');
    if (pokeBall && player.deck.some(inst => game.cardOf(inst).kind === 'pokemon')) return { type: 'playTrainer', uid: pokeBall };

    // エネルギーを手札に用意する
    const hasEnergyInHand = player.hand.some(inst => game.cardOf(inst).kind === 'energy');
    if (!game.turnState.energyAttached && !hasEnergyInHand) {
        const search = pick('エネルギー転送') ?? pick('エネルギー回収');
        if (search) return { type: 'playTrainer', uid: search };
    }

    // エネルギーをつける
    const energy = playable(card => card.kind === 'energy')[0];
    if (energy) {
        const target = chooseEnergyTarget(game, player);
        if (target) return { type: 'attachEnergy', uid: energy, target: target.id };
    }

    // ベンチのエネルギーを、ワザが使えないバトルポケモンへ寄せる
    const energySwitch = pick('エネルギーつけかえ');
    if (energySwitch && active && bestAttack(game, player, active, opponent) === null
        && player.bench.some(pokemon => pokemon.energies.length > 0)) {
        return { type: 'playTrainer', uid: energySwitch };
    }

    // どうぐ
    for (const uid of playable(card => card.trainerType === 'tool')) {
        const target = chooseToolTarget(game, player, cardOf(uid), legal.hand[uid]);
        if (target) return { type: 'playTrainer', uid, target };
    }

    // スタジアム（自分に損なものは出さない）
    const stadium = playable(card => card.trainerType === 'stadium').find(uid => stadiumIsGood(game, player, cardOf(uid)));
    if (stadium) return { type: 'playTrainer', uid: stadium };

    // 回復
    const potion = pick('きずぐすり');
    if (potion && game.inPlay(player).some(pokemon => pokemon.damage >= 30)) return { type: 'playTrainer', uid: potion };

    // ほかのトレーナーズは、カードの cpuWants が「使いたい」と言えば使う（どうぐ・スタジアムは上で選んだ）
    const generic = playable(card => card.kind === 'trainer' && card.trainerType !== 'tool' && card.cpuWants?.(game, player))[0];
    if (generic) return { type: 'playTrainer', uid: generic };

    // バトルポケモンがワザを使えず、ベンチに使えるポケモンがいれば入れ替える
    if (active && bestAttack(game, player, active, opponent) === null) {
        const benchAttacker = player.bench.find(pokemon => bestAttack(game, player, pokemon, opponent) !== null);
        if (benchAttacker) {
            const switchCard = pick('ポケモンいれかえ');
            if (switchCard) return { type: 'playTrainer', uid: switchCard };
            if (legal.retreat.includes(benchAttacker.id)) return { type: 'retreat', target: benchAttacker.id };
        }
    }

    // ワザ
    const attack = bestAttack(game, player, active, opponent, legal);
    if (attack !== null) return { type: 'attack', index: attack };
    // ワザを使えないなら、番が終わるスタジアムの効果（ミアレシティ）もここで使う
    if (legal.stadium && player.bench.length < 4) return { type: 'useStadium' };
    return { type: 'endTurn' };
}

function chooseSupporter(game, player, uids) {
    const byId = name => uids.find(uid => game.cardOf(player.hand.find(inst => inst.uid === uid)).name === name);
    const opponent = game.opponentOf(player);
    const boss = byId('ボスの指令');
    if (boss && player.active) {
        const damage = maxDamage(game, player, player.active, opponent);
        const activeKo = opponent.active && damage >= remainingHp(game, opponent.active);
        if (!activeKo && opponent.bench.some(pokemon => damage >= remainingHp(game, pokemon))) return boss;
    }
    const handSize = player.hand.length - 1;
    if (handSize <= 3 && byId('ゼイユ')) return byId('ゼイユ');
    if (handSize <= 3 && byId('リーリエの決心')) return byId('リーリエの決心');
    if (handSize <= 5 && byId('ガイ')) return byId('ガイ');
    if (handSize <= 5 && byId('MCの盛り上げ')) return byId('MCの盛り上げ');
    if (handSize <= 2 && byId('ジャッジマン')) return byId('ジャッジマン');
    // ほかのサポートは、カードの cpuWants が「使いたい」と言えば使う
    return uids.find(uid => {
        const card = game.cardOf(player.hand.find(inst => inst.uid === uid));
        return card.cpuWants?.(game, player);
    }) ?? null;
}

// ベンチが少なく、山札にたねポケモンがあれば、たねポケモンを探す（場からいなくなると負けるため）
function needsBench(game, player) {
    return player.bench.length < 2 && player.deck.some(inst => {
        const card = game.cardOf(inst);
        return card.kind === 'pokemon' && card.stage === 0;
    });
}

// 進化先が山札にあり、場に進化元がいれば、探す価値がある（ふしぎなアメを持っていれば、2つ上の進化も）
function wantsEvolution(game, player) {
    return player.deck.some(inst => canEvolveSoon(game, player, game.cardOf(inst)));
}

function canEvolveSoon(game, player, card) {
    if (card.kind !== 'pokemon' || card.stage === 0) return false;
    const inPlayNames = new Set(game.inPlay(player).map(pokemon => game.topCard(pokemon).name));
    if (inPlayNames.has(card.evolvesFrom)) return true;
    const hasCandy = player.hand.some(inst => game.cardName(inst) === 'ふしぎなアメ');
    return card.stage === 2 && hasCandy && inPlayNames.has(baseOfStage1(card.evolvesFrom));
}

// エネルギーのつけ先：バトルポケモンがまだワザを使えなければバトル場、それ以外はワザの強いポケモン
function chooseEnergyTarget(game, player) {
    const needs = pokemon => topAttacks(game, pokemon).some(attack => !game.canPayCost(pokemon, attack.cost));
    if (player.active && needs(player.active)) return player.active;
    const candidates = player.bench.filter(needs).sort((a, b) => potential(game, b) - potential(game, a));
    return candidates[0] ?? null;
}

function chooseToolTarget(game, player, card, targets) {
    const pokemonOf = id => game.inPlay(player).find(pokemon => pokemon.id === id);
    const ordered = [...targets].sort((a, b) => (b === player.active?.id) - (a === player.active?.id));
    if (card.retreatReduction) return ordered.find(id => game.topCard(pokemonOf(id)).retreat >= 2) ?? null;
    if (card.damageBonus) return ordered.find(id => !hasRule(game.topCard(pokemonOf(id)))) ?? null;
    return ordered[0] ?? null;
}

// 2進化の HP が減るスタジアムは、相手の2進化のほうが多いときだけ出す
function stadiumIsGood(game, player, card) {
    if (!card.hpModifier) return true;
    const count = p => game.inPlay(p).filter(pokemon => card.hpModifier(game.topCard(pokemon)) < 0).length;
    return count(game.opponentOf(player)) > count(player);
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
    const ctx = { game, player, opponent: game.opponentOf(player), attacker, defender, attack, damage: attack.damage };
    let damage = attack.expected ? attack.expected(ctx) : attack.damage;
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
        if (legal ? !legal.attacks[index] : !game.canPayCost(attacker, game.attackCost(attacker, attack))) return;
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
    // カードの効果が答え方を書いていれば、それを使う
    if (prompt.cpuAnswer) {
        const custom = prompt.cpuAnswer(game, prompt);
        if (custom !== undefined && custom !== null) return custom;
    }

    switch (prompt.purpose) {
        case 'first-player':
            return [1]; // 後攻は最初の番からワザを使える
        case 'setup-active':
            // ルールを持たない、HP の高いポケモンを前に出す
            return indices(prompt.cards, inst => cardScore(inst) - (hasRule(game.cardOf(inst)) ? 1000 : 0), 1);
        case 'setup-bench':
        case 'bench-basic':
        case 'energy-retrieval':
            return indices(prompt.cards, cardScore, prompt.max);
        case 'search-energy':
            return [0];
        case 'mulligan-draw':
            return [prompt.options.length - 1];
        case 'search-pokemon': {
            const benchFirst = player.bench.length < 2;
            return indices(prompt.cards, inst => {
                const card = game.cardOf(inst);
                if (benchFirst) return (card.stage === 0 ? 1000 : 0) + card.hp / 10;
                return (canEvolveSoon(game, player, card) ? 1000 : 0) + card.stage * 100 + card.hp / 10;
            }, 1);
        }
        case 'ultra-ball-discard':
            return indices(prompt.cards, inst => -discardValue(game, player, inst), 2);
        case 'promote':
        case 'switch':
        case 'forced-switch':
            return indices(prompt.pokemon, pokemon => (bestAttack(game, player, pokemon, opponent) !== null ? 1000 : 0) + remainingHp(game, pokemon), 1);
        case 'boss-target':
            return indices(prompt.pokemon, pokemon => -remainingHp(game, pokemon), 1);
        case 'snipe-target':
            // ダメージがわかれば、倒せるもののうち、取れるサイドが一番多いもの。わからなければ残りHPの少ないもの
            return indices(prompt.pokemon, pokemon => {
                const hp = remainingHp(game, pokemon);
                const prizes = game.prizeValue(game.topCard(pokemon));
                if (prompt.amount && hp <= prompt.amount) return 1000 + prizes * 100 - hp / 10;
                return -hp + prizes * 15;
            }, prompt.max);
        case 'search-card':
        case 'search-evolution':
        case 'attach-energy-target':
            return Array.from({ length: prompt.max }, (_, index) => index);
        case 'discard-opponent-energy':
        case 'discard-opponent-hand':
            return Array.from({ length: prompt.max }, (_, index) => index);
        case 'self-damage-target':
            return indices(prompt.pokemon, pokemon => remainingHp(game, pokemon), prompt.min);
        case 'potion':
            return indices(prompt.pokemon, pokemon => pokemon.damage, 1);
        case 'energy-switch-source':
            return indices(prompt.pokemon, pokemon => (pokemon === player.active ? -100 : 0) + pokemon.energies.length, 1);
        case 'energy-switch-target':
            return indices(prompt.pokemon, pokemon => (pokemon === player.active ? 100 : 0) + potential(game, pokemon), 1);
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
    if (card.kind === 'pokemon') return 60 + card.stage * 10 + (isPokemonEx(card) ? 20 : 0);
    if (card.trainerType === 'stadium') return 10;
    if (card.name === 'きずぐすり') return 15;
    return 40 - sameCount * 5;
}

// 条件を満たす最小の答え
export function minimalAnswer(prompt) {
    if (prompt.type === 'confirm') return false;
    return Array.from({ length: prompt.min }, (_, index) => index);
}
