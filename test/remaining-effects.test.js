import { describe, it, expect, afterEach } from 'vitest';
import { CARDS } from '../public/js/card-data.js';
import { startedGame, arrange, answer, makeCard, C } from './helpers.js';

// フックが足されてから書いた、特性・スタジアム・特殊エネルギーの効果

const WATER = 'basic-water-energy';
const PSYCHIC = 'basic-psychic-energy';
const FIGHTING = 'basic-fighting-energy';
const LIGHTNING = 'basic-lightning-energy';
const FIRE = 'basic-fire-energy';

// 実在のカード（catalog.js の id）
const DUGTRIO = 'M2a-206'; // ロケット団のダグトリオ（あなぼこ）
const MISMAGIUS = 'M2-097'; // ムウマージex（うずまくことだま）
const MAGCARGO = 'SV5M-018'; // マグカルゴ（ようがんちたい）
const FLUTTER_MANE = 'SV-P-264'; // ハバタクカミ（あんやのはばたき）
const AMPHAROS = 'SV10-036'; // ロケット団のデンリュウ（ダークインパルス）
const ARBOK = 'SV10-057'; // ロケット団のアーボック（にらみをきかす）
const MELOETTA = 'SV11B-170'; // メロエッタex（デビューライブ）
const WALKING_WAKE = 'SV5K-099'; // ウネルミナモex（こんぺきはとう）
const DREDNAW = 'SV7-026'; // カジリガメ（てっぺきシェル）
const CARBINK = 'MC-752'; // メレシー（ダブルタイプ）
const KORAIDON = 'M5-045'; // コライドン（弱点 [P]。ガイアインパクト）
const PSYDUCK = 'SV-P-262'; // コダック（しめりけ）
const DUSKNOIR = 'SV6a-070'; // ヨノワール（カースドボム）
const GASTRODON = 'SV8-066'; // トリトドン（ねんちゃくしばり）
const GARGANACL = 'M1L-070'; // キョジオーン（2進化・特性ちからのしお）
const MAGMORTAR = 'SV9-014'; // ブーバーン（マグマのはどう）
const PECHARUNT = 'SV8-075'; // モモワロウ（もうどくしはい）
const CLEFAIRY = 'SV9-033'; // リーリエのピッピex（フェアリーゾーン）
const DRATINI = 'M2a-124'; // ミニリュウ（ドラゴン）
const CLAWITZER = 'M1S-068'; // ブロスター（バックリロード）
const FINIZEN = 'SV6-034'; // ナミイルカ
const PALAFIN = 'SV6-035'; // イルカマン（マイティチェンジ）
const PALAFIN_EX = 'SV6-116'; // イルカマンex
const LATIOS = 'M1S-050'; // ラティオス（ラスターアシスト）
const MEGA_LATIAS = 'M1S-088'; // メガラティアスex
const SLOWPOKE = 'M-P-070'; // ヤドン（特性まぬけがお）
const NUZLEAF = 'M1L-008'; // コノハナ（草の1進化）
const SALANDIT = 'SV7-013'; // ヤトウモリ（ひのこ：エネルギーを1個選び、トラッシュする）
const FOREST = 'M1S-061'; // 活力の森
const NITRO = 'M4-081'; // ニトロ炎エネルギー
const BOOMERANG = 'SV5a-066'; // ブーメランエネルギー

const SEEDOT = Object.values(CARDS).find(card => card.kind === 'pokemon' && card.name === CARDS[NUZLEAF].evolvesFrom && card.stage === 0 && card.supported).id;

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    return { game, me: game.current, opp: 1 - game.current };
}

// ワザを受けても倒れない的（弱点・抵抗力なし）
const TARGET = 'test-remaining-target';
function useTarget() {
    CARDS[TARGET] = { ...CARDS[C.pikachu], id: TARGET, hp: 500, weakness: null, resistance: null, ability: null };
}
afterEach(() => { delete CARDS[TARGET]; });

