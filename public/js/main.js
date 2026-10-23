/**
 * 起動と画面の切り替え（scene：title / online / lobby / game）
 */

import { DECKS, expandDeck } from './decks.js';
import LocalGameController from './game-controller.js';
import OnlineGameController, { loadOnlineSession } from './online-controller.js';
import NetplayClient from './netplay/netplay-client.mjs';
import GameScreen from './ui/game-screen.js';
import { cardFace } from './ui/card-view.js';
import { closeOnBackdrop } from './ui/sheets.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'pokemon-card-game:settings';
const SCENES = ['title', 'online', 'lobby', 'game'];
const MAX_PLAYERS = 2;

const settings = loadSettings();
let scene = 'title';
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
    resultNote: () => (isOnlineGame() && !online.isHost() ? 'ホストが「もう一度」を押すと再戦します' : '')
});

// ===== 設定 =====

function loadSettings() {
    const fallback = { deckId: DECKS[0].id, name: '' };
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
        return {
            deckId: DECKS.some(deck => deck.id === saved.deckId) ? saved.deckId : fallback.deckId,
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

const selectedDeck = () => DECKS.find(deck => deck.id === settings.deckId);

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
    document.querySelectorAll('.deck-select').forEach(container => {
        container.innerHTML = DECKS.map(deck =>
            `<button type="button" class="segment-item ${deck.id === settings.deckId ? 'active' : ''}" data-deck="${deck.id}">${deck.name}</button>`).join('');
    });
}

function showTitle() {
    screen.stop();
    renderDeckSelect();
    $('title-art').innerHTML = ['charizard-ex', 'professors-research', 'miraidon-ex']
        .map((id, index) => `<div class="fan fan-${index}">${cardFace(id)}</div>`).join('');
    setScene('title');
}

// ===== CPU 対戦 =====

function startCpuGame() {
    const mine = selectedDeck();
    const cpu = DECKS.find(deck => deck.id !== mine.id) ?? mine;
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
    const deckButton = event.target.closest('[data-deck]');
    if (deckButton) {
        settings.deckId = deckButton.dataset.deck;
        saveSettings();
        renderDeckSelect();
    }
    const removeCpu = event.target.closest('[data-remove-cpu]');
    if (removeCpu) online?.removeCpu(Number(removeCpu.dataset.removeCpu));
});
$('start-cpu').addEventListener('click', startCpuGame);
$('open-online').addEventListener('click', () => showOnlineMenu());
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
$('go-home').addEventListener('click', () => (isOnlineGame() ? leaveOnline() : showTitle()));
['open-rules', 'open-rules-game'].forEach(id => $(id).addEventListener('click', () => $('rules').showModal()));
closeOnBackdrop($('rules'));
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
