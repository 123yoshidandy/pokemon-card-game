import { describe, it, expect } from 'vitest';
import { startedGame, arrange, answer, C } from './helpers.js';

const LIGHTNING = 'basic-lightning-energy';
const FIGHTING = 'basic-fighting-energy';
const DARKNESS = 'basic-darkness-energy';
const METAL = 'basic-metal-energy';
const PSYCHIC = 'basic-psychic-energy';
const POTIONS = Array(8).fill(C.potion);
const PRIZES = Array(6).fill(C.potion);

// 特性を持つカード（catalog.js の id）
const RAPIDASH = 'MC-090'; // ギャロップ：いそぎあし
const QUAQUAVAL = 'SV7a-015'; // ウェーニバル：アップテンポ
const MEGA_KANGASKHAN = 'M-P-086'; // メガガルーラex：おつかいダッシュ
const DUSKNOIR = 'SV6a-070'; // ヨノワール：カースドボム
const MUNKIDORI = 'SV6-107'; // マシマシラ：アドレナブレイン
const IONO_BELLIBOLT = 'SV9-030'; // ナンジャモのハラバリーex：エレキストリーマー
const ERIKA_VILEPLUME = 'MC-003'; // エリカのラフレシアex：うるわしのかおり
const ROCKET_CROBAT = 'SV10-131'; // ロケット団のクロバットex：かみつきまわる
const ROCKET_GOLBAT = 'SV10-065'; // ロケット団のゴルバット
const ARCHALUDON = 'SV7a-037'; // ブリジュラスex：ごうきんビルド
const DURALUDON = 'SV7a-036'; // ジュラルドン
const LEDIAN = 'SV7-103'; // レディアン：きらぼしもよう
const LEDYBA = 'SV7-001'; // レディバ
const IRON_ANT = 'SV8-130'; // アイアントex：いきなりけずる
const BOUFFALANT_EX = 'SV11W-172'; // バッフロンex：アフロガード
const BOUFFALANT_A = 'M2a-140'; // バッフロン：カーリーウォール
const BOUFFALANT_B = 'SV7-081'; // バッフロン：カーリーウォール
const OKIDOGI = 'SV6-110'; // イイネイヌ：アドレナパワー
const PIKACHU_EX = 'SV8-136'; // ピカチュウex：がんばりハート
const TYRANITAR = 'SV9-058'; // バンギラス：いあつのがんこう
const MEGA_GOLURK = 'M6-109'; // メガゴルーグex：きどうせいげん
const IRON_BOULDER = 'MC-628'; // テツノコウベ：オートマーシャル
const FROSLASS = 'SV6-104'; // ユキメノコ：いてつくとばり
const HYDREIGON_EX = 'SV11W-171'; // サザンドラex：グリードイーター
const THUNDURUS = 'M6-025'; // ボルトロス：けしんだんけつ
const LANDORUS = 'M6-040'; // ランドロス
const TORNADUS = 'M6-059'; // トルネロス
const ENAMORUS = 'M6-083'; // ラブトロス

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    return { game, me: game.current, opp: 1 - game.current };
}

const useAbility = (game, playerId, pokemon) => game.applyCommand(playerId, { type: 'useAbility', target: pokemon.id });

// 選択待ちに、インデックスで答える（同じカードが何枚もあるとき）
function answerIndices(game, indices) {
    const ok = game.applyCommand(game.pendingPrompt.player.id, { type: 'answer', answer: indices });
    if (!ok) throw new Error(game.lastError);
}

