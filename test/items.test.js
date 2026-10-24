import { describe, it, expect } from 'vitest';
import { CARDS, resolveCardId } from '../public/js/card-data.js';
import { startedGame, arrange, answer, makeCard, C } from './helpers.js';

const FIRE = 'basic-fire-energy';
const WATER = 'basic-water-energy';
const LIGHTNING = 'basic-lightning-energy';
const DARKNESS = 'basic-darkness-energy';
const SPECIAL = resolveCardId('M3-078'); // グロウ草エネルギー（特殊エネルギー）
const FLOAT_STONE = C['float-stone'];
const LUMIOSE = C['lumiose-city'];

// 名前からカードのIDを引く（同じ名前が何枚あっても、最初の1つ）
const ID = name => Object.values(CARDS).find(card => card.name === name).id;

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState = { ...game.turnState, energyAttached: false, supporterPlayed: false };
    return { game, me: game.current, opp: 1 - game.current };
}

// 手札のカードを名前で選んで使う
function play(game, playerId, name) {
    const inst = game.players[playerId].hand.find(card => game.cardName(card) === name);
    if (!inst) throw new Error(`手札に${name}がない`);
    return game.applyCommand(playerId, { type: 'playTrainer', uid: inst.uid });
}

const handNames = (game, player) => player.hand.map(inst => game.cardName(inst));
const filler = (n = 10) => Array(n).fill(C.potion);

describe('グッズ：使える条件', () => {
    it('スペシャルレッドカード：相手のサイドが3枚以下のときだけ。相手は手札を山札の下にもどし、3枚引く', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { hand: ['スペシャルレッドカード'].map(ID) });
        const target = arrange(game, opp, { hand: Array(5).fill(FIRE), deck: filler(10), prizes: filler(6) });
        expect(play(game, me, 'スペシャルレッドカード')).toBe(false);

        target.prizes = target.prizes.slice(0, 3);
        expect(play(game, me, 'スペシャルレッドカード')).toBe(true);
        expect(target.hand.length).toBe(3);
        expect(target.hand.every(inst => inst.id === C.potion)).toBe(true);
        expect(target.deck.slice(-5).every(inst => inst.id === FIRE)).toBe(true);
    });

    it('おたすけベル：後攻の最初の番だけ使え、山札からサポートを手札に加える', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: [ID('おたすけベル')], deck: [C.potion, C.guy, C.potion] });
        expect(play(game, me, 'おたすけベル')).toBe(false);

        game.firstPlayer = opp;
        player.turnsTaken = 1;
        expect(play(game, me, 'おたすけベル')).toBe(true);
        expect(game.pendingPrompt.cards.map(inst => inst.id)).toEqual([C.guy]);
        answer(game, [C.guy]);
        expect(handNames(game, player)).toEqual(['ガイ']);
    });

    it('シークレットボックス：手札を3枚トラッシュしなければ使えない。グッズ・どうぐ・サポート・スタジアムを1枚ずつ', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, {
            hand: [ID('シークレットボックス'), FIRE, FIRE],
            deck: [C.potion, FLOAT_STONE, C.guy, LUMIOSE, C.pikachu]
        });
        expect(play(game, me, 'シークレットボックス')).toBe(false);

        player.hand.push(makeCard(game, WATER));
        expect(play(game, me, 'シークレットボックス')).toBe(true);
        answer(game, player.hand.map(inst => inst.uid)); // 残りの手札3枚（基本エネルギー）
        ['きずぐすり', 'ふうせん', 'ガイ', 'ミアレシティ'].forEach(name => {
            expect(game.pendingPrompt.cards.map(inst => game.cardName(inst))).toEqual([name]);
            answer(game, [game.pendingPrompt.cards[0].uid]);
        });
        expect(handNames(game, player).sort()).toEqual(['きずぐすり', 'ふうせん', 'ガイ', 'ミアレシティ'].sort());
        expect(player.deck.map(inst => inst.id)).toEqual([C.pikachu]);
        expect(player.discard.length).toBe(4); // トラッシュした3枚と、シークレットボックス
    });

    it('ヒートバーナー：手札の基本エネルギーをトラッシュし、相手のどうぐかスタジアムを1枚トラッシュする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: [ID('ヒートバーナー')] });
        const target = arrange(game, opp, { active: { id: C.pikachu, tool: FLOAT_STONE } });
        game.stadium = { inst: makeCard(game, LUMIOSE), owner: opp };
        expect(play(game, me, 'ヒートバーナー')).toBe(false);

        player.hand.push(makeCard(game, FIRE));
        expect(play(game, me, 'ヒートバーナー')).toBe(true);
        answer(game, [FIRE]);
        expect(game.pendingPrompt.options).toHaveLength(2);
        answer(game, [0]); // どうぐ
        expect(target.active.tool).toBeNull();
        expect(game.stadium).not.toBeNull();
        expect(player.discard.map(inst => inst.id)).toContain(FIRE);
    });
});

