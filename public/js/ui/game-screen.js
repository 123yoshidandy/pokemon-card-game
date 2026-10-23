/**
 * 対戦画面：ビューから盤面・手札・ログを描き、タップを操作（command）に変える
 * コントローラーは getView() と send(command) だけを持てばよい（CPU 対戦・オンライン対戦で共通）
 */

import { getCard } from '../card-data.js';
import { cardFace, pokemonTile } from './card-view.js';
import { bindPress } from './press.js';
import { showPrompt, showDetail, showPile, showResult, closeOnBackdrop } from './sheets.js';
import { BENCH_SIZE } from '../game.js';

const $ = id => document.getElementById(id);


export default class GameScreen {
    // handlers：onHome() / onRematch()
    constructor(handlers) {
        this.handlers = handlers;
        this.controller = null;
        this.view = null;
        this.mode = null; // 手札のカードのつけ先・にげる先を選んでいる間 { kind, uid?, targets }
        this.promptPeeking = false;
        this.shownPromptId = null;
        this.resultShown = false;
        this.errorTimer = null;
        this.bind();
    }

    start(controller) {
        this.controller = controller;
        this.mode = null;
        this.promptPeeking = false;
        this.shownPromptId = null;
        this.resultShown = false;
        ['prompt', 'detail', 'pile', 'result'].forEach(id => $(id).open && $(id).close());
        this.render();
    }

    stop() {
        this.controller?.stop();
        this.controller = null;
    }

    send(command) {
        this.mode = null;
        this.controller?.send(command);
        this.render();
    }

    showError(message) {
        $('status').textContent = message;
        $('status').classList.add('status-error');
        clearTimeout(this.errorTimer);
        this.errorTimer = setTimeout(() => this.render(), 1800);
    }

    // ===== 入力 =====

    bind() {
        ['detail', 'pile'].forEach(id => closeOnBackdrop($(id)));
        const screen = $('game-screen');
        bindPress(screen, '[data-uid], [data-pokemon]', {
            onTap: element => (element.dataset.uid ? this.tapHand(element.dataset.uid) : this.tapPokemon(element.dataset.pokemon)),
            onLongPress: element => (element.dataset.uid ? this.openHandDetail(element.dataset.uid) : this.openPokemonDetail(element.dataset.pokemon))
        });
        $('end-turn').addEventListener('click', () => this.send({ type: 'endTurn' }));
        $('prompt-done').addEventListener('click', () => {
            this.promptPeeking = false;
            this.shownPromptId = null;
            this.render();
        });
        $('stadium').addEventListener('click', () => {
            const view = this.view;
            if (!view?.stadium) return;
            showDetail($('detail'), {
                cardId: view.stadium.id,
                actions: { play: view.legal?.stadium },
                onPlay: () => this.send({ type: 'useStadium' })
            });
        });
        ['opp-info', 'my-info'].forEach(id => $(id).addEventListener('click', event => {
            if (!event.target.closest('[data-discard]')) return;
            const player = this.view.players[id === 'my-info' ? this.view.viewerId : 1 - this.view.viewerId];
            showPile($('pile'), `${player.name}のトラッシュ`, player.discard, cardId => this.openCardDetail(cardId));
        }));
        // 選択の外をタップしたら、つけ先の選択をやめる
        screen.addEventListener('click', event => {
            if (!this.mode || event.target.closest('[data-uid], [data-pokemon], button')) return;
            this.mode = null;
            this.render();
        });
    }

    tapHand(uid) {
        const view = this.view;
        if (!view || this.myPrompt()) return;
        if (this.mode?.uid === uid) {
            this.mode = null;
            this.render();
            return;
        }
        const targets = view.legal?.hand[uid];
        if (!targets) {
            this.openHandDetail(uid);
            return;
        }
        const card = getCard(this.handCard(uid).id);
        const type = card.kind === 'energy' ? 'attachEnergy' : card.kind === 'pokemon' ? (card.stage === 0 ? 'playBasic' : 'evolve') : 'playTrainer';
        if (targets.length === 0) {
            this.send({ type, uid });
        } else if (targets.length === 1) {
            this.send({ type, uid, target: targets[0] });
        } else {
            this.mode = { kind: 'target', type, uid, targets };
            this.render();
        }
    }

