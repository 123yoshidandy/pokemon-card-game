/**
 * デッキ構築の画面：デッキの一覧と、デッキの編集
 * 編集はその場で保存する（保存ボタンも、戻るときの確認もない）
 */

import { getCard } from '../card-data.js';
import { DECK_SIZE } from '../deck-rules.js';
import { CARD_POOL, addCard, removeCard, canAdd, totalCount, deckProblem, sortedEntries } from '../deck-builder.js';
import { FILTER_GROUPS, QUICK_GROUP, matchesFilters, filterCount, toggleFilter } from '../card-filter.js';
import { cardFace, energyDot } from './card-view.js';
import { bindPress } from './press.js';
import { showDetail, showConfirm, closeOnBackdrop } from './sheets.js';

const $ = id => document.getElementById(id);

const KIND_TABS = [
    { kind: 'pokemon', label: 'ポケモン' },
    { kind: 'trainer', label: 'トレーナーズ' },
    { kind: 'energy', label: 'エネルギー' }
];

// 一度に並べるカードの数（多すぎると、スマホで描き直しが重い）
const POOL_LIMIT = 200;

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
        // 詳しい条件（種類ごとに覚えておく）。上の小さなタブも、この中の QUICK_GROUP の項目を切り替える
        this.filters = { pokemon: {}, trainer: {}, energy: {} };
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
            this.renderEditor();
            $('pool').scrollTop = 0;
            $('pool-subtabs').scrollLeft = 0;
        });
        $('pool-subtabs').addEventListener('click', event => {
            const tab = event.target.closest('[data-sub]');
            if (!tab) return;
            // 「すべて」はその項目の条件を外す。ほかは、その1つだけを選ぶ
            const groupId = QUICK_GROUP[this.kind];
            this.filters[this.kind] = { ...this.filters[this.kind], [groupId]: tab.dataset.sub === 'all' ? [] : [tab.dataset.sub] };
            this.renderEditor();
            $('pool').scrollTop = 0;
        });
        $('pool-search').addEventListener('input', () => {
            this.query = searchKey($('pool-search').value.trim());
            this.renderEditor();
            $('pool').scrollTop = 0;
        });
        $('pool-filter-open').addEventListener('click', () => this.openFilter());
        closeOnBackdrop($('pool-filter'));
        $('pool-filter').addEventListener('click', event => {
            const option = event.target.closest('[data-group]');
            if (option) this.filters[this.kind] = toggleFilter(this.filters[this.kind], option.dataset.group, option.dataset.option);
            else if (event.target.closest('[data-clear]')) this.filters[this.kind] = {};
            else if (event.target.closest('[data-close]')) return $('pool-filter').close();
            else return;
            this.renderFilter();
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

    // ===== 詳しい条件 =====

    openFilter() {
        this.renderFilter();
        $('pool-filter').showModal();
    }

    renderFilter() {
        const filters = this.filters[this.kind];
        const kindLabel = KIND_TABS.find(tab => tab.kind === this.kind).label;
        const groups = FILTER_GROUPS[this.kind].map(group => `<section class="filter-group">
            <h3>${group.label}</h3>
            <div class="filter-options">${group.options.map(option => {
                const on = filters[group.id]?.includes(option.id) ?? false;
                return `<button type="button" class="subtab ${on ? 'active' : ''}" data-group="${group.id}" data-option="${option.id}" aria-pressed="${on}">${option.icon ? energyDot(option.icon) : ''}${option.label}</button>`;
            }).join('')}</div>
        </section>`).join('');
        $('pool-filter').innerHTML = `<div class="sheet-body">
                <h2>${kindLabel}の詳しい条件<span class="filter-hits">${this.matches().length}種類</span></h2>
                <p class="filter-hint">同じ項目の中は、どれかに合うカード。項目どうしは、すべてに合うカードを出します。</p>
                ${groups}
            </div>
            <div class="sheet-actions">
                <button type="button" class="btn btn-secondary" data-clear ${filterCount(this.kind, filters) ? '' : 'disabled'}>条件をクリア</button>
                <button type="button" class="btn btn-primary" data-close>閉じる</button>
            </div>`;
    }

    // 今の種類・名前・詳しい条件に合うカード
    matches() {
        const filters = this.filters[this.kind];
        return CARD_POOL.filter(id => {
            const card = getCard(id);
            if (card.kind !== this.kind || !matchesFilters(card, filters)) return false;
            return !this.query || searchKey(card.name).includes(this.query);
        });
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
        // 小さなタブ：「すべて」と、QUICK_GROUP の項目の選択肢（詳しい条件で複数選んだときは、そのすべてが光る）
        const filters = this.filters[this.kind];
        const quick = FILTER_GROUPS[this.kind].find(group => group.id === QUICK_GROUP[this.kind]);
        const chosen = filters[quick.id] ?? [];
        const subTabs = [{ id: 'all', label: 'すべて' }, ...quick.options];
        $('pool-subtabs').innerHTML = subTabs.map(tab => {
            const on = tab.id === 'all' ? chosen.length === 0 : chosen.includes(tab.id);
            return `<button type="button" class="subtab ${on ? 'active' : ''}" data-sub="${tab.id}" role="tab" aria-selected="${on}">${tab.icon ? energyDot(tab.icon) : ''}${tab.label}</button>`;
        }).join('');
        // ボタンの数は、小さなタブで見えている項目を除いた条件の数
        const active = filterCount(this.kind, filters) - chosen.length;
        $('pool-filter-open').textContent = active ? `しぼりこみ ${active}` : 'しぼりこみ';
        $('pool-filter-open').classList.toggle('active', active > 0);
        const matches = this.matches();
        const shown = matches.slice(0, POOL_LIMIT);
        const note = matches.length === 0
            ? `<p class="pool-note">見つかりませんでした${active ? '（「しぼりこみ」の条件もお確かめください）' : ''}</p>`
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
