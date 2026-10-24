import { describe, it, expect } from 'vitest';
import { CARDS } from '../public/js/card-data.js';
import { startedGame, arrange, answer, C } from './helpers.js';

// トレーナーズ（グッズ・サポート・スタジアム・どうぐ）の効果が、「相手の効果を受けない」ポケモンを守り、
// 「トラッシュから動かせない」カードを動かさないことを確かめる

const find = test => Object.values(CARDS).find(test);
const named = name => find(card => card.name === name && card.supported);

const CETITOAN = 'SV10-113'; // ハルクジラex（ゆきにまぎれる：相手が手札から出したグッズ・サポートの効果を受けない）
const FRAXURE = 'SV6a-074'; // オノンド（きんちょうかん：同じ）
const RHYPERIOR = 'SV7-052'; // ドサイドン（ワイドウォール：バトル場にいるかぎり、自分のポケモン全員は相手のサポートの効果を受けない）
const ENERGY = 'basic-lightning-energy';
const LOCKED_ENERGY = 'test-locked-lightning-energy';

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.stadium = null;
    // トラッシュにあるかぎり動かせない基本エネルギー（ポケバイタルA・ニュートラルセンターと同じ印をつけたもの）
    CARDS[LOCKED_ENERGY] = { ...CARDS[ENERGY], id: LOCKED_ENERGY, lockedInDiscard: true };
    return { game, me: game.current, opp: 1 - game.current };
}

// 手札の1枚目のトレーナーズを使う（使えたら true）
const play = (game, playerId) => game.applyCommand(playerId, { type: 'playTrainer', uid: game.players[playerId].hand[0].uid });

const specialEnergy = () => find(card => card.kind === 'energy' && !card.basic && card.supported && card.name === 'ミストエネルギー').id;
const tool = () => named('ふうせん').id;

describe('相手のポケモンを呼び出す', () => {
    it('ボスの指令：ゆきにまぎれるのベンチポケモンは候補から外れ、守りのないポケモンは呼び出せる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu, hand: [named('ボスの指令').id] });
        const target = arrange(game, opp, { active: C.magnemite, bench: [CETITOAN, C.pikachu] });
        const [cetitan, pikachu] = target.bench;
        expect(play(game, me)).toBe(true);
        expect(game.pendingPrompt.pokemon).toEqual([pikachu]);
        answer(game, [pikachu]);
        expect(target.active).toBe(pikachu);
        expect(target.bench).toContain(cetitan);
    });

    it('ボスの指令：ベンチがきんちょうかんのポケモンだけなら使えない。バトル場がゆきにまぎれるでも使えない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu, hand: [named('ボスの指令').id] });
        arrange(game, opp, { active: C.magnemite, bench: [FRAXURE] });
        expect(play(game, me)).toBe(false);
        arrange(game, opp, { active: CETITOAN, bench: [C.pikachu] });
        expect(play(game, me)).toBe(false);
    });

    it('ワイドウォール：バトル場にいるかぎり、ボスの指令（サポート）は使えないが、ポケモンキャッチャー（グッズ）は使える', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu, hand: [named('ボスの指令').id, named('ポケモンキャッチャー').id] });
        const target = arrange(game, opp, { active: RHYPERIOR, bench: [C.pikachu] });
        expect(play(game, me)).toBe(false);
        // ポケモンキャッチャーを先にする
        game.players[me].hand.reverse();
        expect(play(game, me)).toBe(true);
        answer(game, [target.bench[0]]);
        expect(game.topCard(target.active).name).toBe('ピカチュウ');
    });

    it('むしよけスプレー：相手が選ぶベンチポケモンから、ゆきにまぎれるのポケモンが外れる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu, hand: [named('むしよけスプレー').id] });
        const target = arrange(game, opp, { active: C.magnemite, bench: [CETITOAN, C.pikachu] });
        expect(play(game, me)).toBe(true);
        expect(game.pendingPrompt.player.id).toBe(opp);
        expect(game.pendingPrompt.pokemon).toEqual([target.bench[1]]);
        answer(game, [target.bench[1]]);
        expect(game.topCard(target.active).name).toBe('ピカチュウ');
    });
});