describe('自分の番に使う特性', () => {
    it('いそぎあし：山札を1枚引く。同じポケモンは1回しか使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: RAPIDASH, hand: [], deck: POTIONS });
        expect(useAbility(game, me, player.active)).toBe(true);
        expect(player.hand.length).toBe(1);
        expect(useAbility(game, me, player.active)).toBe(false);
    });

    it('アップテンポ：手札を1枚山札の下にもどし、手札が5枚になるように引く', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: QUAQUAVAL, hand: [C.potion, LIGHTNING], deck: Array(8).fill(FIGHTING) });
        useAbility(game, me, player.active);
        answer(game, [LIGHTNING]);
        expect(player.hand.length).toBe(5);
        expect(player.deck[player.deck.length - 1].id).toBe(LIGHTNING);
    });

    it('おつかいダッシュ：バトル場にいるなら2枚引く。ベンチでは使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: MEGA_KANGASKHAN, bench: [MEGA_KANGASKHAN], hand: [], deck: POTIONS });
        expect(useAbility(game, me, player.bench[0])).toBe(false);
        expect(useAbility(game, me, player.active)).toBe(true);
        expect(player.hand.length).toBe(2);
    });

    it('カースドボム（ヨノワール）：相手のポケモンにダメカンを13個のせ、このポケモンはきぜつする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu, bench: [DUSKNOIR], prizes: PRIZES, deck: POTIONS });
        const other = arrange(game, opp, { active: { id: C.raichu, damage: 0 }, bench: [C.pikachu], prizes: PRIZES, deck: POTIONS });
        const target = other.active;
        useAbility(game, me, player.bench[0]);
        answer(game, [target]);
        expect(target.damage).toBe(130);
        expect(player.bench.length).toBe(0);
        expect(player.discard.some(inst => inst.id === DUSKNOIR)).toBe(true);
        expect(other.prizes.length).toBe(5); // 相手はヨノワールのぶん、サイドを1枚とる
        expect(other.discard.some(inst => inst.id === C.raichu)).toBe(true); // HP130 のライチュウはきぜつ
        expect(player.prizes.length).toBe(5);
    });

    it('アドレナブレイン：悪エネルギーがついていれば、自分のダメカンを3個まで相手にのせ替える', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: MUNKIDORI, energies: [DARKNESS] }, bench: [{ id: C.raichu, damage: 50 }], deck: POTIONS });
        const other = arrange(game, opp, { active: C.raichu, deck: POTIONS });
        useAbility(game, me, player.active);
        answer(game, [player.bench[0]]);
        expect(game.pendingPrompt.options.length).toBe(3);
        answerIndices(game, [2]);
        answer(game, [other.active]);
        expect(player.bench[0].damage).toBe(20);
        expect(other.active.damage).toBe(30);
    });

    it('アドレナブレイン：悪エネルギーがついていなければ使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: MUNKIDORI, energies: [PSYCHIC] }, bench: [{ id: C.raichu, damage: 50 }], deck: POTIONS });
        expect(useAbility(game, me, player.active)).toBe(false);
    });

    it('エレキストリーマー：何回でも、手札の基本雷エネルギーをナンジャモのポケモンにつける', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: IONO_BELLIBOLT, bench: [C.pikachu], hand: [LIGHTNING, LIGHTNING], deck: POTIONS });
        useAbility(game, me, player.active);
        expect(game.pendingPrompt.type).toBe('cards');
        answerIndices(game, [0]);
        useAbility(game, me, player.active);
        answerIndices(game, [0]);
        expect(player.active.energies.length).toBe(2);
        expect(player.bench[0].energies.length).toBe(0);
        expect(player.hand.length).toBe(0);
    });

    it('うるわしのかおり：自分のポケモン全員のHPを30回復する', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: ERIKA_VILEPLUME, damage: 50 }, bench: [{ id: C.pikachu, damage: 20 }, C.raichu], deck: POTIONS });
        useAbility(game, me, player.active);
        expect(player.active.damage).toBe(20);
        expect(player.bench[0].damage).toBe(0);
    });
});

describe('出したとき・進化させたときの特性', () => {
    it('かみつきまわる：手札から進化させたとき、相手のポケモン2匹にダメカンを2個ずつのせる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: ROCKET_GOLBAT, hand: [ROCKET_CROBAT], deck: POTIONS });
        const other = arrange(game, opp, { active: C.raichu, bench: [C.raichu, C.raichu], deck: POTIONS });
        expect(game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.active.id })).toBe(true);
        answer(game, true);
        answer(game, [other.active, other.bench[1]]);
        expect(other.active.damage).toBe(20);
        expect(other.bench[0].damage).toBe(0);
        expect(other.bench[1].damage).toBe(20);
    });

    it('ごうきんビルド：進化させたとき、トラッシュの基本鋼エネルギーを2枚まで鋼ポケモンにつける', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: DURALUDON, bench: [C.pikachu], hand: [ARCHALUDON], deck: POTIONS });
        player.discard = [METAL, METAL, LIGHTNING].map(id => ({ uid: `x${game.nextUid++}`, id }));
        game.evolveInto(player, player.active, player.hand[0]);
        game.processEffects();
        answer(game, true);
        answerIndices(game, [0, 1]);
        expect(player.active.energies.map(inst => inst.id)).toEqual([METAL, METAL]);
        expect(player.discard.map(inst => inst.id)).toEqual([LIGHTNING]);
    });

    it('きらぼしもよう：進化させたとき、相手のベンチの残りHP90以下のポケモンをバトル場に呼び出す', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: LEDYBA, hand: [LEDIAN], deck: POTIONS });
        const other = arrange(game, opp, { active: C.raichu, bench: [C.raichu, { id: C.raichu, damage: 40 }], deck: POTIONS });
        const weak = other.bench[1];
        game.evolveInto(player, player.active, player.hand[0]);
        game.processEffects();
        answer(game, true);
        expect(game.pendingPrompt.pokemon).toEqual([weak]); // 残りHP130のライチュウは選べない
        answer(game, [weak]);
        expect(other.active).toBe(weak);
    });

    it('いきなりけずる：手札からベンチに出したとき、相手の山札を上から1枚トラッシュする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [IRON_ANT], deck: POTIONS });
        const other = arrange(game, opp, { active: C.raichu, deck: [LIGHTNING, ...POTIONS] });
        game.applyCommand(me, { type: 'playBasic', uid: player.hand[0].uid });
        answer(game, true);
        expect(other.discard.map(inst => inst.id)).toEqual([LIGHTNING]);
        expect(other.deck.length).toBe(8);
    });
});

