import { describe, it, expect } from 'vitest';
import { CARDS } from '../public/js/card-data.js';
import { startedGame, arrange, C } from './helpers.js';

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