// ワザのダメージを直接与える（相手のワザとして）
function hit(game, attackerOwner, target, amount) {
    const player = game.players[attackerOwner];
    const ctx = { game, player, opponent: game.opponentOf(player), attacker: player.active, defender: target, attack: { name: 'テスト' }, damage: amount, dealt: 0 };
    return game.dealAttackDamage(ctx, target, amount);
}

// 自分の番のまま、バトルポケモンをベンチポケモンと入れ替える
function switchTo(game, playerId, benchIndex) {
    const player = game.players[playerId];
    game.switchActive(player, player.bench[benchIndex]);
    game.processEffects();
}

describe('相手のバトルポケモンがベンチにもどったとき', () => {
    it('あなぼこ：相手の番に、相手のバトルポケモンがベンチにもどるたび、そのポケモンにダメカンを2個のせる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu, bench: [C.magnemite] });
        arrange(game, opp, { active: DUGTRIO });
        const old = player.active;
        switchTo(game, me, 0);
        expect(old.damage).toBe(20);

        // 自分の番に、自分のポケモンがベンチにもどっても働かない
        const second = midGame(2);
        const mine = arrange(second.game, second.me, { active: DUGTRIO, bench: [C.pikachu] });
        const dugtrio = mine.active;
        switchTo(second.game, second.me, 0);
        expect(dugtrio.damage).toBe(0);
    });

    it('うずまくことだま：バトル場にいるかぎり、相手のバトルポケモンがベンチにもどるたび、新しく出てきたポケモンをこんらんにする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.charmander, bench: [C.pikachu] });
        arrange(game, opp, { active: MISMAGIUS });
        switchTo(game, me, 0);
        expect(game.hasCondition(player.active, 'confused')).toBe(true);

        // ベンチにいるときは働かない
        const second = midGame(2);
        const other = arrange(second.game, second.me, { active: C.charmander, bench: [C.pikachu] });
        arrange(second.game, second.opp, { active: C.magnemite, bench: [MISMAGIUS] });
        switchTo(second.game, second.me, 0);
        expect(second.game.hasCondition(other.active, 'confused')).toBe(false);
    });

    it('ようがんちたい：ベンチにいても、相手のバトルポケモンがベンチにもどるたび、新しく出てきたポケモンをやけどにする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.charmander, bench: [C.pikachu] });
        arrange(game, opp, { active: C.magnemite, bench: [MAGCARGO] });
        switchTo(game, me, 0);
        expect(game.hasCondition(player.active, 'burned')).toBe(true);
    });
});

describe('ほかのポケモンの特性をなくす', () => {
    it('あんやのはばたき：バトル場にいるかぎり、相手のバトルポケモンの特性だけがなくなる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: FLUTTER_MANE, bench: [SLOWPOKE] });
        const opponent = arrange(game, opp, { active: SLOWPOKE, bench: [MISMAGIUS] });
        expect(game.abilitySuppressed(opponent.active)).toBe(true);
        expect(game.abilitySuppressed(opponent.bench[0])).toBe(false);
        expect(game.abilitySuppressed(game.players[me].bench[0])).toBe(false);

        const second = midGame(2);
        arrange(second.game, second.me, { active: C.pikachu, bench: [FLUTTER_MANE] });
        const other = arrange(second.game, second.opp, { active: SLOWPOKE });
        expect(second.game.abilitySuppressed(other.active)).toBe(false);
    });

    it('しめりけ：おたがいのポケモンの「使ったなら、このポケモンをきぜつさせる」特性がなくなる。ほかの特性はなくならない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: SLOWPOKE, bench: [DUSKNOIR] });
        arrange(game, opp, { active: PSYDUCK });
        expect(game.abilitySuppressed(player.bench[0])).toBe(true);
        expect(game.checkAbility(player, player.bench[0].id)).toMatch('なくなっています');
        expect(game.abilitySuppressed(player.active)).toBe(false);

        const second = midGame(2);
        const other = arrange(second.game, second.me, { active: C.pikachu, bench: [DUSKNOIR] });
        arrange(second.game, second.opp, { active: C.magnemite });
        expect(second.game.abilitySuppressed(other.bench[0])).toBe(false);
    });

    it('ねんちゃくしばり：ベンチにいるかぎり、おたがいのベンチの2進化ポケモンの特性がなくなる（バトル場の2進化ポケモンはなくならない）', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu, bench: [GASTRODON] });
        const opponent = arrange(game, opp, { active: GARGANACL, bench: [GARGANACL] });
        expect(game.abilitySuppressed(opponent.bench[0])).toBe(true);
        expect(game.abilitySuppressed(opponent.active)).toBe(false);

        const second = midGame(2);
        arrange(second.game, second.me, { active: GASTRODON });
        const other = arrange(second.game, second.opp, { active: C.pikachu, bench: [GARGANACL] });
        expect(second.game.abilitySuppressed(other.bench[0])).toBe(false);
    });
});

