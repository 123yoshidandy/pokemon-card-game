/**
 * 共有デッキ：誰でも作り・編集し・初期に戻し・削除でき、変えた内容はサーバーに保存されて全員に届く（server/src/shared-decks.js）
 * 構築済みデッキ（decks.js）は、初めからある共有デッキで、作った共有デッキと同じに扱う
 * サーバーから届いた内容で DECKS を並べ直す（変えた構築済みデッキの中身を当て、消したものを除き、作ったものを後ろに足す）
 * CPU 対戦・デッキ選び・オンライン対戦は、そのまま DECKS を使えばよい
 * 最後に受け取った内容は端末にも覚えておき、オフラインのときや、サーバーから届くまではそれを使う
 */

import { DECKS } from './decks.js';
import { resolveCardId } from './card-data.js';
import NetplayClient from './netplay/netplay-client.mjs';
import { DEPLOYED_SERVER_URL } from './online-controller.js';

const STORAGE_KEY = 'pokemon-card-game:shared-decks';
const RESPONSE_TIMEOUT_MS = 8000;

// 構築済みデッキと、その初期の内容（初期に戻したときに使う）
const BUILT_INS = [...DECKS];
const DEFAULTS = new Map(DECKS.map(deck => [deck.id, { name: deck.name, cards: { ...deck.cards } }]));

const readCards = cards => Object.fromEntries(Object.entries(cards).map(([id, count]) => [resolveCardId(id), count]));

// 届いた内容（decks：{ デッキのID: { name, cards, edited, createdAt? } }、deleted：消した構築済みデッキのID）で DECKS を並べ直す
//   構築済みデッキは、同じものを書き換えて使う（タイプ・難しさ・説明を残すため）
export function applySharedDecks(decks = {}, deleted = []) {
    const gone = new Set(deleted);
    const builtIns = BUILT_INS.filter(deck => !gone.has(deck.id)).map(deck => {
        const shared = decks[deck.id];
        const base = DEFAULTS.get(deck.id);
        deck.name = shared?.name ?? base.name;
        deck.cards = shared ? readCards(shared.cards) : { ...base.cards };
        deck.edited = Boolean(shared); // 「初期に戻す」を出すか
        return deck;
    });
    const created = Object.entries(decks)
        .filter(([id]) => !DEFAULTS.has(id))
        .sort(([, a], [, b]) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .map(([id, shared]) => ({ id, name: shared.name, cards: readCards(shared.cards), edited: Boolean(shared.edited) }));
    // 全部消えることはない（サーバーが最後の1つを残す）が、念のため構築済みの最初のデッキを残す
    const next = [...builtIns, ...created];
    DECKS.splice(0, DECKS.length, ...(next.length ? next : BUILT_INS.slice(0, 1)));
}

function remember(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
        // 覚えられなくても、この画面を開いている間は使える
    }
}

// 起動したときに、前に受け取った内容を当てる（前の版は、変えた構築済みデッキの表 { デッキのID: { name, cards } } だけを覚えていた）
export function loadCachedSharedDecks() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        if (saved.decks && typeof saved.decks === 'object') applySharedDecks(saved.decks, saved.deleted ?? []);
        else applySharedDecks(saved, []);
    } catch {
        // 読めなければ初期の内容のまま
    }
}

// サーバーに1回だけ問い合わせ、返事（今の共有デッキのすべて）を当てる。だめなら理由の文で失敗する
function request(message) {
    return new Promise((resolve, reject) => {
        let socket;
        let done = false;
        const timer = setTimeout(() => finish(new Error('サーバーから返事がありません')), RESPONSE_TIMEOUT_MS);
        const finish = (error, reply) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            socket?.close();
            if (error) return reject(error);
            const state = { decks: reply.decks ?? {}, deleted: reply.deleted ?? [] };
            applySharedDecks(state.decks, state.deleted);
            remember(state);
            resolve(reply);
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
            if (reply.type === 'sharedDecks') finish(null, reply);
            if (reply.type === 'sharedDecksError') finish(new Error(reply.message));
        });
    });
}

export const fetchSharedDecks = () => request({ action: 'getSharedDecks' });
// 返事の created に、作った共有デッキのID が入る
export const createSharedDeck = deck => request({ action: 'createSharedDeck', name: deck.name, cards: deck.cards });
export const saveSharedDeck = deck => request({ action: 'saveSharedDeck', id: deck.id, name: deck.name, cards: deck.cards });
export const resetSharedDeck = id => request({ action: 'resetSharedDeck', id });
export const deleteSharedDeck = id => request({ action: 'deleteSharedDeck', id });
