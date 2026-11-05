/**
 * 起動と画面の切り替え（scene：title / online / lobby / game / decks / editor）
 */

import { DECKS, expandDeck } from './decks.js';
import { resolveCardId } from './card-data.js';
import { createDeckStore } from './deck-store.js';
import { createDeckStats, statsText } from './deck-stats.js';
import { deckProblem, mainEnergyType } from './deck-builder.js';
import LocalGameController from './game-controller.js';
import OnlineGameController, { loadOnlineSession } from './online-controller.js';
import NetplayClient from './netplay/netplay-client.mjs';
import GameScreen from './ui/game-screen.js';
import DeckScreens from './ui/deck-screen.js';
import { cardFace } from './ui/card-view.js';
import { unlockSound, toggleSound, isSoundOn } from './sound.js';
import { closeOnBackdrop, showDeckPicker, showConfirm } from './ui/sheets.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'pokemon-card-game:settings';
const SCENES = ['title', 'online', 'lobby', 'game', 'decks', 'editor'];
const MAX_PLAYERS = 2;

const settings = loadSettings();
const deckStore = createDeckStore();
const deckStats = createDeckStats();
let scene = 'title';
let deckReturnScene = 'title'; // デッキ構築から戻る先（開始画面かロビー）
let online = null;      // オンライン対戦のコントローラー（部屋に入っている間）
let matchId = null;     // 表示している対戦
let toastTimer = null;

const screen = new GameScreen({
    resultButtons: () => (isOnlineGame()
        ? [
            { label: '部屋に戻る', onClick: () => online.backToLobby() },
            ...(online.isHost() ? [{ label: 'もう一度', primary: true, onClick: () => online.startGame() }] : [])
        ]
        : [
            { label: 'ホーム', onClick: () => showTitle() },
            { label: '再戦', primary: true, onClick: () => startCpuGame() }
        ]),
    resultNote: () => (isOnlineGame() && !online.isHost() ? 'ホストが「もう一度」を押すと再戦します' : ''),
    // 決着したら、使ったデッキの戦績を記録する
    onEnd: view => {
        if (view.viewerId === null || view.viewerId === undefined) return;
        // 同じ対戦は1回だけ数える（オンラインで決着のあとに読み直したとき、決着がもう一度届くため）
        const key = isOnlineGame() ? `online:${online?.lobby?.roomCode}:${matchId}` : `cpu:${screen.controller?.options?.seed}`;
        if (alreadyCounted(key)) return;
        deckStats.record(selectedDeck().id, view.winner === 'draw' ? 'draw' : view.winner === view.viewerId ? 'win' : 'loss');
    }
});

// 戦績を数えた対戦の印（タブを閉じるまで覚えておく）
function alreadyCounted(key) {
    try {
        const counted = JSON.parse(sessionStorage.getItem('pokemon-card-game:counted') ?? '[]');
        if (counted.includes(key)) return true;
        sessionStorage.setItem('pokemon-card-game:counted', JSON.stringify([...counted, key].slice(-50)));
    } catch {
        // 覚えられない環境では、そのまま数える
    }
    return false;
}

// ===== 設定 =====

function loadSettings() {
    const fallback = { deckId: DECKS[0].id, cpuDeckId: '', name: '' };
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return {
            deckId: typeof saved.deckId === 'string' ? saved.deckId : fallback.deckId,
            cpuDeckId: typeof saved.cpuDeckId === 'string' ? saved.cpuDeckId : '', // CPU のデッキ（空ならおまかせ）
            name: typeof saved.name === 'string' ? saved.name : ''
        };
    } catch {
        return fallback;
    }
}

function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // 保存できない環境でも遊べるようにする
    }
}

// 選んだデッキ（消した・まだ60枚にならないデッキなら、構築済みの最初のデッキ）
function selectedDeck() {
    const deck = deckStore.find(settings.deckId);
    return deck && !deckProblem(deck) ? deck : DECKS[0];
}

// CPU のデッキ（おまかせ・消した・遊べないデッキなら null）
function selectedCpuDeck() {
    const deck = settings.cpuDeckId ? deckStore.find(settings.cpuDeckId) : null;
    return deck && !deckProblem(deck) ? deck : null;
}

