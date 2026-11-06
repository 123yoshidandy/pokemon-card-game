import { describe, it, expect } from 'vitest';
import Game from '../public/js/game.js';
import { runCpuStep } from '../public/js/cpu-player.js';
import { createGameView } from '../public/js/game-view.js';
import { deckOptions, PLAYERS } from './helpers.js';

const CPU_PLAYERS = PLAYERS.map(player => ({ ...player, isCPU: true }));

describe('演出のための出来事（events）', () => {
    it('試合の中で、ワザ・トレーナーズ・エネルギー・きぜつなどが通し番号つきで残り、記録から再現しても同じになる', () => {
        const options = deckOptions(5);
        const game = new Game(CPU_PLAYERS, options);
        game.setup();
        const seen = new Set();
        let lastSeq = 0;
        for (let steps = 0; game.phase !== 'end' && steps < 5000; steps++) {
            runCpuStep(game);
            game.events.forEach(event => seen.add(event.type));
            const seq = game.events.at(-1)?.seq ?? 0;
            expect(seq).toBeGreaterThanOrEqual(lastSeq);
            lastSeq = seq;
            expect(game.events.length).toBeLessThanOrEqual(40);
        }
        expect([...seen]).toEqual(expect.arrayContaining(['attack', 'trainer', 'energy', 'knockout', 'bench', 'draw', 'prize']));
        const replayed = Game.replay(CPU_PLAYERS, options, game.commands);
        expect(replayed.events).toEqual(game.events);
        expect(createGameView(game, 0).events).toEqual(game.events);
    });
});