describe('いるだけで働く特性', () => {
    it('アフロガード：受けるワザのダメージが-30', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.raichu, energies: [LIGHTNING, LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BOUFFALANT_EX, deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 }); // ストロングボルト 150
        expect(other.active.damage).toBe(120);
    });

    it('カーリーウォール：別のバッフロンがいれば、無色のたねポケモンが受けるダメージが-60。2匹いても重ならない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.raichu, energies: [LIGHTNING, LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BOUFFALANT_A, bench: [BOUFFALANT_B], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(other.active.damage).toBe(90);
    });

    it('カーリーウォール：バッフロンが1匹だけなら減らない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.raichu, energies: [LIGHTNING, LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const other = arrange(game, opp, { active: { id: BOUFFALANT_A }, bench: [C.pikachu], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 });
        // 150 のまま受けて、HP100 のバッフロンはきぜつする（-60 されれば 90 で残る）
        expect(other.discard.some(inst => inst.id === BOUFFALANT_A)).toBe(true);
    });

    it('アドレナパワー：悪エネルギーがついていれば、最大HPとバトルポケモンへのダメージが+100', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: OKIDOGI, energies: [FIGHTING, FIGHTING] }, deck: POTIONS });
        expect(game.maxHp(player.active)).toBe(130);
        player.active.energies.push({ uid: `x${game.nextUid++}`, id: DARKNESS });
        expect(game.maxHp(player.active)).toBe(230);
        const other = arrange(game, opp, { active: ARCHALUDON, deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 0 }); // グッドパンチ 70
        expect(other.active.damage).toBe(170);
    });

    it('がんばりハート：HPがまんたんなら、ワザのダメージできぜつせず残りHP10で残る', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: OKIDOGI, energies: [FIGHTING, FIGHTING, DARKNESS] }, deck: POTIONS });
        const other = arrange(game, opp, { active: PIKACHU_EX, bench: [C.pikachu], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 0 }); // 170 × 弱点2倍
        expect(other.active.cards[0].id).toBe(PIKACHU_EX);
        expect(game.maxHp(other.active) - other.active.damage).toBe(10);
    });

    it('がんばりハート：HPがまんたんでなければ、きぜつする', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: OKIDOGI, energies: [FIGHTING, FIGHTING, DARKNESS] }, deck: POTIONS });
        const other = arrange(game, opp, { active: { id: PIKACHU_EX, damage: 10 }, bench: [C.pikachu], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(other.discard.some(inst => inst.id === PIKACHU_EX)).toBe(true);
    });

    it('いあつのがんこう：バトル場にいるかぎり、相手はグッズを使えない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, damage: 30 }, hand: [C.potion], deck: POTIONS });
        const other = arrange(game, opp, { active: TYRANITAR, bench: [C.pikachu], deck: POTIONS });
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(false);
        expect(game.lastError).toContain('グッズ');
        // ベンチにいるなら働かない
        [other.active, other.bench[0]] = [other.bench[0], other.active];
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(true);
    });

    it('きどうせいげん：手札が10枚以上のときにしか、ワザを使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: MEGA_GOLURK, energies: [PSYCHIC, PSYCHIC] }, hand: Array(9).fill(C.potion), deck: POTIONS });
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(false);
        player.hand.push({ uid: `x${game.nextUid++}`, id: C.potion });
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(true);
    });

    it('オートマーシャル：バトル場でワザのダメージを受けたとき、ワザを使ったポケモンにダメカンを3個のせる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.raichu, energies: [LIGHTNING] }, deck: POTIONS });
        arrange(game, opp, { active: IRON_BOULDER, deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 0 }); // クイックアタック 20
        expect(player.active.damage).toBe(30);
    });

    it('いてつくとばり：ポケモンチェックのたび、特性を持つポケモン（ユキメノコをのぞく）にダメカンを1個のせる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: FROSLASS, bench: [RAPIDASH, C.pikachu], deck: POTIONS });
        const other = arrange(game, opp, { active: RAPIDASH, deck: POTIONS });
        game.applyCommand(me, { type: 'endTurn' });
        expect(player.active.damage).toBe(0);
        expect(player.bench[0].damage).toBe(10);
        expect(player.bench[1].damage).toBe(0);
        expect(other.active.damage).toBe(10);
    });

    it('グリードイーター：このポケモンのワザで相手のたねポケモンがきぜつしたら、サイドを1枚多くとる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: HYDREIGON_EX, energies: Array(5).fill(DARKNESS) }, prizes: PRIZES, deck: POTIONS });
        arrange(game, opp, { active: C.charmander, bench: [C.pikachu], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(player.prizes.length).toBe(4);
    });

    it('けしんだんけつ：4匹がそろえば、ワザを使うための無色エネルギーがなくなる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: THUNDURUS, energies: [LIGHTNING] }, bench: [LANDORUS, TORNADUS, ENAMORUS], deck: POTIONS });
        expect(game.attackCost(player.active, game.topCard(player.active).attacks[0])).toEqual(['lightning']);
        expect(game.checkAttack(player, 0)).toBeNull();
        player.bench.pop();
        expect(game.checkAttack(player, 0)).toBe('エネルギーが足りません');
    });
});
