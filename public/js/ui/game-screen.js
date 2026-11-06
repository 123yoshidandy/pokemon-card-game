/**
 * 対戦画面：ビューから盤面・手札・ログを描き、タップを操作（command）に変える
 * コントローラーは getView() と send(command) だけを持てばよい（CPU 対戦・オンライン対戦で共通）
 */

import { getCard } from '../card-data.js';
import { cardFace, cardBack, pokemonTile } from './card-view.js';
import { bindPress } from './press.js';
import { showPrompt, showDetail, showPile, showResult, showConfirm, showLog, closeOnBackdrop, escapeHtml } from './sheets.js';
import { BENCH_SIZE } from '../game.js';
import Animator from './animator.js';
import { cardOrder } from '../deck-builder.js';
import { playEffect } from '../sound.js';

const $ = id => document.getElementById(id);
const PRIZE_SLOTS = 6;


// 場のポケモンを選ぶ選択のうち、タップ1回では決まらないもの（2匹以上・選ばなくてもよい）
const multiPick = prompt => prompt.type === 'pokemon' && (prompt.max > 1 || prompt.min === 0);

export default class GameScreen {
    // handlers：resultButtons(view) → [{ label, primary, onClick }]（決着のダイアログのボタン）、resultNote(view)
    constructor(handlers) {
        this.handlers = handlers;
        this.controller = null;
        this.view = null;
        this.mode = null; // 手札のカードのつけ先・にげる先を選んでいる間 { kind, uid?, targets }
        this.picked = { promptId: null, ids: new Set() }; // 場のポケモンを何匹か選ぶ選択で、選んだもの
        this.promptPeeking = false;
        this.shownPromptId = null;
        this.resultShown = false;
        this.errorTimer = null;
        this.animator = new Animator($('fx'));
        this.bind();
    }

    start(controller) {
        this.controller = controller;
        this.mode = null;
        this.promptPeeking = false;
        this.shownPromptId = null;
        this.resultShown = false;
        this.resultPeeking = false;
        this.lastDamages = null;
        this.lastTurnKey = null;
        this.animator.reset();
        this.closeDialogs();
        this.render();
    }

    stop() {
        this.controller?.stop();
        this.controller = null;
        this.closeDialogs();
    }

    closeDialogs() {
        ['prompt', 'detail', 'pile', 'result'].forEach(id => $(id).open && $(id).close());
    }

    send(command) {
        // オンラインで返事を待っている間は、二重に送らない（降参だけは待たずに送る。ほかは知らせる）
        if (this.controller?.awaitingResponse && command.type !== 'concede') {
            this.showError('少し待ってください');
            return;
        }
        this.mode = null;
        this.controller?.send(command);
        this.render();
    }

    showError(message) {
        // 答えが断られたら、同じ選択をもう一度出せるようにする
        this.answeredPromptId = null;
        $('status').textContent = message;
        $('status').classList.add('status-error');
        clearTimeout(this.errorTimer);
        this.errorTimer = setTimeout(() => this.render(), 1800);
    }

    // ===== 入力 =====

    // ワザが使えるのに、またはエネルギーをつけられるのに番を終えようとしたときだけ、確かめる（押しまちがいで番を失わないように）
    confirmEndTurn() {
        const view = this.view;
        const legal = view?.legal;
        const me = view?.players[view.viewerId];
        const canAttack = legal?.attacks?.some(Boolean);
        const canAttach = (me?.hand ?? []).some(inst => legal?.hand[inst.uid] && getCard(inst.id).kind === 'energy');
        if (!canAttack && !canAttach) return this.send({ type: 'endTurn' });
        showConfirm($('confirm'), {
            title: canAttack ? 'ワザを使わずに番を終えますか？' : 'エネルギーをつけずに番を終えますか？',
            yesLabel: '番を終える',
            onYes: () => this.send({ type: 'endTurn' })
        });
    }

