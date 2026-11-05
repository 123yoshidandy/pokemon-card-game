/**
 * 効果音（音声ファイルを使わず、Web Audio API で合成する）
 * ブラウザの制限で、最初に画面を触るまでは鳴らない（unlockSound を操作の中で呼ぶ）
 * いきなり鳴って驚かせないよう、初めはオフ。上の帯のボタンでオンにしたときだけ鳴らす
 */

const STORAGE_KEY = 'pokemon-card-game:sound';

let context = null;
let enabled = loadEnabled();
const listeners = new Set();

function loadEnabled() {
    try {
        return localStorage.getItem(STORAGE_KEY) === 'on';
    } catch {
        return false;
    }
}

export const isSoundOn = () => enabled;

export function toggleSound() {
    enabled = !enabled;
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
        // 保存できなくても切り替えはできる
    }
    if (enabled) unlockSound();
    listeners.forEach(listener => listener(enabled));
}

export const onSoundChange = listener => listeners.add(listener);

// ユーザー操作の中で呼ぶ（AudioContext を作る・再開する）
export function unlockSound() {
    if (!enabled) return;
    try {
        context ??= new (window.AudioContext || window.webkitAudioContext)();
        if (context.state === 'suspended') context.resume();
    } catch {
        context = null;
    }
}

function tone({ frequency, type = 'sine', start = 0, duration = 0.15, volume = 0.2, slide = null }) {
    const t = context.currentTime + start;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume * MASTER_VOLUME, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(context.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
}

function noise({ start = 0, duration = 0.05, volume = 0.25, frequency = 1800, type = 'bandpass' }) {
    const t = context.currentTime + start;
    const length = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.value = volume * MASTER_VOLUME;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(t);
}

// v：音量の倍率（相手の操作は少し小さくする）
const MASTER_VOLUME = 0.5; // 全体の音量（控えめに）

const EFFECTS = {
    // トレーナーズ：カードをめくる
    trainer: v => noise({ duration: 0.09, volume: 0.22 * v, frequency: 3200 }),
    // ワザ：振りかぶって、当たる
    attack: v => {
        noise({ duration: 0.16, volume: 0.18 * v, frequency: 900, type: 'lowpass' });
        tone({ frequency: 150, type: 'triangle', start: 0.2, duration: 0.18, volume: 0.32 * v, slide: 70 });
        noise({ start: 0.2, duration: 0.06, volume: 0.25 * v, frequency: 1200 });
    },
    // きぜつ：下がっていく
    knockout: v => tone({ frequency: 440, type: 'triangle', start: 0.15, duration: 0.55, volume: 0.16 * v, slide: 110 }),
    // エネルギー：小さなチャイム
    energy: v => [988, 1319].forEach((frequency, i) => tone({ frequency, start: 0.3 + i * 0.06, duration: 0.2, volume: 0.08 * v })),
    // ベンチに出す：ぽん
    bench: v => tone({ frequency: 520, type: 'sine', duration: 0.12, volume: 0.16 * v, slide: 780 }),
    // 進化：上がっていく和音
    evolve: v => [392, 523, 659, 784].forEach((frequency, i) => tone({ frequency, type: 'triangle', start: i * 0.06, duration: 0.25, volume: 0.09 * v })),
    // コイン：オモテは高く、ウラは低く
    coinHeads: () => [2093, 3136].forEach((frequency, i) => tone({ frequency, start: 0.55 + i * 0.05, duration: 0.25, volume: 0.07 })),
    coinTails: () => [1047, 1397].forEach((frequency, i) => tone({ frequency, start: 0.55 + i * 0.05, duration: 0.25, volume: 0.07 })),
    // 入れ替え
    switch: v => noise({ duration: 0.12, volume: 0.14 * v, frequency: 1500 }),
    // サイドを取る
    prize: v => [1175, 1568, 2093].forEach((frequency, i) => tone({ frequency, start: 0.2 + i * 0.07, duration: 0.22, volume: 0.08 * v })),
    // 自分の番が来た
    turn: () => [659, 988].forEach((frequency, i) => tone({ frequency, start: i * 0.11, duration: 0.2, volume: 0.08 })),
    // 勝ち・負け
    win: () => [523, 659, 784, 1047].forEach((frequency, i) => tone({ frequency, type: 'triangle', start: i * 0.13, duration: 0.35, volume: 0.15 })),
    lose: () => [440, 392, 330].forEach((frequency, i) => tone({ frequency, type: 'triangle', start: i * 0.18, duration: 0.4, volume: 0.12 }))
};

// mine：自分の操作なら true（相手の操作は少し小さく鳴らす）
export function playEffect(name, { mine = true } = {}) {
    if (!enabled || !context || context.state !== 'running') return;
    EFFECTS[name]?.(mine ? 1 : 0.7);
}