describe('相手が手札からポケモンを出すとき', () => {
    it('ダークインパルス：相手が手札から進化させるたび、そのポケモンにダメカンを4個のせる。2匹いても重ならない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: SEEDOT, hand: [NUZLEAF] });
        arrange(game, opp, { active: AMPHAROS, bench: [AMPHAROS] });
        expect(game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.active.id })).toBe(true);
        expect(game.topCard(player.active).name).toBe('コノハナ');
        expect(player.active.damage).toBe(40);
    });

    it('にらみをきかす：バトル場にいるかぎり、相手は手札から特性を持つポケモンを出せない（特性のないポケモンは出せる）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.charmander, bench: [], hand: [SLOWPOKE, C.pikachu] });
        arrange(game, opp, { active: ARBOK });
        expect(game.applyCommand(me, { type: 'playBasic', uid: player.hand[0].uid })).toBe(false);
        expect(game.lastError).toMatch('にらみをきかす');
        expect(game.applyCommand(me, { type: 'playBasic', uid: player.hand[1].uid })).toBe(true);

        const second = midGame(2);
        const other = arrange(second.game, second.me, { active: C.charmander, bench: [], hand: [SLOWPOKE] });
        arrange(second.game, second.opp, { active: C.pikachu, bench: [ARBOK] });
        expect(second.game.applyCommand(second.me, { type: 'playBasic', uid: other.hand[0].uid })).toBe(true);
    });
});

describe('ワザ・ダメージ・タイプ・弱点', () => {
    it('デビューライブ：先攻プレイヤーの最初の番でも、ワザが使える', () => {
        const { game, me } = midGame();
        game.turn = 1;
        const player = arrange(game, me, { active: { id: MELOETTA, energies: [PSYCHIC] } });
        expect(game.checkAttack(player, 0)).toBeNull();
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] } });
        expect(game.checkAttack(player, 0)).toBe('先攻の最初の番はワザを使えません');
    });

    it('こんぺきはとう：このポケモンが使うワザのダメージは、相手のバトルポケモンにかかっている効果を計算しない', () => {
        useTarget();
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: WALKING_WAKE, energies: [WATER, WATER, WATER] } });
        const opponent = arrange(game, opp, { active: TARGET, deck: Array(5).fill(C.potion) });
        game.addEffect(opponent.active, 'damageReduction', game.turn + 1, { amount: 50 });
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(true); // カタルシスロアー 120
        expect(opponent.active.damage).toBe(120);

        // この特性のないポケモンのワザなら、効果を計算する
        const second = midGame(2);
        arrange(second.game, second.me, { active: C.charmander });
        const other = arrange(second.game, second.opp, { active: TARGET });
        second.game.addEffect(other.active, 'damageReduction', second.game.turn + 1, { amount: 50 });
        expect(hit(second.game, second.me, other.active, 120)).toBe(70);
    });

    it('てっぺきシェル：相手のポケモンから「200」以上のワザのダメージを受けない（199以下は受ける）', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.charmander });
        const opponent = arrange(game, opp, { active: DREDNAW });
        expect(hit(game, me, opponent.active, 200)).toBe(0);
        expect(opponent.active.damage).toBe(0);
        expect(hit(game, me, opponent.active, 130)).toBe(130);
    });

    it('ダブルタイプ（メレシー）：場にいるかぎり [F] と [P] の2つのタイプになり、[P] が弱点のポケモンにも弱点を計算する', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: CARBINK });
        const opponent = arrange(game, opp, { active: KORAIDON });
        expect(game.typesOf(player.active).sort()).toEqual(['fighting', 'psychic']);
        expect(hit(game, me, opponent.active, 50)).toBe(100);
    });

    it('フェアリーゾーン：相手の場の [N] ポケモン全員の弱点は [P] になる（自分のポケモンは変わらない）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: CLEFAIRY, bench: [DRATINI] });
        const opponent = arrange(game, opp, { active: DRATINI, bench: [C.pikachu] });
        expect(game.weaknessOf(opponent.active)).toBe('psychic');
        expect(game.weaknessOf(player.bench[0])).toBeNull();
        expect(game.weaknessOf(opponent.bench[0])).toBe(CARDS[C.pikachu].weakness);
        expect(hit(game, me, opponent.active, 20)).toBe(40);
    });
});

