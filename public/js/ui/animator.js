/**
 * 対戦中の演出：ゲームが残した出来事（view.events）のうち、まだ見せていないものを、演出用の層（#fx）で再生する
 * 描き直しで場の要素が作り直されても困らないように、演出は描き直したあとの要素か、#fx の上の複製で行う
 */

import { cardFace, energyDot } from './card-view.js';
import { playEffect } from '../sound.js';

const STAGGER_MS = 160; // 同時に届いた出来事を、少しずつずらして見せる

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// 縦向きのスマホでは、body ごと時計回りに90度回して描く（style.css）。
// #fx は body の中にあるので、画面の上の位置を、回す前の body の中の位置に直して使う
const rotated = () => window.matchMedia?.('(orientation: portrait) and (pointer: coarse)').matches;
function localRect(element) {
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (!rotated()) return rect;
    return { left: rect.top, top: window.innerWidth - rect.right, width: rect.height, height: rect.width };
}

export default class Animator {
    constructor(layer) {
        this.layer = layer;
        this.lastSeq = null;
        this.timers = new Set(); // 演出の予約（新しい対戦を始めたら消す）
        this.tiles = new Map(); // 描き直す前の場のポケモン（id → { rect, html }）。きぜつして消えたポケモンの位置に演出を出すため
    }

    // 新しい対戦を始めたとき
    reset() {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.clear();
        this.lastSeq = null;
        this.tiles.clear();
        this.layer.replaceChildren();
    }

    // 描き直す前に呼ぶ
    // view：これから描くビュー。まだ見せていないきぜつがあるときだけ写す（位置を測るとレイアウトの計算が走るため）
    capture(view) {
        const fresh = this.lastSeq !== null && (view?.events ?? []).some(event => event.seq > this.lastSeq && event.type === 'knockout');
        if (!fresh) return;
        this.tiles = new Map([...document.querySelectorAll('#game-screen .slot [data-pokemon]')]
            .map(element => [element.dataset.pokemon, { rect: localRect(element), html: element.outerHTML }]));
    }

    // 描き直したあとに呼ぶ。開いた直後（途中から見始めたとき）は、それまでの出来事を再生しない
    play(view) {
        const events = view.events ?? [];
        const latest = events.at(-1)?.seq ?? 0;
        if (this.lastSeq === null || latest < this.lastSeq) {
            this.lastSeq = latest;
            return;
        }
        const fresh = events.filter(event => event.seq > this.lastSeq);
        this.lastSeq = latest;
        const tiles = this.tiles;
        // コインを何枚も投げたときは、横に並べる
        let coins = 0;
        fresh.forEach((event, index) => {
            const slot = event.type === 'coin' ? coins++ : 0;
            this.later(() => this.playOne(event, view, tiles, slot), index * STAGGER_MS);
        });
    }

    playOne(event, view, tiles, slot = 0) {
        const mine = event.player === undefined || event.player === view.viewerId;
        playEffect(event.type === 'coin' ? (event.heads ? 'coinHeads' : 'coinTails') : event.type, { mine });
        if (reducedMotion()) return;
        switch (event.type) {
            case 'trainer': return this.reveal(event.card);
            case 'attack': return this.attack(event, mine);
            case 'knockout': return this.knockout(tiles.get(event.pokemon));
            case 'bench':
            case 'evolve':
            case 'switch': return this.pulse(event.pokemon, 'fx-pop');
            case 'coin': return this.coin(event.heads, slot);
            case 'prize': return this.glow(mine ? '#my-prizes' : '#opp-prizes');
            case 'energy': return this.energy(event, mine);
            default: return null;
        }
    }

    // 使ったトレーナーズを、盤面に一瞬大きく見せる
    reveal(cardId) {
        const field = localRect(document.querySelector('#game-screen .field'));
        if (!field) return;
        const element = this.add('fx-reveal', cardFace(cardId));
        // 中央の帯の文（相手の番は、いま何をしたか）と重ならないよう、右寄りに出す
        element.style.left = `${field.left + field.width * 0.8}px`;
        element.style.top = `${field.top + field.height / 2}px`;
    }

