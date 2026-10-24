import { describe, it, expect } from 'vitest';
import { CARDS, resolveCardId } from '../public/js/card-data.js';
import { TRAINER_EFFECTS } from '../public/js/cards/trainers/supporters.js';
import { runCpuStep } from '../public/js/cpu-player.js';
import { startedGame, arrange, answer, C } from './helpers.js';

const LIGHTNING = 'basic-lightning-energy';
const WATER = 'basic-water-energy';
const FIRE = 'basic-fire-energy';
const DARKNESS = 'basic-darkness-energy';
const SPECIAL = resolveCardId('M3-078'); // グロウ草エネルギー（特殊エネルギー）
const ZORUA = resolveCardId('M1L-041'); // クスネ（悪のたねポケモン）
const FILLER = Array(10).fill(C.potion);

// サポートのカードIDを名前で引く
const S = name => Object.values(CARDS).find(card => card.kind === 'trainer' && card.trainerType === 'supporter' && card.name === name).id;

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    return { game, me: game.current, opp: 1 - game.current };
}

function play(game, playerId, name) {
    const inst = game.players[playerId].hand.find(card => game.cardName(card) === name);
    return game.applyCommand(playerId, { type: 'playTrainer', uid: inst.uid });
}

// 前の相手の番に、ワザで自分のポケモンがきぜつしたことにする
function knockedOutLastTurn(game, player, name = 'ピカチュウ') {
    player.knockedOutByAttackTurn = game.turn - 1;
    player.knockedOutByAttackNames = [name];
}

