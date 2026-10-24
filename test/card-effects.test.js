import { describe, it, expect, afterEach } from 'vitest';
import { CARDS, resolveCardId } from '../public/js/card-data.js';
import { compileAttackText } from '../public/js/cards/attack-effects.js';
import { validateDeck } from '../public/js/deck-rules.js';
import { CARD_POOL } from '../public/js/deck-builder.js';
import { DECKS, expandDeck } from '../public/js/decks.js';
import { startedGame, arrange, answer, C } from './helpers.js';

const LIGHTNING = 'basic-lightning-energy';
const testIds = [];

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    return { game, me: game.current, opp: 1 - game.current };
}

// ワザが1つだけのテスト用のポケモン（ピカチュウの写し）を作る。ワザの効果は文から読み替える
function testPokemon(text, { damage = 0 } = {}) {
    const id = `test-${testIds.length}`;
    const compiled = compileAttackText(text);
    if (!compiled) throw new Error(`読み替えられない: ${text}`);
    CARDS[id] = {
        ...CARDS[C.pikachu],
        id,
        name: `テスト${testIds.length}`,
        attacks: [{ name: 'テスト', cost: ['colorless'], damage, damageText: damage ? String(damage) : '', text, ...compiled }]
    };
    testIds.push(id);
    return id;
}

afterEach(() => {
    testIds.splice(0).forEach(id => delete CARDS[id]);
});

describe('カードのデータ', () => {
    it('スタンダードのカードを、名前と効果で1種類として持つ。前の版のIDは今のIDに読み替える', () => {
        expect(Object.keys(CARDS).length).toBeGreaterThan(2000);
        expect(resolveCardId('charmander')).toBe(C.charmander);
        expect(CARDS[C.charmander].name).toBe('ヒトカゲ');
        expect(resolveCardId(C.charmander)).toBe(C.charmander);
        expect(CARD_POOL.every(id => CARDS[id].supported)).toBe(true);
        expect(CARD_POOL.length).toBeGreaterThan(900);
    });

    it('まだ効果が動かないカードはデッキに入れられない', () => {
        const unsupported = Object.values(CARDS).find(card => card.kind === 'pokemon' && !card.supported);
        const cards = [...expandDeck(DECKS[0]).slice(0, 59), unsupported.id];
        expect(validateDeck(cards)).toContain('まだ使えない');
    });

    it('ACE SPEC のカードは1枚まで', () => {
        CARDS['test-ace-a'] = { ...CARDS[C.potion], id: 'test-ace-a', name: 'エースA', aceSpec: true };
        CARDS['test-ace-b'] = { ...CARDS[C.potion], id: 'test-ace-b', name: 'エースB', aceSpec: true };
        testIds.push('test-ace-a', 'test-ace-b');
        const base = expandDeck(DECKS[0]).slice(0, 58);
        expect(validateDeck([...base, 'test-ace-a', C.potion])).toBeNull();
        expect(validateDeck([...base, 'test-ace-a', 'test-ace-b'])).toContain('ACE SPEC');
    });
});

describe('進化', () => {
    it('進化は名前でつながる（別の版のたねポケモンからも進化できる）', () => {
        const pikachus = Object.values(CARDS).filter(card => card.name === 'ピカチュウ' && card.stage === 0 && card.supported);
        expect(pikachus.length).toBeGreaterThan(1);
        for (const pikachu of pikachus) {
            const { game, me } = midGame();
            const player = arrange(game, me, { active: pikachu.id, hand: [C.raichu] });
            expect(game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.active.id })).toBe(true);
            expect(game.topCard(player.active).name).toBe('ライチュウ');
        }
    });
});

describe('ワザの効果（文の読み替え）', () => {
    it('コインを2回投げ、オモテの数×30ダメージ', () => {
        const id = testPokemon('コインを2回投げ、オモテの数×30ダメージ。', { damage: 30 });
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id, energies: [LIGHTNING] } });
        const target = arrange(game, opp, { active: C.charmander, deck: Array(5).fill(C.potion) });
        game.random = () => 0.1; // オモテ
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(target.active.damage).toBe(60);
    });

    it('次の相手の番、このワザを受けたポケモンは、にげられない', () => {
        const id = testPokemon('次の相手の番、このワザを受けたポケモンは、にげられない。', { damage: 10 });
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id, energies: [LIGHTNING] }, deck: Array(5).fill(C.potion) });
        const target = arrange(game, opp, { active: { id: C.charmander, energies: [LIGHTNING, LIGHTNING] }, bench: [C.pikachu], deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(game.current).toBe(opp);
        expect(game.applyCommand(opp, { type: 'retreat', target: target.bench[0].id })).toBe(false);
        expect(game.lastError).toContain('にげられません');
    });

    it('次の相手の番、このポケモンが受けるワザのダメージは「-30」される', () => {
        const id = testPokemon('次の相手の番、このポケモンが受けるワザのダメージは「-30」される。');
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id, energies: [LIGHTNING] }, deck: Array(5).fill(C.potion) });
        arrange(game, opp, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index: 0 });
        game.applyCommand(opp, { type: 'attack', index: 1 }); // プチボルト 30
        expect(player.active.damage).toBe(0);
    });

    it('次の相手の番、相手は手札からグッズを出して使えない', () => {
        const id = testPokemon('次の相手の番、相手は手札からグッズを出して使えない。', { damage: 10 });
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id, energies: [LIGHTNING] }, deck: Array(5).fill(C.potion) });
        const target = arrange(game, opp, { active: C.charmander, bench: [C.pikachu], hand: [C.switch], deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(game.applyCommand(opp, { type: 'playTrainer', uid: target.hand[0].uid })).toBe(false);
        expect(game.lastError).toContain('グッズ');
    });

    it('相手のベンチポケモン1匹にも、20ダメージ（ベンチは弱点を計算しない）', () => {
        const id = testPokemon('相手のベンチポケモン1匹にも、20ダメージ。［ベンチは弱点・抵抗力を計算しない。］', { damage: 10 });
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id, energies: [LIGHTNING] } });
        const target = arrange(game, opp, { active: C.charmander, bench: [C.magnemite, C.growlithe], deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(game.pendingPrompt.purpose).toBe('snipe-target');
        answer(game, [target.bench[1]]);
        expect(target.active.damage).toBe(10);
        expect(target.bench[1].damage).toBe(20);
        expect(target.bench[0].damage).toBe(0);
    });

    it('読み替えられない文があるワザは null', () => {
        expect(compileAttackText('このポケモンは宇宙を旅する。')).toBeNull();
        expect(compileAttackText('自分の山札を2枚引く。そして宇宙を旅する。')).toBeNull();
        expect(compileAttackText('自分の山札を2枚引く。')).not.toBeNull();
    });
});
