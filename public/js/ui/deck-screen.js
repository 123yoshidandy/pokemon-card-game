/**
 * デッキ構築の画面：デッキの一覧と、デッキの編集
 * 自作のデッキは、編集をその場で保存する（保存ボタンも、戻るときの確認もない）
 * 構築済みデッキは全員の共有デッキで、戻るとき（か「CPU と試す」のとき）に、変えていればサーバーに保存する
 */

import { getCard } from '../card-data.js';
import { DECK_SIZE, MAX_COPIES } from '../deck-rules.js';
import { CARD_POOL, addCard, removeCard, canAdd, totalCount, deckProblem, sortedEntries, deckToText, deckFromText, sameNameCount, cardOrder } from '../deck-builder.js';
import { FILTER_GROUPS, matchesFilters, filterCount, setFilter, filterLabel } from '../card-filter.js';
import { cardFace, energyDot } from './card-view.js';
import { bindPress } from './press.js';
import { showDetail, showConfirm, showImport, showPile } from './sheets.js';
import { fetchSharedDecks, saveSharedDeck, resetSharedDeck } from '../shared-decks.js';

const $ = id => document.getElementById(id);

const KIND_TABS = [
    { kind: 'pokemon', label: 'ポケモン' },
    { kind: 'trainer', label: 'トレーナーズ' },
    { kind: 'energy', label: 'エネルギー' }
];

// 一覧は、この数ずつ書き足す（一度に全部を並べると、スマホで重い）
const POOL_CHUNK = 120;

// 同じ名前で中身の違うカード（アゴジムシが3種類など）は、右の欄で特性か最初のワザの名前を添えて見分ける
const nameCounts = new Map();
for (const id of CARD_POOL) nameCounts.set(getCard(id).name, (nameCounts.get(getCard(id).name) ?? 0) + 1);
function hintText(card) {
    if (card.kind !== 'pokemon' || nameCounts.get(card.name) < 2) return '';
    return (card.ability ? `特性 ${card.ability.name}` : card.attacks[0]?.name) ?? '';
}

