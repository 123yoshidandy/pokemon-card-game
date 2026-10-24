import { describe, it, expect } from 'vitest';
import { CARDS } from '../public/js/card-data.js';
import { startedGame, arrange, C } from './helpers.js';

const find = test => Object.values(CARDS).find(test);
const withAttack = (cardName, attackName) => find(card => card.name === cardName && card.attacks.some(attack => attack.name === attackName));
const withAbility = abilityName => find(card => card.ability?.name === abilityName);
const attackIndex = (card, name) => card.attacks.findIndex(attack => attack.name === name);
const BIG = 'test-big';

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    CARDS[BIG] = { ...CARDS[C.pikachu], id: BIG, hp: 900, weakness: null, resistance: null };
    return { game, me: game.current, opp: 1 - game.current };
}

describe('本体の仕組みを足して使えるようにしたワザ・特性', () => {
    it('やりかえしシザー：ダメカンがのっていれば、エネルギー1個で使える', () => {
        const card = withAttack('シザリガー', 'やりかえしシザー');
        const attack = card.attacks[attackIndex(card, 'やりかえしシザー')];
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: card.id, energies: ['basic-fire-energy'] } });
        expect(game.canPayCost(player.active, game.attackCost(player.active, attack))).toBe(false);
        player.active.damage = 10;
        expect(game.canPayCost(player.active, game.attackCost(player.active, attack))).toBe(true);
    });

    it('パンツァーホーン：前の相手の番に受けたワザのダメージと同じダメージ追加', () => {
        const card = withAttack('メガヘラクロスex', 'パンツァーホーン');
        const index = attackIndex(card, 'パンツァーホーン');
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: card.id, energies: card.attacks[index].cost.map(() => 'basic-grass-energy') } });
        const target = arrange(game, opp, { active: BIG, deck: Array(5).fill(C.potion) });
        player.active.damageTakenLog = { turn: game.turn - 1, amount: 70 };
        game.applyCommand(me, { type: 'attack', index });
        expect(target.active.damage).toBe(card.attacks[index].damage + 70);
    });

    it('ビクトリーシンボル：自分のサイドの残りが1枚なら、この対戦は自分の勝ち', () => {
        const card = withAttack('Nのシンボラー', 'ビクトリーシンボル');
        const index = attackIndex(card, 'ビクトリーシンボル');
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: card.id, energies: ['basic-psychic-energy', 'basic-psychic-energy', 'basic-psychic-energy'] }, prizes: [C.potion] });
        arrange(game, opp, { active: BIG, deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index });
        expect(game.phase).toBe('end');
        expect(game.winner).toBe(me);
        expect(game.endReason).toBe('effect');
        expect(player.prizes).toHaveLength(1);
    });

    it('さくらんフラッシュ：こんらんにして、このこんらんでのせるダメカンは8個', () => {
        const card = withAttack('ランターン', 'さくらんフラッシュ');
        const index = attackIndex(card, 'さくらんフラッシュ');
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: card.id, energies: ['basic-water-energy', 'basic-water-energy'] }, deck: Array(5).fill(C.potion) });
        const target = arrange(game, opp, { active: { id: BIG, energies: ['basic-lightning-energy'] }, deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index });
        expect(game.hasCondition(target.active, 'confused')).toBe(true);
        game.random = () => 0.9; // ウラ（こんらんで失敗）
        game.applyCommand(opp, { type: 'attack', index: 0 });
        expect(target.active.damage).toBe(80);
    });

    it('おいしげる：自分のポケモンについている基本草エネルギーは、草エネルギー2個ぶん', () => {
        const meganium = withAbility('おいしげる');
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: ['basic-grass-energy'] }, bench: [meganium.id] });
        expect(game.energyUnits(player.active)).toEqual(['grass', 'grass']);
        expect(game.canPayCost(player.active, ['grass', 'colorless'])).toBe(true);
    });

    it('ぬめぬめスリップ：相手がにげるときコインを投げ、ウラならにげられない（エネルギーもトラッシュしない）', () => {
        const goodra = withAbility('ぬめぬめスリップ');
        const { game, me, opp } = midGame();
        arrange(game, opp, { active: goodra.id });
        const player = arrange(game, me, { active: { id: C.pikachu, energies: ['basic-lightning-energy'] }, bench: [C.magnemite] });
        const active = player.active;
        game.random = () => 0.9; // ウラ
        expect(game.applyCommand(me, { type: 'retreat', target: player.bench[0].id })).toBe(true);
        expect(player.active).toBe(active);
        expect(active.energies).toHaveLength(1);
    });

    it('にじいろDNA：イーブイから進化するポケモンex を、このポケモンにのせて進化できる', () => {
        const eeveeEx = withAbility('にじいろDNA');
        const evolution = find(card => card.kind === 'pokemon' && card.evolvesFrom === 'イーブイ' && card.rule === 'ex' && card.supported);
        const { game, me } = midGame();
        const player = arrange(game, me, { active: eeveeEx.id, hand: [evolution.id] });
        expect(game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.active.id })).toBe(true);
        expect(game.topCard(player.active).name).toBe(evolution.name);
    });

    it('げんせいらんだ：自分の場の「古代」のポケモンの数×30ダメージ', () => {
        const koraidon = withAttack('コライドン', 'げんせいらんだ');
        const index = attackIndex(koraidon, 'げんせいらんだ');
        const ancient = find(card => card.kind === 'pokemon' && card.ancient && card.stage === 0 && card.id !== koraidon.id);
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: koraidon.id, energies: ['basic-fighting-energy', 'basic-fighting-energy'] }, bench: [ancient.id, ancient.id] });
        const target = arrange(game, opp, { active: BIG, deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index });
        expect(target.active.damage).toBe(90);
    });
});
