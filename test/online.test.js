import { describe, it, expect } from 'vitest';
import { createTestServer } from '../server/netplay/testing.js';
import game from '../server/src/game-definition.js';
import { DECKS, expandDeck } from '../public/js/decks.js';

const DECK_A = expandDeck(DECKS[0]);
const DECK_B = expandDeck(DECKS[1]);

const matchIdOf = client => client.last('lobby').matchId;
const viewOf = client => client.last('state').view;
const command = (client, cmd) => client.send('command', { matchId: matchIdOf(client), command: cmd });

// ビューだけを見て1手打つ人間の役：選択には最小の答え、自分の番はすぐ終える
async function stepHuman(client) {
    const view = viewOf(client);
    if (view.phase === 'end') return false;
    const prompt = view.prompt;
    if (prompt && !prompt.waiting && prompt.player === view.viewerId) {
        const answer = prompt.type === 'confirm' ? false : Array.from({ length: prompt.min }, (_, i) => i);
        await command(client, { type: 'answer', answer });
        return true;
    }
    if (!prompt && view.phase === 'main' && view.current === view.viewerId) {
        await command(client, { type: 'endTurn' });
        return true;
    }
    return false;
}

async function startRoom() {
    const server = createTestServer(game);
    const [a, b] = await server.createRoom(['あお', 'みどり']);
    await a.send('start');
    return { server, a, b };
}

describe('オンライン対戦', () => {
    it('両者がデッキを送ると準備が始まり、決着まで進む', async () => {
        const { a, b } = await startRoom();
        expect(viewOf(a).phase).toBe('deck');
        await command(a, { type: 'deck', cards: DECK_A });
        expect(viewOf(b).decksSubmitted).toEqual([true, false]);
        await command(b, { type: 'deck', cards: DECK_B });
        expect(viewOf(a).phase).toBe('setup');

        for (let i = 0; i < 2000 && viewOf(a).phase !== 'end'; i++) {
            const moved = (await stepHuman(a)) || (await stepHuman(b));
            expect(moved).toBe(true);
        }
        expect(viewOf(a).phase).toBe('end');
        expect(viewOf(b).winner).toBe(viewOf(a).winner);
        expect(a.last('lobby').status).toBe('ended');
    });

    it('決まりに合わないデッキは断られる', async () => {
        const { a } = await startRoom();
        await command(a, { type: 'deck', cards: DECK_A.slice(1) });
        expect(a.last('error').message).toContain('60枚');
        const tooMany = [...DECK_A.slice(0, 55), ...Array(5).fill('potion')];
        await command(a, { type: 'deck', cards: tooMany });
        expect(a.last('error').message).toContain('4枚まで');
        expect(viewOf(a).decksSubmitted).toEqual([false, false]);
    });

    it('相手の手札・山札・サイドのカードは、どのメッセージにも入らない', async () => {
        const server = createTestServer(game);
        const [a, b] = await server.createRoom(['あお', 'みどり']);
        await a.send('start');
        await command(a, { type: 'deck', cards: DECK_A });
        await command(b, { type: 'deck', cards: DECK_B });
        for (let i = 0; i < 120 && viewOf(a).phase !== 'end'; i++) {
            if (!((await stepHuman(a)) || (await stepHuman(b)))) break;
        }
        // サーバーの状態から、b の隠れたカードを調べる
        const saved = await server.store.getRoom(a.last('joined').roomCode);
        const restored = game.restore(saved.game);
        const hidden = restored.players[1];
        const ids = [...hidden.hand, ...hidden.deck, ...hidden.prizes].map(inst => inst.uid);
        const own = [...restored.players[0].deck, ...restored.players[0].prizes].map(inst => inst.uid);
        expect(ids.length).toBeGreaterThan(0);
        const text = JSON.stringify(a.messages);
        // 手札に来たあとに見えたカードもあるので、今の隠れたカードだけを、最後のビューで確かめる
        const last = JSON.stringify(a.last('state'));
        ids.forEach(uid => expect(last.includes(`"${uid}"`)).toBe(false));
        own.forEach(uid => expect(last.includes(`"${uid}"`)).toBe(false));
        expect(text).not.toContain('"seed"');
    });

    it('部屋を出た人の番は CPU が代わりに打つ。端末から proxy は送れない', async () => {
        const { a, b } = await startRoom();
        await command(a, { type: 'proxy' });
        expect(a.last('error')).toBeTruthy();
        await command(a, { type: 'deck', cards: DECK_A });
        await b.send('leave');
        // b はデッキを決めないまま抜けたので、CPU が代わりに決めて準備が進む
        const view = viewOf(a);
        expect(view.decksSubmitted).toEqual([true, true]);
        expect(view.players[1].isCPU).toBe(true);
        for (let i = 0; i < 2000 && viewOf(a).phase !== 'end'; i++) {
            if (!(await stepHuman(a))) break;
        }
        expect(viewOf(a).phase).toBe('end');
    });

    it('CPU を入れた部屋では、CPU がデッキを決めて対戦が進む', async () => {
        const server = createTestServer(game);
        const [a] = await server.createRoom(['あお']);
        await a.send('addCpu');
        await a.send('start');
        await command(a, { type: 'deck', cards: DECK_B });
        expect(viewOf(a).phase).not.toBe('deck');
        for (let i = 0; i < 2000 && viewOf(a).phase !== 'end'; i++) {
            if (!(await stepHuman(a))) break;
        }
        expect(viewOf(a).phase).toBe('end');
    });
});