describe('相手のエネルギー・どうぐをトラッシュする・手札にもどす', () => {
    it('クラッシュハンマー：ゆきにまぎれるのポケモンのエネルギーはトラッシュできない。守りのないポケモンのエネルギーはトラッシュできる', () => {
        const { game, me, opp } = midGame();
        game.flipCoin = () => true;
        arrange(game, me, { active: C.pikachu, hand: [named('クラッシュハンマー').id] });
        const target = arrange(game, opp, { active: { id: CETITOAN, energies: [ENERGY] }, bench: [{ id: C.pikachu, energies: [ENERGY] }] });
        expect(play(game, me)).toBe(true);
        expect(game.pendingPrompt.pokemon).toEqual([target.bench[0]]);
        answer(game, [target.bench[0]]);
        expect(target.bench[0].energies).toHaveLength(0);
        expect(target.active.energies).toHaveLength(1);
    });

    it('クラッシュハンマー：エネルギーがついているのがゆきにまぎれるのポケモンだけなら使えない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu, hand: [named('クラッシュハンマー').id] });
        arrange(game, opp, { active: { id: CETITOAN, energies: [ENERGY] }, bench: [C.pikachu] });
        expect(play(game, me)).toBe(false);
    });

    it('改造ハンマー：きんちょうかんのポケモンの特殊エネルギーはトラッシュできず、守りのないポケモンのものはトラッシュする', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu, hand: [named('改造ハンマー').id] });
        arrange(game, opp, { active: { id: FRAXURE, energies: [specialEnergy()] } });
        expect(play(game, me)).toBe(false);
        const target = arrange(game, opp, { active: { id: FRAXURE, energies: [specialEnergy()] }, bench: [{ id: C.pikachu, energies: [specialEnergy()] }] });
        expect(play(game, me)).toBe(true);
        // 候補が1匹だけでも選ぶ（守りのあるポケモンは候補にない）
        expect(game.pendingPrompt.pokemon).toEqual([target.bench[0]]);
        answer(game, [target.bench[0]]);
        expect(target.bench[0].energies).toHaveLength(0);
        expect(target.active.energies).toHaveLength(1);
    });

    it('ツールスクラッパー：ゆきにまぎれるのポケモンのどうぐは候補から外れる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu, hand: [named('ツールスクラッパー').id] });
        const target = arrange(game, opp, { active: { id: CETITOAN, tool: tool() }, bench: [{ id: C.pikachu, tool: tool() }] });
        expect(play(game, me)).toBe(true);
        expect(game.pendingPrompt.pokemon).toEqual([target.bench[0]]);
        answer(game, [target.bench[0]]);
        expect(target.bench[0].tool).toBeNull();
        expect(target.active.tool).toBeTruthy();
    });

    it('ヒートバーナー：トラッシュできるのがゆきにまぎれるのポケモンのどうぐ・特殊エネルギーだけなら使えない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu, hand: [named('ヒートバーナー').id, ENERGY] });
        arrange(game, opp, { active: { id: CETITOAN, tool: tool(), energies: [specialEnergy()] } });
        expect(play(game, me)).toBe(false);
    });

    it('怖いお兄さん：ワイドウォールがバトル場にいれば使えない。ベンチにいるときは、どうぐと特殊エネルギーをトラッシュする', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu, hand: [named('怖いお兄さん').id] });
        arrange(game, opp, { active: { id: RHYPERIOR, tool: tool() }, bench: [{ id: C.pikachu, tool: tool(), energies: [specialEnergy()] }] });
        expect(play(game, me)).toBe(false);
        const target = arrange(game, opp, { active: { id: C.pikachu, tool: tool(), energies: [specialEnergy()] }, bench: [RHYPERIOR] });
        expect(play(game, me)).toBe(true);
        answer(game, [target.active]);
        expect(target.active.tool).toBeNull();
        expect(target.active.energies).toHaveLength(0);
    });

    it('サビ組のしたっぱ：エネルギーがついているのがゆきにまぎれるのポケモンだけなら使えない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [named('サビ組のしたっぱ').id] });
        player.knockedOutByAttackTurn = game.turn - 1;
        player.knockedOutByAttackNames = ['ピカチュウ'];
        arrange(game, opp, { active: { id: CETITOAN, energies: [ENERGY] } });
        expect(play(game, me)).toBe(false);
        const target = arrange(game, opp, { active: { id: CETITOAN, energies: [ENERGY] }, bench: [{ id: C.pikachu, energies: [ENERGY] }] });
        expect(play(game, me)).toBe(true);
        expect(game.pendingPrompt.pokemon).toEqual([target.bench[0]]);
    });

    it('のんびりじゃらし：きんちょうかんのポケモンのエネルギーは手札にもどせない。守りのないポケモンのものはもどす', () => {
        const { game, me, opp } = midGame();
        game.firstPlayer = opp;
        game.players[me].turnsTaken = 1;
        arrange(game, me, { active: C.pikachu, hand: [named('のんびりじゃらし').id] });
        const target = arrange(game, opp, { active: { id: FRAXURE, energies: [ENERGY] }, bench: [{ id: C.pikachu, energies: [ENERGY] }], hand: [] });
        expect(play(game, me)).toBe(true);
        expect(game.pendingPrompt.pokemon).toEqual([target.bench[0]]);
        answer(game, [target.bench[0]]);
        expect(target.bench[0].energies).toHaveLength(0);
        expect(target.hand.map(inst => inst.id)).toEqual([ENERGY]);
        expect(target.active.energies).toHaveLength(1);
    });
});

