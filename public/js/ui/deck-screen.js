/**
 * デッキ構築の画面：デッキの一覧と、デッキの編集
 * 編集はその場で保存する（保存ボタンも、戻るときの確認もない）
 */

import { getCard, TYPE_NAMES } from '../card-data.js';
import { DECK_SIZE } from '../deck-rules.js';
import { CARD_POOL, addCard, removeCard, canAdd, totalCount, deckProblem, sortedEntries } from '../deck-builder.js';
import { cardFace, energyDot } from './card-view.js';
import { bindPress } from './press.js';
import { showDetail, showConfirm } from './sheets.js';

const $ = id => document.getElementById(id);

const KIND_TABS = [
    { kind: 'pokemon', label: 'ポケモン' },
    { kind: 'trainer', label: 'トレーナーズ' },
    { kind: 'energy', label: 'エネルギー' }
];

// 一度に並べるカードの数（多すぎると、スマホで描き直しが重い）
const POOL_LIMIT = 200;
const TYPE_ORDER = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal', 'dragon', 'colorless'];

// 種類ごとの小さなタブ（しぼりこみ）。test はカードが入るか
const SUB_TABS = {
    pokemon: [
        { id: 'all', label: 'すべて', test: () => true },
        ...TYPE_ORDER.map(type => ({ id: type, label: TYPE_NAMES[type], icon: type, test: card => card.type === type }))
    ],
    trainer: [
        { id: 'all', label: 'すべて', test: () => true },
        { id: 'supporter', label: 'サポート', test: card => card.trainerType === 'supporter' },
        { id: 'item', label: 'グッズ', test: card => card.trainerType === 'item' },
        { id: 'tool', label: 'どうぐ', test: card => card.trainerType === 'tool' },
        { id: 'stadium', label: 'スタジアム', test: card => card.trainerType === 'stadium' }
    ],
    energy: [
        { id: 'all', label: 'すべて', test: () => true },
        { id: 'basic', label: '基本エネルギー', test: card => Boolean(card.basic) },
        { id: 'special', label: '特殊エネルギー', test: card => !card.basic }
    ]
};