    tapPokemon(id) {
        const view = this.view;
        if (!view) return;
        const prompt = this.myPrompt();
        if (prompt?.type === 'pokemon') {
            const index = prompt.pokemon.indexOf(id);
            if (index !== -1) this.controller.send({ type: 'answer', answer: [index] });
            this.render();
            return;
        }
        if (this.mode?.targets.includes(id)) {
            if (this.mode.kind === 'retreat') this.send({ type: 'retreat', target: id });
            else this.send({ type: this.mode.type, uid: this.mode.uid, target: id });
            return;
        }
        if (this.mode) {
            this.mode = null;
            this.render();
        }
        this.openPokemonDetail(id);
    }

    openHandDetail(uid) {
        const inst = this.handCard(uid);
        if (!inst) return;
        const playable = Boolean(this.view.legal?.hand[uid]) && !this.myPrompt();
        showDetail($('detail'), { cardId: inst.id, actions: { play: playable }, onPlay: () => this.tapHand(uid) });
    }

    openCardDetail(cardId) {
        showDetail($('detail'), { cardId });
    }

    openPokemonDetail(id) {
        const view = this.view;
        const found = this.findPokemon(id);
        if (!found || !found.pokemon.top) return;
        const { pokemon, owner } = found;
        const mine = owner.id === view.viewerId;
        const legal = mine && !this.myPrompt() ? view.legal : null;
        const isActive = owner.active?.id === id;
        showDetail($('detail'), {
            cardId: pokemon.top,
            pokemon,
            actions: {
                attacks: isActive ? legal?.attacks : null,
                retreat: isActive && legal?.retreat.length > 0,
                ability: legal?.abilities.includes(id)
            },
            onAttack: index => this.send({ type: 'attack', index }),
            onAbility: () => this.send({ type: 'useAbility', target: id }),
            onRetreat: () => {
                const targets = legal.retreat;
                if (targets.length === 1) this.send({ type: 'retreat', target: targets[0] });
                else {
                    this.mode = { kind: 'retreat', targets };
                    this.render();
                }
            }
        });
    }

    // ===== 描画 =====

    render() {
        if (!this.controller) return;
        const view = this.controller.getView();
        this.view = view;
        const me = view.players[view.viewerId];
        const opp = view.players[1 - view.viewerId];
        const prompt = this.myPrompt();
        const highlight = new Set(prompt?.type === 'pokemon' ? prompt.pokemon : this.mode?.targets ?? []);

        $('turn-info').textContent = view.phase === 'setup' ? '準備' : `${view.turn}ターン目 ・ ${view.current === view.viewerId ? 'あなたの番' : `${opp.name}の番`}`;
        $('opp-side').innerHTML = this.sideHtml(opp, highlight);
        $('my-side').innerHTML = this.sideHtml(me, highlight, view.current === view.viewerId && !prompt ? view.legal : null);
        $('opp-info').innerHTML = this.infoHtml(opp);
        $('my-info').innerHTML = this.infoHtml(me);
        $('stadium').innerHTML = view.stadium ? `<span class="stadium-chip ${view.legal?.stadium ? 'playable' : ''}">${getCard(view.stadium.id).name}</span>` : '';
        $('status').classList.remove('status-error');
        $('status').textContent = this.statusText(view, prompt);
        $('hand').innerHTML = (me.hand ?? []).map(inst => {
            const playable = view.legal?.hand[inst.uid] && !prompt;
            const selected = this.mode?.uid === inst.uid;
            return `<div class="hand-card ${playable ? 'playable' : ''} ${selected ? 'selected' : ''}" data-uid="${inst.uid}">${cardFace(inst.id)}</div>`;
        }).join('');
        $('end-turn').disabled = !view.legal?.endTurn || Boolean(prompt);
        const log = $('log');
        log.innerHTML = view.log.slice(-40).map(text => `<li class="${text.startsWith('—') ? 'log-turn' : ''}">${text}</li>`).join('');
        log.scrollTop = log.scrollHeight;

        // 選択のダイアログ（場のポケモンを選ぶときは盤面を光らせ、ダイアログは出さない）
        const promptDone = $('prompt-done');
        promptDone.hidden = !(prompt && prompt.type !== 'pokemon' && this.promptPeeking);
        promptDone.textContent = '選択にもどる';
        if (prompt && prompt.type !== 'pokemon') {
            if (!this.promptPeeking && this.shownPromptId !== prompt.id) {
                this.shownPromptId = prompt.id;
                showPrompt($('prompt'), prompt, {
                    onAnswer: answer => {
                        $('prompt').close();
                        this.shownPromptId = null;
                        this.controller.send({ type: 'answer', answer });
                        this.render();
                    },
                    onPeek: () => {
                        this.promptPeeking = true;
                        this.shownPromptId = null;
                        this.render();
                    },
                    onDetail: cardId => this.openCardDetail(cardId)
                });
            }
        } else {
            this.promptPeeking = false;
            if ($('prompt').open) $('prompt').close();
            this.shownPromptId = null;
        }

        if (view.phase === 'end' && !this.resultShown) {
            this.resultShown = true;
            const won = view.winner === view.viewerId;
            showResult($('result'), {
                title: view.winner === 'draw' ? '引き分け' : won ? '勝ち' : '負け',
                message: this.endMessage(view, won),
                onRematch: () => this.handlers.onRematch(),
                onHome: () => this.handlers.onHome()
            });
        }
    }