describe('グッズ：山札から', () => {
    it('ぼうけんのランタン：基本炎エネルギーと基本雷エネルギーを1枚ずつ', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { hand: [ID('ぼうけんのランタン')], deck: [FIRE, FIRE, LIGHTNING, LIGHTNING, WATER] });
        expect(play(game, me, 'ぼうけんのランタン')).toBe(true);
        expect(game.pendingPrompt.max).toBe(1);
        expect(game.pendingPrompt.cards.every(inst => inst.id === FIRE)).toBe(true);
        answer(game, [game.pendingPrompt.cards[0].uid]);
        expect(game.pendingPrompt.cards.every(inst => inst.id === LIGHTNING)).toBe(true);
        answer(game, [game.pendingPrompt.cards[0].uid]);
        expect(player.hand.map(inst => inst.id).sort()).toEqual([FIRE, LIGHTNING].sort());
        expect(player.deck).toHaveLength(3);
    });

    it('エネルギー転送PRO：それぞれちがうタイプの基本エネルギーを好きなだけ', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { hand: [ID('エネルギー転送PRO')], deck: [FIRE, FIRE, WATER, C.potion] });
        expect(play(game, me, 'エネルギー転送PRO')).toBe(true);
        expect(game.pendingPrompt.cards.map(inst => inst.id).sort()).toEqual([FIRE, WATER].sort());
        answer(game, [FIRE, WATER]);
        expect(player.hand.map(inst => inst.id).sort()).toEqual([FIRE, WATER].sort());
        expect(player.deck.map(inst => inst.id).sort()).toEqual([FIRE, C.potion].sort());
    });

    it('ポケギア3.0：上から7枚の中のサポートだけを選べる', () => {
        const { game, me } = midGame();
        const deck = [...Array(7).fill(C.potion), C.guy];
        deck[3] = C.judge;
        const player = arrange(game, me, { hand: [ID('ポケギア3.0')], deck });
        expect(play(game, me, 'ポケギア3.0')).toBe(true);
        expect(game.pendingPrompt.cards.map(inst => inst.id)).toEqual([C.judge]); // 8枚目のガイは見えない
        answer(game, [C.judge]);
        expect(handNames(game, player)).toEqual(['ジャッジマン']);
        expect(player.deck).toHaveLength(7);
    });

    it('おとりよせボックス：グッズを2枚まで手札に加え、自分の番が終わる', () => {
        const { game, me, opp } = midGame();
        arrange(game, opp, { deck: filler(5) });
        const player = arrange(game, me, { hand: [ID('おとりよせボックス')], deck: [C.potion, C.switch, C.guy] });
        expect(play(game, me, 'おとりよせボックス')).toBe(true);
        expect(game.pendingPrompt.cards).toHaveLength(2);
        answer(game, [C.potion, C.switch]);
        expect(handNames(game, player).sort()).toEqual(['きずぐすり', 'ポケモンいれかえ'].sort());
        expect(game.current).toBe(opp);
    });
});

