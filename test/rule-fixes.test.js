import { describe, it, expect } from 'vitest';
import { startedGame, arrange, answer, makeCard, C } from './helpers.js';
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
        // 選べるカードがないサーチも、山札を見るための選択が出る（0枚まで。[] で閉じる）
        while (game.pendingPrompt && game.pendingPrompt.player.id === me.id) answer(game, game.pendingPrompt.type === 'confirm' ? true : game.pendingPrompt.max === 0 ? [] : [0]);
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

    it('相手のベンチに出す効果は、相手のベンチの上限で数える（ゼロの大空洞で自分だけ8匹のときの、おはやし笛）', () => {
        const game = midGame();
        const me = game.players[game.current];
        const opp = game.opponentOf(me);
        const tera = Object.values(CARDS).find(card => card.kind === 'pokemon' && card.tera && card.stage === 0);
        const basic = Object.values(CARDS).find(card => card.kind === 'pokemon' && card.stage === 0 && !card.ability && !card.rule && card.hp >= 60).id;
        arrange(game, me.id, { active: tera.id, bench: [], hand: [idOf('おはやし笛')] });
        arrange(game, opp.id, { active: basic, bench: [basic, basic, basic, basic], deck: [basic, basic, basic, basic, basic, basic] });
        game.stadium = { inst: makeCard(game, idOf('ゼロの大空洞')), owner: me.id };
        expect([game.benchLimit(me), game.benchLimit(opp)]).toEqual([8, 5]);
        game.applyCommand(me.id, { type: 'playTrainer', uid: me.hand[0].uid });
        expect(game.pendingPrompt.max).toBe(1);
        answer(game, game.pendingPrompt.cards.map(inst => inst.uid).slice(0, game.pendingPrompt.max));
        expect(opp.bench.length).toBe(5);
    });

    it('メガトンブロアーは、どうぐが2枚ついたポケモンの、2枚ともトラッシュする', () => {
        const game = midGame();
        const me = game.players[game.current];
        const opp = game.opponentOf(me);
        arrange(game, opp.id, { active: { id: C.pikachu, tool: idOf('ふうせん') }, bench: [C.pikachu] });
        opp.active.tool2 = makeCard(game, idOf('ヒーローマント'));
        arrange(game, me.id, { active: { id: C.pikachu }, bench: [], hand: [idOf('メガトンブロアー')] });
        expect(game.applyCommand(me.id, { type: 'playTrainer', uid: me.hand[0].uid })).toBe(true);
        expect([opp.active.tool, opp.active.tool2]).toEqual([null, null]);
        expect(opp.discard.map(inst => CARDS[inst.id].name)).toEqual(expect.arrayContaining(['ふうせん', 'ヒーローマント']));
    });

    it('トレーナーズの効果の途中で決着しても、そのカードはトラッシュに置かれる（消えない）', () => {
        const game = midGame();
        const me = game.players[game.current];
        const inst = makeCard(game, idOf('ハイパーボール'));
        game.trainerInPlay = { player: me, inst };
        game.endGame(me.id, 'effect', 'テスト');
        expect(me.discard).toContain(inst);
        expect(game.trainerInPlay).toBeNull();
    });

    it('ロケット団エネルギーが、ロケット団のポケモン以外についていたら、トラッシュする', () => {
        const game = midGame();
        const me = game.players[game.current];
        const rocket = idOf('ロケット団エネルギー');
        arrange(game, me.id, { active: { id: C.pikachu, energies: [rocket, 'basic-lightning-energy'] }, bench: [C.pikachu], hand: [] });
        expect(game.applyCommand(me.id, { type: 'endTurn' })).toBe(true);
        const names = me.active.energies.map(inst => CARDS[inst.id].name);
        expect(names).not.toContain('ロケット団エネルギー');
        expect(me.discard.map(inst => inst.id)).toContain(rocket);
    });

    it('逆境ほけんは、効果で変わった弱点で判定する', () => {
        const game = midGame();
        const me = game.players[game.current];
        const opp = game.opponentOf(me);
        arrange(game, opp.id, { active: { id: C.pikachu, tool: idOf('逆境ほけん') }, bench: [C.pikachu], hand: [] });
        arrange(game, me.id, { active: { id: C.pikachu }, bench: [], hand: [] });
        game.weaknessOf = pokemon => (pokemon === opp.active ? game.topCard(me.active).type : null);
        const hand = opp.hand.length;
        game.hookAll('onDamaged', { damage: 10 }, opp.active);
        expect(opp.hand.length).toBe(hand + 3);
    });
});
