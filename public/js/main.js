/**
 * 起動と画面の切り替え（scene：title / game）
 */

import { DECKS, expandDeck } from './decks.js';
import LocalGameController from './game-controller.js';
import GameScreen from './ui/game-screen.js';
import { cardFace } from './ui/card-view.js';
import { closeOnBackdrop } from './ui/sheets.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'pokemon-card-game:settings';

const settings = loadSettings();
let scene = 'title';

const screen = new GameScreen({
    onHome: () => showTitle(),
    onRematch: () => startCpuGame()
});

function loadSettings() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return { deckId: DECKS.some(deck => deck.id === saved.deckId) ? saved.deckId : DECKS[0].id };
    } catch {
        return { deckId: DECKS[0].id };
    }
}

function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // 保存できない環境でも遊べるようにする
    }
}

function setScene(next) {
    scene = next;
    $('title-screen').hidden = scene !== 'title';
    $('game-screen').hidden = scene !== 'game';
}

function showTitle() {
    screen.stop();
    renderTitle();
    setScene('title');
}

function renderTitle() {
    $('deck-select').innerHTML = DECKS.map(deck =>
        `<button type="button" class="segment-item ${deck.id === settings.deckId ? 'active' : ''}" data-deck="${deck.id}">${deck.name}</button>`).join('');
    $('title-art').innerHTML = ['charizard-ex', 'professors-research', 'miraidon-ex']
        .map((id, index) => `<div class="fan fan-${index}">${cardFace(id)}</div>`).join('');
}

function startCpuGame() {
    const mine = DECKS.find(deck => deck.id === settings.deckId);
    const cpu = DECKS.find(deck => deck.id !== mine.id) ?? mine;
    screen.stop();
    const controller = new LocalGameController(
        { name: 'あなた', decks: [expandDeck(mine), expandDeck(cpu)] },
        { onUpdate: () => screen.render(), onError: message => screen.showError(message) }
    );
    setScene('game');
    screen.start(controller);
}

$('deck-select').addEventListener('click', event => {
    const button = event.target.closest('[data-deck]');
    if (!button) return;
    settings.deckId = button.dataset.deck;
    saveSettings();
    renderTitle();
});
$('start-cpu').addEventListener('click', startCpuGame);
$('go-home').addEventListener('click', showTitle);
['open-rules', 'open-rules-game'].forEach(id => $(id).addEventListener('click', () => $('rules').showModal()));
closeOnBackdrop($('rules'));
document.addEventListener('contextmenu', event => {
    if (!event.target.closest('input, textarea')) event.preventDefault();
});

renderTitle();
setScene('title');

// 確認用：画面の外からゲームを触れるようにする
window.__app = { get scene() { return scene; }, screen, startCpuGame };