describe('グッズ：相手への効果', () => {
    it('むしよけスプレー：相手のバトルポケモンを入れ替える。出すポケモンは相手が選ぶ', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { hand: [ID('むしよけスプレー')] });
        const target = arrange(game, opp, { active: C.charmander, bench: [C.pikachu, C.magnemite] });
        expect(play(game, me, 'むしよけスプレー')).toBe(true);
        expect(game.pendingPrompt.player.id).toBe(opp);
        const chosen = target.bench[1];
        answer(game, [chosen]);
        expect(target.active).toBe(chosen);
        expect(target.bench.map(pokemon => game.topCard(pokemon).name)).toContain('ヒトカゲ');
    });

    it('プライムキャッチャー：相手のベンチポケモンを呼び出し、その後、自分も入れ替える', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu, bench: [C.magnemite], hand: [ID('プライムキャッチャー')] });
        const target = arrange(game, opp, { active: C.charmander, bench: [C.growlithe] });
        expect(play(game, me, 'プライムキャッチャー')).toBe(true);
        answer(game, [target.bench[0]]);
        expect(game.topCard(target.active).name).toBe('ガーディ');
        expect(game.pendingPrompt.player.id).toBe(me);
        answer(game, [player.bench[0]]);
        expect(game.topCard(player.active).name).toBe('コイル');
    });

    it('エネはたき：相手の手札のエネルギーを1枚、相手の山札の下にもどす', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { hand: [ID('エネはたき')] });
        const target = arrange(game, opp, { hand: [C.potion, FIRE], deck: filler(3) });
        expect(play(game, me, 'エネはたき')).toBe(true);
        expect(game.pendingPrompt.cards.map(inst => inst.id)).toEqual([FIRE]);
        answer(game, [FIRE]);
        expect(target.hand.map(inst => inst.id)).toEqual([C.potion]);
        expect(target.deck[target.deck.length - 1].id).toBe(FIRE);
    });

    it('クラッシュハンマー：オモテなら、相手のポケモンとエネルギーを選んでトラッシュする。ウラなら何もしない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { hand: [ID('クラッシュハンマー'), ID('クラッシュハンマー')] });
        const target = arrange(game, opp, { active: { id: C.charmander, energies: [FIRE, WATER] }, bench: [{ id: C.pikachu, energies: [LIGHTNING] }] });
        game.random = () => 0.9; // ウラ
        expect(play(game, me, 'クラッシュハンマー')).toBe(true);
        expect(game.pendingPrompt).toBeNull();
        expect(target.active.energies).toHaveLength(2);

        game.random = () => 0.1; // オモテ
        expect(play(game, me, 'クラッシュハンマー')).toBe(true);
        answer(game, [target.active]);
        answer(game, [WATER]);
        expect(target.active.energies.map(inst => inst.id)).toEqual([FIRE]);
        expect(target.discard.map(inst => inst.id)).toContain(WATER);
    });

    it('改造ハンマー：相手の特殊エネルギーだけを選べる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { hand: [ID('改造ハンマー')] });
        const target = arrange(game, opp, { active: { id: C.charmander, energies: [FIRE, SPECIAL] }, bench: [{ id: C.pikachu, energies: [LIGHTNING] }] });
        expect(play(game, me, '改造ハンマー')).toBe(true);
        expect(game.pendingPrompt.pokemon).toEqual([target.active]);
        answer(game, [target.active]);
        expect(target.active.energies.map(inst => inst.id)).toEqual([FIRE]);
    });

    it('ハンドトリマー：おたがい手札が5枚になるようにトラッシュする（相手から）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: [ID('ハンドトリマー'), ...Array(7).fill(FIRE)] });
        const target = arrange(game, opp, { hand: Array(8).fill(WATER) });
        expect(play(game, me, 'ハンドトリマー')).toBe(true);
        expect(game.pendingPrompt.player.id).toBe(opp);
        expect(game.pendingPrompt.min).toBe(3);
        answer(game, target.hand.slice(0, 3).map(inst => inst.uid));
        expect(game.pendingPrompt.player.id).toBe(me);
        expect(game.pendingPrompt.min).toBe(2);
        answer(game, player.hand.slice(0, 2).map(inst => inst.uid));
        expect(target.hand).toHaveLength(5);
        expect(player.hand).toHaveLength(5);
    });

    it('メガトンブロアー：相手のどうぐ・特殊エネルギーと、場のスタジアムをすべてトラッシュする（自分のどうぐは残る）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, tool: FLOAT_STONE }, hand: [ID('メガトンブロアー')] });
        const target = arrange(game, opp, {
            active: { id: C.charmander, tool: FLOAT_STONE, energies: [FIRE, SPECIAL] },
            bench: [{ id: C.pikachu, tool: FLOAT_STONE }]
        });
        game.stadium = { inst: makeCard(game, LUMIOSE), owner: me };
        expect(play(game, me, 'メガトンブロアー')).toBe(true);
        expect(target.active.tool).toBeNull();
        expect(target.bench[0].tool).toBeNull();
        expect(target.active.energies.map(inst => inst.id)).toEqual([FIRE]);
        expect(game.stadium).toBeNull();
        expect(player.active.tool).not.toBeNull();
    });

    it('ロケット団のびっくりボム：オモテなら相手のポケモンにダメカン2個（きぜつすればサイドを取る）、ウラなら自分のバトルポケモンに', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [ID('ロケット団のびっくりボム'), ID('ロケット団のびっくりボム')], prizes: filler(6) });
        const target = arrange(game, opp, { active: C.charmander, bench: [C.magnemite] });
        target.bench[0].damage = game.maxHp(target.bench[0]) - 20;
        game.random = () => 0.1; // オモテ
        expect(play(game, me, 'ロケット団のびっくりボム')).toBe(true);
        expect(game.pendingPrompt.purpose).toBe('snipe-target');
        answer(game, [target.bench[0]]);
        expect(target.bench).toHaveLength(0);
        expect(player.prizes).toHaveLength(5);

        game.random = () => 0.9; // ウラ
        expect(play(game, me, 'ロケット団のびっくりボム')).toBe(true);
        expect(player.active.damage).toBe(20);
    });

    it('ダークベル：おたがいのバトルポケモン（悪ポケモンをのぞく）をこんらんにする', () => {
        const { game, me, opp } = midGame();
        const dark = Object.values(CARDS).find(card => card.kind === 'pokemon' && card.type === 'darkness' && card.stage === 0 && card.supported);
        const player = arrange(game, me, { active: dark.id, hand: [ID('ダークベル')] });
        const target = arrange(game, opp, { active: C.charmander });
        expect(play(game, me, 'ダークベル')).toBe(true);
        expect(game.hasCondition(player.active, 'confused')).toBe(false);
        expect(game.hasCondition(target.active, 'confused')).toBe(true);
    });
});

