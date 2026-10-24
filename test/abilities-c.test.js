import { describe, it, expect } from 'vitest';
import { CARDS, resolveCardId } from '../public/js/card-data.js';
import { startedGame, arrange, answer, C } from './helpers.js';

const LIGHTNING = 'basic-lightning-energy';
const FIRE = 'basic-fire-energy';
const GRASS = 'basic-grass-energy';
const METAL = 'basic-metal-energy';
const FIGHTING = 'basic-fighting-energy';
const PSYCHIC = 'basic-psychic-energy';
const POTIONS = Array(8).fill(C.potion);

const ID = name => {
    const card = Object.values(CARDS).find(c => c.name === name);
    if (!card) throw new Error(`カードがない: ${name}`);
    return card.id;
};
const PIKACHU_EX = ID('ピカチュウex');
// 進化元のカードのID
const baseOf = id => ID(CARDS[id].evolvesFrom);

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    return { game, me: game.current, opp: 1 - game.current };
}

// 選択待ちに、インデックスで答える（同じカードが何枚もあるとき）
function answerIndices(game, indices) {
    const ok = game.applyCommand(game.pendingPrompt.player.id, { type: 'answer', answer: indices });
    if (!ok) throw new Error(game.lastError);
}

const useAbility = (game, playerId, pokemon) => game.applyCommand(playerId, { type: 'useAbility', target: pokemon.id });

describe('自分の番に使う特性', () => {
    it('はかいのずつき（ラムパルドex）：バトル場にいれば、オモテで相手のバトルポケモンのエネルギーを1個トラッシュする', () => {
        const { game, me, opp } = midGame();
        game.flipCoin = () => true;
        const player = arrange(game, me, { active: resolveCardId('M5-098'), bench: [resolveCardId('M5-098')], deck: POTIONS });
        const other = arrange(game, opp, { active: { id: C.charmander, energies: [FIRE] }, deck: POTIONS });
        expect(useAbility(game, me, player.bench[0])).toBe(false); // ベンチでは使えない
        expect(useAbility(game, me, player.active)).toBe(true);
        answer(game, [FIRE]);
        expect(other.active.energies).toHaveLength(0);
        expect(other.discard.some(inst => inst.id === FIRE)).toBe(true);
    });

    it('はっこうジュース（ツボツボ）：草エネルギーがついていれば、自分のポケモン1匹のHPを30回復する', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: resolveCardId('MC-023'), energies: [GRASS] }, bench: [resolveCardId('MC-023'), { id: C.pikachu, damage: 50 }] });
        expect(useAbility(game, me, player.bench[0])).toBe(false); // エネルギーがついていない
        expect(useAbility(game, me, player.active)).toBe(true);
        answer(game, [player.bench[1]]);
        expect(player.bench[1].damage).toBe(20);
    });

    it('ファンコール（スピンロトム）：最初の自分の番だけ、HP100以下の無色ポケモンを3枚まで手札に加える。別の「ファンコール」は使えない', () => {
        const { game, me } = midGame();
        game.players[me].turnsTaken = 1;
        const player = arrange(game, me, { active: resolveCardId('SV7-080'), bench: [resolveCardId('SV7-080')], hand: [], deck: [resolveCardId('SV8a-125'), resolveCardId('SV8a-127'), resolveCardId('MC-177'), C.potion] });
        expect(useAbility(game, me, player.active)).toBe(true);
        expect(game.pendingPrompt.cards.map(inst => inst.id)).toEqual([resolveCardId('SV8a-125'), resolveCardId('SV8a-127')]); // ルンパッパ（水）は選べない
        answer(game, [resolveCardId('SV8a-125'), resolveCardId('SV8a-127')]);
        expect(player.hand.map(inst => inst.id).sort()).toEqual([resolveCardId('SV8a-125'), resolveCardId('SV8a-127')]);
        expect(useAbility(game, me, player.bench[0])).toBe(false);
    });

    it('ファンコール：2回目の自分の番からは使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: resolveCardId('SV7-080'), deck: [resolveCardId('SV8a-125')] });
        expect(useAbility(game, me, player.active)).toBe(false);
    });

    it('フレアマジック（マフォクシー）：手札の基本炎エネルギーを1枚トラッシュし、手札が7枚になるように引く', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, bench: [resolveCardId('M4-013')], hand: [FIRE, C.potion, C.potion], deck: Array(10).fill(C.potion) });
        expect(useAbility(game, me, player.bench[0])).toBe(true);
        expect(player.hand).toHaveLength(7);
        expect(player.hand.some(inst => inst.id === FIRE)).toBe(false);
        expect(player.discard.some(inst => inst.id === FIRE)).toBe(true);
    });

    it('メタルメーカー（メタング）：山札の上から4枚のうち、基本鋼エネルギーを好きなだけつけ、残りは山札の下にもどす', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: resolveCardId('SV5M-047'), deck: [METAL, C.potion, METAL, C.potion, C.pikachu] });
        const fifth = player.deck[4];
        expect(useAbility(game, me, player.active)).toBe(true);
        expect(game.pendingPrompt.cards).toHaveLength(2);
        answerIndices(game, [0, 1]);
        expect(player.active.energies.map(inst => inst.id)).toEqual([METAL, METAL]);
        expect(player.deck).toHaveLength(3);
        expect(player.deck[0]).toBe(fifth); // 見なかった5枚目が山札の上になる
    });

    it('やけつくじょうき（ボルケニオンex）：バトル場にいれば、相手のバトルポケモンをやけどにする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: resolveCardId('SV9-017'), bench: [resolveCardId('SV9-017')] });
        const other = arrange(game, opp, { active: C.charmander });
        expect(useAbility(game, me, player.bench[0])).toBe(false);
        expect(useAbility(game, me, player.active)).toBe(true);
        expect(other.active.burned).toBe(true);
    });

    it('れっからんぶ（エンブオー）：手札の基本炎エネルギーを、自分のポケモンに何回でもつけられる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.charmander, bench: [resolveCardId('M2a-026')], hand: [FIRE, FIRE] });
        expect(useAbility(game, me, player.bench[0])).toBe(true);
        answer(game, [player.active]);
        expect(useAbility(game, me, player.bench[0])).toBe(true);
        answer(game, [player.bench[0]]);
        expect(player.active.energies).toHaveLength(1);
        expect(player.bench[0].energies).toHaveLength(1);
        expect(useAbility(game, me, player.bench[0])).toBe(false); // 手札に基本炎エネルギーがない
    });
});

