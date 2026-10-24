import { describe, it, expect } from 'vitest';
import { CARDS } from '../public/js/card-data.js';
import { startedGame, arrange, answer, makeCard, C } from './helpers.js';

// 「相手のワザの効果を受けない」ポケモン（特性「ばけがくれ」）に、ワザの効果（cards/attack-effects.js・attack-overrides*.js）が働かないことのテスト
// カードは catalog.js の実在のもの
const E = {
    grass: 'basic-grass-energy',
    fire: 'basic-fire-energy',
    psychic: 'basic-psychic-energy',
    fighting: 'basic-fighting-energy',
    darkness: 'basic-darkness-energy',
    metal: 'basic-metal-energy'
};
const CHADES = 'M5-005'; // チャデス（ばけがくれ・HP30・たね）
const YABASOCHA = 'M5-006'; // ヤバソチャ（ばけがくれ・HP60・チャデスから進化）
const JUPPETA = 'M5-032'; // ジュペッタ（ばけがくれ・HP80）
const SPECIAL = 'M3-078'; // グロウ草エネルギー（特殊エネルギー）
const TOOL = 'M2a-163'; // でんきだま（ポケモンのどうぐ）
const COLOSSEUM = 'M2-108'; // バトルコロシアム
const BIG = 'test-big-guard';
const filler = n => Array(n).fill(C.potion);

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    CARDS[BIG] = { ...CARDS[C.pikachu], id: BIG, hp: 900, weakness: null, resistance: null };
    return { game, me: game.current, opp: 1 - game.current };
}

// 自分のバトルポケモン（カードID・つけるエネルギー）でワザを名前で使う
function attackWith(game, playerId, name) {
    const active = game.players[playerId].active;
    const index = game.topCard(active).attacks.findIndex(entry => entry.name === name);
    const ok = game.applyCommand(playerId, { type: 'attack', index });
    if (!ok) throw new Error(game.lastError);
}

const prompt = game => game.pendingPrompt;

