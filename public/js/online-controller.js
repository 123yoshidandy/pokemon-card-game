/**
 * オンライン対戦のコントローラー
 * CPU 対戦の LocalGameController と同じく、画面には getView() でビューを渡し、操作は send() で受け取る
 * ゲームはサーバーが進め、ここではサーバーから届いた自分のビューを表示するだけ
 * 接続・再接続・参加情報の保存・CPU の手を間を置いて見せる処理は、共通部品の NetplayClient が行う
 */

import NetplayClient from './netplay/netplay-client.mjs';

const STORAGE_KEY = 'pokemon-card-game.online'; // 再接続に使う部屋番号とトークン
const CPU_STEP_DELAY_MS = 650;                   // CPU の手は CPU 対戦と同じ間隔で順に見せる
const RESPONSE_TIMEOUT_MS = 5000;                // 操作の返事がこれだけ来なければ、入り直して今の状態を受け取り直す
const DEPLOYED_SERVER_URL = 'wss://9flzja5gdi.execute-api.ap-northeast-1.amazonaws.com/prod'; // スタック pokemon-card-game-online の WebSocketUrl

export function loadOnlineSession() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
        return null;
    }
}

export default class OnlineGameController {
    // getDeck()：デッキを決める段階で送るカードIDの配列
    // listeners：onUpdate() / onLobby(lobby) / onError(message) / onConnectionChange(connected)
    constructor({ getDeck }, listeners = {}) {
        this.getDeck = getDeck;
        this.listeners = listeners;
        this.view = null;
        this.awaitingResponse = false; // 操作を送ってから返事が届くまで
        this.deckSentFor = null;       // デッキを送った対戦の matchId
        this.net = new NetplayClient({
            serverUrl: NetplayClient.resolveServerUrl({ deployed: DEPLOYED_SERVER_URL }),
            storageKey: STORAGE_KEY,
            cpuStepDelayMs: CPU_STEP_DELAY_MS
        });

        this.net.on('lobby', (lobby) => {
            // ロビーに戻ったときと、新しい対戦が始まったとき（ビューより先に届く）は、前の対戦の表示を消す
            if (lobby.status === 'lobby' || lobby.matchId !== this.matchId) this.view = null;
            this.matchId = lobby.matchId;
            listeners.onLobby?.(lobby);
        });
        this.net.on('state', ({ view, matchId }) => {
            // 後から届いた古いビューは、NetplayClient（部屋の版を見る）が捨てている
            this.clearAwaiting();
            // 新しい対戦のビューなのに、その開始の lobby を受け取っていない（届き損ね）なら、入り直して部屋の状態から受け取り直す
            const lobbyMatchId = this.net.lobby?.matchId;
            if (matchId !== undefined && lobbyMatchId !== undefined && matchId > lobbyMatchId) {
                this.net.resume().catch(() => {});
                return;
            }
            this.view = view;
            this.sendDeckIfNeeded();
            listeners.onUpdate?.();
        });
        this.net.on('error', ({ message }) => {
            this.clearAwaiting();
            listeners.onError?.(message);
            listeners.onUpdate?.();
        });
        this.net.on('connection', (connected) => listeners.onConnectionChange?.(connected));
    }

    get session() { return this.net.session; }
    get lobby() { return this.net.lobby; }

    // ===== 部屋の操作 =====

    createRoom(name) { return this.net.createRoom(name); }
    enterRoom(code, name) { return this.net.enterRoom(code, name); }
    joinFromInvite(name) { return this.net.joinFromInvite(name); }
    resume() { return this.net.resume(); }
    addCpu() { this.net.addCpu(); }
    removeCpu(seat) { this.net.removeCpu(seat); }
    startGame() { this.net.start(); }
    backToLobby() { this.net.backToLobby(); }
    isHost() { return this.net.isHost(); }
    inviteUrl() { return this.net.inviteUrl(); }

    // 部屋を出る（対戦中なら、以後は CPU が代わりに打つ。保存した参加情報も消す）
    leave() {
        this.clearAwaiting();
        this.net.leave();
        this.view = null;
    }

    // ===== 画面とのやり取り（CPU 対戦のコントローラーと同じ形） =====

    getView() {
        if (!this.view) return null;
        // 返事を待つ間は、二重に操作しないよう、できる操作をなくす
        return this.awaitingResponse ? { ...this.view, legal: null } : this.view;
    }

    send(command) {
        if (!this.net.send('command', { command })) {
            this.listeners.onError?.('サーバーとの接続が切れています。つなぎ直しています…');
            return false;
        }
        this.awaitingResponse = true;
        // 返事が届き損ねたときの保険：入り直すと joined → lobby → state で今の状態が届く（古い版は捨てられるので、重なっても害はない）
        clearTimeout(this.responseTimer);
        this.responseTimer = setTimeout(() => {
            if (this.awaitingResponse) this.net.resume().catch(() => {});
        }, RESPONSE_TIMEOUT_MS);
        this.listeners.onUpdate?.();
        return true;
    }

    clearAwaiting() {
        this.awaitingResponse = false;
        clearTimeout(this.responseTimer);
    }

    // 画面を閉じるときに呼ばれる（部屋は出ない。出るのは leave）
    stop() {}

    // デッキを決める段階になったら、選んでおいたデッキを1回だけ送る
    sendDeckIfNeeded() {
        const view = this.view;
        const matchId = this.net.lobby?.matchId;
        if (view?.phase !== 'deck' || view.decksSubmitted[view.viewerId] || this.deckSentFor === matchId) return;
        this.deckSentFor = matchId;
        this.send({ type: 'deck', cards: this.getDeck() });
    }
}