describe('〜したときに使う特性', () => {
    it('パニックプリズン（アノホラグサ）：手札から進化させたとき、相手のバトルポケモンをこんらんにする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: baseOf(resolveCardId('M2-041')), hand: [resolveCardId('M2-041')] });
        const other = arrange(game, opp, { active: C.charmander });
        expect(game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.active.id })).toBe(true);
        expect(game.pendingPrompt.type).toBe('confirm');
        answer(game, true);
        expect(other.active.rotation).toBe('confused');
    });

    it('まんぷくタイム（バウッツェルex）：自分の進化ポケモン全員のHPをすべて回復し、回復したポケモンのエネルギーをトラッシュする', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, {
            active: baseOf(resolveCardId('MC-348')),
            bench: [{ id: C.raichu, damage: 50, energies: [LIGHTNING] }, { id: C.pikachu, damage: 30, energies: [LIGHTNING] }, { id: C.raichu, energies: [LIGHTNING] }],
            hand: [resolveCardId('MC-348')]
        });
        game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.active.id });
        answer(game, true);
        const [raichu, pikachu, fresh] = player.bench;
        expect(raichu.damage).toBe(0);
        expect(raichu.energies).toHaveLength(0);
        expect(pikachu.damage).toBe(30); // たねポケモンは回復しない
        expect(pikachu.energies).toHaveLength(1);
        expect(fresh.energies).toHaveLength(1); // 回復していないポケモンのエネルギーはそのまま
    });

    it('バズブースト（メガヤンマex）：ベンチからバトル場に出たとき、山札の基本草エネルギーを3枚までつける', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING] }, bench: [resolveCardId('M2a-003')], deck: [GRASS, GRASS, GRASS, GRASS, C.potion] });
        expect(game.applyCommand(me, { type: 'retreat', target: player.bench[0].id })).toBe(true);
        answer(game, true);
        expect(game.pendingPrompt.cards).toHaveLength(4);
        answerIndices(game, [0, 1, 2]);
        expect(player.active.cards[0].id).toBe(resolveCardId('M2a-003'));
        expect(player.active.energies.map(inst => inst.id)).toEqual([GRASS, GRASS, GRASS]);
        expect(player.deck).toHaveLength(2);
    });
});

