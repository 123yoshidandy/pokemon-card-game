/**
 * 共有デッキ：構築済みデッキは誰でも編集でき、変えた内容はサーバーに保存されて全員に届く（server/src/shared-decks.js）
 * 変えた内容は DECKS の中身に当てる。CPU 対戦・デッキ選び・オンライン対戦は、そのまま DECKS を使えばよい
 * 最後に受け取った内容は端末にも覚えておき、オフラインのときや、サーバーから届くまではそれを使う
 */

import { DECKS } from './decks.js';
import { resolveCardId } from './card-data.js';
import NetplayClient from './netplay/netplay-client.mjs';
import { DEPLOYED_SERVER_URL } from './online-controller.js';

const STORAGE_KEY = 'pokemon-card-game:shared-decks';
const RESPONSE_TIMEOUT_MS = 8000;

// 初期の内容（初期に戻したときと、変えたかどうかの判定に使う）
const DEFAULTS = new Map(DECKS.map(deck => [deck.id, { name: deck.name, cards: { ...deck.cards } }]));

// 変えた内容 { デッキのID: { name, cards } } を DECKS に当てる（入っていないデッキは初期の内容に戻す）
export function applySharedDecks(decks) {
    for (const deck of DECKS) {
        const shared = decks?.[deck.id];
        const base = DEFAULTS.get(deck.id);
        deck.name = shared?.name ?? base.name;
        deck.cards = shared ? Object.fromEntries(Object.entries(shared.cards).map(([id, count]) => [resolveCardId(id), count])) : { ...base.cards };
        deck.edited = Boolean(shared); // 「初期に戻す」を出すか
    }
}

function remember(decks) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
    } catch {
        // 覚えられなくても、この画面を開いている間は使える
    }
}

// 起動したときに、前に受け取った内容を当てる
export function loadCachedSharedDecks() {
    try {
        applySharedDecks(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
    } catch {
        // 読めなければ初期の内容のまま
    }
}

// サーバーに1回だけ問い合わせ、返事（変えた内容のすべて）を当てる。だめなら理由の文で失敗する
function request(message) {
    return new Promise((resolve, reject) => {
        let socket;
        let done = false;
        const timer = setTimeout(() => finish(new Error('サーバーから返事がありません')), RESPONSE_TIMEOUT_MS);
        const finish = (error, decks) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            socket?.close();
            if (error) return reject(error);
            applySharedDecks(decks);
            remember(decks);
            resolve(decks);
        };
        try {
            socket = new WebSocket(NetplayClient.resolveServerUrl({ deployed: DEPLOYED_SERVER_URL }));
        } catch {
            return finish(new Error('サーバーにつながりません'));
        }
        socket.addEventListener('open', () => socket.send(JSON.stringify(message)));
        socket.addEventListener('error', () => finish(new Error('サーバーにつながりません')));
        socket.addEventListener('message', event => {
            let reply;
            try {
                reply = JSON.parse(event.data);
            } catch {
                return;
            }
            if (reply.type === 'sharedDecks') finish(null, reply.decks ?? {});
            if (reply.type === 'sharedDecksError') finish(new Error(reply.message));
        });
    });
}

export const fetchSharedDecks = () => request({ action: 'getSharedDecks' });
export const saveSharedDeck = deck => request({ action: 'saveSharedDeck', id: deck.id, name: deck.name, cards: deck.cards });
export const resetSharedDeck = id => request({ action: 'resetSharedDeck', id });
