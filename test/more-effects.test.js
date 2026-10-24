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

    it('化石：手札から使うと、HP60の無色のたねポケモンとしてベンチに出る。進化でき、にげられず、場からトラッシュできる', () => {
        const skull = find(card => card.name === '古びたずがいの化石');
        const cranidos = find(card => card.name === 'ズガイドス' && card.supported);
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu }, bench: [], hand: [skull.id, cranidos.id] });
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(true);
        const fossilPokemon = player.bench[0];
        expect(game.topCard(fossilPokemon).kind).toBe('pokemon');
        expect(game.maxHp(fossilPokemon)).toBe(60);
        expect(player.discard.some(inst => inst.id === skull.id)).toBe(false);

        // 出した番は進化できないので、次の番にする
        game.turn += 2;
        fossilPokemon.enteredTurn = game.turn - 2;
        expect(game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: fossilPokemon.id })).toBe(true);
        expect(game.topCard(fossilPokemon).name).toBe('ズガイドス');

        // 化石のままのものは、にげられず、場からトラッシュするともとのグッズにもどる
        const second = arrange(game, me, { active: { id: C.pikachu, energies: ['basic-lightning-energy'] }, bench: [C.magnemite], hand: [skull.id] });
        game.applyCommand(me, { type: 'playTrainer', uid: second.hand[0].uid });
        const fossilInPlay = second.bench[1];
        game.switchActive(second, fossilInPlay);
        expect(game.applyCommand(me, { type: 'retreat', target: second.bench[0].id })).toBe(false);
        expect(game.applyCommand(me, { type: 'useAbility', target: fossilInPlay.id })).toBe(true);
        const discarded = second.discard.find(inst => inst.id === skull.id);
        expect(discarded).toBeTruthy();
        expect(game.cardOf(discarded).kind).toBe('trainer');
    });

    it('化石採掘場：山札から「古びた」グッズを2枚まで、たねポケモンとしてベンチに出す', () => {
        const site = find(card => card.name === '化石採掘場');
        const fossilA = find(card => card.name === '古びたアゴの化石');
        const fossilB = find(card => card.name === '古びたヒレの化石');
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, bench: [], hand: [site.id], deck: [fossilA.id, fossilB.id, C.potion] });
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        expect(game.applyCommand(me, { type: 'useStadium' })).toBe(true);
        game.applyCommand(me, { type: 'answer', answer: [0, 1] });
        expect(player.bench.map(pokemon => game.topCard(pokemon).name).sort()).toEqual([fossilA.name, fossilB.name].sort());
    });

    it('おまつりおんど：場に「お祭り会場」が出ているなら、ワザを2回続けて使う', () => {
        // ピカチュウ（プチボルト 30）に、この特性を持たせて確かめる
        const dance = find(card => card.ability?.name === 'おまつりおんど').ability;
        CARDS['test-dancer'] = { ...CARDS[C.pikachu], id: 'test-dancer', ability: dance };
        const festival = find(card => card.name === 'お祭り会場');
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'test-dancer', energies: ['basic-lightning-energy', 'basic-lightning-energy'] }, hand: [festival.id] });
        const target = arrange(game, opp, { active: BIG, deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(target.active.damage).toBe(60);
        delete CARDS['test-dancer'];
    });

    it('きんきゅうかいてん：相手の場に2進化ポケモンがいるなら、手札からベンチに出せる', () => {
        const klinklang = withAbility('きんきゅうかいてん');
        const stage2 = find(card => card.kind === 'pokemon' && card.stage === 2 && card.supported);
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu, bench: [], hand: [klinklang.id] });
        arrange(game, opp, { active: C.charmander });
        expect(game.getLegalActions(me).handAbilities).toEqual([]);
        arrange(game, opp, { active: stage2.id });
        expect(game.getLegalActions(me).handAbilities).toEqual([player.hand[0].uid]);
        expect(game.applyCommand(me, { type: 'useHandAbility', uid: player.hand[0].uid })).toBe(true);
        expect(game.topCard(player.bench[0]).name).toBe(klinklang.name);
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