describe('いるだけで働く特性', () => {
    it('バイタルサンバ（ルンパッパ）：自分のポケモン全員の最大HPが+40。何匹いても重ならない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: resolveCardId('MC-177'), bench: [resolveCardId('SV9-023'), C.pikachu] });
        const other = arrange(game, opp, { active: C.pikachu });
        expect(game.maxHp(player.bench[1])).toBe(110);
        expect(game.maxHp(player.active)).toBe(180);
        expect(game.maxHp(other.active)).toBe(70);
    });

    it('ハッスルプレー（ガオガエンex）：相手のベンチポケモンの数だけ、ワザの無色エネルギーが少なくなる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: resolveCardId('SV5M-085'), energies: [FIRE] } });
        arrange(game, opp, { active: C.pikachu, bench: [C.pikachu, C.pikachu, C.pikachu] });
        expect(game.checkAttack(player, 0)).not.toBeNull();
        arrange(game, opp, { bench: [C.pikachu, C.pikachu, C.pikachu, C.pikachu] });
        expect(game.attackCost(player.active, game.topCard(player.active).attacks[0])).toEqual(['fire']);
        expect(game.checkAttack(player, 0)).toBeNull();
    });

    it('はんげき（ハギギシリ）：バトル場でワザのダメージを受けたら、ワザを使ったポケモンにダメカンを3個のせる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.charmander, energies: [FIRE, FIRE] }, deck: POTIONS });
        const other = arrange(game, opp, { active: resolveCardId('SV7a-012'), deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 0 }); // ほのおのツメ 30
        expect(other.active.damage).toBe(30);
        expect(player.active.damage).toBe(30);
    });

    it('はなのカーテン（シェイミ）：ルールを持たない自分のベンチポケモンは、相手のワザのダメージを受けない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu });
        const other = arrange(game, opp, { active: C.charmander, bench: [resolveCardId('SV9a-066'), PIKACHU_EX] });
        const ctx = { game, player, opponent: other, attacker: player.active, defender: other.active, attack: { name: 'テスト' } };
        expect(game.dealAttackDamage(ctx, other.bench[0], 30)).toBe(0);
        expect(game.dealAttackDamage(ctx, other.bench[1], 30)).toBe(30);
        expect(game.dealAttackDamage(ctx, other.active, 30)).toBe(30);
    });

    it('ブーストしんか（イーブイ）：バトル場にいれば、出したばかりの番でも進化できる', () => {
        const { game, me } = midGame();
        const evolution = Object.values(CARDS).find(card => card.evolvesFrom === 'イーブイ' && card.supported).id;
        const player = arrange(game, me, {
            active: { id: resolveCardId('SV8a-125'), enteredTurn: game.turn },
            bench: [{ id: resolveCardId('SV8a-125'), enteredTurn: game.turn }],
            hand: [evolution, evolution]
        });
        expect(game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.bench[0].id })).toBe(false);
        expect(game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.active.id })).toBe(true);
    });

    it('ふんばりボディ（メガルチャブルex）：ワザのダメージできぜつするとき、オモテならHP10で残る', () => {
        const { game, me, opp } = midGame();
        game.flipCoin = () => true;
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const other = arrange(game, opp, { active: { id: resolveCardId('M2a-239'), damage: 240 }, bench: [C.pikachu], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 }); // プチボルト 30
        expect(other.active.cards[0].id).toBe(resolveCardId('M2a-239'));
        expect(game.maxHp(other.active) - other.active.damage).toBe(10);
    });

    it('ふんばりボディ：ウラならきぜつする', () => {
        const { game, me, opp } = midGame();
        game.flipCoin = () => false;
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const other = arrange(game, opp, { active: { id: resolveCardId('M2a-239'), damage: 240 }, bench: [C.pikachu], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(other.discard.some(inst => inst.id === resolveCardId('M2a-239'))).toBe(true);
    });

    it('マスターアーツ（ローブシン）：ついている闘エネルギー1個につき、最大HPが+40', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: resolveCardId('MC-390'), energies: [FIGHTING, FIGHTING, FIRE] } });
        expect(game.maxHp(player.active)).toBe(220);
    });

    it('マッドコート（バンバドロ）：受けるワザのダメージが-30', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.raichu, energies: [LIGHTNING, LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const other = arrange(game, opp, { active: resolveCardId('MC-406'), deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 }); // ストロングボルト 150
        expect(other.active.damage).toBe(120);
    });

    it('ふみん（ホーホー）：ねむりにならない（ほかの特殊状態にはなる）', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: resolveCardId('SV8a-127') });
        game.addCondition(player.active, 'asleep');
        expect(player.active.rotation).toBeNull();
        game.addCondition(player.active, 'poisoned');
        expect(player.active.poisoned).toBe(true);
    });

    it('もろいぬけがら（ヌケニン）：相手のポケモンexのワザのダメージできぜつしても、相手はサイドをとれない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: PIKACHU_EX, energies: [LIGHTNING, LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const other = arrange(game, opp, { active: resolveCardId('M1S-072'), bench: [C.pikachu], deck: POTIONS });
        const prizes = player.prizes.length;
        game.applyCommand(me, { type: 'attack', index: 0 }); // 10まんボルト 120
        expect(other.discard.some(inst => inst.id === resolveCardId('M1S-072'))).toBe(true);
        expect(player.prizes).toHaveLength(prizes);
    });

    it('もろいぬけがら：ポケモンexでないポケモンのワザなら、サイドをとられる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, deck: POTIONS });
        arrange(game, opp, { active: { id: resolveCardId('M1S-072'), damage: 30 }, bench: [C.pikachu], deck: POTIONS });
        const prizes = player.prizes.length;
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(player.prizes).toHaveLength(prizes - 1);
    });

    it('パワーセーバー（ロケット団のミュウツーex）：自分の場の「ロケット団のポケモン」が4匹以上でなければ、ワザが使えない', () => {
        const { game, me } = midGame();
        const rocket = Object.values(CARDS).find(card => card.kind === 'pokemon' && card.stage === 0 && card.name.startsWith('ロケット団の') && card.id !== resolveCardId('SV10-130')).id;
        const player = arrange(game, me, { active: { id: resolveCardId('SV10-130'), energies: [PSYCHIC, PSYCHIC, PSYCHIC] }, bench: [rocket, rocket] });
        expect(game.checkAttack(player, 0)).toMatch('ロケット団のポケモン');
        arrange(game, me, { bench: [rocket, rocket, rocket] });
        expect(game.checkAttack(player, 0)).toBeNull();
    });

    it('ワンダーキッス（トゲキッス）：相手のバトルポケモンがきぜつしたとき、オモテならサイドを1枚多くとる', () => {
        const { game, me, opp } = midGame();
        game.flipCoin = () => true;
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, bench: [resolveCardId('SV8-047'), resolveCardId('SV8-047')], deck: POTIONS });
        arrange(game, opp, { active: { id: C.charmander, damage: 60 }, bench: [C.pikachu], deck: POTIONS });
        const prizes = player.prizes.length;
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(player.prizes).toHaveLength(prizes - 2); // 2匹いても重ならない
    });

    it('むしばむのろい（ゲンガーex）：相手が手札からエネルギーをつけるたび、そのポケモンにダメカンを2個のせる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [LIGHTNING] });
        arrange(game, opp, { active: C.charmander, bench: [resolveCardId('SV5K-088')] });
        game.applyCommand(me, { type: 'attachEnergy', uid: player.hand[0].uid, target: player.active.id });
        expect(player.active.damage).toBe(20);
    });
});
