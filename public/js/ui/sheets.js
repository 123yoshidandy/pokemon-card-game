/**
 * ダイアログ：選択（カード・選択肢・はい／いいえ）、カードの説明、カードの一覧、決着
 */

import { cardFace, cardDetail } from './card-view.js';
import { bindPress } from './press.js';

// 外側のタップで閉じる（closable なダイアログだけ）
export function closeOnBackdrop(dialog) {
    dialog.addEventListener('click', event => {
        if (event.target === dialog && dialog.dataset.closable !== 'false') dialog.close();
    });
}

function open(dialog) {
    if (!dialog.open) dialog.showModal();
}

// ===== 選択 =====

// prompt はビューの prompt。onAnswer(answer) / onPeek()（盤面を見るために一時的に閉じる） / onDetail(cardId)
export function showPrompt(dialog, prompt, { onAnswer, onPeek, onDetail }) {
    dialog.dataset.closable = 'false';
    dialog.dataset.promptId = prompt.id;
    const selected = new Set();
    const peek = '<button type="button" class="btn btn-secondary" data-peek>盤面を見る</button>';

    if (prompt.type === 'confirm') {
        dialog.innerHTML = `<div class="sheet-body"><h2 class="prompt-title">${prompt.title}</h2>${prompt.card ? `<div class="detail">${cardDetail(prompt.card)}</div>` : ''}</div>
            <div class="sheet-actions">${peek}<button type="button" class="btn btn-secondary" data-answer="no">いいえ</button><button type="button" class="btn btn-primary" data-answer="yes">はい</button></div>`;
    } else if (prompt.type === 'choose') {
        dialog.innerHTML = `<div class="sheet-body"><h2 class="prompt-title">${prompt.title}</h2>
            <div class="choose-options">${prompt.options.map((option, index) => `<button type="button" class="btn btn-primary" data-option="${index}">${option}</button>`).join('')}</div></div>
            <div class="sheet-actions">${peek}</div>`;
    } else {
        const count = prompt.min === prompt.max ? `${prompt.max}枚` : `${prompt.min ? `${prompt.min}〜` : ''}${prompt.max}枚まで`;
        dialog.innerHTML = `<div class="sheet-body"><h2 class="prompt-title">${prompt.title}<span class="prompt-count">${count}</span></h2>
            <div class="prompt-cards">${prompt.cards.map((card, index) => `<button type="button" class="pick" data-index="${index}">${cardFace(card.id)}</button>`).join('')}</div></div>
            <div class="sheet-actions">${peek}<button type="button" class="btn btn-primary" data-submit>決定</button></div>`;
    }

    const submit = dialog.querySelector('[data-submit]');
    const refresh = () => {
        dialog.querySelectorAll('.pick').forEach(button => button.classList.toggle('selected', selected.has(Number(button.dataset.index))));
        if (submit) submit.disabled = selected.size < prompt.min || selected.size > prompt.max;
    };
    refresh();

    dialog.onclick = event => {
        const target = event.target.closest('button');
        if (!target) return;
        if (target.dataset.peek !== undefined) {
            dialog.close();
            onPeek();
        } else if (target.dataset.answer) {
            onAnswer(target.dataset.answer === 'yes');
        } else if (target.dataset.option !== undefined) {
            onAnswer([Number(target.dataset.option)]);
        } else if (target.dataset.submit !== undefined) {
            onAnswer([...selected].sort((a, b) => a - b));
        }
    };

    const grid = dialog.querySelector('.prompt-cards');
    if (grid) {
        bindPress(grid, '.pick', {
            onTap: button => {
                const index = Number(button.dataset.index);
                if (selected.has(index)) selected.delete(index);
                else {
                    if (prompt.max === 1) selected.clear();
                    if (selected.size < prompt.max) selected.add(index);
                }
                refresh();
            },
            onLongPress: button => onDetail(prompt.cards[Number(button.dataset.index)].id)
        });
    }
    open(dialog);
}

// ===== カードの説明 =====
// actions：{ attacks: [使えるか...], retreat, ability, play } と、それぞれの処理 onAttack(index)・onRetreat()・onAbility()・onPlay()
export function showDetail(dialog, { cardId, pokemon = null, actions = {}, onAttack, onRetreat, onAbility, onPlay }) {
    dialog.dataset.closable = 'true';
    dialog.innerHTML = `<div class="sheet-body detail">${cardDetail(cardId, pokemon)}</div>
        <div class="sheet-actions">
            ${actions.retreat ? '<button type="button" class="btn btn-secondary" data-retreat>にげる</button>' : ''}
            ${actions.play ? '<button type="button" class="btn btn-primary" data-play>使う</button>' : ''}
            <button type="button" class="btn btn-secondary" data-close>閉じる</button>
        </div>`;
    // ワザと特性のボタンは、それぞれの説明の中に置く
    dialog.querySelectorAll('[data-attack]').forEach(block => {
        const index = Number(block.dataset.attack);
        if (actions.attacks?.[index]) block.insertAdjacentHTML('beforeend', `<button type="button" class="btn btn-primary btn-small" data-use-attack="${index}">ワザを使う</button>`);
    });
    if (actions.ability) dialog.querySelector('[data-ability]')?.insertAdjacentHTML('beforeend', '<button type="button" class="btn btn-primary btn-small" data-use-ability>特性を使う</button>');

    dialog.onclick = event => {
        const target = event.target.closest('button');
        if (!target) return;
        dialog.close();
        if (target.dataset.useAttack !== undefined) onAttack?.(Number(target.dataset.useAttack));
        else if (target.dataset.useAbility !== undefined) onAbility?.();
        else if (target.dataset.retreat !== undefined) onRetreat?.();
        else if (target.dataset.play !== undefined) onPlay?.();
    };
    open(dialog);
}

// ===== カードの一覧（トラッシュ） =====
export function showPile(dialog, title, cards, onDetail) {
    dialog.dataset.closable = 'true';
    dialog.innerHTML = `<div class="sheet-body"><h2 class="prompt-title">${title}<span class="prompt-count">${cards.length}枚</span></h2>
        <div class="prompt-cards">${cards.length ? cards.map(card => `<button type="button" class="pick" data-card="${card.id}">${cardFace(card.id)}</button>`).join('') : '<p class="empty">カードはありません</p>'}</div></div>
        <div class="sheet-actions"><button type="button" class="btn btn-secondary" data-close>閉じる</button></div>`;
    dialog.onclick = event => {
        const pick = event.target.closest('.pick');
        if (pick) onDetail(pick.dataset.card);
        else if (event.target.closest('[data-close]')) dialog.close();
    };
    open(dialog);
}

// ===== 決着 =====
// buttons：[{ label, primary, onClick }]
export function showResult(dialog, { title, message, note = '', buttons }) {
    dialog.dataset.closable = 'false';
    dialog.innerHTML = `<div class="sheet-body result-body"><h2 class="result-title">${title}</h2><p>${message}</p>${note ? `<p class="note">${note}</p>` : ''}</div>
        <div class="sheet-actions">${buttons.map((button, index) => `<button type="button" class="btn ${button.primary ? 'btn-primary' : 'btn-secondary'}" data-index="${index}">${button.label}</button>`).join('')}</div>`;
    dialog.onclick = event => {
        const target = event.target.closest('[data-index]');
        if (!target) return;
        dialog.close();
        buttons[Number(target.dataset.index)].onClick();
    };
    open(dialog);
}
