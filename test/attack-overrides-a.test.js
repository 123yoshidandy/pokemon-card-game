import { describe, it, expect } from 'vitest';
import { CARDS } from '../public/js/card-data.js';
import { startedGame, arrange, answer, makeCard, C } from './helpers.js';

// 手で書いたワザの効果（cards/attack-overrides-a.js）のテスト。カードは catalog.js の実在のもの
const E = {
    fire: 'basic-fire-energy',
    water: 'basic-water-energy',
    lightning: 'basic-lightning-energy',
    psychic: 'basic-psychic-energy',
    fighting: 'basic-fighting-energy',
    darkness: 'basic-darkness-energy',
    metal: 'basic-metal-energy',
    grass: 'basic-grass-energy'
};
const ABSOL = 'M1L-089'; // メガアブソルex（HP280・弱点は草）
const GIRATINA = 'M6-031'; // ギラティナ（HP130）
const filler = n => Array(n).fill(C.potion);

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    return { game, me: game.current, opp: 1 - game.current };
}

// バトルポケモンのワザを名前で使う
function attack(game, playerId, name) {
    const active = game.players[playerId].active;
    const index = game.topCard(active).attacks.findIndex(entry => entry.name === name);
    const ok = game.applyCommand(playerId, { type: 'attack', index });
    if (!ok) throw new Error(game.lastError);
}

const HEADS = () => 0.1;
const TAILS = () => 0.9;