const deckScreens = new DeckScreens(deckStore, {
    show: next => setScene(next),
    onDeleted: deckId => {
        if (settings.cpuDeckId === deckId) settings.cpuDeckId = '';
        if (settings.deckId === deckId) settings.deckId = DECKS[0].id;
        saveSettings();
    },
    toast: message => toast(message),
    statsOf: deckId => statsText(deckStats.get(deckId)),
    // デッキ編集の「CPU と試す」：そのデッキを選んで、CPU 戦を始める
    onTry: deckId => {
        settings.deckId = deckId;
        saveSettings();
        startCpuGame();
    },
    onBack: () => {
        if (deckReturnScene === 'lobby' && online?.lobby?.status === 'lobby') {
            renderLobby(online.lobby);
            setScene('lobby');
        } else {
            showTitle();
        }
    }
});

function openDecks() {
    deckReturnScene = scene === 'lobby' ? 'lobby' : 'title';
    deckScreens.showList();
}

function deckChoices() {
    return [...deckStore.custom(), ...deckStore.all().filter(deck => deck.builtIn)].map(deck => ({ id: deck.id, name: deck.name, problem: deckProblem(deck) }));
}

// CPU のデッキを選ぶ（おまかせ：自分のデッキとタイプの違う構築済みデッキからランダム）
function openCpuDeckPicker() {
    showDeckPicker($('deck-picker'), {
        title: '相手のデッキ',
        any: 'おまかせ',
        decks: deckChoices(),
        currentId: selectedCpuDeck()?.id ?? '',
        onPick: deckId => {
            settings.cpuDeckId = deckId;
            saveSettings();
            renderDeckSelect();
        },
        onBuild: openDecks
    });
}

function openDeckPicker() {
    showDeckPicker($('deck-picker'), {
        decks: deckChoices(),
        currentId: selectedDeck().id,
        onPick: deckId => {
            settings.deckId = deckId;
            saveSettings();
            renderDeckSelect();
        },
        onBuild: openDecks
    });
}

// ===== 画面の切り替え =====

function setScene(next) {
    scene = next;
    SCENES.forEach(name => { $(`${name}-screen`).hidden = scene !== name; });
}

function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { element.hidden = true; }, 2600);
}

function renderDeckSelect() {
    const name = selectedDeck().name;
    document.querySelectorAll('[data-open-deck-picker]').forEach(button => { button.textContent = name; });
    document.querySelectorAll('[data-open-cpu-deck-picker]').forEach(button => { button.textContent = selectedCpuDeck()?.name ?? 'おまかせ'; });
}

function showTitle() {
    screen.stop();
    renderDeckSelect();
    $('title-art').innerHTML = ['SV6-120', 'M1L-092', 'SV9-061'] // ドラパルトex・メガルカリオex・Nのゾロアークex
        .map((id, index) => `<div class="fan fan-${index}">${cardFace(resolveCardId(id))}</div>`).join('');
    setScene('title');
}

// ===== CPU 対戦 =====

function startCpuGame() {
    // CPU は、選んだデッキ。おまかせなら、自分のデッキとタイプの違う構築済みデッキから、ランダムに選ぶ
    const mine = selectedDeck();
    const others = DECKS.filter(deck => deck.type !== mainEnergyType(mine));
    const cpu = selectedCpuDeck() ?? (others.length ? others[Math.floor(Math.random() * others.length)] : DECKS[0]);
    screen.stop();
    const controller = new LocalGameController(
        { name: 'あなた', decks: [expandDeck(mine), expandDeck(cpu)] },
        { onUpdate: () => screen.render(), onError: message => screen.showError(message) }
    );
    setScene('game');
    screen.start(controller);
}

// ===== オンライン対戦 =====

const isOnlineGame = () => online !== null && screen.controller === online;

function knownName() {
    return (loadOnlineSession()?.name ?? settings.name ?? '').trim();
}