    bind() {
        ['detail', 'pile'].forEach(id => closeOnBackdrop($(id)));
        const screen = $('game-screen');
        bindPress(screen, '[data-uid], [data-pokemon]', {
            onTap: element => (element.dataset.uid ? this.tapHand(element.dataset.uid) : this.tapPokemon(element.dataset.pokemon)),
            onLongPress: element => (element.dataset.uid ? this.openHandDetail(element.dataset.uid) : this.openPokemonDetail(element.dataset.pokemon))
        });
        $('end-turn').addEventListener('click', () => this.confirmEndTurn());
        // Esc や Android の「戻る」で選択・決着のダイアログが閉じたら、「盤面を見る」と同じ扱いにする（中央の帯から戻せるように）
        $('prompt').addEventListener('close', () => {
            // プログラムから閉じたとき（答えた・選択がなくなった）は、何もしない
            if (this.closingPrompt) {
                this.closingPrompt = false;
                return;
            }
            const prompt = this.myPrompt();
            if (this.shownPromptId === null || prompt?.id !== this.shownPromptId) return; // 答えた・盤面を見るで閉じたとき
            this.promptPeeking = true;
            this.shownPromptId = null;
            this.render();
        });
        $('result').addEventListener('close', () => {
            if (this.view?.phase !== 'end' || !this.controller) return;
            this.resultPeeking = true;
            this.render();
        });
        $('open-log').addEventListener('click', () => this.view && showLog($('pile'), this.view.log));
        // 中央のボタン：選択にもどる・（つけ先などを選ぶのを）やめる・結果を見る
        $('prompt-done').addEventListener('click', () => {
            const action = $('prompt-done').dataset.action;
            if (action === 'pick') {
                const prompt = this.myPrompt();
                const ids = this.picked.promptId === prompt?.id ? this.picked.ids : new Set();
                const answer = prompt.pokemon.map((pokemonId, index) => (ids.has(pokemonId) ? index : -1)).filter(index => index >= 0);
                this.picked = { promptId: null, ids: new Set() };
                this.send({ type: 'answer', answer });
                return;
            }
            if (action === 'result') {
                this.resultPeeking = false;
                $('result').showModal();
                this.render();
                return;
            }
            if (action === 'cancel') this.mode = null;
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
        ['opp-info', 'my-info', 'opp-prizes', 'my-prizes'].forEach(id => $(id).addEventListener('click', event => {
            const player = this.view.players[id.startsWith('my-') ? this.view.viewerId : 1 - this.view.viewerId];
            // オモテになったサイド（効果でオモテにしたもの。おたがいに見える）
            if (event.target.closest('[data-prizes]')) {
                showPile($('pile'), `${escapeHtml(player.name)}のオモテのサイド`, player.faceUpPrizes.map(cardId => ({ id: cardId })), cardId => this.openCardDetail(cardId));
                return;
            }
            if (!event.target.closest('[data-discard]')) return;
            // 同じカードは枚数つきでまとめ、種類の順（デッキ構築の一覧と同じ）に並べる
            const counts = new Map();
            player.discard.forEach(inst => counts.set(inst.id, (counts.get(inst.id) ?? 0) + 1));
            const cards = [...counts].sort((a, b) => cardOrder(a[0]) - cardOrder(b[0])).map(([id, count]) => ({ id, count }));
            showPile($('pile'), `${escapeHtml(player.name)}のトラッシュ`, cards, cardId => this.openCardDetail(cardId));
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
        // 手札にあるときに使える特性（このカードをベンチに出す、など）
        if (!targets && view.legal?.handAbilities?.includes(uid)) {
            this.send({ type: 'useHandAbility', uid });
            return;
        }
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
            if (index === -1) return;
            // 2匹以上選ぶ・選ばなくてもよい選択は、タップで選ぶ・外すを切り替え、中央の「決定」で答える
            if (multiPick(prompt)) {
                if (this.picked.promptId !== prompt.id) this.picked = { promptId: prompt.id, ids: new Set() };
                const ids = this.picked.ids;
                if (ids.has(id)) ids.delete(id);
                else if (ids.size < prompt.max) ids.add(id);
                this.render();
                return;
            }
            if (!this.controller?.awaitingResponse) this.controller.send({ type: 'answer', answer: [index] });
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
        // 自分の番に使えないなら、その理由を添える
        const note = !playable && !this.myPrompt() ? this.view.legal?.reasons?.hand[uid] ?? '' : '';
        showDetail($('detail'), { cardId: inst.id, actions: { play: playable }, note, onPlay: () => this.tapHand(uid) });
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
        // 自分のバトルポケモンで、使えないワザがあれば、その理由を添える（同じ理由はまとめる）
        const note = isActive && legal ? [...new Set((legal.reasons?.attacks ?? []).filter(Boolean))].join('・') : '';
        showDetail($('detail'), {
            cardId: pokemon.top,
            pokemon,
            note,
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
        if (!view) return;
        this.view = view;
        this.animator.capture(view); // 描き直す前の場の位置（きぜつの演出に使う）
        const me = view.players[view.viewerId];
        const opp = view.players[1 - view.viewerId];
        const prompt = this.myPrompt();
        const highlight = new Set(prompt?.type === 'pokemon' ? prompt.pokemon : this.mode?.targets ?? []);

        $('opp-side').innerHTML = this.sideHtml(opp, highlight);
        $('my-side').innerHTML = this.sideHtml(me, highlight, view.current === view.viewerId && !prompt ? view.legal : null);
        const playing = view.phase !== 'setup' && view.phase !== 'deck' && !view.winner;
        $('my-side').classList.toggle('on-turn', playing && view.current === view.viewerId);
        $('opp-side').classList.toggle('on-turn', playing && view.current !== view.viewerId);
        this.showDamageChanges(view);
        this.animator.play(view);
        // 自分の番が来たら、控えめに知らせる
        const turnKey = playing && view.current === view.viewerId ? view.turn : null;
        if (turnKey !== null && this.lastTurnKey !== null && turnKey !== this.lastTurnKey) playEffect('turn');
        if (playing) this.lastTurnKey = turnKey ?? this.lastTurnKey ?? 0;
        $('opp-info').innerHTML = this.infoHtml(opp);
        $('my-info').innerHTML = this.infoHtml(me);
        $('opp-prizes').innerHTML = this.prizesHtml(opp);
        $('my-prizes').innerHTML = this.prizesHtml(me);
        // スタジアムは、どちらが出したかを名前の前に小さく添える
        $('stadium').innerHTML = view.stadium ? `<span class="stadium-chip ${view.legal?.stadium ? 'playable' : ''}"><small>${view.stadium.owner === view.viewerId ? 'あなた' : '相手'}</small>${getCard(view.stadium.id).name}</span>` : '';
        $('status').classList.remove('status-error');
        $('status').textContent = this.statusText(view, prompt);
        // 同じカードは1枚に重ねて、枚数を出す（手札が多くても横に流れすぎないように）。タップすると、そのうちの1枚を使う
        const groups = new Map();
        for (const inst of me.hand ?? []) {
            if (!groups.has(inst.id)) groups.set(inst.id, []);
            groups.get(inst.id).push(inst.uid);
        }
        // 種類の順（ポケモン → トレーナーズ → エネルギー。デッキ構築の一覧と同じ順）に並べる
        $('hand').innerHTML = [...groups].sort((a, b) => cardOrder(a[0]) - cardOrder(b[0])).map(([id, uids]) => {
            const uid = uids.find(item => item === this.mode?.uid) ?? uids.find(item => view.legal?.hand[item]) ?? uids[0];
            const playable = view.legal?.hand[uid] && !prompt;
            const selected = this.mode?.uid === uid;
            const count = uids.length > 1 ? `<span class="hand-count">×${uids.length}</span>` : '';
            return `<div class="hand-card ${playable ? 'playable' : ''} ${selected ? 'selected' : ''}" data-uid="${uid}">${cardFace(id)}${count}</div>`;
        }).join('');
        $('end-turn').disabled = !view.legal?.endTurn || Boolean(prompt);
        const log = $('log');
        log.innerHTML = view.log.slice(-40).map(text => `<li class="${text.startsWith('—') ? 'log-turn' : ''}">${escapeHtml(text)}</li>`).join('');
        log.scrollTop = log.scrollHeight;

        // 選択のダイアログ（場のポケモンを選ぶときは盤面を光らせ、ダイアログは出さない）
        const promptDone = $('prompt-done');
        const pickedIds = prompt && multiPick(prompt) && this.picked.promptId === prompt.id ? this.picked.ids : new Set();
        const midAction = prompt && multiPick(prompt) ? 'pick'
            : prompt && prompt.type !== 'pokemon' && this.promptPeeking ? 'prompt'
            : this.mode ? 'cancel'
            : view.phase === 'end' && this.resultPeeking ? 'result' : '';
        promptDone.hidden = !midAction;
        promptDone.dataset.action = midAction;
        promptDone.textContent = { prompt: '選択にもどる', cancel: 'やめる', result: '結果を見る', pick: `決定（${pickedIds.size}/${prompt?.max}）` }[midAction] ?? '';
        promptDone.disabled = midAction === 'pick' && (pickedIds.size < prompt.min || pickedIds.size > prompt.max);
        document.querySelectorAll('#game-screen .slot').forEach(slot => slot.classList.toggle('picked', pickedIds.has(slot.querySelector('[data-pokemon]')?.dataset.pokemon)));
        if (prompt && prompt.type !== 'pokemon') {
            // 答えた選択と、オンラインで返事を待つあいだは、出し直さない（古い選択が残って、次の選択に答えが使われないように）
            if (!this.promptPeeking && this.shownPromptId !== prompt.id && prompt.id !== this.answeredPromptId && !this.controller?.awaitingResponse) {
                this.shownPromptId = prompt.id;
                showPrompt($('prompt'), prompt, {
                    onAnswer: answer => {
                        this.closingPrompt = true;
                        $('prompt').close();
                        this.shownPromptId = null;
                        // 開いている選択が、今の選択と同じときだけ答える
                        if (this.myPrompt()?.id === prompt.id && !this.controller?.awaitingResponse) {
                            this.answeredPromptId = prompt.id;
                            if (this.controller.send({ type: 'answer', answer }) === false) this.answeredPromptId = null;
                        }
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
            if ($('prompt').open) {
                this.closingPrompt = true;
                $('prompt').close();
            }
            this.shownPromptId = null;
        }

        if (view.phase !== 'end' && this.resultShown) {
            this.resultShown = false;
            this.resultPeeking = false;
            if ($('result').open) $('result').close();
        }
        if (view.phase === 'end' && !this.resultShown) {
            this.resultShown = true;
            const won = view.winner === view.viewerId;
            this.handlers.onEnd?.(view);
            if (view.winner !== 'draw') playEffect(won ? 'win' : 'lose');
            showResult($('result'), {
                title: view.winner === 'draw' ? '引き分け' : won ? '勝ち' : '負け',
                // 取ったサイドの数とターン数を添える（例「サイド 6-2 ・ 16ターン」）
                message: this.endMessage(view, won) + (view.turn > 0
                    ? `<br><span class="result-score">サイド ${6 - view.players[view.viewerId].prizeCount}-${6 - view.players[1 - view.viewerId].prizeCount} ・ ${view.turn}ターン</span>`
                    : ''), // 準備の途中で決着したときは、サイドがまだないので出さない
                note: this.handlers.resultNote?.(view) ?? '',
                buttons: this.handlers.resultButtons(view),
                onPeek: () => {
                    this.resultPeeking = true;
                    this.render();
                },
                onLog: () => showLog($('pile'), view.log)
            });
        }
    }

    endMessage(view, won) {
        const opp = { name: escapeHtml(view.players[1 - view.viewerId].name) };
        switch (view.endReason) {
            case 'prizes': return won ? 'サイドをすべて取った' : `${opp.name}がサイドをすべて取った`;
            case 'nopokemon': return won ? `${opp.name}の場のポケモンがいなくなった` : '場のポケモンがいなくなった';
            case 'deckout': return won ? `${opp.name}の山札がなくなった` : '山札がなくなった';
            case 'concede': return won ? `${opp.name}が降参した` : '降参した';
            case 'effect': return won ? 'カードの効果で勝った' : `${opp.name}がカードの効果で勝った`;
            default: return '両者が同時に勝利条件を満たした';
        }
    }

    statusText(view, prompt) {
        if (view.phase === 'end') return '';
        if (view.phase === 'deck') return view.decksSubmitted[view.viewerId] ? `${view.players[1 - view.viewerId].name}がデッキを選んでいます` : '';
        if (prompt?.type === 'pokemon') return prompt.title;
        if (this.mode?.kind === 'retreat') return 'にげる先のポケモンを選ぶ';
        if (this.mode) return 'つけるポケモンを選ぶ';
        // 相手の番は、いま何をしたかを、ログの最新の1行で見せる
        if (view.phase === 'main' && view.current !== view.viewerId) {
            const last = [...view.log].reverse().find(text => !text.startsWith('—'));
            if (last) return last;
        }
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
        // ベンチの数は、スタジアムなどで増えることがある（8匹まで）
        const slots = Math.max(BENCH_SIZE, player.benchLimit ?? BENCH_SIZE, player.bench.length);
        const bench = Array.from({ length: slots }, (_, index) => {
            const pokemon = player.bench[index];
            return pokemon ? tile(pokemon, false) : '<div class="slot slot-bench slot-empty"></div>';
        }).join('');
        return `${active}<div class="bench ${slots > BENCH_SIZE ? 'bench-wide' : ''}" style="--bench-slots:${slots}">${bench}</div>`;
    }

    // ダメージが増えた・減ったポケモンの上に、数字を短く浮かべる（相手の番に何が起きたかを見えるように）
    showDamageChanges(view) {
        const damages = new Map();
        for (const player of view.players) {
            for (const pokemon of [player.active, ...player.bench]) if (pokemon) damages.set(pokemon.id, pokemon.damage);
        }
        for (const [id, damage] of damages) {
            const diff = damage - (this.lastDamages?.get(id) ?? damage);
            const slot = diff && document.querySelector(`#game-screen [data-pokemon="${id}"]`)?.closest('.slot');
            if (!slot) continue;
            const float = document.createElement('span');
            float.className = `damage-float ${diff > 0 ? 'hurt' : 'heal'}`;
            float.textContent = `${diff > 0 ? '−' : '+'}${Math.abs(diff)}`;
            float.addEventListener('animationend', () => float.remove());
            slot.append(float);
        }
        this.lastDamages = damages;
    }

    infoHtml(player) {
        // オンラインで接続が切れているプレイヤーは、名前の横に「切断中」
        const offline = this.disconnected?.has(player.id) ? '<span class="info-offline">切断中</span>' : '';
        // 山札・トラッシュは、小さなカードの山で描く（山札は裏、トラッシュはいちばん上のカード）
        const pile = (kind, label, card, count, { attr = '', countClass = '' } = {}) => {
            const tag = attr ? 'button' : 'div';
            return `<${tag} ${attr ? 'type="button"' : ''} class="pile pile-${kind} ${attr ? 'pile-button' : ''}" ${attr}>
                <span class="pile-card ${count ? '' : 'pile-empty'}">${count ? card : ''}</span>
                <span class="pile-count ${countClass}">${count}</span><span class="pile-label">${label}</span></${tag}>`;
        };
        const top = player.discard.at(-1);
        // 1対1なので、名前（あなた・CPU など）は出さない。上下の位置で、どちらの山かは分かる
        return `<div class="info-name"><span class="info-hand">手札 ${player.handCount}</span>${offline}</div>
            <div class="piles">
                ${pile('deck', '山札', cardBack(), player.deckCount, { countClass: player.deckCount <= 5 ? 'deck-low' : '' })}
                ${pile('discard', 'トラッシュ', top ? cardFace(top.id) : '', player.discard.length, { attr: 'data-discard' })}
            </div>`;
    }

    // サイド：左の列に、6枚の置き場を2列×3段で並べ、残っている分だけ裏のカードを置く
    // 効果でオモテになったサイドがあれば、押すとその中身を見られる（金色の点で知らせる）
    prizesHtml(player) {
        const faceUp = player.faceUpPrizes?.length > 0;
        const cards = Array.from({ length: Math.max(PRIZE_SLOTS, player.prizeCount) }, (_, index) => (index < player.prizeCount
            ? `<span class="prize-card">${cardBack()}</span>`
            : '<span class="prize-card prize-taken"></span>')).join('');
        const tag = faceUp ? 'button' : 'div';
        return `<${tag} ${faceUp ? 'type="button" data-prizes' : ''} class="prize-grid ${faceUp ? 'has-faceup' : ''}">${cards}</${tag}>
            <span class="prize-label">サイド <b>${player.prizeCount}</b></span>`;
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
