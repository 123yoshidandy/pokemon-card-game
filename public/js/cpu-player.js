/**
 * CPU の戦略
 * 人間と同じ操作（command）を返すだけ。判断に Math.random は使わない（記録から再現できるように）
 *
 * 先読み：ゲームの状態を写し（cloneGame）、写しの上で操作を試して、結果の点数（evaluate）で比べる
 *   ・写しでは、自分の山札とサイド、相手の山札・サイド・手札を混ぜなおす（見えないカードを知らずに判断する）
 *   ・写しの乱数は、写しごとの別の乱数（ゲームの乱数は進めない）。コインを投げる操作は、2通りの乱数の平均で見る
 *   ・1手を決めるあいだに試す操作の数に上限がある（スマホでも重くならないように）
 * 先読みで決めること：ワザ（ダメージ・きぜつ・サイド）、ワザの前の操作（ボスの指令・入れ替え・にげる・エネルギー・ダメージを上げるカード）、
 *   自分の番に出た「ポケモンを1匹選ぶ」などの選択
 * ルールで決めること：ベンチ・進化・山札を探す・山札を引く（山札が少なければ控える）・エネルギーの育て先・手札を捨てる順
 */

import { isBasicEnergy, hasRule, isPokemonEx, baseOfStage1, CARDS } from './card-data.js';
import { DECKS, expandDeck } from './decks.js';
import { createRandom, shuffle } from './random.js';

const SIM_BUDGET = 160; // 1手を決めるあいだに試す操作の数
// 1手を決める時間の安全弁（ミリ秒）。ふだんは SIM_BUDGET（試す数）で打ち切るので、端末の速さで手が変わらない。
// ひどく遅い端末で固まらないよう、ここを超えたときだけ先読みをやめる
const TIME_BUDGET = 500;
const IMPROVE = 60; // 先読みで、この点数より大きくよくなるなら、その操作をする
const WIN = 1e6;
const PRIZE = 1000;

// 写さずに共有するもの（カードの定義）
const SHARED = new WeakSet(Object.values(CARDS));

let simDepth = 0; // 写しの中で判断しているときは 1 以上（写しの中では、選択への答えを先読みしない）
let budget = 0;
let deadline = 0;
let rootHandUids = new Set(); // 先読みでエネルギーをつけるのは、今の手札にあるエネルギーだけ（引いたかもしれないカードで判断しない）
let anchor = null; // 最後に手番の操作を決めたときの写し { game, index（そのときの操作の数）, state }

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
    const command = safely(() => chooseCpuCommand(game, playerId));
    if (command && game.applyCommand(playerId, command)) return true;
    // 断られたら、カードの効果の答え方 → 最小の答え（または番を終える）で、必ずゲームを前に進める
    const prompt = game.pendingPrompt;
    if (prompt?.cpuAnswer) {
        const answer = safely(() => prompt.cpuAnswer(game, prompt));
        if (answer !== undefined && answer !== null && game.applyCommand(playerId, { type: 'answer', answer })) return true;
    }
    const fallback = prompt ? { type: 'answer', answer: minimalAnswer(prompt) } : { type: 'endTurn' };
    if (game.applyCommand(playerId, fallback)) return true;
    throw new Error(`CPU が操作できません: ${game.lastError}`);
}

// CPU の判断でエラーが出ても、ゲームは止めない（自作のデッキのカードでも動くように）
function safely(fn) {
    try {
        return fn();
    } catch (error) {
        if (globalThis.CPU_DEBUG) throw error;
        return null;
    } finally {
        if (simDepth !== 0 && !globalThis.CPU_DEBUG) simDepth = 0;
    }
}

export function chooseCpuCommand(game, playerId) {
    if (game.phase === 'deck') {
        return game.decks[playerId] ? null : { type: 'deck', cards: expandDeck(DECKS[playerId % DECKS.length]) };
    }
    budget = SIM_BUDGET;
    deadline = now() + TIME_BUDGET;
    const prompt = game.pendingPrompt;
    if (prompt) return prompt.player.id === playerId ? { type: 'answer', answer: answerPrompt(game, prompt) } : null;
    if (game.phase !== 'main' || game.current !== playerId) return null;
    return chooseMainAction(game, game.players[playerId]);
}

// ===== 先読み =====

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function cloneGame(game, seed) {
    const memo = new Map();
    const copy = Object.create(Object.getPrototypeOf(game));
    memo.set(game, copy);
    for (const key of Object.keys(game)) {
        if (key === 'logs' || key === 'commands' || key === 'events') copy[key] = [];
        else if (key !== 'random') copy[key] = cloneValue(game[key], memo);
    }
    const random = createRandom(seed);
    copy.randomUsed = 0;
    copy.random = () => {
        copy.randomUsed++;
        return random();
    };
    return copy;
}