function connectOnline() {
    if (online) return online;
    online = new OnlineGameController({ getDeck: () => expandDeck(selectedDeck()) }, {
        onUpdate: () => { if (isOnlineGame()) screen.render(); },
        onLobby: lobby => onLobby(lobby),
        onError: message => (scene === 'game' ? screen.showError(message) : toast(message)),
        onConnectionChange: connected => { if (!connected) toast('サーバーとの接続が切れました。つなぎ直しています…'); }
    });
    return online;
}

// invited：招待URLで開いたとき（名前と「参加する」だけにする）
function showOnlineMenu({ roomCode = '', invited = false } = {}) {
    screen.stop();
    $('online-name').value = knownName();
    $('online-screen').classList.toggle('invited', invited);
    $('online-title').textContent = invited ? `部屋 ${roomCode} に参加` : 'オンライン対戦';
    setScene('online');
    if (invited) $('online-name').focus();
}

const isInviteShown = () => scene === 'online' && $('online-screen').classList.contains('invited');

function readName() {
    const name = $('online-name').value.trim();
    if (!name) {
        toast('名前を入れてください');
        return null;
    }
    settings.name = name;
    saveSettings();
    return name;
}

async function createRoom() {
    const name = readName();
    if (!name) return;
    try {
        await connectOnline().createRoom(name);
    } catch (error) {
        toast(error.message);
    }
}

async function joinRoom() {
    const name = readName();
    if (!name) return;
    if (isInviteShown()) return joinInvitedRoom(name);
    const code = $('room-code').value.trim();
    if (!NetplayClient.isRoomCode(code)) {
        toast(`部屋番号（数字${NetplayClient.ROOM_CODE_LENGTH}桁）を入れてください`);
        return;
    }
    try {
        await connectOnline().enterRoom(code, name);
    } catch (error) {
        // サーバーに断られたときの知らせは onError が出すので、ここでは通信の失敗だけ知らせる
        if (!error.fromServer) toast(error.message);
    }
}

// 招待の部屋に入る。入れなければ（部屋がもうないなど）、いつもの入口に戻す
async function joinInvitedRoom(name) {
    try {
        await connectOnline().joinFromInvite(name);
    } catch (error) {
        if (!error.fromServer) toast(error.message);
        showOnlineMenu();
    }
}

function onLobby(lobby) {
    // 対戦中（playing）と対戦後（ended）は対戦画面。新しい対戦なら画面を作り直す
    if (lobby.status !== 'lobby') {
        if (!isOnlineGame() || lobby.matchId !== matchId) {
            matchId = lobby.matchId;
            setScene('game');
            screen.start(online);
        } else {
            setScene('game');
            screen.render();
        }
        return;
    }
    if (isOnlineGame()) screen.stop();
    renderLobby(lobby);
    setScene('lobby');
}

