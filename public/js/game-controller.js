/**
 * CPU 対戦のコントローラー
 * 画面には getView() でビューを渡し、操作は send() で受け取る（オンライン対戦のコントローラーと同じ形）
 */

import Game from './game.js';
import { createGameView } from './game-view.js';
import { runCpuStep, actingPlayerId } from './cpu-player.js';
import { createSeed } from './random.js';

const CPU_STEP_DELAY_MS = 650; // CPU の手は1手ずつ間を置いて見せる
const CPU_SETUP_DELAY_MS = 250;
const HUMAN = 0;

export default class LocalGameController {
    // decks: [自分のデッキ, CPU のデッキ]（カードIDの配列） / listeners: onUpdate() / onError(message)
    constructor({ name, decks, seed = createSeed() }, listeners = {}) {
        this.listeners = listeners;
        this.options = { seed, decks };
        this.players = [{ name, isCPU: false }, { name: 'CPU', isCPU: true }];
        this.game = new Game(this.players, this.options);
        this.game.setup();
        this.cpuTimer = null;
        this.scheduleCpu();
    }

    getView() {
        return createGameView(this.game, HUMAN);
    }

    send(command) {
        if (!this.game.applyCommand(HUMAN, command)) {
            this.listeners.onError?.(this.game.lastError);
            return false;
        }
        this.listeners.onUpdate?.();
        this.scheduleCpu();
        return true;
    }

    scheduleCpu() {
        clearTimeout(this.cpuTimer);
        const playerId = actingPlayerId(this.game);
        if (playerId === null || !this.game.players[playerId].isCPU) return;
        const delay = this.game.phase === 'setup' ? CPU_SETUP_DELAY_MS : CPU_STEP_DELAY_MS;
        this.cpuTimer = setTimeout(() => {
            runCpuStep(this.game);
            this.listeners.onUpdate?.();
            this.scheduleCpu();
        }, delay);
    }

    stop() {
        clearTimeout(this.cpuTimer);
    }
}