function cloneValue(value, memo) {
    if (value === null || typeof value !== 'object') return value;
    const known = memo.get(value);
    if (known !== undefined) return known;
    if (SHARED.has(value)) return value;
    if (Array.isArray(value)) {
        const array = new Array(value.length);
        memo.set(value, array);
        for (let i = 0; i < value.length; i++) array[i] = cloneValue(value[i], memo);
        return array;
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const object = {};
    memo.set(value, object);
    for (const key of Object.keys(value)) object[key] = cloneValue(value[key], memo);
    return object;
}

// 見えないカードを混ぜなおす（自分の山札とサイド・相手の山札とサイドと手札）。枚数は変えない
function hideUnknown(sim, me) {
    const reshuffle = lists => {
        const pool = lists.flat();
        shuffle(pool, sim.random);
        let at = 0;
        lists.forEach(list => {
            list.splice(0, list.length, ...pool.slice(at, at + list.length));
            at += list.length;
        });
    };
    const mine = sim.players[me];
    const other = sim.players[1 - me];
    reshuffle([mine.deck, mine.prizes]);
    reshuffle([other.deck, other.prizes, other.hand]);
    sim.randomUsed = 0;
}

// 写しの上で操作を順に試す。断られたら null。選択は CPU の答え方で答える（次の操作が答えなら、それで答える）
//   選択待ちや、効果の途中の状態は写さない（選択の続きは、元のゲームを指したままの関数なので、写しで動かすと元が変わる）
function simulate(game, me, commands, salt = 0, { open = false } = {}) {
    if (budget <= 0 || game.pendingPrompt || game.effectQueue.length > 0) return null;
    if (now() > deadline) {
        budget = 0;
        return null;
    }
    budget--;
    const seed = (Math.imul((game.seed ?? 0) ^ 0x9e3779b9, 31) + (game.commands?.length ?? 0) * 7919
        + game.promptCount * 131 + game.turn * 17 + salt * 104729 + simDepth * 613) >>> 0;
    const sim = cloneGame(game, seed);
    if (simDepth === 0) hideUnknown(sim, me);
    simDepth++;
    try {
        for (let i = 0; i < commands.length; i++) {
            const command = commands[i];
            const actor = command.type === 'answer' && sim.pendingPrompt ? sim.pendingPrompt.player.id : me;
            if (!sim.applyCommand(actor, command)) return null;
            if (commands[i + 1]?.type === 'answer' || (open && i === commands.length - 1)) continue;
            if (!settle(sim)) return null;
        }
        return sim;
    } catch (error) {
        if (globalThis.CPU_DEBUG) throw error;
        return null;
    } finally {
        simDepth--;
    }
}

function settle(sim) {
    for (let guard = 0; sim.pendingPrompt && sim.phase !== 'end'; guard++) {
        if (guard > 40) return false;
        const prompt = sim.pendingPrompt;
        const answer = answerPrompt(sim, prompt);
        if (!sim.applyCommand(prompt.player.id, { type: 'answer', answer })
            && !sim.applyCommand(prompt.player.id, { type: 'answer', answer: minimalAnswer(prompt) })) return false;
    }
    return true;
}

// 写しの結果の点数。自分の番がまだ続いていれば、そこからワザまで進めたときの一番よい点数
function outcome(sim, me, options) {
    if (!sim) return -Infinity;
    if (sim.phase === 'main' && sim.current === me && !sim.pendingPrompt && !sim.turnState.attacked) return bestFinish(sim, me, options).value;
    return evaluate(sim, me);
}

// 操作を試した結果の点数（乱数を使ったなら、別の乱数でもう一度試して平均する）
//   base（何もしないときの締めくくり）を渡すと、ワザに関わる状態が変わらない操作は、先読みを省いて base の点数にする
function trial(game, me, commands, options, base = null) {
    const first = simulate(game, me, commands, 0);
    if (!first) return -Infinity;
    if (base && first.current === me && first.phase === 'main' && !first.pendingPrompt && attackSignature(first, me) === base.signature) return base.value;
    const value = outcome(first, me, options);
    if (!first.randomUsed || budget < 8) return value;
    const second = simulate(game, me, commands, 1);
    return second ? (value + outcome(second, me, options)) / 2 : value;
}

// ワザの結果に関わる状態の要約（同じなら、ワザの先読みの結果も同じとみなす）
//   手札は入れない（先読みでつけるのは今の手札のエネルギーだけなので、手札が変わっても、ワザの結果がよくなることはない）
function attackSignature(game, me) {
    const player = game.players[me];
    const other = game.players[1 - me];
    const pokemonKey = pokemon => (pokemon
        ? `${pokemon.id}:${game.topCard(pokemon).id}:${pokemon.energies.map(inst => inst.id).join(',')}:${pokemon.tool?.id ?? ''}:${pokemon.damage}:${pokemon.effects.length}`
        : '-');
    const effects = p => p.effects.filter(effect => effect.untilTurn >= game.turn).map(effect => effect.kind).join(',');
    return [pokemonKey(player.active), pokemonKey(other.active), other.bench.map(pokemonKey).join('|'), player.bench.length,
        effects(player), effects(other), game.stadium?.inst.id ?? '', game.turnState.energyAttached,
        other.prizes.length, player.discard.length, other.discard.length].join('/');
}

// 何もしないときの締めくくり（同じ番で、ワザに関わる状態が同じなら、前に求めたものを使う）
let baseCache = { game: null, key: null, base: null };
function baseFinish(game, me) {
    const signature = attackSignature(game, me);
    const key = `${game.turn}#${signature}#${game.players[me].hand.map(inst => inst.uid).join(',')}`;
    if (baseCache.game === game && baseCache.key === key && baseCache.base) return baseCache.base;
    const base = { ...bestFinish(game, me), signature };
    if (base.value !== -Infinity) baseCache = { game, key, base };
    return base;
}

// 先読みの結果を、同じ番で状態が同じあいだ使い回す（手番の操作は1つずつ決めるので、同じ計算をくり返さないように）
let planCache = new Map();
let planCacheOwner = null;
function cachedPlan(game, me, name, extraKey, compute) {
    if (planCacheOwner !== game || planCache.turn !== game.turn) {
        planCache = new Map();
        planCache.turn = game.turn;
        planCacheOwner = game;
    }
    const key = `${name}#${attackSignature(game, me)}#${extraKey}`;
    if (planCache.has(key)) return planCache.get(key);
    const result = compute();
    if (budget > 0) planCache.set(key, result);
    return result;
}

// 番の締めくくり：ワザを使う（エネルギーを1枚つけてから使う）か、番を終えるかの、一番よいもの
function bestFinish(state, me, { attach = true } = {}) {
    const player = state.players[me];
    const legal = state.getLegalActions(me);
    let best = { value: trial(state, me, [{ type: 'endTurn' }]), command: { type: 'endTurn' } };
    legal.attacks.forEach((ok, index) => {
        if (!ok) return;
        const value = trial(state, me, [{ type: 'attack', index }]) + 1;
        if (value > best.value) best = { value, command: { type: 'attack', index } };
    });
    if (attach && !state.turnState.energyAttached && player.active) {
        const seen = new Set();
        for (const [uid, targets] of Object.entries(legal.hand)) {
            if (!rootHandUids.has(uid) || !targets.includes(player.active.id)) continue;
            const inst = player.hand.find(card => card.uid === uid);
            if (!inst || state.cardOf(inst).kind !== 'energy' || seen.has(inst.id)) continue;
            seen.add(inst.id);
            const command = { type: 'attachEnergy', uid, target: player.active.id };
            // 局面の点数はエネルギー1個で +40 されるので、それを差し引く（ワザがよくなるときだけ、ここでバトルポケモンにつける。育て先は chooseEnergyAttach が選ぶ）
            const value = trial(state, me, [command], { attach: false }) - ENERGY_VALUE;
            if (value > best.value) best = { value, command };
        }
    }
    return best;
}

const ENERGY_VALUE = 40; // 局面の点数で、場のエネルギー1個の値打ち

// 局面の点数（me から見て。大きいほどよい）
function evaluate(sim, me) {
    if (!sim) return -Infinity;
    if (sim.phase === 'end') return sim.winner === me ? WIN : sim.winner === 'draw' ? 0 : -WIN;
    const player = sim.players[me];
    const other = sim.players[1 - me];
    let score = PRIZE * (other.prizes.length - player.prizes.length);
    const side = (owner, sign) => {
        sim.inPlay(owner).forEach(pokemon => {
            const card = sim.topCard(pokemon);
            const hp = Math.max(1, sim.maxHp(pokemon));
            const prizes = Math.max(1, sim.prizeValue(card));
            const isActive = owner.active === pokemon;
            const hurt = Math.min(1, pokemon.damage / hp);
            if (sign < 0) {
                score += 320 * prizes * hurt * (isActive ? 1 : 0.85);
                score -= 40 * pokemon.energies.length + 45 * (pokemon.cards.length - 1) + 30;
                if (isActive) score += conditionValue(sim, pokemon);
            } else {
                score -= 220 * prizes * hurt * (isActive ? 1 : 0.8);
                score += ENERGY_VALUE * pokemon.energies.length + 50 * (pokemon.cards.length - 1) + 40 + (pokemon.tool ? 15 : 0);
                if (isActive) score -= conditionValue(sim, pokemon);
            }
        });
    };
    side(other, -1);
    side(player, 1);
    score += 8 * Math.min(player.hand.length, 8);
    score -= 4 * Math.min(other.hand.length, 8);
    if (player.deck.length < 8) score -= (8 - player.deck.length) * 60;
    if (player.deck.length === 0 && sim.current !== me) score -= WIN / 2;
    return score;
}

function conditionValue(game, pokemon) {
    let value = 0;
    if (game.hasCondition(pokemon, 'asleep')) value += 40;
    if (game.hasCondition(pokemon, 'paralyzed')) value += 70;
    if (game.hasCondition(pokemon, 'confused')) value += 30;
    if (game.hasCondition(pokemon, 'poisoned')) value += 25;
    if (game.hasCondition(pokemon, 'burned')) value += 25;
    return value;
}

// ===== 手番の操作 =====

function chooseMainAction(game, player) {
    const legal = game.getLegalActions(player.id);
    rootHandUids = new Set(player.hand.map(inst => inst.uid));
    anchor = { game, index: game.commands.length, state: cloneGame(game, 1) };
    const instOf = uid => player.hand.find(inst => inst.uid === uid);
    const cardOf = uid => game.cardOf(instOf(uid));
    const playable = filter => Object.keys(legal.hand).filter(uid => filter(cardOf(uid), legal.hand[uid]));
    const pick = name => playable(card => card.name === name)[0];
    const opponent = game.opponentOf(player);
    const active = player.active;
    const ctx = { game, player, legal, instOf, cardOf, playable, pick, opponent };

    // 特性（cpuWants が false なら使わない。何回でも使える特性は、1つの番に3回まで。山札を引きすぎない）
    const abilities = legal.abilities.filter(id => {
        const pokemon = game.inPlay(player).find(pk => pk.id === id);
        const card = game.topCard(pokemon);
        if ((game.turnState.abilityUseCount[id] ?? 0) >= 3) return false;
        return card.ability.cpuWants ? card.ability.cpuWants(game, player, pokemon) : true;
    });
    for (const id of abilities) {
        const command = { type: 'useAbility', target: id };
        if (drawIsSafe(ctx, command)) return command;
    }
    // 手札にあるときに使える特性
    for (const uid of legal.handAbilities ?? []) {
        const card = cardOf(uid);
        const command = { type: 'useHandAbility', uid };
        if ((card.ability.cpuWants ? card.ability.cpuWants(game, player) : true) && drawIsSafe(ctx, command)) return command;
    }

    // たねポケモンをベンチに出す（出したとたんにきぜつするなら出さない）
    for (const uid of playable(card => card.kind === 'pokemon' && card.stage === 0)) {
        if (benchIsSafe(ctx, uid)) return { type: 'playBasic', uid };
    }

    // 進化（ワザが強くなるポケモンを先に）
    const evolution = chooseEvolution(ctx);
    if (evolution) return evolution;

    // ポケモンを出す・探す
    const search = chooseSearchItem(ctx);
    if (search) return search;

    // サポート（先読みでワザの結果がよくなるもの → 山札を引くもの）
    const supporter = chooseSupporter(ctx);
    if (supporter) return supporter;

    // ワザの前の操作（入れ替え・にげる・ダメージを上げるカード・特性・スタジアム）を先読みで選ぶ
    const plan = planBeforeAttack(ctx);
    if (plan.best) return plan.best.command;
    // エネルギーをつけるとワザがよくなるなら、バトルポケモンにつける
    const baseCommand = plan.base.command;
    if (baseCommand.type === 'attachEnergy' && legal.hand[baseCommand.uid]?.includes(baseCommand.target)) return baseCommand;

    // エネルギーを育てる
    if (!game.turnState.energyAttached) {
        const energy = chooseEnergyAttach(ctx);
        if (energy) return energy;
    }

    // ベンチのエネルギーを、ワザが使えないバトルポケモンへ寄せる
    const energySwitch = pick('エネルギーつけかえ');
    if (energySwitch && active && plan.base.command.type !== 'attack'
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

    // ほかのトレーナーズは、カードの cpuWants が「使いたい」と言えば使う（どうぐ・スタジアム・サポートは上で選んだ）
    for (const uid of playable(card => card.kind === 'trainer' && card.trainerType !== 'tool' && card.trainerType !== 'supporter'
        && card.trainerType !== 'stadium' && card.cpuWants?.(game, player))) {
        const command = { type: 'playTrainer', uid };
        if (drawIsSafe(ctx, command)) return command;
    }

    // バトルポケモンがワザを使えず、ベンチに使えるポケモンがいれば入れ替える（次の番の準備）
    if (active && plan.base.command.type !== 'attack' && !game.turnState.retreated) {
        const ready = player.bench.filter(pokemon => readyToAttack(game, pokemon))
            .sort((a, b) => potential(game, player, b) - potential(game, player, a))[0];
        if (ready && potential(game, player, ready) > potential(game, player, active)) {
            const switchCard = pick('ポケモンいれかえ');
            if (switchCard) return { type: 'playTrainer', uid: switchCard };
            if (legal.retreat.includes(ready.id) && game.retreatCost(active) <= 1) return { type: 'retreat', target: ready.id };
        }
    }

    // ワザ（または番を終える）
    if (plan.base.command.type === 'attack' && legal.attacks[plan.base.command.index]) return plan.base.command;
    // ワザを使えないなら、番が終わるスタジアムの効果（ミアレシティ）もここで使う
    // ほかのスタジアムの効果は、カードの cpuWantsUse が「使いたい」と言うときだけ使う（使い続けて対戦が終わらなくなることがある）
    if (legal.stadium) {
        const stadiumCard = game.cardOf(game.stadium.inst);
        if (stadiumCard.name === 'ミアレシティ' ? player.bench.length < 4 : stadiumCard.cpuWantsUse?.(game, player)) return { type: 'useStadium' };
    }
    // 先読みが使えなかったとき（上限に達したなど）は、使えるワザのうち見積もりの一番大きいもの
    if (plan.base.value === -Infinity) {
        const attack = bestAttack(game, player, active, opponent, legal);
        if (attack !== null) return { type: 'attack', index: attack };
    }
    return { type: 'endTurn' };
}

// 山札を引く・探す操作が、山札を減らしすぎないか（写しで試して、山札の残りを見る）
function drawIsSafe(ctx, command) {
    const { game, player } = ctx;
    if (player.deck.length > 20) return true;
    const sim = simulate(game, player.id, [command]);
    if (!sim) return true;
    const after = sim.players[player.id];
    const drawn = player.deck.length - after.deck.length;
    if (drawn <= 0) return true;
    // 手札が多いのに引く操作は、山札が減るだけ（ただし、特性でない操作は使う）
    if (command.type === 'useAbility' && player.hand.length >= 8 && drawn >= 2) return false;
    return after.deck.length >= deckReserve(game, player);
}

// 残しておきたい山札の枚数（手札が少ないほど、引くことを優先する）
function deckReserve(game, player) {
    const hand = player.hand.length;
    if (hand <= 1) return 2;
    if (hand <= 3) return 5;
    return 8 + Math.min(player.prizes.length, game.opponentOf(player).prizes.length);
}

function benchIsSafe(ctx, uid) {
    const { game, player } = ctx;
    if (!game.stadium) return true;
    const sim = simulate(game, player.id, [{ type: 'playBasic', uid }]);
    if (!sim) return true;
    return sim.players[player.id].bench.some(pokemon => pokemon.id === uid);
}

function chooseEvolution(ctx) {
    const { game, player, legal, playable, cardOf } = ctx;
    let best = null;
    for (const uid of playable(card => card.kind === 'pokemon' && card.stage > 0)) {
        const card = cardOf(uid);
        for (const target of legal.hand[uid]) {
            const pokemon = game.inPlay(player).find(pk => pk.id === target);
            // 育っているポケモン（エネルギーが多い）・バトルポケモンを先に
            const score = pokemon.energies.length * 10 + (pokemon === player.active ? 5 : 0) + (card.rule ? 3 : 0) - pokemon.damage / 100;
            if (!best || score > best.score) best = { score, command: { type: 'evolve', uid, target } };
        }
    }
    return best?.command ?? null;
}

function chooseSearchItem(ctx) {
    const { game, player, pick, playable, cardOf } = ctx;
    const deckHas = filter => player.deck.some(inst => filter(game.cardOf(inst)));
    const tryCommand = uid => {
        const command = { type: 'playTrainer', uid };
        return uid && drawIsSafe(ctx, command) ? command : null;
    };
    const candy = pick('ふしぎなアメ');
    if (candy) return { type: 'playTrainer', uid: candy };
    const poffin = pick('なかよしポフィン');
    if (poffin && player.bench.length < game.benchLimit(player) - 1 && deckHas(card => card.kind === 'pokemon' && card.stage === 0 && card.hp <= 70)) {
        const command = tryCommand(poffin);
        if (command) return command;
    }
    const ultra = pick('ハイパーボール');
    if (ultra && player.hand.length >= 3 && (wantsEvolution(game, player) || needsBench(game, player)) && cheapDiscards(game, player, ultra, 2)) {
        const command = tryCommand(ultra);
        if (command) return command;
    }
    const pokeBall = pick('モンスターボール');
    if (pokeBall && deckHas(card => card.kind === 'pokemon')) return { type: 'playTrainer', uid: pokeBall };

    // ポケモンを探すグッズ（カードの cpuWants が「使いたい」と言い、探したいポケモンがあるとき）
    for (const uid of playable(card => card.trainerType === 'item' && ['ポケパッド', 'ファイトゴング', 'メガシグナル'].includes(card.name) && card.cpuWants?.(game, player))) {
        if (cardOf(uid).name === 'ファイトゴング' || wantsEvolution(game, player) || needsBench(game, player) || player.bench.length < 4) {
            const command = tryCommand(uid);
            if (command) return command;
        }
    }

    // エネルギーを手札に用意する
    const hasEnergyInHand = player.hand.some(inst => game.cardOf(inst).kind === 'energy');
    if (!game.turnState.energyAttached && !hasEnergyInHand) {
        const search = pick('エネルギー転送') ?? pick('エネルギー回収');
        if (search) return { type: 'playTrainer', uid: search };
    }
    return null;
}

// 捨てる手札に、捨ててもよいカードが count 枚あるか
function cheapDiscards(game, player, exceptUid, count) {
    const values = player.hand.filter(inst => inst.uid !== exceptUid).map(inst => keepValue(game, player, inst)).sort((a, b) => a - b);
    return values.length >= count && values.slice(0, count).every(value => value < 70);
}

function chooseSupporter(ctx) {
    const { game, player, playable, cardOf } = ctx;
    const uids = playable(card => card.trainerType === 'supporter');
    if (uids.length === 0) return null;
    const distinct = [...new Map(uids.map(uid => [cardOf(uid).id, uid])).values()];
    // 先読みで、ワザの結果（きぜつ・ダメージ）がよくなるサポート（ボスの指令など）
    const best = cachedPlan(game, player.id, 'supporter', `${distinct.join(',')}|${handKey(player)}`, () => {
        const base = baseFinish(game, player.id);
        let found = null;
        for (const uid of distinct) {
            const value = trial(game, player.id, [{ type: 'playTrainer', uid }], undefined, base);
            if (value > base.value + IMPROVE && (!found || value > found.value)) found = { value, uid };
        }
        return found;
    });
    if (best && distinct.includes(best.uid)) return { type: 'playTrainer', uid: best.uid };

    const byName = name => distinct.find(uid => cardOf(uid).name === name);
    const handSize = player.hand.length - 1;
    const tryUid = uid => (uid && drawIsSafe(ctx, { type: 'playTrainer', uid }) ? { type: 'playTrainer', uid } : null);
    const ordered = [];
    if (handSize <= 3) ordered.push(byName('ゼイユ'), byName('リーリエの決心'));
    if (handSize <= 5) ordered.push(byName('ガイ'), byName('MCの盛り上げ'));
    if (handSize <= 4) ordered.push(byName('リーリエの決心'));
    if (handSize <= 2 || game.opponentOf(player).hand.length >= 7) ordered.push(byName('ジャッジマン'));
    for (const uid of ordered) {
        const command = tryUid(uid);
        if (command) return command;
    }
    // ほかのサポートは、カードの cpuWants が「使いたい」と言えば使う（ボスの指令は、先読みで決める）
    for (const uid of distinct) {
        const card = cardOf(uid);
        if (card.name === 'ボスの指令' || !card.cpuWants?.(game, player)) continue;
        const command = tryUid(uid);
        if (command) return command;
    }
    // 手札がとても少なければ、山札を引くサポートを使う
    if (handSize <= 2) {
        for (const name of ['リーリエの決心', 'ジャッジマン']) {
            const command = tryUid(byName(name));
            if (command) return command;
        }
    }
    return null;
}

// ワザの前の操作を先読みで選ぶ。base：何もしないときの締めくくり、best：base よりよくなる操作
function planBeforeAttack(ctx) {
    const { game, player, legal } = ctx;
    const extraKey = [Object.keys(legal.hand).join(','), legal.abilities.join(','), legal.retreat.join(','), legal.stadium].join('|');
    const best = cachedPlan(game, player.id, 'plan', extraKey, () => planCandidates(ctx));
    return { base: baseFinish(game, player.id), best: best && stillLegal(legal, best.command) ? best : null };
}

function stillLegal(legal, command) {
    if (command.type === 'playTrainer') return Boolean(legal.hand[command.uid]) && (!command.target || legal.hand[command.uid].includes(command.target));
    if (command.type === 'useAbility') return legal.abilities.includes(command.target);
    if (command.type === 'retreat') return legal.retreat.includes(command.target);
    if (command.type === 'useStadium') return legal.stadium;
    return true;
}

function handKey(player) {
    return player.hand.map(inst => inst.uid).join(',');
}

function planCandidates(ctx) {
    const { game, player, legal, cardOf } = ctx;
    const base = baseFinish(game, player.id);
    const candidates = [];
    const seen = new Set();
    const hasEnergy = !game.turnState.energyAttached && player.hand.some(inst => game.cardOf(inst).kind === 'energy');
    // にげる先は、この番にワザを使えそうなポケモンだけ
    const couldAttack = pokemon => game.attacksOf(pokemon).some(attack => {
        const missing = missingEnergy(game, pokemon, game.attackCost(pokemon, attack));
        return missing === 0 || (missing === 1 && hasEnergy);
    });
    for (const [uid, targets] of Object.entries(legal.hand)) {
        const card = cardOf(uid);
        if (card.kind !== 'trainer' || card.trainerType === 'supporter') continue;
        if (card.trainerType === 'tool') {
            targets.forEach(target => {
                const key = `${card.id}>${target}`;
                if (!seen.has(key)) candidates.push({ type: 'playTrainer', uid, target });
                seen.add(key);
            });
        } else if (!seen.has(card.id)) {
            seen.add(card.id);
            candidates.push({ type: 'playTrainer', uid });
        }
    }
    legal.abilities.forEach(id => candidates.push({ type: 'useAbility', target: id }));
    legal.retreat.forEach(target => {
        const pokemon = player.bench.find(pk => pk.id === target);
        if (pokemon && couldAttack(pokemon)) candidates.push({ type: 'retreat', target });
    });
    if (legal.stadium) candidates.push({ type: 'useStadium' });
    let best = null;
    for (const command of candidates) {
        const value = trial(game, player.id, [command], undefined, base);
        if (value > base.value + IMPROVE && (!best || value > best.value)) best = { value, command };
    }
    return best;
}

// エネルギーの育て先：ワザ（進化した後のワザもふくむ）に足りないエネルギーが減るポケモン
function chooseEnergyAttach(ctx) {
    const { game, player, playable, instOf, legal } = ctx;
    let best = null;
    const seen = new Set();
    for (const uid of playable(card => card.kind === 'energy')) {
        const inst = instOf(uid);
        for (const target of legal.hand[uid]) {
            const key = `${inst.id}>${target}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const pokemon = game.inPlay(player).find(pk => pk.id === target);
            let score = energyScore(game, player, pokemon, inst);
            const card = game.cardOf(inst);
            if (!card.basic) score += specialEnergyBonus(ctx, uid, target);
            if (score > 0 && (!best || score > best.score)) best = { score, command: { type: 'attachEnergy', uid, target } };
        }
    }
    return best?.command ?? null;
}

// つけたときに働く特殊エネルギー（ベンチにポケモンが出る・手札が増える）
function specialEnergyBonus(ctx, uid, target) {
    const { game, player } = ctx;
    const sim = simulate(game, player.id, [{ type: 'attachEnergy', uid, target }]);
    if (!sim) return 0;
    const after = sim.players[player.id];
    return (sim.inPlay(after).length - game.inPlay(player).length) * 40 + Math.max(0, after.hand.length - (player.hand.length - 1)) * 15;
}

function energyScore(game, player, pokemon, inst) {
    const stage = game.topCard(pokemon).stage;
    let best = 0;
    for (const goal of attackGoals(game, player, pokemon)) {
        const before = missingEnergy(game, pokemon, goal.cost);
        if (before === 0) continue;
        const after = missingEnergy(game, pokemon, goal.cost, inst);
        if (after >= before) continue;
        const value = (goal.damage > 0 ? 40 + Math.min(goal.damage, 300) : 5) - after * 15 - (goal.stage - stage) * 10;
        best = Math.max(best, value);
    }
    if (best <= 0) return 0;
    if (pokemon === player.active) best += 10;
    return best;
}

// そのポケモン（と、その進化先）のワザ：{ cost, damage, stage }
// ワザの見積もりのダメージ。ほかのポケモンのワザをまねるワザ（ナイトジョーカーなど）は、自分の場のほかのポケモンのワザのいちばん大きいもの
function goalDamage(game, player, pokemon, attack, defender) {
    if (!attack.copiesAttack) return estimateRaw(game, player, pokemon, attack, defender);
    const copied = game.inPlay(player).filter(other => other !== pokemon) // バトル場のポケモンも、にげたあとでまねられる
        .flatMap(other => game.topCard(other).attacks.filter(item => !item.copiesAttack).map(item => estimateRaw(game, player, other, item, defender)));
    return Math.max(0, ...copied);
}

function attackGoals(game, player, pokemon) {
    const top = game.topCard(pokemon);
    const opponent = game.opponentOf(player);
    const goals = game.attacksOf(pokemon).map(attack => ({
        cost: game.attackCost(pokemon, attack),
        damage: goalDamage(game, player, pokemon, attack, opponent.active),
        stage: top.stage
    }));
    const owned = ownedCards(game, player);
    const next = owned.filter(card => card.kind === 'pokemon' && card.evolvesFrom === top.name);
    const after = owned.filter(card => card.kind === 'pokemon' && next.some(stage1 => card.evolvesFrom === stage1.name));
    [...next, ...after].forEach(card => card.attacks.forEach(attack => goals.push({
        cost: attack.cost,
        damage: goalDamage(game, player, pokemon, attack, opponent.active),
        stage: card.stage
    })));
    return goals;
}

// 自分のカード（山札・手札・トラッシュ・サイド・場）。デッキの中身は自分で知っている
function ownedCards(game, player) {
    const insts = [...player.deck, ...player.hand, ...player.discard, ...player.prizes, ...game.inPlay(player).flatMap(pokemon => pokemon.cards)];
    const seen = new Set();
    const cards = [];
    insts.forEach(inst => {
        if (seen.has(inst.id)) return;
        seen.add(inst.id);
        cards.push(game.cardOf(inst));
    });
    return cards;
}

// デッキのエネルギーで、そのポケモンのどれかのワザを払えるか（準備でバトル場に出すポケモンを選ぶため）
function canPayWithDeck(game, player, card) {
    const types = new Set();
    for (const owned of ownedCards(game, player)) {
        if (owned.kind !== 'energy') continue;
        if (owned.basic) types.add(owned.energyType);
        else {
            try {
                (owned.provides?.() ?? []).forEach(entry => String(entry).split('|').forEach(type => types.add(type)));
            } catch {
                types.add('any');
            }
        }
    }
    return (card.attacks ?? []).some(attack => attack.cost.every(type => type === 'colorless' || types.has(type) || types.has('any')));
}

// 足りないエネルギーの数（extra：つけるつもりのエネルギー）
function missingEnergy(game, pokemon, cost, extra = null) {
    const pool = game.energyUnits(pokemon, extra ? [...pokemon.energies, extra] : pokemon.energies);
    const fits = (unit, type) => unit.includes('|') && unit.split('|').includes(type);
    let missing = 0;
    for (const type of cost.filter(type => type !== 'colorless')) {
        let index = pool.indexOf(type);
        if (index === -1) index = pool.findIndex(unit => fits(unit, type));
        if (index === -1) index = pool.indexOf('any');
        if (index === -1) missing++;
        else pool.splice(index, 1);
    }
    return missing + Math.max(0, cost.filter(type => type === 'colorless').length - pool.length);
}

function readyToAttack(game, pokemon) {
    return game.attacksOf(pokemon).some(attack => attack.damage > 0 && game.canPayCost(pokemon, game.attackCost(pokemon, attack)));
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
    return player.deck.some(inst => canEvolveSoon(game, player, game.cardOf(inst)) && !player.hand.some(other => other.id === inst.id));
}

function canEvolveSoon(game, player, card) {
    if (card.kind !== 'pokemon' || card.stage === 0) return false;
    const inPlayNames = new Set(game.inPlay(player).map(pokemon => game.topCard(pokemon).name));
    if (inPlayNames.has(card.evolvesFrom)) return true;
    const hasCandy = player.hand.some(inst => game.cardName(inst) === 'ふしぎなアメ');
    return card.stage === 2 && hasCandy && inPlayNames.has(baseOfStage1(card.evolvesFrom));
}

function chooseToolTarget(game, player, card, targets) {
    const pokemonOf = id => game.inPlay(player).find(pokemon => pokemon.id === id);
    let ordered = [...targets].sort((a, b) => (b === player.active?.id) - (a === player.active?.id));
    if (card.cpuWants && !card.cpuWants(game, player)) return null;
    // つけ先の目安（どうぐの cpuTarget）があれば、それに合うポケモンだけにつける
    if (card.cpuTarget) ordered = ordered.filter(id => card.cpuTarget(game, player, pokemonOf(id)));
    if (card.retreatReduction) return ordered.find(id => game.topCard(pokemonOf(id)).retreat >= 2) ?? null;
    if (card.damageBonus) return ordered.find(id => !hasRule(game.topCard(pokemonOf(id)))) ?? null;
    return ordered[0] ?? null;
}

// 2進化の HP が減るスタジアムは、相手の2進化のほうが多いときだけ出す
function stadiumIsGood(game, player, card) {
    if (game.stadium && game.cardOf(game.stadium.inst).name === card.name) return false;
    if (card.cpuWants) return card.cpuWants(game, player);
    if (!card.hpModifier) return true;
    const count = p => game.inPlay(p).filter(pokemon => card.hpModifier(game.topCard(pokemon)) < 0).length;
    return count(game.opponentOf(player)) > count(player);
}

// 進化した後も含めた、そのポケモンのワザの強さの目安
function potential(game, player, pokemon) {
    const goals = attackGoals(game, player, pokemon);
    return Math.max(0, ...goals.map(goal => goal.damage)) + game.topCard(pokemon).stage * 40;
}

function remainingHp(game, pokemon) {
    return game.maxHp(pokemon) - pokemon.damage;
}

// ワザのダメージの見積もり（弱点をふくまない）
function estimateRaw(game, player, attacker, attack, defender) {
    const ctx = { game, player, opponent: game.opponentOf(player), attacker, defender, attack, damage: attack.damage };
    if (!attack.expected) return attack.damage;
    try {
        return attack.expected(ctx) ?? attack.damage;
    } catch {
        return attack.damage;
    }
}

function estimateDamage(game, player, attacker, attack, defender) {
    let damage = estimateRaw(game, player, attacker, attack, defender);
    const weakness = defender ? game.weaknessOf(defender) : null;
    if (weakness && game.typesOf(attacker).includes(weakness)) damage *= 2;
    return damage;
}

function maxDamageAgainst(game, player, attacker, defender) {
    if (!attacker) return 0;
    let best = 0;
    game.attacksOf(attacker).forEach(attack => {
        if (!game.canPayCost(attacker, game.attackCost(attacker, attack))) return;
        best = Math.max(best, estimateDamage(game, player, attacker, attack, defender));
    });
    return best;
}

// エネルギーが足りるワザのうち、ダメージの一番大きいもの（なければ null）。legal を渡せば今使えるかも確かめる
function bestAttack(game, player, attacker, opponent, legal) {
    if (!attacker) return null;
    let best = null;
    let bestDamage = -1;
    game.attacksOf(attacker).forEach((attack, index) => {
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

const DISCARD_PURPOSES = new Set(['ultra-ball-discard', 'ability-discard', 'supporter-discard-hand', 'secret-box-discard', 'discard-hand', 'prism-tower', 'supporter-discard-any']);
const SEARCH_PURPOSES = new Set(['search-card', 'search-pokemon', 'search-evolution']);

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
    const fromHand = prompt.type === 'cards' && prompt.cards.every(inst => player.hand.includes(inst));
    const fromDeck = prompt.type === 'cards' && prompt.cards.every(inst => player.deck.includes(inst));

    // 手札を決まった枚数だけ捨てる：残したいカードを残す
    if (fromHand && prompt.min === prompt.max && prompt.min > 0 && DISCARD_PURPOSES.has(prompt.purpose)) {
        return indices(prompt.cards, inst => -keepValue(game, player, inst, prompt.cards), prompt.min);
    }
    // 山札から1枚選んで手札に加える：今いちばんほしいカード
    if (fromDeck && prompt.max === 1 && SEARCH_PURPOSES.has(prompt.purpose)) {
        return indices(prompt.cards, inst => needValue(game, player, game.cardOf(inst)), 1);
    }
    // 自分の番に出た「1つ選ぶ」選択は、先読みで答える（ボスの指令の相手・入れ替える先・まねするワザなど）
    if (simDepth === 0 && game.current === player.id && game.phase === 'main' && prompt.max === 1 && prompt.min === 1
        && (prompt.type === 'pokemon' || prompt.type === 'choose')) {
        const answer = answerBySimulation(game, prompt);
        if (answer) return answer;
    }
    // カードの効果が答え方を書いていれば、それを使う
    if (prompt.cpuAnswer) {
        const custom = prompt.cpuAnswer(game, prompt);
        if (custom !== undefined && custom !== null) return custom;
    }

    switch (prompt.purpose) {
        case 'first-player':
            return [1]; // 後攻は最初の番からワザを使える
        case 'setup-active':
            // ルールを持たない、にげやすく HP の高いポケモンを前に出す。ワザをデッキのエネルギーで払えないポケモン（ベンチにいてこそ役に立つもの）は後ろに
            return indices(prompt.cards, inst => {
                const card = game.cardOf(inst);
                return card.hp - card.retreat * 20 - (hasRule(card) ? 1000 : 0) - (canPayWithDeck(game, player, card) ? 0 : 500);
            }, 1);
        case 'setup-bench':
        case 'bench-basic':
            // 進化先がデッキにあるポケモンを先に、とられるサイドの多い ex は後に（needValue と同じ考え）
            return indices(prompt.cards, inst => needValue(game, player, game.cardOf(inst)) - (hasRule(game.cardOf(inst)) ? 30 : 0), prompt.max);
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
                return needValue(game, player, card);
            }, 1);
        }
        case 'ultra-ball-discard':
            return indices(prompt.cards, inst => -keepValue(game, player, inst, prompt.cards), prompt.min); // ハイパーボールは2枚、1枚を選ぶワザもある
        case 'promote':
        case 'switch':
        case 'forced-switch':
            return indices(prompt.pokemon, pokemon => promoteScore(game, player, pokemon), 1);
        case 'boss-target':
            return indices(prompt.pokemon, pokemon => bossScore(game, player, pokemon), 1);
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
            if (fromDeck) return indices(prompt.cards, inst => needValue(game, player, game.cardOf(inst)), prompt.max);
            return Array.from({ length: prompt.max }, (_, index) => index);
        case 'attach-energy-target':
            // つけるエネルギーで、ワザに足りないエネルギーがいちばん減る（育てたい）ポケモンを選ぶ
            if (prompt.type === 'pokemon' && prompt.energy) {
                return indices(prompt.pokemon, pokemon => energyScore(game, player, pokemon, prompt.energy) * 10 + potential(game, player, pokemon) / 100, prompt.max);
            }
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
            return indices(prompt.pokemon, pokemon => (pokemon === player.active ? 100 : 0) + potential(game, player, pokemon), 1);
    }
    if (prompt.type === 'confirm') return prompt.purpose.startsWith('ability-');
    if (prompt.type === 'cards' && prompt.purpose === 'rare-candy-card') return [0];
    return minimalAnswer(prompt);
}

// 選択肢をそれぞれ写しで試し、一番よいものを選ぶ（差がなければ null。ほかの答え方にまかせる）
//   選択待ちの状態は写せないので、手番の操作を決めたときの写し（anchor）から、それからの操作をやり直して試す
function answerBySimulation(game, prompt) {
    if (!anchor || anchor.game !== game || game.commands.length < anchor.index) return null;
    const items = game.promptItems(prompt);
    if (items.length < 2 || items.length > 8) return null;
    const me = prompt.player.id;
    const since = game.commands.slice(anchor.index).map(({ playerId, ...command }) => command);
    // やり直して、同じ選択にたどり着くか確かめる（コインの結果などで変わることがある）
    const check = simulate(anchor.state, me, since, 0, { open: true });
    const same = check?.pendingPrompt && check.pendingPrompt.purpose === prompt.purpose
        && check.promptItems(check.pendingPrompt).length === items.length
        && (prompt.type !== 'pokemon' || check.pendingPrompt.pokemon.every((pokemon, index) => pokemon.id === prompt.pokemon[index].id));
    if (!same) return null;
    const values = items.map((_, index) => trial(anchor.state, me, [...since, { type: 'answer', answer: [index] }]));
    const best = Math.max(...values);
    if (best === -Infinity || best - Math.min(...values) < 1) return null;
    return [values.indexOf(best)];
}

// バトル場に出すポケモン：ワザを使えるもの → 次の番に使えそうなもの → HP の高いもの
function promoteScore(game, player, pokemon) {
    const goals = game.attacksOf(pokemon).map(attack => ({ cost: game.attackCost(pokemon, attack), damage: estimateRaw(game, player, pokemon, attack, game.opponentOf(player).active) }));
    let score = remainingHp(game, pokemon) / 10;
    for (const goal of goals) {
        const missing = missingEnergy(game, pokemon, goal.cost);
        const value = goal.damage > 0 ? (missing === 0 ? 1000 : missing === 1 ? 500 : 0) + Math.min(goal.damage, 300) : 0;
        score = Math.max(score, value + remainingHp(game, pokemon) / 10);
    }
    return score - game.retreatCost(pokemon) * 5;
}

// ボスの指令で呼ぶ相手：倒せるもの（サイドの多いもの）→ にげにくく、エネルギーのないもの
function bossScore(game, player, pokemon) {
    const damage = maxDamageAgainst(game, player, player.active, pokemon);
    const hp = remainingHp(game, pokemon);
    const prizes = game.prizeValue(game.topCard(pokemon));
    if (damage >= hp) return 1000 + prizes * 300 - hp / 10;
    return -hp / 10 + game.retreatCost(pokemon) * 20 - pokemon.energies.length * 10;
}

// 手札に残したいほど大きい値（捨てるときに使う）
function keepValue(game, player, inst, pool = player.hand) {
    const card = game.cardOf(inst);
    const sameInHand = player.hand.filter(other => other.id === inst.id).length;
    const duplicate = (sameInHand - 1) * 8;
    if (card.kind === 'energy') {
        const energies = player.hand.filter(other => game.cardOf(other).kind === 'energy').length;
        let value = energies <= 1 ? 75 : energies <= 2 ? 55 : 35;
        if (!card.basic) value += 10;
        return value - duplicate;
    }
    if (card.kind === 'pokemon') {
        // 「ばけがくれ」のポケモンは、トラッシュにあるほど強くなるデッキがある
        if (card.ability?.name === 'ばけがくれ' && ownedCards(game, player).some(other => other.name === 'ダダリン' || other.name === 'ヤバソチャ')) return 5;
        if (card.stage > 0) return (canEvolveSoon(game, player, card) ? 85 : 45) - duplicate;
        const benchFull = player.bench.length >= game.benchLimit(player);
        return (benchFull ? 15 : 55) + (isPokemonEx(card) ? 5 : 0) - duplicate;
    }
    if (card.trainerType === 'supporter') return (game.turnState.supporterPlayed ? 50 : 70) + (card.name === 'ボスの指令' ? 10 : 0) - duplicate;
    if (card.trainerType === 'stadium') return (game.stadium && game.cardOf(game.stadium.inst).name === card.name ? 5 : 25) - duplicate;
    if (card.trainerType === 'tool') return 35 - duplicate;
    if (card.name === '変化の書' && sameInHand < 2) return 15;
    if (card.name === 'きずぐすり') return 20;
    return 45 - duplicate;
}

// 山札から手札に加えたいほど大きい値
function needValue(game, player, card) {
    const hand = player.hand.map(inst => game.cardOf(inst));
    const inHand = name => hand.some(other => other.name === name);
    if (card.kind === 'pokemon') {
        if (card.stage > 0) {
            if (canEvolveSoon(game, player, card)) return (inHand(card.name) ? 60 : 100) + card.stage * 5 + (card.rule ? 5 : 0);
            return 30 + (inHand(card.evolvesFrom) ? 20 : 0);
        }
        if (player.bench.length < 2) return 90 + card.hp / 100;
        const inPlay = game.inPlay(player).some(pokemon => game.topCard(pokemon).name === card.name);
        const evolves = ownedCards(game, player).some(other => other.kind === 'pokemon' && other.evolvesFrom === card.name);
        if (player.bench.length >= game.benchLimit(player)) return 10;
        return (evolves && !inPlay ? 70 : 40) + (inHand(card.name) ? -20 : 0) + card.hp / 100;
    }
    if (card.kind === 'energy') {
        const energies = hand.filter(other => other.kind === 'energy').length;
        return energies === 0 ? 80 : 30;
    }
    if (card.trainerType === 'supporter') {
        const supporters = hand.filter(other => other.trainerType === 'supporter').length;
        if (card.name === 'ボスの指令') return supporters === 0 ? 78 : 45;
        return supporters === 0 ? 75 : 35;
    }
    if (card.trainerType === 'stadium') return 20;
    if (card.trainerType === 'tool') return 30;
    return inHand(card.name) ? 30 : 45;
}

// 条件を満たす最小の答え
export function minimalAnswer(prompt) {
    if (prompt.type === 'confirm') return false;
    return Array.from({ length: prompt.min }, (_, index) => index);
}
