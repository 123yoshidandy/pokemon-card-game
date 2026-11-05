import { describe, it, expect } from 'vitest';
import { startedGame, arrange, answer, C } from './helpers.js';
import { CARDS } from '../public/js/card-data.js';

const idOf = name => Object.values(CARDS).find(card => card.name === name).id;

// 2ターン目以降の自分の番から始める（先攻1ターン目の制限を避ける）
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    return game;
}

// プレイヤーのカードの合計（場・手札・山札・トラッシュ・サイド・スタジアム）。どこかへ消えていないかを確かめる
function countCards(game, player) {
    return player.deck.length + player.hand.length + player.discard.length + player.prizes.length
        + game.inPlay(player).reduce((sum, pokemon) => sum + pokemon.cards.length + pokemon.energies.length + (pokemon.tool ? 1 : 0) + (pokemon.tool2 ? 1 : 0), 0)
        + (game.stadium?.owner === player.id ? 1 : 0);
}

describe('ルールの不具合の直し', () => {
    it('山札の検索を2回つなぐワザで、2回目に選べるカードがなくても、1回目に選んだカードは消えない（バチュル「バチュチャージ」）', () => {
        const game = midGame();
        const me = game.players[game.current];
        arrange(game, me.id, {
            active: { id: 'SV7-108', energies: ['basic-lightning-energy'] },
            bench: [],
            hand: [],
            deck: ['basic-grass-energy', 'basic-grass-energy', 'basic-fire-energy', 'basic-fire-energy'] // 雷はない
        });
        const before = countCards(game, me);
        game.applyCommand(me.id, { type: 'attack', index: 0 });
        if (game.pendingPrompt?.purpose === 'search-energy') answer(game, game.pendingPrompt.cards.map(inst => inst.uid));
        while (game.pendingPrompt && game.pendingPrompt.player.id === me.id) answer(game, game.pendingPrompt.type === 'confirm' ? true : [0]);
        expect(countCards(game, me)).toBe(before);
    });

    it('どうぐが外れて最大HP がダメージ以下になったら、番の終わりを待たずにきぜつする（メガトンブロアーでヒーローマントを外す）', () => {
        const game = midGame();
        const me = game.players[game.current];
        const opp = game.opponentOf(me);
        arrange(game, opp.id, { active: { id: C.pikachu, damage: 100, tool: idOf('ヒーローマント') }, bench: [C.pikachu] });
        arrange(game, me.id, { active: { id: C.pikachu }, bench: [], hand: [idOf('メガトンブロアー')] });
        const prizes = me.prizes.length;
        expect(game.applyCommand(me.id, { type: 'playTrainer', uid: me.hand[0].uid })).toBe(true);
        expect(opp.active).toBeNull();
        expect(game.pendingPrompt?.purpose).toBe('promote');
        expect(me.prizes.length).toBe(prizes - 1);
    });
});