describe('サポートの効果', () => {
    it('書いたサポートは使えるカードになり、どれも CPU の判断（cpuWants）を持つ', () => {
        const names = Object.keys(TRAINER_EFFECTS);
        expect(names.length).toBeGreaterThanOrEqual(60);
        names.forEach(name => {
            expect(CARDS[S(name)].supported, name).toBe(true);
            expect(typeof TRAINER_EFFECTS[name].cpuWants, name).toBe('function');
        });
    });

    it('ネモ：山札を3枚引く', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { hand: [S('ネモ')], deck: FILLER });
        expect(play(game, me, 'ネモ')).toBe(true);
        expect(player.hand).toHaveLength(3);
        expect(player.discard.map(inst => game.cardName(inst))).toContain('ネモ');
    });

    it('ビリオとネア：2枚引いた後、手札が10枚以上なら、さらに2枚引く', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { hand: [S('ビリオとネア'), ...Array(9).fill(C.potion)], deck: FILLER });
        play(game, me, 'ビリオとネア');
        expect(player.hand).toHaveLength(13);

        const small = arrange(game, me, { hand: [S('ビリオとネア'), C.potion], deck: FILLER });
        game.turnState.supporterPlayed = false;
        play(game, me, 'ビリオとネア');
        expect(small.hand).toHaveLength(3);
    });

    it('マツバの確信：手札を1枚トラッシュしなければ使えない。相手のベンチの数ぶん引く', () => {
        const { game, me, opp } = midGame();
        arrange(game, opp, { bench: [C.pikachu, C.charmander] });
        const player = arrange(game, me, { hand: [S('マツバの確信')], deck: FILLER });
        expect(play(game, me, 'マツバの確信')).toBe(false);

        arrange(game, me, { hand: [S('マツバの確信'), C.switch] });
        expect(play(game, me, 'マツバの確信')).toBe(true);
        expect(game.pendingPrompt.purpose).toBe('supporter-discard-hand');
        answer(game, [C.switch]);
        expect(player.hand).toHaveLength(2);
        expect(player.discard.map(inst => game.cardName(inst))).toContain('ポケモンいれかえ');
    });

    it('グラジオの決戦：手札がこのカードだけのときに使え、ルールを持たないポケモンのワザの、相手のバトルポケモンへのダメージが+80', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, hand: [S('グラジオの決戦'), C.potion], deck: FILLER });
        const target = arrange(game, opp, { active: C['mega-charizard-y-ex'], deck: FILLER });
        expect(play(game, me, 'グラジオの決戦')).toBe(false);

        arrange(game, me, { hand: [S('グラジオの決戦')] });
        expect(play(game, me, 'グラジオの決戦')).toBe(true);
        game.applyCommand(me, { type: 'attack', index: 1 }); // プチボルト 30
        expect(target.active.damage).toBe(110);
    });

    it('マチスの取引：相手がのぞめば、おたがいにサイドを1枚とる。のぞまなければ自分が4枚引く', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: [S('マチスの取引')], deck: FILLER, prizes: Array(6).fill(C.potion) });
        const other = arrange(game, opp, { hand: [], prizes: Array(6).fill(C.potion) });
        play(game, me, 'マチスの取引');
        expect(game.pendingPrompt.player).toBe(other);
        answer(game, true);
        expect(player.prizes).toHaveLength(5);
        expect(other.prizes).toHaveLength(5);
        expect(player.hand).toHaveLength(1);
        expect(other.hand).toHaveLength(1);

        game.turnState.supporterPlayed = false;
        arrange(game, me, { hand: [S('マチスの取引')] });
        play(game, me, 'マチスの取引');
        answer(game, false);
        expect(player.hand).toHaveLength(4);
        expect(player.prizes).toHaveLength(5);
    });

    it('クセロシキのたくらみ：相手が自分で選んで、手札が3枚になるようにトラッシュする', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { hand: [S('クセロシキのたくらみ')] });
        const other = arrange(game, opp, { hand: [C.potion, C.potion, C.switch, C.switch, C.pikachu, C.pikachu] });
        play(game, me, 'クセロシキのたくらみ');
        expect(game.pendingPrompt.player).toBe(other);
        expect(game.pendingPrompt.min).toBe(3);
        answer(game, other.hand.slice(0, 3).map(inst => inst.uid));
        expect(other.hand).toHaveLength(3);
        expect(other.discard).toHaveLength(3);
    });

    it('ビワ：相手の手札を見て、グッズを2枚までトラッシュする（グッズでないものは選べない）', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { hand: [S('ビワ')] });
        const other = arrange(game, opp, { hand: [C.potion, C.switch, C.pikachu, S('ネモ')] });
        play(game, me, 'ビワ');
        expect(game.pendingPrompt.cards).toHaveLength(2);
        answer(game, [C.potion, C.switch]);
        expect(other.hand.map(inst => game.cardName(inst))).toEqual(['ピカチュウ', 'ネモ']);
    });

    it('ハッサク：前の相手の番に自分のポケモンがきぜつしていなければ使えない。上から8枚から3枚まで手札に加える', () => {
        const { game, me } = midGame();
        const deck = [C.pikachu, C.raichu, C.switch, C.potion, C.charmander, C.magnemite, C.magneton, C.magnezone, C.growlithe, C.arcanine];
        const player = arrange(game, me, { hand: [S('ハッサク')], deck });
        expect(play(game, me, 'ハッサク')).toBe(false);

        knockedOutLastTurn(game, player);
        expect(play(game, me, 'ハッサク')).toBe(true);
        expect(game.pendingPrompt.cards).toHaveLength(8);
        expect(game.pendingPrompt.cards.map(inst => inst.id)).not.toContain(C.growlithe);
        answer(game, [C.raichu, C.magnezone, C.switch]);
        expect(player.hand.map(inst => game.cardName(inst)).sort()).toEqual(['ジバコイル', 'ポケモンいれかえ', 'ライチュウ'].sort());
        expect(player.deck).toHaveLength(7);
    });

    it('ルチアのアピール：相手のベンチのたねポケモンだけを呼び出し、こんらんにする', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { hand: [S('ルチアのアピール')] });
        const other = arrange(game, opp, { active: C.charmander, bench: [{ id: C.raichu, cards: [C.pikachu, C.raichu] }, C.magnemite] });
        play(game, me, 'ルチアのアピール');
        expect(game.pendingPrompt.pokemon).toHaveLength(1);
        answer(game, [other.bench[1]]);
        expect(game.topCard(other.active).name).toBe('コイル');
        expect(game.hasCondition(other.active, 'confused')).toBe(true);
    });

    it('怖いお兄さん：相手のポケモン1匹の、どうぐと特殊エネルギーを1枚ずつトラッシュする', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { hand: [S('怖いお兄さん')] });
        const other = arrange(game, opp, { active: { id: C.pikachu, tool: C['float-stone'], energies: [LIGHTNING, SPECIAL] }, bench: [C.charmander] });
        play(game, me, '怖いお兄さん');
        expect(game.pendingPrompt.pokemon).toEqual([other.active]);
        answer(game, [other.active]);
        expect(other.active.tool).toBeNull();
        expect(other.active.energies.map(inst => inst.id)).toEqual([LIGHTNING]);
        expect(other.discard.map(inst => inst.id).sort()).toEqual([C['float-stone'], SPECIAL].sort());
    });

    it('サビ組のしたっぱ：前の相手の番に自分のポケモンがきぜつしていれば、相手のエネルギーを1個トラッシュする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: [S('サビ組のしたっぱ')] });
        const other = arrange(game, opp, { active: { id: C.pikachu, energies: [LIGHTNING, WATER] }, bench: [] });
        expect(play(game, me, 'サビ組のしたっぱ')).toBe(false);

        knockedOutLastTurn(game, player);
        play(game, me, 'サビ組のしたっぱ');
        answer(game, [other.active]);
        answer(game, [WATER]);
        expect(other.active.energies.map(inst => inst.id)).toEqual([LIGHTNING]);
    });

    it('AZの安らぎ：ポケモンexをベンチに入れ替えたら、HPを80回復する', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C['miraidon-ex'], damage: 100 }, bench: [C.pikachu], hand: [S('AZの安らぎ')] });
        const ex = player.active;
        play(game, me, 'AZの安らぎ');
        answer(game, [player.bench[0]]);
        expect(game.topCard(player.active).name).toBe('ピカチュウ');
        expect(ex.damage).toBe(20);
    });

    it('ヒガナの信頼：入れ替えた後、ベンチに下がったポケモンのエネルギーを1個、新しいバトルポケモンにつけ替える', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, WATER] }, bench: [C.charmander], hand: [S('ヒガナの信頼')] });
        const old = player.active;
        play(game, me, 'ヒガナの信頼');
        answer(game, [player.bench[0]]);
        answer(game, [WATER]);
        expect(player.active.energies.map(inst => inst.id)).toEqual([WATER]);
        expect(old.energies.map(inst => inst.id)).toEqual([LIGHTNING]);
    });

    it('ポケモンセンターのお姉さん：HPを60回復し、特殊状態を治す（ワザの効果は残る）', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.raichu, cards: [C.pikachu, C.raichu], damage: 80 }, bench: [C.charmander], hand: [S('ポケモンセンターのお姉さん')] });
        game.addCondition(player.active, 'poisoned');
        game.addCondition(player.active, 'paralyzed');
        game.addEffect(player.active, 'cannotRetreat', game.turn + 1);
        play(game, me, 'ポケモンセンターのお姉さん');
        answer(game, [player.active]);
        expect(player.active.damage).toBe(20);
        expect(game.hasAnyCondition(player.active)).toBe(false);
        expect(game.hasEffect(player.active, 'cannotRetreat')).toBe(true);
    });

    it('ベルのまごころ：残りHPが30以下のポケモンがいなければ使えない。いればHPをすべて回復する', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, damage: 30 }, hand: [S('ベルのまごころ')] });
        expect(play(game, me, 'ベルのまごころ')).toBe(false);
        player.active.damage = 40;
        expect(play(game, me, 'ベルのまごころ')).toBe(true);
        answer(game, [player.active]);
        expect(player.active.damage).toBe(0);
    });

    it('ヒカリ：たね・1進化・2進化を1枚ずつ選んで手札に加える', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { hand: [S('ヒカリ')], deck: [C.magnemite, C.magneton, C.magnezone, C.potion, C.potion] });
        play(game, me, 'ヒカリ');
        expect(game.pendingPrompt.cards.map(inst => inst.id)).toEqual([C.magnemite]);
        answer(game, [C.magnemite]);
        expect(game.pendingPrompt.cards.map(inst => inst.id)).toEqual([C.magneton]);
        answer(game, [C.magneton]);
        answer(game, [C.magnezone]);
        expect(player.hand.map(inst => game.cardName(inst))).toEqual(['コイル', 'レアコイル', 'ジバコイル']);
        expect(player.deck).toHaveLength(2);
    });

    it('アカマツ：ちがうタイプの基本エネルギーを2枚選び、1枚を手札に、もう1枚を自分のポケモンにつける', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.charmander, bench: [], hand: [S('アカマツ')], deck: [FIRE, FIRE, WATER, C.potion] });
        play(game, me, 'アカマツ');
        answer(game, [FIRE]);
        expect(game.pendingPrompt.cards.map(inst => inst.id)).toEqual([WATER]);
        answer(game, [WATER]);
        answer(game, [WATER]); // 手札に加える方
        expect(player.hand.map(inst => inst.id)).toEqual([WATER]);
        expect(player.active.energies.map(inst => inst.id)).toEqual([FIRE]);
        expect(player.deck).toHaveLength(2);
    });

    it('タケシのスカウト：進化ポケモンを選べば、進化ポケモンだけを1枚探す', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { hand: [S('タケシのスカウト')], deck: [C.pikachu, C.raichu, C.potion] });
        play(game, me, 'タケシのスカウト');
        answer(game, [1]);
        expect(game.pendingPrompt.cards.map(inst => inst.id)).toEqual([C.raichu]);
        answer(game, [C.raichu]);
        expect(player.hand.map(inst => inst.id)).toEqual([C.raichu]);
    });

    it('カスミの元気：基本水エネルギーを4枚まで1匹につけ、自分の番が終わる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu, bench: [C.charmander], hand: [S('カスミの元気')], deck: [WATER, WATER, WATER, C.potion, WATER] });
        arrange(game, opp, { deck: FILLER });
        play(game, me, 'カスミの元気');
        answer(game, [WATER, WATER, WATER, WATER].map((_, index) => game.pendingPrompt.cards[index].uid));
        answer(game, [player.bench[0]]);
        expect(player.bench[0].energies.map(inst => inst.id)).toEqual([WATER, WATER, WATER, WATER]);
        expect(game.current).toBe(opp);
    });

    it('アンズの秘技：悪ポケモン2匹に基本悪エネルギーを1枚ずつつけ、バトルポケモンはどくになる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: ZORUA, bench: [ZORUA, C.pikachu], hand: [S('アンズの秘技')], deck: [DARKNESS, C.potion, DARKNESS] });
        play(game, me, 'アンズの秘技');
        expect(game.pendingPrompt.pokemon).toHaveLength(2);
        answer(game, [player.active, player.bench[0]]);
        expect(player.active.energies.map(inst => inst.id)).toEqual([DARKNESS]);
        expect(player.bench[0].energies.map(inst => inst.id)).toEqual([DARKNESS]);
        expect(game.hasCondition(player.active, 'poisoned')).toBe(true);
        expect(game.hasCondition(player.bench[0], 'poisoned')).toBe(false);
    });

    it('ナンジャモ：おたがいに手札を山札の下にもどし、それぞれサイドの残り枚数ぶん引く', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: [S('ナンジャモ'), C.potion, C.potion], deck: FILLER, prizes: Array(3).fill(C.potion) });
        const other = arrange(game, opp, { hand: [C.pikachu], deck: FILLER, prizes: Array(5).fill(C.potion) });
        play(game, me, 'ナンジャモ');
        expect(player.hand).toHaveLength(3);
        expect(other.hand).toHaveLength(5);
        expect(game.cardName(other.deck[other.deck.length - 1])).toBe('ピカチュウ');
    });

    it('タイム：相手がHPを当てれば相手が4枚、外せば自分が4枚引く。置いたポケモンは手札にもどる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: [S('タイム'), C.pikachu], deck: FILLER });
        const other = arrange(game, opp, { hand: [], deck: FILLER });
        play(game, me, 'タイム');
        answer(game, [C.pikachu]);
        expect(game.pendingPrompt.player).toBe(other);
        answer(game, [game.pendingPrompt.options.indexOf(`HP${CARDS[C.pikachu].hp}`)]);
        expect(other.hand).toHaveLength(4);
        expect(player.hand.map(inst => inst.id)).toEqual([C.pikachu]);

        game.turnState.supporterPlayed = false;
        arrange(game, me, { hand: [S('タイム'), C.pikachu] });
        play(game, me, 'タイム');
        answer(game, [C.pikachu]);
        answer(game, [game.pendingPrompt.options.indexOf('HP300')]);
        expect(player.hand).toHaveLength(5);
    });

    it('セイジ：この番に出したばかりのポケモンでも、山札から特性のない進化ポケモンで進化させる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, enteredTurn: 3 }, hand: [S('セイジ')], deck: [C.raichu, C.magneton, C.potion] });
        play(game, me, 'セイジ');
        answer(game, [player.active]);
        expect(game.pendingPrompt.cards.map(inst => inst.id)).toEqual([C.raichu]);
        answer(game, [C.raichu]);
        expect(game.topCard(player.active).name).toBe('ライチュウ');
        expect(player.hand).toHaveLength(0);
    });

    it('ロケット団のアポロ：前の相手の番に「ロケット団のポケモン」がきぜつしていなければ使えない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: [S('ロケット団のアポロ'), C.potion], deck: FILLER });
        const other = arrange(game, opp, { hand: [C.potion, C.potion, C.potion, C.potion], deck: FILLER });
        knockedOutLastTurn(game, player, 'ピカチュウ');
        expect(play(game, me, 'ロケット団のアポロ')).toBe(false);
        knockedOutLastTurn(game, player, 'ロケット団のニャース');
        expect(play(game, me, 'ロケット団のアポロ')).toBe(true);
        expect(player.hand).toHaveLength(5);
        expect(other.hand).toHaveLength(3);
    });

    it('CPU は、手札が少ないときに山札を引くサポートを使う', () => {
        const { game, me } = midGame();
        game.players[me].isCPU = true;
        const player = arrange(game, me, { active: C.pikachu, bench: [], hand: [S('ネモ')], deck: FILLER });
        expect(runCpuStep(game)).toBe(true);
        expect(player.hand).toHaveLength(3);
        expect(game.turnState.supporterPlayed).toBe(true);
    });

    it('CPU の相手は、マチスの取引の問いに自分で答える', () => {
        const { game, me, opp } = midGame();
        game.players[opp].isCPU = true;
        arrange(game, me, { hand: [S('マチスの取引')], deck: FILLER, prizes: Array(2).fill(C.potion) });
        const other = arrange(game, opp, { hand: [], prizes: Array(5).fill(C.potion) });
        play(game, me, 'マチスの取引');
        expect(runCpuStep(game)).toBe(true);
        // 相手（CPU）はサイドで負けているので、のぞまない
        expect(other.prizes).toHaveLength(5);
        expect(game.players[me].hand).toHaveLength(4);
    });
});
