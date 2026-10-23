import { describe, it, expect } from 'vitest';
import Game from '../public/js/game.js';
import { runCpuStep } from '../public/js/cpu-player.js';
import { createGameView } from '../public/js/game-view.js';
import { DECKS } from '../public/js/decks.js';
import { CARDS } from '../public/js/card-data.js';
import { deckOptions, PLAYERS } from './helpers.js';

const MAX_STEPS = 5000;
const CPU_PLAYERS = PLAYERS.map(player => ({ ...player, isCPU: true }));

function playOut(seed, deckIds) {
    const options = deckOptions(seed, deckIds);
    const game = new Game(CPU_PLAYERS, options);
    game.setup();
    let steps = 0;
    while (game.phase !== 'end' && steps < MAX_STEPS) {
        runCpuStep(game);
        steps++;
    }
    return { game, options, steps };
}

describe('CPU 同士の試合', () => {
    const pairs = [['charizard', 'miraidon'], ['miraidon', 'charizard'], ['charizard', 'charizard'], ['miraidon', 'miraidon']];

    it('どのデッキの組み合わせでも、止まらずに決着し、記録から同じ結果を再現できる', () => {
        const played = new Set();
        for (let seed = 1; seed <= 60; seed++) {
            const deckIds = pairs[seed % pairs.length];
            const { game, options, steps } = playOut(seed, deckIds);
            expect(steps, `seed ${seed} が止まった`).toBeLessThan(MAX_STEPS);
            expect(game.phase).toBe('end');
            const replayed = Game.replay(CPU_PLAYERS, options, game.commands);
            expect(replayed.winner).toBe(game.winner);
            expect(replayed.logs).toEqual(game.logs);
            game.logs.forEach(entry => {
                const match = entry.text.match(/は(.+)を使った$/);
                if (match) played.add(match[1]);
            });
        }
        // デッキに入っているトレーナーズが、すべて一度は使われている
        const trainers = new Set(DECKS.flatMap(deck => Object.keys(deck.cards))
            .map(id => CARDS[id])
            .filter(card => card.kind === 'trainer')
            .map(card => card.name));
        expect([...trainers].filter(name => !played.has(name))).toEqual([]);
    });

    it('相手の手札と山札・サイドの中身は、どのビューにも出ない', () => {
        const { game } = playOut(11, ['charizard', 'miraidon']);
        for (const viewer of [0, 1]) {
            const view = createGameView(game, viewer);
            const opponent = view.players[1 - viewer];
            expect(opponent.hand).toBeNull();
            const text = JSON.stringify(view);
            const hidden = [...game.players[1 - viewer].hand, ...game.players[1 - viewer].deck, ...game.players[1 - viewer].prizes];
            hidden.forEach(inst => expect(text.includes(`"${inst.uid}"`)).toBe(false));
            const myDeck = [...game.players[viewer].deck, ...game.players[viewer].prizes];
            myDeck.forEach(inst => expect(text.includes(`"${inst.uid}"`)).toBe(false));
        }
    });
});
