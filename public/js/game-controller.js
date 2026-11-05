/**
 * CPU 対戦のコントローラー
 * 画面には getView() でビューを渡し、操作は send() で受け取る（オンライン対戦のコントローラーと同じ形）
 */

import Game from './game.js';
import { createGameView } from './game-view.js';
import { runCpuStep, actingPlayerId, minimalAnswer } from './cpu-player.js';
import { createSeed } from './random.js';

const CPU_STEP_DELAY_MS = 650; // CPU の手は1手ずつ間を置いて見せる（場が変わった手のあと）
const CPU_QUICK_DELAY_MS = 300; // 山札を探す・選ぶなど、見た目が変わらない手のあと
const VISUAL_EVENTS = new Set(['bench', 'evolve', 'energy', 'trainer', 'attack', 'knockout', 'switch', 'coin', 'prize']);
const CPU_SETUP_DELAY_MS = 250;
const HUMAN = 0;
const SAVE_KEY = 'pokemon-card-game:cpu-game'; // 途中の CPU 戦（名前・デッキ・シード・操作の記録）

// 保存した途中の CPU 戦（なければ null）
export function loadSavedCpuGame() {
    try {
        const saved = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null');
        return saved && Array.isArray(saved.decks) && Array.isArray(saved.commands) ? saved : null;
    } catch {
        return null;
    }
}

export function clearSavedCpuGame() {
    try {
        localStorage.removeItem(SAVE_KEY);
    } catch {
        // 保存できない環境では何もしない
    }
}
const STALL_LIMIT = 3; // CPU の手が進まないことがこの回数続いたら、最小の答えか「番を終える」で抜ける

export default class LocalGameController {
    // decks: [自分のデッキ, CPU のデッキ]（カードIDの配列） / listeners: onUpdate() / onError(message)
    // commands を渡すと、その記録から途中の対戦を作り直す（続きから）
    constructor({ name, decks, seed = createSeed(), commands = null }, listeners = {}) {
        this.listeners = listeners;
        this.name = name;
        this.options = { seed, decks };
        this.players = [{ name, isCPU: false }, { name: 'CPU', isCPU: true }];
        if (commands) {
            this.game = Game.replay(this.players, this.options, commands);
        } else {
            this.game = new Game(this.players, this.options);
            this.game.setup();
        }
        this.save();
        this.cpuTimer = null;
        this.scheduleCpu();
    }

    getView() {
        return createGameView(this.game, HUMAN);
    }

    send(command) {
        let accepted;
        try {
            accepted = this.game.applyCommand(HUMAN, command);
        } catch (error) {
            // カードの処理の例外で止まらないように、記録から作り直して、その操作の前に戻す
            console.error(error);
            this.game = Game.replay(this.players, this.options, this.game.commands);
            this.listeners.onError?.('その操作はできませんでした');
            this.listeners.onUpdate?.();
            this.scheduleCpu();
            return false;
        }
        this.save();
        if (!accepted) {
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
        const delay = this.game.phase === 'setup' ? CPU_SETUP_DELAY_MS : this.lastStepVisual === false ? CPU_QUICK_DELAY_MS : CPU_STEP_DELAY_MS;
        this.cpuTimer = setTimeout(() => {
            // どこで例外が出ても、必ず次の手を予約する（対戦が止まらないように）
            try {
                this.stepCpu();
            } catch (error) {
                console.error(error);
            } finally {
                try {
                    this.listeners.onUpdate?.();
                } finally {
                    this.scheduleCpu();
                }
            }
        }, delay);
    }

    // 操作のたびに保存する（タブが読み直されても、続きから遊べるように）。決着したら消す
    save() {
        if (this.game.phase === 'end') return clearSavedCpuGame();
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify({ name: this.name, decks: this.options.decks, seed: this.options.seed, commands: this.game.commands }));
        } catch {
            // 保存できない環境でも遊べるようにする
        }
    }

    stepCpu() {
        const before = this.game.commands.length;
        const seq = this.game.eventSeq;
        try {
            runCpuStep(this.game);
        } catch (error) {
            console.error(error);
        }
        this.stalls = this.game.commands.length === before ? (this.stalls ?? 0) + 1 : 0;
        this.save();
        this.lastStepVisual = this.game.events.some(event => event.seq > seq && VISUAL_EVENTS.has(event.type));
        if (this.stalls < STALL_LIMIT) return;
        this.stalls = 0;
        const playerId = actingPlayerId(this.game);
        if (playerId === null) return;
        const prompt = this.game.pendingPrompt;
        this.game.applyCommand(playerId, prompt ? { type: 'answer', answer: minimalAnswer(prompt) } : { type: 'endTurn' });
    }

    stop() {
        clearTimeout(this.cpuTimer);
    }
}