describe('ばけがくれ：相手のワザの効果を受けない', () => {
    it('どくづき：ばけがくれのポケモンはどくにならない。ほかのポケモンはどくになる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M1L-072', energies: [E.darkness, E.darkness] }, deck: filler(5) });
        const target = arrange(game, opp, { active: CHADES, bench: [BIG], deck: filler(5) });
        attackWith(game, me, 'どくづき');
        expect(target.active.damage).toBe(20); // ダメージは受ける
        expect(target.active.poisoned).toBe(false);

        const second = midGame();
        arrange(second.game, second.me, { active: { id: 'M1L-072', energies: [E.darkness, E.darkness] }, deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: BIG, deck: filler(5) });
        attackWith(second.game, second.me, 'どくづき');
        expect(other.active.poisoned).toBe(true);
    });

    it('わしづかみ：ばけがくれのポケモンには「にげられない」がつかない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M1L-040', energies: [E.darkness] }, deck: filler(5) });
        const target = arrange(game, opp, { active: CHADES, deck: filler(5) });
        attackWith(game, me, 'わしづかみ');
        expect(game.hasEffect(target.active, 'cannotRetreat')).toBe(false);

        const second = midGame();
        arrange(second.game, second.me, { active: { id: 'M1L-040', energies: [E.darkness] }, deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: BIG, deck: filler(5) });
        attackWith(second.game, second.me, 'わしづかみ');
        expect(second.game.hasEffect(other.active, 'cannotRetreat')).toBe(true);
    });

    it('はかいこうせん：ばけがくれのポケモンのエネルギーはトラッシュされない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M2-062', energies: [E.metal, E.metal, E.metal] }, deck: filler(5) });
        const target = arrange(game, opp, { active: { id: JUPPETA, energies: [E.psychic, E.fire] }, deck: filler(5) });
        attackWith(game, me, 'はかいこうせん');
        expect(prompt(game)).toBeNull();
        expect(target.active.energies).toHaveLength(2);

        const second = midGame();
        arrange(second.game, second.me, { active: { id: 'M2-062', energies: [E.metal, E.metal, E.metal] }, deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: { id: BIG, energies: [E.psychic, E.fire] }, deck: filler(5) });
        attackWith(second.game, second.me, 'はかいこうせん');
        answer(second.game, [E.fire]);
        expect(other.active.energies.map(inst => inst.id)).toEqual([E.psychic]);
    });

    it('このゆびとまれ：ばけがくれのベンチポケモンは選べない。バトル場にいれば入れ替えない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M3-086', energies: [E.psychic] }, deck: filler(5) });
        const target = arrange(game, opp, { active: BIG, bench: [CHADES, C.pikachu], deck: filler(5) });
        attackWith(game, me, 'このゆびとまれ');
        expect(prompt(game).pokemon.map(pk => game.topCard(pk).id)).toEqual([C.pikachu]);
        answer(game, [prompt(game).pokemon[0]]);
        expect(game.topCard(target.active).name).toBe('ピカチュウ');

        const second = midGame();
        arrange(second.game, second.me, { active: { id: 'M3-086', energies: [E.psychic] }, deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: CHADES, bench: [BIG], deck: filler(5) });
        attackWith(second.game, second.me, 'このゆびとまれ');
        expect(prompt(second.game)).toBeNull();
        expect(second.game.topCard(other.active).id).toBe(CHADES);
    });

    it('つきとばす（ベイリーフ）：ばけがくれのバトルポケモンは入れ替えられない。ほかなら、ばけがくれのないベンチだけを出せる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M1S-004', energies: [E.grass, E.grass] }, deck: filler(5) });
        const target = arrange(game, opp, { active: JUPPETA, bench: [BIG], deck: filler(5) });
        attackWith(game, me, 'つきとばす');
        expect(prompt(game)).toBeNull();
        expect(game.topCard(target.active).id).toBe(JUPPETA);

        const second = midGame();
        arrange(second.game, second.me, { active: { id: 'M1S-004', energies: [E.grass, E.grass] }, deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: BIG, bench: [CHADES, C.pikachu], deck: filler(5) });
        attackWith(second.game, second.me, 'つきとばす');
        expect(prompt(second.game).player).toBe(other);
        expect(prompt(second.game).pokemon.map(pk => second.game.topCard(pk).id)).toEqual([C.pikachu]);
        answer(second.game, [prompt(second.game).pokemon[0]]);
        expect(second.game.topCard(other.active).name).toBe('ピカチュウ');
    });

    it('のろいのしずく：ダメカンは、ばけがくれのポケモンとバトルコロシアムのベンチには、のせられない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV6-014', energies: [E.grass] }, deck: filler(5) });
        const target = arrange(game, opp, { active: BIG, bench: [CHADES], deck: filler(5) });
        attackWith(game, me, 'のろいのしずく');
        for (let i = 0; i < 4; i++) {
            expect(prompt(game).pokemon).toEqual([target.active]);
            answer(game, [target.active]);
        }
        expect(target.active.damage).toBe(40);
        expect(target.bench[0].damage).toBe(0);

        // バトルコロシアム：ベンチポケモンには、相手のワザの効果でダメカンがのらない
        const second = midGame();
        arrange(second.game, second.me, { active: { id: 'SV6-014', energies: [E.grass] }, deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: BIG, bench: [C.pikachu], deck: filler(5) });
        second.game.stadium = { inst: makeCard(second.game, COLOSSEUM), owner: second.me };
        attackWith(second.game, second.me, 'のろいのしずく');
        expect(prompt(second.game).pokemon).toEqual([other.active]);
    });

    it('ふきつなめ：相手のポケモン1匹にダメカンをのせるとき、ばけがくれのポケモンは選べない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M6-046', energies: [E.darkness, E.darkness] }, deck: filler(5) });
        const target = arrange(game, opp, { active: CHADES, bench: [BIG], deck: filler(5) });
        attackWith(game, me, 'ふきつなめ');
        // のせられるのが1匹だけなので、選ばずにのせる
        expect(prompt(game)).toBeNull();
        expect(target.active.damage).toBe(0);
        expect(target.bench[0].damage).toBe(50);
    });

    it('たいかこうせん：ばけがくれのポケモンは退化しない。ほかの進化ポケモンは退化して、はがしたカードは手札へ', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M4-090', energies: [E.fighting] }, deck: filler(5) });
        const target = arrange(game, opp, { active: { id: YABASOCHA, cards: [CHADES, YABASOCHA] }, hand: [], deck: filler(5) });
        attackWith(game, me, 'たいかこうせん');
        expect(target.active.damage).toBe(50);
        expect(game.topCard(target.active).id).toBe(YABASOCHA);
        expect(target.hand.some(inst => inst.id === YABASOCHA)).toBe(false);

        const second = midGame();
        arrange(second.game, second.me, { active: { id: 'M4-090', energies: [E.fighting] }, deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: { id: C.charmeleon, cards: [C.charmander, C.charmeleon] }, hand: [], deck: filler(5) });
        attackWith(second.game, second.me, 'たいかこうせん');
        expect(second.game.topCard(other.active).name).toBe('ヒトカゲ');
        expect(other.hand.some(inst => inst.id === C.charmeleon)).toBe(true);
    });

    it('きゅうびうつし：ばけがくれのバトルポケモンには、ダメカンをのせ替えられない（自分のベンチのダメカンもそのまま）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'M4-009', energies: [E.fire] }, bench: [{ id: C.pikachu, damage: 30 }], deck: filler(5) });
        const target = arrange(game, opp, { active: CHADES, deck: filler(5) });
        attackWith(game, me, 'きゅうびうつし');
        expect(target.active.damage).toBe(0);
        expect(player.bench[0].damage).toBe(30);

        const second = midGame();
        const mine = arrange(second.game, second.me, { active: { id: 'M4-009', energies: [E.fire] }, bench: [{ id: C.pikachu, damage: 30 }], deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: BIG, deck: filler(5) });
        attackWith(second.game, second.me, 'きゅうびうつし');
        expect(other.active.damage).toBe(30);
        expect(mine.bench[0].damage).toBe(0);
    });

    it('きゅうびうつし：場に「かんしのめ」のポケモンがいれば、ダメカンはのせ替えられない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'M4-009', energies: [E.fire] }, bench: [{ id: C.pikachu, damage: 30 }], deck: filler(5) });
        const target = arrange(game, opp, { active: BIG, bench: ['M-P-141'], deck: filler(5) });
        attackWith(game, me, 'きゅうびうつし');
        expect(target.active.damage).toBe(0);
        expect(player.bench[0].damage).toBe(30);
    });

    it('ふしょくえき：ばけがくれのポケモンのどうぐと特殊エネルギーはトラッシュされない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M4-116', energies: [E.psychic, E.psychic] }, deck: filler(5) });
        const target = arrange(game, opp, {
            active: { id: CHADES, energies: [SPECIAL], tool: TOOL },
            bench: [{ id: BIG, energies: [SPECIAL, E.grass], tool: TOOL }],
            deck: filler(5)
        });
        attackWith(game, me, 'ふしょくえき');
        expect(target.active.tool).toBeTruthy();
        expect(target.active.energies.map(inst => inst.id)).toEqual([SPECIAL]);
        expect(target.bench[0].tool).toBeNull();
        expect(target.bench[0].energies.map(inst => inst.id)).toEqual([E.grass]);
    });

    it('とっぷうがえし：ばけがくれのポケモンは山札にもどせない（選べるのは、ばけがくれのないポケモンだけ）', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M1L-009', energies: [E.grass] }, deck: filler(5) });
        const target = arrange(game, opp, { active: CHADES, bench: [BIG], deck: filler(5) });
        game.random = () => 0.1; // オモテ
        attackWith(game, me, 'とっぷうがえし');
        expect(game.topCard(target.active).id).toBe(CHADES);
        expect(target.bench).toHaveLength(0);
        expect(target.deck.some(inst => inst.id === BIG)).toBe(true);
    });

    it('ゴーストブロー：ばけがくれのベンチポケモンには、ダメカンをのせられない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M5-039', energies: [E.psychic, E.psychic] }, deck: filler(5) });
        const target = arrange(game, opp, { active: BIG, bench: [CHADES, C.pikachu], deck: filler(5) });
        attackWith(game, me, 'ゴーストブロー');
        expect(prompt(game)).toBeNull();
        expect(target.bench[0].damage).toBe(0);
        expect(target.bench[1].damage).toBe(50);
    });
});