    // コイン：盤面の中央で回り、オモテかウラで止まる（何枚もなら横に並べる）
    coin(heads, slot) {
        const field = localRect(document.querySelector('#game-screen .field'));
        if (!field) return;
        const element = this.add(`fx-coin ${heads ? 'heads' : 'tails'}`, `<span>${heads ? 'オモテ' : 'ウラ'}</span>`);
        element.style.left = `${field.left + field.width / 2 + (slot % 5) * 64}px`;
        element.style.top = `${field.top + field.height / 2}px`;
    }

    // サイドを取った側の情報の欄を光らせる
    glow(selector) {
        const element = document.querySelector(selector);
        if (!element) return;
        element.classList.remove('fx-glow');
        void element.offsetWidth;
        element.classList.add('fx-glow');
        element.addEventListener('animationend', () => element.classList.remove('fx-glow'), { once: true });
    }

    // ワザ：使ったポケモンが相手のほうへ踏み込み、少し遅れて受けたポケモンが揺れる
    attack(event, mine) {
        this.pulse(event.attacker, mine ? 'fx-lunge-up' : 'fx-lunge-down');
        if (event.defender) this.later(() => this.pulse(event.defender, 'fx-hit'), 220);
    }

    // きぜつ：描き直す前のポケモンの複製を、元の場所で灰色にして沈ませる
    knockout(tile) {
        if (!tile) return;
        const element = this.add('fx-knockout', tile.html);
        // きぜつしたので、残りHP は 0 で見せる（写したのはダメージが入る前の姿）
        element.querySelectorAll('.mon-hp-num').forEach(hp => { hp.textContent = '0'; hp.classList.add('hp-low'); });
        Object.assign(element.style, { left: `${tile.rect.left}px`, top: `${tile.rect.top}px`, width: `${tile.rect.width}px`, height: `${tile.rect.height}px` });
    }

    // エネルギー：手札の側（相手なら相手の情報の欄）から、つけたポケモンへ印が飛ぶ
    energy(event, mine) {
        const target = localRect(this.pokemonElement(event.pokemon));
        const from = localRect(document.querySelector(mine ? '#hand' : '#opp-info'));
        if (!target || !from) return;
        const element = this.add('fx-energy', event.energyType ? energyDot(event.energyType) : '<span class="fx-energy-dot"></span>');
        const start = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
        const end = { x: target.left + target.width / 2, y: target.top + target.height * 0.7 };
        const lift = Math.min(90, Math.abs(end.y - start.y) / 2 + 30); // 遠いほど高い弧を描く
        element.animate([
            { transform: `translate(${start.x}px, ${start.y}px) scale(0.6)`, opacity: 0 },
            { transform: `translate(${(start.x + end.x) / 2}px, ${Math.min(start.y, end.y) - lift}px) scale(1.3)`, opacity: 1, offset: 0.5 },
            { transform: `translate(${end.x}px, ${end.y}px) scale(1)`, opacity: 1 }
        ], { duration: 520, easing: 'ease-in-out' }).finished.then(() => element.remove(), () => element.remove());
    }

    // 時間をおいて行う演出（reset で消せるように覚えておく）
    later(fn, ms) {
        const timer = setTimeout(() => {
            this.timers.delete(timer);
            fn();
        }, ms);
        this.timers.add(timer);
    }

    // 場のポケモンの要素に、動きのクラスを一度だけ付ける
    pulse(pokemonId, className) {
        const element = this.pokemonElement(pokemonId)?.closest('.slot');
        if (!element) return;
        element.classList.remove(className);
        void element.offsetWidth; // 同じクラスを付け直しても、動きが最初から始まるように
        element.classList.add(className);
        element.addEventListener('animationend', () => element.classList.remove(className), { once: true });
    }

    pokemonElement(pokemonId) {
        return pokemonId ? document.querySelector(`#game-screen .slot [data-pokemon="${pokemonId}"]`) : null;
    }

    // #fx に要素を足す。動きが終わったら消す（裏のタブなどで animationend が来なくても、時間で必ず消す）
    add(className, html) {
        const element = document.createElement('div');
        element.className = `fx ${className}`;
        element.innerHTML = html;
        this.layer.append(element);
        element.addEventListener('animationend', () => element.remove(), { once: true });
        setTimeout(() => element.remove(), 2000);
        return element;
    }
}
