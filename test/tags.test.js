import { describe, it, expect } from 'vitest';
import { CARDS } from '../public/js/card-data.js';
import { startedGame, arrange, C } from './helpers.js';

const find = test => Object.values(CARDS).find(test);
const idOf = name => find(card => card.name === name && card.supported)?.id;

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    return { game, me: game.current, opp: 1 - game.current };
}

describe('テラスタル・古代・未来の印', () => {
    it('印はデータに入っている（ミライドンex MC-284 はテラスタル、テツノカシラex は未来）', () => {
        expect(CARDS[C['miraidon-ex']].tera).toBe(true);
        expect(find(card => card.name === 'テツノカシラex').future).toBe(true);
        expect(find(card => card.name === 'トドロクツキ').ancient).toBe(true);
        expect(find(card => card.name === 'プライムキャッチャー').aceSpec).toBe(true);
    });

    it('ブーストエナジー 未来：未来のポケモンは、にげるためのエネルギーがなくなる', () => {
        const future = find(card => card.kind === 'pokemon' && card.future && card.retreat > 0);
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: future.id, tool: idOf('ブーストエナジー 未来') }, bench: [{ id: future.id, tool: null }] });
        expect(game.retreatCost(player.active)).toBe(0);
        expect(game.retreatCost(player.bench[0])).toBe(future.retreat);
    });

    it('きらめく結晶：テラスタルのポケモンのワザは、エネルギーが1個少なくてよい', () => {
        const tera = find(card => card.kind === 'pokemon' && card.tera && card.supported && card.attacks.some(attack => attack.cost.length >= 2));
        const attack = tera.attacks.find(a => a.cost.length >= 2);
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: tera.id, tool: idOf('きらめく結晶') } });
        expect(game.attackCost(player.active, attack)).toHaveLength(attack.cost.length - 1);
    });

    it('ブライア：この番、テラスタルのポケモンのワザで相手のバトルポケモンがきぜつしたら、サイドを1枚多くとる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C['miraidon-ex'], energies: ['basic-lightning-energy'] }, hand: [idOf('ブライア')] });
        arrange(game, opp, { active: { id: C.pikachu, damage: 60 }, bench: [C.magnemite], prizes: [C.potion, C.potion], deck: Array(5).fill(C.potion) });
        player.prizes = player.prizes.slice(0, 6);
        const before = player.prizes.length;
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(true);
        game.applyCommand(me, { type: 'attack', index: 0 }); // スラッシュクロー 40
        expect(before - player.prizes.length).toBe(2);
    });

    it('イニシャライズ：バトル場にいるかぎり、ルールを持つポケモン（未来をのぞく）の特性はなくなる', () => {
        const thorns = find(card => card.name === 'テツノイバラex' && card.ability?.name === 'イニシャライズ');
        const ruleWithAbility = find(card => card.kind === 'pokemon' && card.rule && !card.future && card.ability && card.ability.type !== 'unknown');
        const { game, me, opp } = midGame();
        arrange(game, me, { active: thorns.id });
        const target = arrange(game, opp, { active: ruleWithAbility.id });
        expect(game.abilitySuppressed(target.active)).toBe(true);
        arrange(game, me, { active: C.pikachu, bench: [thorns.id] });
        expect(game.abilitySuppressed(target.active)).toBe(false);
    });

    it('テラスタルオーブ：山札からテラスタルのポケモンを手札に加える', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { hand: [idOf('テラスタルオーブ')], deck: [C.pikachu, C['miraidon-ex'], C.potion] });
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        expect(game.pendingPrompt.cards.map(inst => inst.id)).toEqual([C['miraidon-ex']]);
    });
});