describe('どく・やけどのダメージ', () => {
    it('マグマのはどう：相手のやけどのポケモンは、やけどでのせるダメカンが3個多くなる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: MAGMORTAR, deck: Array(5).fill(C.potion) });
        const opponent = arrange(game, opp, { active: C.pikachu, deck: Array(5).fill(C.potion) });
        opponent.active.burned = true;
        game.applyCommand(me, { type: 'endTurn' });
        expect(opponent.active.damage).toBe(50);
    });

    it('もうどくしはい：バトル場にいるかぎり、相手のどくのポケモンは、どくでのせるダメカンが5個多くなる（ベンチでは働かない）', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: PECHARUNT, deck: Array(5).fill(C.potion) });
        const opponent = arrange(game, opp, { active: C.pikachu, deck: Array(5).fill(C.potion) });
        opponent.active.poisoned = true;
        game.applyCommand(me, { type: 'endTurn' });
        expect(opponent.active.damage).toBe(60);

        const second = midGame(2);
        arrange(second.game, second.me, { active: C.charmander, bench: [PECHARUNT], deck: Array(5).fill(C.potion) });
        const other = arrange(second.game, second.opp, { active: C.pikachu, deck: Array(5).fill(C.potion) });
        other.active.poisoned = true;
        second.game.applyCommand(second.me, { type: 'endTurn' });
        expect(other.active.damage).toBe(10);
    });
});