    endMessage(view, won) {
        const opp = view.players[1 - view.viewerId];
        switch (view.endReason) {
            case 'prizes': return won ? 'サイドをすべて取った' : `${opp.name}がサイドをすべて取った`;
            case 'nopokemon': return won ? `${opp.name}の場のポケモンがいなくなった` : '場のポケモンがいなくなった';
            case 'deckout': return won ? `${opp.name}の山札がなくなった` : '山札がなくなった';
            default: return '両者が同時に勝利条件を満たした';
        }
    }

    statusText(view, prompt) {
        if (view.phase === 'end') return '';
        if (prompt?.type === 'pokemon') return prompt.title;
        if (this.mode?.kind === 'retreat') return 'にげる先のポケモンを選ぶ';
        if (this.mode) return 'つけるポケモンを選ぶ';
        if (view.prompt?.waiting) return `${view.players[view.prompt.player].name}が選んでいます`;
        return '';
    }

    sideHtml(player, highlight, legal = null) {
        const tile = (pokemon, active) => {
            const classes = [];
            if (highlight.has(pokemon.id)) classes.push('target');
            const canAct = legal && ((active && (legal.attacks.some(Boolean) || legal.retreat.length)) || legal.abilities.includes(pokemon.id));
            if (canAct && !highlight.size) classes.push('playable');
            return `<div class="slot ${active ? 'slot-active' : 'slot-bench'} ${classes.join(' ')}">${pokemonTile(pokemon, { active })}</div>`;
        };
        const active = player.active ? tile(player.active, true) : '<div class="slot slot-active slot-empty"></div>';
        const bench = Array.from({ length: BENCH_SIZE }, (_, index) => {
            const pokemon = player.bench[index];
            return pokemon ? tile(pokemon, false) : '<div class="slot slot-bench slot-empty"></div>';
        }).join('');
        return `${active}<div class="bench">${bench}</div>`;
    }

    infoHtml(player) {
        return `<div class="info-name">${player.name}</div>
            <div class="info-row">
                <span class="info-item"><span class="info-label">サイド</span><b>${player.prizeCount}</b></span>
                <span class="info-item"><span class="info-label">山札</span><b>${player.deckCount}</b></span>
                <span class="info-item"><span class="info-label">手札</span><b>${player.handCount}</b></span>
                <button type="button" class="info-item info-button" data-discard><span class="info-label">トラッシュ</span><b>${player.discard.length}</b></button>
            </div>`;
    }

    // ===== ビューから引く =====

    myPrompt() {
        const prompt = this.view?.prompt;
        return prompt && !prompt.waiting && prompt.player === this.view.viewerId ? prompt : null;
    }

    handCard(uid) {
        return this.view?.players[this.view.viewerId].hand?.find(inst => inst.uid === uid) ?? null;
    }

    findPokemon(id) {
        for (const owner of this.view.players) {
            const pokemon = [owner.active, ...owner.bench].find(p => p?.id === id);
            if (pokemon) return { pokemon, owner };
        }
        return null;
    }
}