describe('ダメカン・特殊状態', () => {
    it('ロケット団のびっくりボム：ゆきにまぎれるのポケモンは、ダメカンをのせる候補から外れる', () => {
        const { game, me, opp } = midGame();
        game.flipCoin = () => true;
        arrange(game, me, { active: C.pikachu, hand: [named('ロケット団のびっくりボム').id] });
        const target = arrange(game, opp, { active: CETITOAN, bench: [C.pikachu] });
        expect(play(game, me)).toBe(true);
        expect(game.pendingPrompt.pokemon).toEqual([target.bench[0]]);
        answer(game, [target.bench[0]]);
        expect(target.bench[0].damage).toBe(20);
        expect(target.active.damage).toBe(0);
    });

    it('デンジャラス光線：ゆきにまぎれるのバトルポケモンは、やけど・こんらんにならない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu, hand: [named('デンジャラス光線').id] });
        const target = arrange(game, opp, { active: CETITOAN });
        expect(play(game, me)).toBe(true);
        expect(game.hasCondition(target.active, 'burned')).toBe(false);
        expect(game.hasCondition(target.active, 'confused')).toBe(false);
    });
});

describe('トラッシュから動かせないカード（ポケバイタルA・ニュートラルセンター）', () => {
    it('つりざおMAX・ミラクルインカム：ポケバイタルA・ニュートラルセンターはトラッシュに残る', () => {
        const { game, me } = midGame();
        const vital = named('ポケバイタルA').id;
        const center = named('ニュートラルセンター').id;
        const player = arrange(game, me, { active: C.pikachu, hand: [named('ミラクルインカム').id] });
        player.discard = [vital, center, named('ボスの指令').id].map(id => ({ uid: `d${game.nextUid++}`, id }));
        expect(play(game, me)).toBe(true);
        expect(game.pendingPrompt.cards.map(inst => game.cardName(inst))).toEqual(['ボスの指令']);
        answer(game, [game.pendingPrompt.cards[0].uid]);
        expect(player.hand.map(inst => game.cardName(inst))).toEqual(['ボスの指令']);
        expect(player.discard.map(inst => inst.id)).toEqual(expect.arrayContaining([vital, center]));
    });

    it('エネルギー回収：トラッシュから動かせないエネルギーは候補から外れ、それしかなければ使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [named('エネルギー回収').id] });
        player.discard = [{ uid: 'locked-1', id: LOCKED_ENERGY }];
        expect(play(game, me)).toBe(false);
        player.discard.push({ uid: 'free-1', id: ENERGY });
        expect(play(game, me)).toBe(true);
        // 候補が1枚なので、1枚だけ選ぶ
        expect(game.pendingPrompt.cards.map(inst => inst.uid)).toEqual(['free-1']);
        answer(game, ['free-1']);
        expect(player.hand.map(inst => inst.uid)).toEqual(['free-1']);
        expect(player.discard.map(inst => inst.uid)).toContain('locked-1');
    });

    it('エネルギーリサイクル：トラッシュから動かせないエネルギーは山札にもどさない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [named('エネルギーリサイクル').id], deck: [] });
        player.discard = [{ uid: 'locked-1', id: LOCKED_ENERGY }, { uid: 'free-1', id: ENERGY }];
        expect(play(game, me)).toBe(true);
        expect(game.pendingPrompt.cards.map(inst => inst.uid)).toEqual(['free-1']);
        answer(game, ['free-1']);
        expect(player.deck.map(inst => inst.uid)).toEqual(['free-1']);
        expect(player.discard.map(inst => inst.uid)).toContain('locked-1');
    });

    it('ハッコウシティ：トラッシュから動かせない雷エネルギーは手札に加えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [] });
        game.stadium = { inst: { uid: 'stadium-1', id: named('ハッコウシティ').id }, owner: me };
        player.discard = [{ uid: 'locked-1', id: LOCKED_ENERGY }];
        expect(game.applyCommand(me, { type: 'useStadium' })).toBe(false);
        player.discard.push({ uid: 'free-1', id: ENERGY });
        expect(game.applyCommand(me, { type: 'useStadium' })).toBe(true);
        expect(game.pendingPrompt.cards.map(inst => inst.uid)).toEqual(['free-1']);
        answer(game, ['free-1']);
        expect(player.hand.map(inst => inst.uid)).toEqual(['free-1']);
        expect(player.discard.map(inst => inst.uid)).toContain('locked-1');
    });
});