function escape(text) {
    return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// 検索のために、ひらがなをカタカナに、全角・半角をそろえる
function searchKey(text) {
    return String(text).normalize('NFKC').toLowerCase().replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

// 検索に使うカードの文（ワザ・特性・トレーナーズ・特殊エネルギー）。一度作ったら覚えておく
const TEXT_CACHE = new Map();
function cardText(id) {
    if (!TEXT_CACHE.has(id)) {
        const card = getCard(id);
        const parts = [card.text, card.ability?.name, card.ability?.text, ...(card.attacks ?? []).flatMap(attack => [attack.name, attack.text])];
        TEXT_CACHE.set(id, searchKey(parts.filter(Boolean).join(' ')));
    }
    return TEXT_CACHE.get(id);
}

export default class DeckScreens {
    // store：createDeckStore() / handlers：show(scene) / onDeleted(deckId) / onBack() / onTry(deckId) / toast(message)
    constructor(store, handlers) {
        this.store = store;
        this.handlers = handlers;
        this.deck = null;
        this.kind = 'pokemon';
        this.query = '';
        // しぼりこみの条件（種類ごとに覚えておく）
        this.filters = { pokemon: {}, trainer: {}, energy: {} };
        this.poolIds = [];
        this.poolShown = 0;
        // 一覧の終わりが近づいたら、続きを書き足す
        this.poolObserver = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) this.appendPool();
        }, { root: $('pool'), rootMargin: '0px 0px 400px 0px' });
        this.bind();
    }

    bind() {
        $('decks-back').addEventListener('click', () => this.handlers.onBack());
        $('new-deck').addEventListener('click', () => this.openEditor(this.store.create().id));
        $('import-deck').addEventListener('click', () => showImport($('confirm'), { onSubmit: text => this.importDeck(text) }));
        $('deck-export').addEventListener('click', () => this.exportDeck());
        $('deck-list').addEventListener('click', event => {
            const edit = event.target.closest('[data-edit]');
            const copy = event.target.closest('[data-copy]');
            const view = event.target.closest('[data-view]');
            if (edit) this.openEditor(edit.dataset.edit);
            // 構築済みデッキは、名前をタップすると中身を見られる（コピーしなくても）
            if (view) {
                const deck = this.store.find(view.dataset.view);
                showPile($('pile'), escape(deck.name), sortedEntries(deck).map(([id, count]) => ({ id, count })), cardId => showDetail($('detail'), { cardId }));
            }
            if (copy) {
                const deck = this.store.create(this.store.find(copy.dataset.copy));
                this.openEditor(deck.id);
                this.untouched = JSON.stringify(deck); // 何も変えずに戻ったら、コピーは残さない
            }
        });

        $('deck-try').addEventListener('click', () => {
            if (deckProblem(this.deck)) return;
            const deckId = this.deck.id;
            if (this.shared) this.leaveShared(() => this.handlers.onTry(deckId));
            else this.handlers.onTry(deckId);
        });
        $('editor-back').addEventListener('click', () => {
            if (this.shared) return this.leaveShared(() => this.showList());
            // 空のデッキと、変えずに戻ったコピーは残さない（見るだけでデッキが増えないように）
            if (totalCount(this.deck) === 0 || JSON.stringify(this.deck) === this.untouched) {
                this.store.remove(this.deck.id);
                this.handlers.onDeleted(this.deck.id);
            }
            this.showList();
        });
        $('deck-name').addEventListener('input', () => {
            const next = { ...this.deck, name: $('deck-name').value };
            this.deck = this.shared ? next : this.store.save(next);
        });
        $('deck-reset').addEventListener('click', () => {
            const deck = this.deck;
            showConfirm($('confirm'), {
                title: `「${escape(deck.name)}」を初期の内容に戻しますか？（共有デッキなので、全員のデッキが戻ります）`,
                yesLabel: '戻す',
                onYes: () => this.sendShared(() => resetSharedDeck(deck.id), '初期の内容に戻しました', () => this.showList())
            });
        });
        $('deck-delete').addEventListener('click', () => {
            const deck = this.deck;
            showConfirm($('confirm'), {
                title: `「${escape(deck.name)}」を削除しますか？`,
                yesLabel: '削除',
                onYes: () => {
                    this.store.remove(deck.id);
                    this.handlers.onDeleted(deck.id);
                    this.showList();
                }
            });
        });
        $('pool-tabs').addEventListener('click', event => {
            const tab = event.target.closest('[data-kind]');
            if (!tab) return;
            this.kind = tab.dataset.kind;
            this.renderFilters();
            this.renderEditor();
            $('pool').scrollTop = 0;
            $('pool-filters').scrollLeft = 0;
            this.updateFilterFade();
        });
        $('pool-filters').addEventListener('scroll', () => this.updateFilterFade(), { passive: true });
        window.addEventListener('resize', () => this.updateFilterFade());
        // 項目ごとのプルダウン（先頭の「すべて」は、その項目の条件を外す）
        $('pool-filters').addEventListener('change', event => {
            const select = event.target.closest('select[data-group]');
            if (!select) return;
            this.filters[this.kind] = setFilter(this.filters[this.kind], select.dataset.group, select.value);
            this.renderFilters();
            this.renderEditor();
            $('pool').scrollTop = 0;
        });
        // しぼりこみの「クリア」と、見つからないときの「しぼりこみを外す」
        const clearFilters = event => {
            if (!event.target.closest('[data-clear]')) return;
            this.filters[this.kind] = {};
            this.renderFilters();
            this.renderEditor();
            $('pool').scrollTop = 0;
        };
        $('pool-filters').addEventListener('click', clearFilters);
        $('pool').addEventListener('click', clearFilters);
        $('pool-search').addEventListener('input', () => {
            this.query = searchKey($('pool-search').value.trim());
            this.renderEditor();
            $('pool').scrollTop = 0;
        });
        bindPress($('pool'), '[data-card]', {
            onTap: element => this.change(addCard(this.deck, element.dataset.card)),
            // 長押しの説明から、そのままデッキに入れられる
            onLongPress: element => showDetail($('detail'), {
                cardId: element.dataset.card,
                actions: { play: canAdd(this.deck, element.dataset.card) },
                playLabel: 'デッキに入れる',
                onPlay: () => this.change(addCard(this.deck, element.dataset.card))
            })
        });
        bindPress($('deck-cards'), '[data-row]', {
            onTap: element => showDetail($('detail'), { cardId: element.dataset.row }),
            onLongPress: element => showDetail($('detail'), { cardId: element.dataset.row })
        });
        $('deck-cards').addEventListener('click', event => {
            if (event.target.closest('[data-sample]')) return this.sampleHand();
            const minus = event.target.closest('[data-minus]');
            const plus = event.target.closest('[data-plus]');
            if (minus) this.change(removeCard(this.deck, minus.dataset.minus));
            if (plus) this.change(addCard(this.deck, plus.dataset.plus));
        });
    }

    // 試し引き：デッキを混ぜて7枚を引き、たねポケモンの枚数を添えて見せる（最初の手札の事故を確かめる）
    sampleHand() {
        const cards = Object.entries(this.deck.cards).flatMap(([id, count]) => Array(count).fill(id));
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }
        const hand = cards.slice(0, 7).sort((a, b) => cardOrder(a) - cardOrder(b));
        const basics = hand.filter(id => getCard(id).kind === 'pokemon' && getCard(id).stage === 0).length;
        showPile($('pile'), `試し引き（たねポケモン ${basics}枚）`, hand.map(id => ({ id })), cardId => showDetail($('detail'), { cardId }));
    }

    // ===== 書き出し・取り込み =====

    // 「枚数 名前 版の番号」の文をクリップボードへ
    async exportDeck() {
        try {
            await navigator.clipboard.writeText(`${this.deck.name}\n${deckToText(this.deck)}`);
            this.handlers.toast('デッキをコピーしました');
        } catch {
            this.handlers.toast('コピーできませんでした');
        }
    }

    // 貼り付けた文からデッキを作って開く（1行めがカードでなければ、デッキの名前にする）
    importDeck(text) {
        const lines = String(text).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        const { cards, unknown } = deckFromText(lines.join('\n'));
        if (!Object.keys(cards).length) return 'カードを読めませんでした。「4 ヒトカゲ MC-083」のように1行に1種類で書いてください';
        const named = unknown[0] === lines[0] ? unknown.shift() : null;
        const deck = this.store.save({ ...this.store.create(), cards, ...(named ? { name: named } : {}) });
        this.openEditor(deck.id);
        if (unknown.length) this.handlers.toast(`読めなかった行が${unknown.length}行あります（${unknown[0]} など）`);
        return null;
    }

    // ===== 一覧 =====

    showList() {
        this.deck = null;
        this.shared = false;
        this.renderList();
        this.handlers.show('decks');
        // 共有デッキは、ほかの人が変えているかもしれないので、取り直して描き直す
        fetchSharedDecks().then(() => { if (!this.deck) this.renderList(); }, () => {});
    }

    renderList() {
        const row = deck => {
            const total = totalCount(deck);
            const problem = deckProblem(deck);
            const button = `<button type="button" class="btn btn-secondary btn-small" data-copy="${deck.id}">コピー</button><button type="button" class="btn btn-primary btn-small" data-edit="${deck.id}">編集</button>`;
            return `<li class="deck-row">
                <span class="deck-row-name" ${deck.builtIn ? `data-view="${deck.id}"` : ''}>${escape(deck.name)}${deck.builtIn ? '<span class="deck-row-view">中身</span>' : ''}</span>
                ${deck.builtIn ? '<span class="badge">共有</span>' : ''}
                <span class="deck-row-count ${problem ? 'incomplete' : ''}">${total}/${DECK_SIZE}</span>
                ${button}
            </li>`;
        };
        const custom = this.store.custom();
        const builtIn = this.store.all().filter(deck => deck.builtIn);
        $('deck-list').innerHTML = `${custom.map(row).join('')}${builtIn.map(row).join('')}`;
    }

    // ===== 編集 =====

    openEditor(deckId) {
        const found = this.store.find(deckId);
        if (!found) return this.showList();
        this.shared = this.store.all().some(deck => deck.builtIn && deck.id === deckId);
        this.deck = this.shared ? { id: found.id, name: found.name, cards: { ...found.cards } } : found;
        this.untouched = this.shared ? JSON.stringify(this.deck) : null;
        $('deck-delete').hidden = this.shared;
        $('deck-reset').hidden = !(this.shared && found.edited);
        // 別のデッキを開いたときは、種類・検索・しぼりこみを初めの状態にもどす
        this.kind = 'pokemon';
        this.query = '';
        this.filters = { pokemon: {}, trainer: {}, energy: {} };
        $('pool-search').value = '';
        $('pool-filters').scrollLeft = 0;
        $('deck-name').value = this.deck.name;
        this.handlers.show('editor');
        this.renderFilters();
        this.renderEditor();
        $('pool').scrollTop = 0;
    }

    change(next) {
        if (next === this.deck) return; // 足せない・減らせないときは何もしない
        this.deck = this.shared ? next : this.store.save(next);
        // 一覧は描き直さず、枚数の印だけを変える（スクロールの位置を保ち、長い一覧でも重くしない）
        this.renderDeck();
        this.updatePoolMarks();
    }

    // ===== 共有デッキ =====

    // 編集画面を出るとき：変えていればサーバーに保存してから then を呼ぶ（保存できなければ画面に残る）
    leaveShared(then) {
        if (JSON.stringify(this.deck) === this.untouched) return then();
        const problem = deckProblem(this.deck);
        if (problem) {
            return showConfirm($('confirm'), {
                title: `共有デッキは、遊べるデッキでないと保存できません（${escape(problem)}）。変えた内容を捨てますか？`,
                yesLabel: '捨てる',
                onYes: then
            });
        }
        this.sendShared(() => saveSharedDeck(this.deck), '共有デッキを保存しました', then);
    }

    // サーバーへの保存・初期に戻すを送る。送っている間は、ボタンを押しても何もしない
    sendShared(request, done, then) {
        if (this.sending) return;
        this.sending = true;
        request().then(() => {
            this.handlers.toast(done);
            then();
        }, error => this.handlers.toast(`サーバーに送れませんでした（${error.message}）`))
            .finally(() => { this.sending = false; });
    }

    // ===== しぼりこみ =====

    // 項目ごとのプルダウンを並べる。見えるのは自分で描いたボタンで、その上に透明な select を重ね、
    // タップすると端末の選択画面が開く。カードを足すたびには描き直さない（横のスクロールが戻らないように）
    renderFilters() {
        const filters = this.filters[this.kind];
        const selects = FILTER_GROUPS[this.kind].map(group => {
            const chosen = group.options.find(option => filters[group.id]?.includes(option.id));
            const name = group.short ?? group.label;
            const options = [`<option value="">${name}：すべて</option>`, ...group.options.map(option =>
                `<option value="${option.id}" ${option === chosen ? 'selected' : ''}>${option.label}</option>`)].join('');
            return `<label class="filter-select ${chosen ? 'active' : ''}">
                ${chosen?.icon ? energyDot(chosen.icon) : ''}<span>${filterLabel(group, filters)}</span><span class="filter-caret" aria-hidden="true">▾</span>
                <select data-group="${group.id}" aria-label="${group.label}">${options}</select>
            </label>`;
        }).join('');
        const clear = filterCount(this.kind, filters) ? '<button type="button" class="filter-clear" data-clear>クリア</button>' : '';
        $('pool-filters').innerHTML = clear + selects;
        this.updateFilterFade();
    }

    // 横に続きがある側の端を薄くして、スクロールできることを伝える（途中で切れたボタンに見えないように）
    updateFilterFade() {
        const row = $('pool-filters');
        row.classList.toggle('more-left', row.scrollLeft > 1);
        row.classList.toggle('more-right', row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
    }

    // 今の種類・しぼりこみ・検索の言葉に合うカード。言葉は名前とカードの文に当て、名前に合うものを先に並べる
    matches() {
        const filters = this.filters[this.kind];
        const ids = CARD_POOL.filter(id => getCard(id).kind === this.kind && matchesFilters(getCard(id), filters));
        if (!this.query) return ids;
        const byName = ids.filter(id => searchKey(getCard(id).name).includes(this.query));
        const named = new Set(byName);
        return [...byName, ...ids.filter(id => !named.has(id) && cardText(id).includes(this.query))];
    }

    renderEditor() {
        this.renderPool();
        this.renderDeck();
    }

    // 左のカード一覧（種類・名前・しぼりこみが変わったとき）
    renderPool() {
        $('pool-tabs').innerHTML = KIND_TABS.map(tab =>
            `<button type="button" class="segment-item ${tab.kind === this.kind ? 'active' : ''}" data-kind="${tab.kind}">${tab.label}</button>`).join('');
        this.poolIds = this.matches();
        this.poolShown = 0;
        const active = filterCount(this.kind, this.filters[this.kind]);
        $('pool').innerHTML = this.poolIds.length
            ? ''
            : `<p class="pool-note">見つかりませんでした${active ? `<button type="button" class="filter-clear pool-note-clear" data-clear>しぼりこみを外す</button>` : ''}</p>`;
        this.appendPool();
    }

    // 一覧の続きを書き足す。まだ残りがあれば、末尾に目印を置いて見張る
    appendPool() {
        const pool = $('pool');
        pool.querySelector('.pool-more')?.remove();
        this.poolObserver.disconnect();
        const next = this.poolIds.slice(this.poolShown, this.poolShown + POOL_CHUNK);
        const start = this.poolShown;
        this.poolShown += next.length;
        pool.insertAdjacentHTML('beforeend', next.map(id =>
            `<div class="pool-card" data-card="${id}">${cardFace(id)}</div>`).join(''));
        this.updatePoolMarks([...pool.querySelectorAll('.pool-card')].slice(start));
        if (this.poolShown < this.poolIds.length) {
            pool.insertAdjacentHTML('beforeend', '<div class="pool-more" aria-hidden="true"></div>');
            this.poolObserver.observe(pool.querySelector('.pool-more'));
        }
    }

    // 一覧の、デッキに入っている枚数と、もう足せないカードの印
    // elements を渡すと、そのカードだけに付ける（書き足した分だけ）
    updatePoolMarks(elements = $('pool').querySelectorAll('.pool-card')) {
        const deck = this.deck;
        const full = totalCount(deck) >= DECK_SIZE;
        for (const element of elements) {
            const id = element.dataset.card;
            const count = deck.cards[id] ?? 0;
            const maxed = !canAdd(deck, id);
            element.classList.toggle('maxed', maxed);
            // 同じ名前で4枚に達して足せないときは、理由を出す（60枚に達したときは、上の枚数でわかる）
            element.classList.toggle('name-full', maxed && !full && sameNameCount(deck, getCard(id)) >= MAX_COPIES);
            let badge = element.querySelector('.pool-count');
            if (count && !badge) {
                badge = document.createElement('span');
                badge.className = 'pool-count';
                element.append(badge);
            }
            if (badge && !count) badge.remove();
            else if (badge) badge.textContent = count;
        }
    }

    // 上の枚数と、右のデッキの欄
    renderDeck() {
        const deck = this.deck;
        const total = totalCount(deck);
        const problem = deckProblem(deck);
        $('deck-count').textContent = `${total}/${DECK_SIZE}`;
        $('deck-count').classList.toggle('incomplete', Boolean(problem));
        $('deck-problem').textContent = problem && total === DECK_SIZE ? problem : '';
        $('deck-try').disabled = Boolean(problem);

        const entries = sortedEntries(deck);
        // 同じ名前で中身の違うカードは、一覧と同じく特性かワザの名前を添えて見分ける
        const sub = card => (hintText(card) ? `<span class="deck-card-sub">${escape(hintText(card))}</span>` : '');
        // 種類の切れ目に、その種類の枚数の見出しを入れる
        const kindTotals = {};
        entries.forEach(([id, count]) => { kindTotals[getCard(id).kind] = (kindTotals[getCard(id).kind] ?? 0) + count; });
        const heading = (id, index) => {
            const kind = getCard(id).kind;
            if (index > 0 && getCard(entries[index - 1][0]).kind === kind) return '';
            return `<li class="deck-kind">${KIND_TABS.find(tab => tab.kind === kind).label}<span>${kindTotals[kind]}</span></li>`;
        };
        $('deck-cards').innerHTML = entries.length
            ? entries.map(([id, count], index) => `${heading(id, index)}<li class="deck-card-row">
                <span class="deck-card-name" data-row="${id}">${escape(getCard(id).name)}${sub(getCard(id))}</span>
                <button type="button" class="step-btn" data-minus="${id}" aria-label="減らす">−</button>
                <span class="deck-card-count">${count}</span>
                <button type="button" class="step-btn" data-plus="${id}" aria-label="増やす" ${canAdd(deck, id) ? '' : 'disabled'}>＋</button>
            </li>`).join('')
            : '<li class="deck-empty">左のカードをタップすると、デッキに入ります。長押しで説明が出ます。</li>';
        // 7枚以上あれば、最初の手札を試せる
        if (total >= 7) $('deck-cards').insertAdjacentHTML('beforeend', '<li class="deck-tools"><button type="button" class="btn btn-secondary btn-small" data-sample>試し引き</button></li>');
    }
}