describe('ワザの効果（手で書いたもの・そのa）', () => {
    it('書いたワザを持つカードは、効果が動くカードになる', () => {
        ['M1L-089', 'M2-020', 'M5-030', 'M6-031', 'M5-089', 'SV10-107', 'SV11B-125'].forEach(id => expect(CARDS[id].supported).toBe(true));
    });

    it('デスピリオド：ダメカンがちょうど6個ならきぜつさせ、5個ならなにもしない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: ABSOL, energies: [E.darkness, E.darkness] }, prizes: filler(6), deck: filler(5) });
        const target = arrange(game, opp, { active: { id: GIRATINA, damage: 60 }, bench: [C.pikachu], deck: filler(5) });
        attack(game, me, 'デスピリオド');
        expect(target.active).toBeNull();
        expect(player.prizes.length).toBe(5);

        const second = midGame();
        arrange(second.game, second.me, { active: { id: ABSOL, energies: [E.darkness, E.darkness] }, deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: { id: GIRATINA, damage: 50 }, deck: filler(5) });
        attack(second.game, second.me, 'デスピリオド');
        expect(other.active.damage).toBe(50);
    });

    it('れんごくざん：手札の基本エネルギーが4枚ないなら失敗、あれば4枚トラッシュして220ダメージ', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M2-020', energies: [E.fire] }, hand: [E.fire, E.fire, E.water], deck: filler(5) });
        const target = arrange(game, opp, { active: ABSOL, deck: filler(5) });
        attack(game, me, 'れんごくざん');
        expect(target.active.damage).toBe(0);
        expect(game.logs.some(entry => entry.text === 'ワザは失敗した')).toBe(true);

        const second = midGame();
        const player = arrange(second.game, second.me, { active: { id: 'M2-020', energies: [E.fire] }, hand: [E.fire, E.fire, E.fire, E.fire, C.potion], deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: ABSOL, deck: filler(5) });
        attack(second.game, second.me, 'れんごくざん');
        expect(other.active.damage).toBe(220);
        expect(player.hand.map(inst => inst.id)).toEqual([CARDS[C.potion].id]);
        expect(player.discard.filter(inst => inst.id === E.fire).length).toBe(4);
    });

    it('しびれるまえば：次の相手の番、このワザを受けたポケモンに手札からエネルギーをつけると、ダメカンを8個のせる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M1S-033', energies: [E.lightning] }, deck: filler(5) });
        const target = arrange(game, opp, { active: ABSOL, bench: [C.pikachu], hand: [E.darkness, E.darkness], deck: filler(5) });
        attack(game, me, 'しびれるまえば');
        expect(target.active.damage).toBe(10);
        expect(game.applyCommand(opp, { type: 'attachEnergy', uid: target.hand[0].uid, target: target.bench[0].id })).toBe(true);
        expect(target.bench[0].damage).toBe(0);
        game.turnState.energyAttached = false;
        expect(game.applyCommand(opp, { type: 'attachEnergy', uid: target.hand[0].uid, target: target.active.id })).toBe(true);
        expect(target.active.damage).toBe(90);
    });

    it('きょうれつキッス：次の相手の番の終わりに、このワザを受けたポケモンをトラッシュする（サイドはとらない）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'M5-030', energies: [E.psychic] }, prizes: filler(6), deck: filler(5) });
        const target = arrange(game, opp, { active: GIRATINA, bench: [C.pikachu], deck: filler(5) });
        attack(game, me, 'きょうれつキッス');
        expect(target.active.cards[0].id).toBe(GIRATINA);
        game.applyCommand(opp, { type: 'endTurn' });
        expect(target.active).toBeNull();
        expect(target.discard.some(inst => inst.id === GIRATINA)).toBe(true);
        expect(player.prizes.length).toBe(6);
        expect(game.pendingPrompt.purpose).toBe('promote');
    });

    it('すみふんしゃ：次の相手の番、このワザを受けたポケモンのワザは、コインが1回でもウラなら失敗', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'M4-017', energies: [E.water] }, deck: filler(5) });
        const target = arrange(game, opp, { active: { id: C.pikachu, energies: [E.lightning, E.lightning] }, deck: filler(5) });
        attack(game, me, 'すみふんしゃ');
        expect(target.active.damage).toBe(30);
        game.random = TAILS;
        attack(game, opp, 'プチボルト');
        expect(player.active.damage).toBe(0);
    });

    it('クロノバースト：のぞむなら、エネルギーをすべて山札にもどして80ダメージ追加', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'M1L-047', energies: [E.metal, E.metal, E.metal] }, deck: filler(5) });
        const target = arrange(game, opp, { active: ABSOL, deck: filler(5) });
        attack(game, me, 'クロノバースト');
        expect(game.pendingPrompt.purpose).toBe('optional-bonus');
        answer(game, true);
        expect(target.active.damage).toBe(160);
        expect(player.active.energies.length).toBe(0);
        expect(player.deck.filter(inst => inst.id === E.metal).length).toBe(3);
    });

    it('インフェルノX：場の炎エネルギーを好きなだけトラッシュし、その枚数×90ダメージ', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, {
            active: { id: 'M2a-223', energies: [E.fire, E.fire, E.water] },
            bench: [{ id: C.charmander, energies: [E.fire] }],
            deck: filler(5)
        });
        const target = arrange(game, opp, { active: ABSOL, deck: filler(5) });
        attack(game, me, 'インフェルノX');
        expect(game.pendingPrompt.cards.length).toBe(3);
        answer(game, [player.active.energies[0].uid, player.bench[0].energies[0].uid]);
        expect(target.active.damage).toBe(180);
        expect(player.active.energies.map(inst => inst.id)).toEqual([E.fire, E.water]);
        expect(player.bench[0].energies.length).toBe(0);
    });

    it('サイコプロテクト：次の相手の番、特性を持つポケモンからワザのダメージを受けない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'M4-033', energies: [E.psychic, E.psychic, E.psychic] }, deck: filler(5) });
        // 相手はバトル場のメガアブソルex（特性なし）をにげさせ、特性を持つヒトカゲ（M2-011「みがる」）でワザを使う
        const target = arrange(game, opp, {
            active: { id: ABSOL, energies: [E.darkness, E.darkness] },
            bench: [{ id: 'M2-011', energies: [E.fire] }],
            deck: filler(5)
        });
        attack(game, me, 'サイコプロテクト');
        expect(target.active.damage).toBe(80);
        expect(game.applyCommand(opp, { type: 'retreat', target: target.bench[0].id })).toBe(true);
        attack(game, opp, 'ひだね');
        expect(player.active.damage).toBe(0);
    });

    it('カオスクローラー：次の相手の番はダメージを受けず、続けては使えない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: GIRATINA, energies: [E.psychic, E.psychic, E.psychic] }, hand: [], deck: filler(5) });
        arrange(game, opp, { active: { id: ABSOL, energies: [E.darkness, E.darkness, E.darkness] }, deck: filler(5) });
        attack(game, me, 'カオスクローラー');
        attack(game, opp, 'あくのかぎづめ');
        expect(player.active.damage).toBe(0);
        expect(game.current).toBe(me);
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(false);
        expect(game.lastError).toContain('カオスクローラー');
    });

    it('たいかこうせん：相手の進化しているバトルポケモンから進化カードをはがし、相手の手札にもどす', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M4-090', energies: [E.fighting] }, deck: filler(5) });
        const target = arrange(game, opp, { active: { id: 'M-P-045', cards: [C.charmander, 'M-P-045'] }, hand: [], deck: filler(5) });
        attack(game, me, 'たいかこうせん');
        expect(game.topCard(target.active).name).toBe('ヒトカゲ');
        expect(target.active.damage).toBe(50);
        // 相手の番になって1枚引いているので、手札には引いたカードもある
        expect(target.hand.some(inst => inst.id === 'M-P-045')).toBe(true);
    });

    it('スキルシーフ：手札がないなら、相手の場のポケモンのワザを、このワザとして使う', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M5-089', energies: [E.darkness, E.darkness] }, hand: [], deck: filler(5) });
        const target = arrange(game, opp, { active: C.pikachu, deck: filler(5) });
        attack(game, me, 'スキルシーフ');
        expect(game.pendingPrompt.purpose).toBe('copy-attack');
        answer(game, [game.pendingPrompt.options.findIndex(option => option.includes('プチボルト'))]);
        expect(target.active.damage).toBe(30);

        const second = midGame();
        arrange(second.game, second.me, { active: { id: 'M5-089', energies: [E.darkness, E.darkness] }, hand: [C.potion], deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: C.pikachu, deck: filler(5) });
        attack(second.game, second.me, 'スキルシーフ');
        expect(second.game.pendingPrompt).toBeNull();
        expect(other.active.damage).toBe(0);
    });

    it('メタルブロック：次の相手の番、進化ポケモンから受けるワザのダメージは-100', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'M5-062', energies: [E.metal, E.metal, E.metal] }, deck: filler(5) });
        const target = arrange(game, opp, {
            active: { id: ABSOL, energies: [E.darkness, E.darkness] },
            bench: [{ id: 'M1L-008', energies: [E.grass] }],
            deck: filler(5)
        });
        attack(game, me, 'メタルブロック');
        expect(game.applyCommand(opp, { type: 'retreat', target: target.bench[0].id })).toBe(true);
        attack(game, opp, 'はたく');
        expect(player.active.damage).toBe(0);
    });

    it('ストロングバッシュ：次の相手の番、ワザのダメージを受けたら、受けたダメージぶんのダメカンをワザを使ったポケモンにのせる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV10-107', energies: [E.metal, E.metal, E.metal] }, bench: [C.pikachu], hand: [], deck: filler(5) });
        const target = arrange(game, opp, { active: { id: ABSOL, energies: [E.darkness, E.darkness, E.darkness] }, deck: filler(5) });
        attack(game, me, 'ストロングバッシュ');
        expect(target.active.damage).toBe(70);
        attack(game, opp, 'あくのかぎづめ');
        expect(target.active.damage).toBe(270);
    });

    it('やけつくだいち：相手のスタジアムをトラッシュし、次の相手の番は手札からスタジアムを出せない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'M1S-014', energies: [E.fire] }, deck: filler(5) });
        const target = arrange(game, opp, { active: ABSOL, hand: ['M1S-086'], deck: filler(5) });
        game.stadium = { inst: makeCard(game, 'M1S-062'), owner: opp };
        attack(game, me, 'やけつくだいち');
        expect(game.stadium).toBeNull();
        expect(target.discard.some(inst => inst.id === 'M1S-062')).toBe(true);
        expect(game.applyCommand(opp, { type: 'playTrainer', uid: target.hand.find(inst => inst.id === 'M1S-086').uid })).toBe(false);
        expect(game.lastError).toContain('スタジアム');
    });

    it('トゲトゲローリング：前の自分の番にも使っていたなら、80ダメージ追加', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'MC-514', energies: [E.metal, E.metal] }, deck: filler(5) });
        const target = arrange(game, opp, { active: ABSOL, deck: filler(5) });
        attack(game, me, 'トゲトゲローリング');
        expect(target.active.damage).toBe(80);
        game.applyCommand(opp, { type: 'endTurn' });
        attack(game, me, 'トゲトゲローリング');
        expect(target.active.damage).toBe(240);
    });

    it('バグパニック：山札の下から7枚のうち、バグパニックを持つポケモンの枚数×50ダメージ。ほかのカードはトラッシュ', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, {
            active: { id: 'M5-008', energies: [E.fire, E.fire, E.fire] },
            deck: [...filler(3), 'M5-008', 'M5-008', ...filler(5)]
        });
        const target = arrange(game, opp, { active: ABSOL, deck: filler(5) });
        attack(game, me, 'バグパニック');
        expect(target.active.damage).toBe(100);
        expect(player.discard.filter(inst => inst.id === CARDS[C.potion].id).length).toBe(5);
        expect(player.deck.filter(inst => inst.id === 'M5-008').length).toBe(2);
    });

    it('ハッピープレゼント：おたがいに、手札の基本エネルギーを3枚までつける（相手から）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'M4-018', energies: [E.water] }, hand: [E.fire], deck: filler(5) });
        const target = arrange(game, opp, { active: C.pikachu, bench: [], hand: [E.lightning, E.lightning, C.potion], deck: filler(5) });
        attack(game, me, 'ハッピープレゼント');
        expect(game.pendingPrompt.player.id).toBe(opp);
        answer(game, game.pendingPrompt.cards.map(inst => inst.uid));
        expect(target.active.energies.length).toBe(2);
        expect(game.pendingPrompt.player.id).toBe(me);
        answer(game, [E.fire]);
        expect(player.active.energies.map(inst => inst.id)).toEqual([E.water, E.fire]);
    });

    it('きゅうびうつし：ベンチポケモンのダメカンをすべて、相手のバトルポケモンにのせ替える', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'M4-009', energies: [E.fire] }, bench: [{ id: C.charmander, damage: 40 }], deck: filler(5) });
        const target = arrange(game, opp, { active: ABSOL, deck: filler(5) });
        attack(game, me, 'きゅうびうつし');
        expect(target.active.damage).toBe(40);
        expect(player.bench[0].damage).toBe(0);
    });

    it('さいぼうしんか：自分のポケモン1匹を、山札から進化させる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'SV11B-124', energies: [E.psychic] }, bench: [C.charmander], deck: ['M-P-045', ...filler(4)] });
        arrange(game, opp, { active: ABSOL, deck: filler(5) });
        attack(game, me, 'さいぼうしんか');
        expect(game.pendingPrompt.purpose).toBe('search-evolution');
        answer(game, ['M-P-045']);
        expect(game.topCard(player.bench[0]).name).toBe('リザード');
    });

    it('そらをとぶ：オモテなら次の相手の番ダメージを受けず、ウラなら失敗', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'M5-065', energies: [E.lightning] }, deck: filler(5) });
        const target = arrange(game, opp, { active: { id: C.pikachu, energies: [E.lightning, E.lightning] }, deck: filler(5) });
        game.random = HEADS;
        attack(game, me, 'そらをとぶ');
        expect(target.active.damage).toBe(30);
        attack(game, opp, 'プチボルト');
        expect(player.active.damage).toBe(0);

        const second = midGame();
        arrange(second.game, second.me, { active: { id: 'M5-065', energies: [E.lightning] }, deck: filler(5) });
        const other = arrange(second.game, second.opp, { active: C.pikachu, deck: filler(5) });
        second.game.random = TAILS;
        attack(second.game, second.me, 'そらをとぶ');
        expect(other.active.damage).toBe(0);
    });
});
