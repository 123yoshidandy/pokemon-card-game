import Game from '../public/js/game.js';
import { runCpuStep } from '../public/js/cpu-player.js';
import { DECKS, expandDeck } from '../public/js/decks.js';

export const PLAYERS = [{ name: 'A' }, { name: 'B' }];

export function deckOptions(seed = 1, deckIds = ['charizard', 'miraidon']) {
    return { seed, decks: deckIds.map(id => expandDeck(DECKS.find(deck => deck.id === id))) };
}

// 準備（先攻の決定・バトル場・ベンチ）を CPU に任せ、最初の番が始まったところで返す
export function startedGame(seed = 1, { cpu = [false, false] } = {}) {
    const game = new Game(PLAYERS.map((player, index) => ({ ...player, isCPU: true })), deckOptions(seed));
    game.setup();
    while (game.phase === 'setup' || game.pendingPrompt) runCpuStep(game);
    game.players.forEach((player, index) => { player.isCPU = cpu[index]; });
    return game;
}

export function makeCard(game, id) {
    return { uid: `t${game.nextUid++}`, id };
}

// プレイヤーの場と手札を並べ直す（テスト用）
//   active / bench：カードIDか、{ id, cards, energies, damage, tool } の形
export function arrange(game, playerId, { active, bench, hand, deck, prizes } = {}) {
    const player = game.players[playerId];
    const toPokemon = spec => {
        const data = typeof spec === 'string' ? { id: spec } : spec;
        const cards = (data.cards ?? [data.id]).map(id => makeCard(game, id));
        const pokemon = game.createPokemon(cards[0]);
        pokemon.cards = cards;
        pokemon.enteredTurn = data.enteredTurn ?? 0;
        pokemon.energies = (data.energies ?? []).map(id => makeCard(game, id));
        pokemon.damage = data.damage ?? 0;
        pokemon.tool = data.tool ? makeCard(game, data.tool) : null;
        return pokemon;
    };
    if (active !== undefined) player.active = active ? toPokemon(active) : null;
    if (bench !== undefined) player.bench = bench.map(toPokemon);
    if (hand !== undefined) player.hand = hand.map(id => makeCard(game, id));
    if (deck !== undefined) player.deck = deck.map(id => makeCard(game, id));
    if (prizes !== undefined) player.prizes = prizes.map(id => makeCard(game, id));
    return player;
}

// 状態を比べるための写し（関数を含む手順と選択待ちは、有無だけを比べる）
export function snapshot(game) {
    return JSON.stringify({
        players: game.players,
        turn: game.turn,
        current: game.current,
        phase: game.phase,
        stadium: game.stadium,
        turnState: game.turnState,
        queue: game.effectQueue.length,
        prompt: game.pendingPrompt?.id ?? null,
        logs: game.logs.length
    });
}

// 選択待ちに答える（cards・pokemon は ID で指定できる）
export function answer(game, choice) {
    const prompt = game.pendingPrompt;
    if (!prompt) throw new Error('選択待ちがありません');
    let value = choice;
    if (prompt.type === 'cards') value = choice.map(id => prompt.cards.findIndex(inst => inst.id === id || inst.uid === id));
    if (prompt.type === 'pokemon') value = choice.map(target => prompt.pokemon.indexOf(target));
    const ok = game.applyCommand(prompt.player.id, { type: 'answer', answer: value });
    if (!ok) throw new Error(game.lastError);
}
