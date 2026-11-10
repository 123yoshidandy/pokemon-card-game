import { describe, it, expect } from 'vitest';
import { CARDS, resolveCardId } from '../public/js/card-data.js';
import { startedGame, arrange, answer, C } from './helpers.js';

const FIRE = 'basic-fire-energy';
const FIGHTING = 'basic-fighting-energy';
const PSYCHIC = 'basic-psychic-energy';

const idOf = name => Object.values(CARDS).find(card => card.name === name && card.supported)?.id;

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    return { game, me: game.current, opp: 1 - game.current };
}

describe('プレイヤーにかかる効果・使ったカードの行き先などを使うトレーナーズ', () => {
    it('オッカのみ：相手の炎ポケモンから受けるワザのダメージは-60され、このカードをトラッシュする。ほかのタイプには働かない', () => {
        const berry = idOf('オッカのみ');
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.charmander, energies: [FIRE, FIRE] } });
        const target = arrange(game, opp, { active: { id: C.pikachu, tool: berry }, deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index: 0 }); // ほのおのツメ 30
        expect(target.active.damage).toBe(0);
        expect(target.active.tool).toBeNull();
        expect(target.discard.some(inst => inst.id === berry)).toBe(true);

        const second = midGame(2);
        arrange(second.game, second.me, { active: { id: C.pikachu, energies: ['basic-lightning-energy', 'basic-lightning-energy'] } });
        const other = arrange(second.game, second.opp, { active: { id: C.charmander, tool: berry }, deck: Array(5).fill(C.potion) });
        second.game.applyCommand(second.me, { type: 'attack', index: 1 }); // プチボルト 30（雷）
        expect(other.active.damage).toBe(30);
        expect(other.active.tool).not.toBeNull();
    });

    it('パワープロテイン：この番、自分の闘ポケモンのワザの、相手のバトルポケモンへのダメージ+30', () => {
        const fighter = Object.values(CARDS).find(card => card.kind === 'pokemon' && card.supported && card.type === 'fighting' && card.stage === 0
            && card.attacks.some(attack => !attack.text && attack.damage > 0 && attack.cost.every(type => type === 'fighting' || type === 'colorless')));
        const index = fighter.attacks.findIndex(attack => !attack.text && attack.damage > 0);
        const attack = fighter.attacks[index];
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: fighter.id, energies: attack.cost.map(() => FIGHTING) }, hand: [idOf('パワープロテイン')] });
        CARDS['test-target'] = { ...CARDS[C.pikachu], id: 'test-target', hp: 500, weakness: null, resistance: null };
        const target = arrange(game, opp, { active: 'test-target', deck: Array(5).fill(C.potion) });
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(true);
        game.applyCommand(me, { type: 'attack', index });
        expect(target.active.damage).toBe(attack.damage + 30);
        delete CARDS['test-target'];
    });

    it('アンフェアスタンプ：前の相手の番に自分のポケモンがきぜつしていなければ使えない。使うと自分は5枚、相手は2枚引く', () => {
        const stamp = idOf('アンフェアスタンプ');
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: [stamp, C.potion], deck: Array(20).fill(FIRE) });
        const opponent = arrange(game, opp, { hand: [C.potion, C.potion, C.potion], deck: Array(20).fill(FIRE) });
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(false);
        player.knockedOutTurn = game.turn - 1;
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(true);
        expect(player.hand).toHaveLength(5);
        expect(opponent.hand).toHaveLength(2);
    });

    it('アンフェアスタンプ：前の相手の番に、相手のカースドボムで自分のポケモンがきぜつしていれば使える（#29）', () => {
        const stamp = idOf('アンフェアスタンプ');
        const dusknoir = resolveCardId('SV6a-070'); // ヨノワール：カースドボム
        const { game, me: opp, opp: me } = midGame();
        const other = arrange(game, opp, { active: C.pikachu, bench: [dusknoir], prizes: Array(6).fill(C.potion), hand: [], deck: Array(20).fill(FIRE) });
        const player = arrange(game, me, { active: C.pikachu, bench: [C.raichu], prizes: Array(6).fill(C.potion), hand: [stamp], deck: Array(20).fill(FIRE) });
        expect(game.applyCommand(opp, { type: 'useAbility', target: other.bench[0].id })).toBe(true);
        answer(game, [player.active]); // ピカチュウにダメカン13個で、きぜつ
        answer(game, [player.bench[0]]); // ライチュウをバトル場に出す
        expect(game.applyCommand(opp, { type: 'endTurn' })).toBe(true);
        expect(game.getLegalActions(me).hand[player.hand[0].uid]).toEqual([]);
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(true);
    });

    it('アンフェアスタンプ：自分の番に、自分のカースドボムで自分のポケモンがきぜつしても、次の自分の番には使えない（前の相手の番ではないので）。理由を出す（#29）', () => {
        const stamp = idOf('アンフェアスタンプ');
        const dusknoir = resolveCardId('SV6a-070');
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu, bench: [dusknoir], prizes: Array(6).fill(C.potion), hand: [stamp], deck: Array(20).fill(FIRE) });
        const other = arrange(game, opp, { active: C.raichu, bench: [C.pikachu], prizes: Array(6).fill(C.potion), hand: [], deck: Array(20).fill(FIRE) });
        game.applyCommand(me, { type: 'useAbility', target: player.bench[0].id });
        answer(game, [other.bench[0]]);
        expect(player.bench).toHaveLength(0); // ヨノワールはきぜつした
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(false); // この番も使えない
        game.applyCommand(me, { type: 'endTurn' });
        game.applyCommand(opp, { type: 'endTurn' });
        const uid = player.hand.find(inst => inst.id === stamp).uid;
        expect(game.applyCommand(me, { type: 'playTrainer', uid })).toBe(false);
        expect(game.getLegalActions(me).reasons.hand[uid]).toBe('前の相手の番に、自分のポケモンがきぜつしていないので使えません');
    });

    it('ネリネ：4枚引き、番の終わりに手札が5枚以上なら、手札をすべてトラッシュする', () => {
        const carmine = idOf('ネリネ');
        const { game, me } = midGame();
        const player = arrange(game, me, { hand: [carmine, C.potion, C.potion], deck: Array(20).fill(FIRE) });
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        expect(player.hand).toHaveLength(6);
        game.applyCommand(me, { type: 'endTurn' });
        expect(player.hand).toHaveLength(0);
    });

    it('ロケット団エネルギー：ロケット団のポケモンにしかつけられず、[P][D] どちらかのエネルギー2個ぶんになる', () => {
        const energy = Object.values(CARDS).find(card => card.name === 'ロケット団エネルギー').id;
        const rocket = Object.values(CARDS).find(card => card.kind === 'pokemon' && card.name.startsWith('ロケット団の') && card.stage === 0).id;
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, bench: [rocket], hand: [energy] });
        expect(game.applyCommand(me, { type: 'attachEnergy', uid: player.hand[0].uid, target: player.active.id })).toBe(false);
        expect(game.getLegalActions(me).hand[player.hand[0].uid]).toEqual([player.bench[0].id]);
        expect(game.applyCommand(me, { type: 'attachEnergy', uid: player.hand[0].uid, target: player.bench[0].id })).toBe(true);
        expect(game.canPayCost(player.bench[0], ['psychic', 'darkness'])).toBe(true);
        expect(game.canPayCost(player.bench[0], ['psychic', 'psychic'])).toBe(true);
        expect(game.canPayCost(player.bench[0], ['fire'])).toBe(false);
        expect(game.canPayCost(player.bench[0], ['psychic', 'colorless', 'colorless'])).toBe(false);
    });

    it('お祭り会場：エネルギーがついているポケモンは特殊状態にならず、受けている特殊状態は回復する', () => {
        const festival = idOf('お祭り会場');
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [PSYCHIC] }, bench: [C.magnemite], hand: [festival] });
        player.active.rotation = 'asleep';
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        expect(game.hasCondition(player.active, 'asleep')).toBe(false);
        game.addCondition(player.active, 'poisoned');
        expect(player.active.poisoned).toBe(false);
        game.addCondition(player.bench[0], 'poisoned');
        expect(game.hasCondition(player.bench[0], 'poisoned')).toBe(true);
    });
});