function escape(text) {
    return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// 検索のために、ひらがなをカタカナに、全角・半角をそろえる
function searchKey(text) {
    return String(text).normalize('NFKC').toLowerCase().replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

export default class DeckScreens {
    // store：createDeckStore() / handlers：show(scene) / onDeleted(deckId) / onBack()
    constructor(store, handlers) {
        this.store = store;
        this.handlers = handlers;
        this.deck = null;
        this.kind = 'pokemon';
        this.query = '';
        this.sub = 'all'; // 種類の中の小さなタブ（SUB_TABS の id）
        this.bind();
    }

    bind() {
        $('decks-back').addEventListener('click', () => this.handlers.onBack());
        $('new-deck').addEventListener('click', () => this.openEditor(this.store.create().id));
        $('deck-list').addEventListener('click', event => {
            const edit = event.target.closest('[data-edit]');
            const copy = event.target.closest('[data-copy]');
            if (edit) this.openEditor(edit.dataset.edit);
            if (copy) this.openEditor(this.store.create(this.store.find(copy.dataset.copy)).id);
        });

        $('editor-back').addEventListener('click', () => this.showList());
        $('deck-name').addEventListener('input', () => {
            this.deck = this.store.save({ ...this.deck, name: $('deck-name').value });
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
            this.sub = 'all';
            this.renderEditor();
            $('pool').scrollTop = 0;
            $('pool-subtabs').scrollLeft = 0;
        });
        $('pool-subtabs').addEventListener('click', event => {
            const tab = event.target.closest('[data-sub]');
            if (!tab) return;
            this.sub = tab.dataset.sub;
            this.renderEditor();
            $('pool').scrollTop = 0;
        });
        $('pool-search').addEventListener('input', () => {
            this.query = searchKey($('pool-search').value.trim());
            this.renderEditor();
            $('pool').scrollTop = 0;
        });
        bindPress($('pool'), '[data-card]', {
            onTap: element => this.change(addCard(this.deck, element.dataset.card)),
            onLongPress: element => showDetail($('detail'), { cardId: element.dataset.card })
        });
        bindPress($('deck-cards'), '[data-row]', {
            onTap: element => showDetail($('detail'), { cardId: element.dataset.row }),
            onLongPress: element => showDetail($('detail'), { cardId: element.dataset.row })
        });
        $('deck-cards').addEventListener('click', event => {
            const minus = event.target.closest('[data-minus]');
            const plus = event.target.closest('[data-plus]');
            if (minus) this.change(removeCard(this.deck, minus.dataset.minus));
            if (plus) this.change(addCard(this.deck, plus.dataset.plus));
        });
    }

    // ===== 一覧 =====

    showList() {
        this.deck = null;
        const row = deck => {
            const total = totalCount(deck);
            const problem = deckProblem(deck);
            const button = deck.builtIn
                ? `<button type="button" class="btn btn-secondary btn-small" data-copy="${deck.id}">コピーして編集</button>`
                : `<button type="button" class="btn btn-primary btn-small" data-edit="${deck.id}">編集</button>`;
            return `<li class="deck-row">
                <span class="deck-row-name">${escape(deck.name)}</span>
                ${deck.builtIn ? '<span class="badge">構築済み</span>' : ''}
                <span class="deck-row-count ${problem ? 'incomplete' : ''}">${total}/${DECK_SIZE}</span>
                ${button}
            </li>`;
        };
        const custom = this.store.custom();
        const builtIn = this.store.all().filter(deck => deck.builtIn);
        $('deck-list').innerHTML = `${custom.map(row).join('')}${builtIn.map(row).join('')}`;
        this.handlers.show('decks');
    }

    // ===== 編集 =====

    openEditor(deckId) {
        this.deck = this.store.find(deckId);
        if (!this.deck) return this.showList();
        $('deck-name').value = this.deck.name;
        this.handlers.show('editor');
        this.renderEditor();
        $('pool').scrollTop = 0;
    }

    change(next) {
        if (next === this.deck) return; // 足せない・減らせないときは何もしない
        this.deck = this.store.save(next);
        this.renderEditor();
    }

    renderEditor() {
        const deck = this.deck;
        const total = totalCount(deck);
        const problem = deckProblem(deck);
        $('deck-count').textContent = `${total}/${DECK_SIZE}`;
        $('deck-count').classList.toggle('incomplete', Boolean(problem));
        $('deck-problem').textContent = problem && total === DECK_SIZE ? problem : '';

        $('pool-tabs').innerHTML = KIND_TABS.map(tab =>
            `<button type="button" class="segment-item ${tab.kind === this.kind ? 'active' : ''}" data-kind="${tab.kind}">${tab.label}</button>`).join('');
        const subTabs = SUB_TABS[this.kind];
        const sub = subTabs.find(tab => tab.id === this.sub) ?? subTabs[0];
        $('pool-subtabs').innerHTML = subTabs.map(tab => `<button type="button" class="subtab ${tab.id === sub.id ? 'active' : ''}" data-sub="${tab.id}" role="tab" aria-selected="${tab.id === sub.id}">${tab.icon ? energyDot(tab.icon) : ''}${tab.label}</button>`).join('');
        const matches = CARD_POOL.filter(id => {
            const card = getCard(id);
            if (card.kind !== this.kind || !sub.test(card)) return false;
            return !this.query || searchKey(card.name).includes(this.query);
        });
        const shown = matches.slice(0, POOL_LIMIT);
        const note = matches.length === 0
            ? '<p class="pool-note">見つかりませんでした</p>'
            : matches.length > shown.length ? `<p class="pool-note">${matches.length}種類のうち${shown.length}種類を表示しています。名前や種類でしぼってください</p>` : '';
        $('pool').innerHTML = shown.map(id => {
            const count = deck.cards[id] ?? 0;
            return `<div class="pool-card ${canAdd(deck, id) ? '' : 'maxed'}" data-card="${id}">${cardFace(id)}${count ? `<span class="pool-count">${count}</span>` : ''}</div>`;
        }).join('') + note;

        const entries = sortedEntries(deck);
        // 同じ名前の別の版を見分けられるように、ポケモンは HP と版の番号も出す
        const subText = card => (card.kind === 'pokemon' ? `HP${card.hp} ${card.prints?.[0] ?? ''}` : '');
        $('deck-cards').innerHTML = entries.length
            ? entries.map(([id, count]) => `<li class="deck-card-row">
                <span class="deck-card-name" data-row="${id}">${escape(getCard(id).name)}<span class="deck-card-sub">${escape(subText(getCard(id)))}</span></span>
                <button type="button" class="step-btn" data-minus="${id}" aria-label="減らす">−</button>
                <span class="deck-card-count">${count}</span>
                <button type="button" class="step-btn" data-plus="${id}" aria-label="増やす" ${canAdd(deck, id) ? '' : 'disabled'}>＋</button>
            </li>`).join('')
            : '<li class="deck-empty">左のカードをタップすると、デッキに入ります。長押しで説明が出ます。</li>';
    }
}