function renderLobby(lobby) {
    const isHost = online.isHost();
    $('lobby-code').textContent = lobby.roomCode;
    $('lobby-players').innerHTML = lobby.players.map(player => {
        const badges = [
            player.seat === lobby.hostSeat ? '<span class="badge">ホスト</span>' : '',
            player.seat === lobby.seat ? '<span class="badge">あなた</span>' : '',
            player.isCPU ? '<span class="badge">CPU</span>' : '',
            player.connected ? '' : '<span class="badge badge-muted">切断中</span>'
        ].join('');
        const remove = isHost && player.isCPU ? `<button type="button" class="btn btn-secondary btn-small" data-remove-cpu="${player.seat}">外す</button>` : '';
        return `<li><span class="lobby-name ${player.connected ? '' : 'offline'}">${escapeHtml(player.name)}</span>${badges}${remove}</li>`;
    }).join('');
    document.querySelectorAll('#lobby-screen .host-only').forEach(element => { element.hidden = !isHost; });
    $('guest-note').hidden = isHost;
    $('add-cpu').disabled = lobby.players.length >= MAX_PLAYERS;
    $('start-online').disabled = lobby.players.length < MAX_PLAYERS;
    renderDeckSelect();
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

async function shareInvite() {
    const code = online?.lobby?.roomCode;
    if (!code) return;
    const url = online.inviteUrl(); // 接続先の指定 ?server= は共通部品が引き継ぐ
    const text = `ポケモンカードゲームで対戦しよう！ 部屋番号 ${code}`;
    try {
        if (navigator.share) {
            await navigator.share({ title: 'ポケモンカードゲーム', text, url });
        } else {
            await navigator.clipboard.writeText(url);
            toast('招待URLをコピーしました');
        }
    } catch {
        // 共有をやめたときなど
    }
}

// 部屋を出る（対戦中なら、自分の番は CPU が代わりに打つ）
function leaveOnline() {
    online?.leave();
    online = null;
    matchId = null;
    showTitle();
}

function clearInviteUrl() {
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', url);
}

// ===== 入力 =====

document.addEventListener('click', event => {
    if (event.target.closest('[data-open-deck-picker]')) openDeckPicker();
    if (event.target.closest('[data-open-cpu-deck-picker]')) openCpuDeckPicker();
    const removeCpu = event.target.closest('[data-remove-cpu]');
    if (removeCpu) online?.removeCpu(Number(removeCpu.dataset.removeCpu));
});
$('start-cpu').addEventListener('click', startCpuGame);
$('open-online').addEventListener('click', () => showOnlineMenu());
$('open-decks').addEventListener('click', openDecks);
['deck-picker', 'confirm'].forEach(id => closeOnBackdrop($(id)));
$('create-room').addEventListener('click', createRoom);
$('join-room').addEventListener('click', joinRoom);
$('online-name').addEventListener('keydown', event => { if (event.key === 'Enter' && isInviteShown()) joinRoom(); });
$('room-code').addEventListener('keydown', event => { if (event.key === 'Enter') joinRoom(); });
$('online-back').addEventListener('click', () => {
    if (isInviteShown()) clearInviteUrl();
    showTitle();
});
$('share-invite').addEventListener('click', shareInvite);
$('add-cpu').addEventListener('click', () => online?.addCpu());
$('start-online').addEventListener('click', () => online?.startGame());
$('leave-room').addEventListener('click', leaveOnline);
// 対戦の途中なら、降参するかを確かめる（降参すると決着のダイアログが出て、そこからホームや部屋に戻る）
$('go-home').addEventListener('click', () => {
    const view = screen.view;
    if (!view || view.phase === 'end' || view.viewerId === null || view.viewerId === undefined) return isOnlineGame() ? leaveOnline() : showTitle();
    showConfirm($('confirm'), { title: '降参しますか？', yesLabel: '降参する', onYes: () => screen.send({ type: 'concede' }) });
});
['open-rules', 'open-rules-game'].forEach(id => $(id).addEventListener('click', () => $('rules').showModal()));
closeOnBackdrop($('rules'));
// 効果音：ブラウザの制限で、画面に触れたときに使えるようにする。ボタンで ON/OFF（保存する）
document.addEventListener('pointerdown', unlockSound, { passive: true });
const renderSoundToggle = () => {
    $('sound-toggle').classList.toggle('off', !isSoundOn());
    $('sound-toggle').setAttribute('aria-pressed', String(isSoundOn()));
};
$('sound-toggle').addEventListener('click', () => {
    toggleSound();
    renderSoundToggle();
});
renderSoundToggle();
document.addEventListener('contextmenu', event => {
    if (!event.target.closest('input, textarea')) event.preventDefault();
});

// ===== 起動 =====

async function boot() {
    showTitle();
    // 招待のURL（?room=部屋番号）で開いたら、その部屋に参加する
    const roomCode = NetplayClient.inviteRoomCode();
    if (roomCode) {
        showOnlineMenu({ roomCode, invited: true });
        if (knownName()) await joinInvitedRoom(knownName());
        return;
    }
    // 前回入っていた部屋があれば戻る
    if (loadOnlineSession()) {
        try {
            await connectOnline().resume();
        } catch {
            online?.leave();
            online = null;
        }
    }
}

boot();

// 確認用：画面の外からゲームを触れるようにする
window.__app = { get scene() { return scene; }, get online() { return online; }, screen, startCpuGame };