describe('バトル場からベンチにもどったとき・ベンチからバトル場に出たとき', () => {
    it('バックリロード：にげてベンチにもどったとき、手札の「基本水エネルギー」を2枚までこのポケモンにつける', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: CLAWITZER, energies: [WATER, WATER] }, bench: [C.pikachu], hand: [WATER, WATER, WATER] });
        const clawitzer = player.active;
        expect(game.applyCommand(me, { type: 'retreat', target: player.bench[0].id })).toBe(true);
        expect(game.pendingPrompt.type).toBe('confirm');
        answer(game, true);
        answer(game, [player.hand[0].uid, player.hand[1].uid]);
        expect(player.bench).toContain(clawitzer);
        expect(clawitzer.energies.map(inst => inst.id)).toEqual([WATER, WATER]);
        expect(player.hand).toHaveLength(1);
    });

    it('マイティチェンジ：ベンチにもどったとき、山札の「イルカマンex」と入れ替え、ダメカンやエネルギーを引きつぐ。このカードは山札にもどす', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, {
            active: { id: PALAFIN, cards: [FINIZEN, PALAFIN], energies: [WATER], damage: 30 },
            bench: [C.pikachu],
            deck: [PALAFIN_EX, C.potion, C.potion]
        });
        const palafin = player.active;
        switchTo(game, me, 0);
        answer(game, true);
        answer(game, [PALAFIN_EX]);
        expect(player.bench).toContain(palafin);
        expect(game.topCard(palafin).name).toBe('イルカマンex');
        expect(palafin.cards.map(inst => inst.id)).toEqual([FINIZEN, PALAFIN_EX]);
        expect(palafin.damage).toBe(30);
        expect(palafin.energies).toHaveLength(1);
        expect(player.deck.some(inst => inst.id === PALAFIN)).toBe(true);
        expect(player.deck.some(inst => inst.id === PALAFIN_EX)).toBe(false);
    });

    it('ラスターアシスト：自分の番に「メガラティアスex」がベンチからバトル場に出たとき、ベンチのエネルギーを好きなだけつけ替える', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, {
            active: { id: C.pikachu, energies: [LIGHTNING] },
            bench: [{ id: LATIOS, energies: [PSYCHIC] }, { id: MEGA_LATIAS, energies: [FIRE] }]
        });
        switchTo(game, me, 1);
        const latias = player.active;
        expect(game.topCard(latias).name).toBe('メガラティアスex');
        expect(game.pendingPrompt.type).toBe('confirm');
        answer(game, true);
        expect(game.pendingPrompt.cards).toHaveLength(2); // ベンチのラティオスと、ベンチにもどったピカチュウのエネルギー
        answer(game, [PSYCHIC, LIGHTNING]);
        expect(latias.energies.map(inst => inst.id).sort()).toEqual([FIRE, LIGHTNING, PSYCHIC].sort());
        expect(player.bench.every(pokemon => pokemon.energies.length === 0)).toBe(true);

        // ほかのポケモンがバトル場に出ても働かない
        const second = midGame(2);
        arrange(second.game, second.me, { active: C.pikachu, bench: [{ id: LATIOS, energies: [PSYCHIC] }, C.magnemite] });
        switchTo(second.game, second.me, 1);
        expect(second.game.pendingPrompt).toBeNull();
    });
});

describe('スタジアム・特殊エネルギー', () => {
    it('活力の森：[G] ポケモンは、出したばかりの番でも [G] ポケモンに進化できる（最初の自分の番はできない）', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: SEEDOT, enteredTurn: game.turn }, hand: [NUZLEAF] });
        expect(game.checkEvolve(player, player.hand[0].uid, player.active.id)).toBe('この番に出したポケモンは進化できません');
        game.stadium = { inst: makeCard(game, FOREST), owner: me };
        expect(game.checkEvolve(player, player.hand[0].uid, player.active.id)).toBeNull();
        player.turnsTaken = 1;
        expect(game.checkEvolve(player, player.hand[0].uid, player.active.id)).toBe('最初の自分の番は進化できません');
    });

    it('ニトロ炎エネルギー：つけている [R] ポケモンのワザの効果でトラッシュされたなら、ワザの後に手札にもどす', () => {
        useTarget();
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: SALANDIT, energies: [NITRO] }, hand: [] });
        arrange(game, opp, { active: TARGET, deck: Array(5).fill(C.potion) });
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(true); // ひのこ：エネルギーを1個選び、トラッシュする
        if (game.pendingPrompt?.player.id === me) answer(game, [NITRO]);
        expect(game.current).toBe(opp);
        expect(player.active.energies).toHaveLength(0);
        expect(player.hand.map(inst => inst.id)).toEqual([NITRO]);
        expect(player.discard.some(inst => inst.id === NITRO)).toBe(false);
    });

    it('ブーメランエネルギー：つけているポケモンのワザの効果でトラッシュされたなら、ワザの後にもとのポケモンにつけなおす', () => {
        useTarget();
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: KORAIDON, energies: [FIGHTING, FIGHTING, BOOMERANG] } });
        arrange(game, opp, { active: TARGET, deck: Array(5).fill(C.potion) });
        expect(game.applyCommand(me, { type: 'attack', index: 1 })).toBe(true); // ガイアインパクト：エネルギーをすべてトラッシュする
        expect(game.current).toBe(opp);
        expect(player.active.energies.map(inst => inst.id)).toEqual([BOOMERANG]);
        expect(player.discard.filter(inst => inst.id === FIGHTING)).toHaveLength(2);
    });
});