describe('グッズ：回復・入れ替え・自分の場', () => {
    it('ミアレガレット：HPを20回復し、特殊状態を1つ選んで回復する', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.charmander, damage: 30 }, hand: [ID('ミアレガレット')] });
        game.addCondition(player.active, 'poisoned');
        game.addCondition(player.active, 'paralyzed');
        expect(play(game, me, 'ミアレガレット')).toBe(true);
        expect(game.pendingPrompt.options).toEqual(['マヒ', 'どく']);
        answer(game, [0]);
        expect(player.active.damage).toBe(10);
        expect(game.hasCondition(player.active, 'paralyzed')).toBe(false);
        expect(game.hasCondition(player.active, 'poisoned')).toBe(true);
    });

    it('いいきずぐすり：60回復し、回復したならエネルギーを1個トラッシュする。ダメージがなければ使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.charmander, energies: [FIRE, WATER] }, hand: [ID('いいきずぐすり')] });
        expect(play(game, me, 'いいきずぐすり')).toBe(false);

        player.active.damage = 50;
        expect(play(game, me, 'いいきずぐすり')).toBe(true);
        answer(game, [player.active]);
        expect(player.active.damage).toBe(0);
        answer(game, [WATER]);
        expect(player.active.energies.map(inst => inst.id)).toEqual([FIRE]);
    });

    it('おいしいおむすび：トラッシュのおいしいおむすび1枚につき、30多く回復する', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.charmander, damage: 100 }, hand: [ID('おいしいおむすび')] });
        player.discard.push(makeCard(game, ID('おいしいおむすび')), makeCard(game, ID('おいしいおむすび')));
        expect(play(game, me, 'おいしいおむすび')).toBe(true);
        expect(player.active.damage).toBe(10);
    });

    it('スクランブルスイッチ：入れ替えた後、前のバトルポケモンのエネルギーを好きなだけつけ替える', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.charmander, energies: [FIRE, FIRE, WATER] }, bench: [C.pikachu], hand: [ID('スクランブルスイッチ')] });
        const old = player.active;
        expect(play(game, me, 'スクランブルスイッチ')).toBe(true);
        answer(game, [player.bench[0]]);
        answer(game, old.energies.filter(inst => inst.id === FIRE).map(inst => inst.uid));
        expect(game.topCard(player.active).name).toBe('ピカチュウ');
        expect(player.active.energies.map(inst => inst.id)).toEqual([FIRE, FIRE]);
        expect(old.energies.map(inst => inst.id)).toEqual([WATER]);
    });

    it('あやしい時計：進化している超ポケモンを退化させ、はがしたカードを手札にもどす（その番は進化できない）', () => {
        const kirlia = ID('キルリア');
        const ralts = Object.values(CARDS).find(card => card.name === 'ラルトス' && card.supported).id;
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: kirlia, cards: [ralts, kirlia], damage: 30 }, hand: [ID('あやしい時計')] });
        expect(play(game, me, 'あやしい時計')).toBe(true);
        answer(game, [player.active]);
        expect(game.topCard(player.active).name).toBe('ラルトス');
        expect(player.active.damage).toBe(30);
        const back = player.hand.find(inst => inst.id === kirlia);
        expect(back).toBeTruthy();
        expect(game.applyCommand(me, { type: 'evolve', uid: back.uid, target: player.active.id })).toBe(false);
    });

    it('とりかえチケット：サイドを山札の下にもどし、山札の上から同じ枚数をサイドに置く', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { hand: [ID('とりかえチケット')], prizes: Array(4).fill(FIRE), deck: [...Array(4).fill(WATER), C.potion] });
        expect(play(game, me, 'とりかえチケット')).toBe(true);
        expect(player.prizes.map(inst => inst.id)).toEqual(Array(4).fill(WATER));
        expect(player.deck.map(inst => inst.id)).toEqual([C.potion, ...Array(4).fill(FIRE)]);
    });

    it('ツールスクラッパー：おたがいの場のどうぐを2枚まで選んでトラッシュする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, tool: FLOAT_STONE }, hand: [ID('ツールスクラッパー')] });
        const target = arrange(game, opp, { active: { id: C.charmander, tool: FLOAT_STONE }, bench: [{ id: C.pikachu, tool: FLOAT_STONE }] });
        expect(play(game, me, 'ツールスクラッパー')).toBe(true);
        expect(game.pendingPrompt.pokemon).toHaveLength(3);
        expect(game.pendingPrompt.max).toBe(2);
        answer(game, [player.active, target.active]);
        expect(player.active.tool).toBeNull();
        expect(target.active.tool).toBeNull();
        expect(target.bench[0].tool).not.toBeNull();
    });
});

describe('グッズ：CPU', () => {
    it('CPU は、使いたいときだけ使う（ポケモンキャッチャーは、呼び出すと得なベンチポケモンがいるとき）', async () => {
        const { runCpuStep } = await import('../public/js/cpu-player.js');
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, hand: [ID('ポケモンキャッチャー')], deck: filler(5) });
        const target = arrange(game, opp, { active: C.charmander, bench: [C.magnemite], deck: filler(5) });
        player.isCPU = true;
        target.bench[0].damage = game.maxHp(target.bench[0]) - 10;
        runCpuStep(game);
        while (game.pendingPrompt?.player === player) runCpuStep(game);
        expect(game.topCard(target.active).name).toBe('コイル');
    });
});
