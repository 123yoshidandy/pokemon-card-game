import { describe, it, expect } from 'vitest';
import Game, { PRIZE_COUNT } from '../public/js/game.js';
import { CARDS } from '../public/js/card-data.js';
import { validateDeck } from '../public/js/deck-rules.js';
import { isStandardLegal, STANDARD_MARKS } from '../public/js/regulation.js';
import { DECKS, expandDeck } from '../public/js/decks.js';
import { startedGame, arrange, snapshot, answer, makeCard, deckOptions, PLAYERS, C } from './helpers.js';

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    game.turnState.supporterPlayed = false;
    return { game, me: game.current, opp: 1 - game.current };
}

const FIRE = 'basic-fire-energy';
const LIGHTNING = 'basic-lightning-energy';
const MEGA_Y = { id: C['mega-charizard-y-ex'], cards: [C.charmander, C.charmeleon, C['mega-charizard-y-ex']] };
const MAGNEZONE = { id: C.magnezone, cards: [C.magnemite, C.magneton, C.magnezone] };
const heads = game => { game.random = () => 0.1; };
const tails = game => { game.random = () => 0.9; };

describe('準備', () => {
    it('手札7枚から始め、サイドを6枚置き、バトル場にたねポケモンを出す', () => {
        const game = startedGame(3);
        game.players.forEach(player => {
            expect(player.prizes).toHaveLength(PRIZE_COUNT);
            expect(player.active).not.toBeNull();
            expect(game.topCard(player.active).stage).toBe(0);
            expect(player.active.faceDown).toBe(false);
            expect(player.deck.length + player.hand.length + player.prizes.length + game.inPlay(player).length).toBe(60);
        });
        expect(game.phase).toBe('main');
        expect(game.turn).toBe(1);
        expect(game.current).toBe(game.firstPlayer);
    });

    it('準備中にウラで出したポケモンは、相手のビューに中身が出ない', async () => {
        const { createGameView } = await import('../public/js/game-view.js');
        const game = new Game(PLAYERS, deckOptions(5));
        game.setup();
        while (game.pendingPrompt?.purpose !== 'setup-active' || game.pendingPrompt.player.id !== 1) {
            const prompt = game.pendingPrompt;
            game.applyCommand(prompt.player.id, { type: 'answer', answer: prompt.type === 'cards' ? [0] : prompt.min ? [0] : [] });
        }
        const view = createGameView(game, 1);
        expect(view.players[0].active.faceDown).toBe(true);
        expect(view.players[0].active.top).toBeUndefined();
    });

    it('相手のマリガンの回数まで、追加で引ける', () => {
        let found = false;
        for (let seed = 1; seed < 300 && !found; seed++) {
            const game = new Game(PLAYERS, deckOptions(seed));
            game.setup();
            while (game.phase === 'setup' || game.pendingPrompt) {
                const prompt = game.pendingPrompt;
                if (prompt.purpose === 'mulligan-draw') {
                    found = true;
                    const before = prompt.player.hand.length;
                    const max = prompt.options.length - 1;
                    expect(max).toBe(game.opponentOf(prompt.player).mulligans);
                    game.applyCommand(prompt.player.id, { type: 'answer', answer: [max] });
                    expect(prompt.player.hand.length).toBe(before + max);
                    continue;
                }
                game.applyCommand(prompt.player.id, { type: 'answer', answer: prompt.type === 'choose' || prompt.min ? [0] : [] });
            }
        }
        expect(found).toBe(true);
    });
});

describe('レギュレーション', () => {
    it('スタンダードは H・I・J。カードはどれもスタンダードで、基本エネルギーはマークがなくても使える', () => {
        expect(STANDARD_MARKS).toEqual(['H', 'I', 'J']);
        Object.values(CARDS).forEach(card => expect(isStandardLegal(card), card.name).toBe(true));
        expect(CARDS[FIRE].regulation).toBeNull();
        expect(isStandardLegal({ kind: 'trainer', regulation: 'G' })).toBe(false);
    });

    it('スタンダードで使えないカードの入ったデッキは断る。構築済みデッキはどちらも使える', () => {
        CARDS['old-card'] = { ...CARDS[C.potion], id: 'old-card', name: '古いカード', regulation: 'G' };
        const cards = [...expandDeck(DECKS[0]).slice(0, 59), 'old-card'];
        expect(validateDeck(cards)).toContain('スタンダードで使えない');
        delete CARDS['old-card'];
        DECKS.forEach(deck => expect(validateDeck(expandDeck(deck))).toBeNull());
    });
});

describe('最初の番の制限', () => {
    it('先攻の最初の番は、ワザとサポートを使えない（ゼイユは使える）', () => {
        const game = startedGame(2);
        const me = game.current;
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING] }, hand: [C.guy, C.zeiyu], deck: Array(10).fill(FIRE) });
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(false);
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(false);
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[1].uid })).toBe(true);
        expect(player.hand).toHaveLength(5);
    });

    it('最初の自分の番と、出したばかりのポケモンは進化できない', () => {
        const game = startedGame(2);
        const me = game.current;
        arrange(game, me, { active: C.pikachu, hand: [C.raichu] });
        const player = game.players[me];
        expect(game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.active.id })).toBe(false);

        const { game: later, me: p } = midGame(2);
        arrange(later, p, { active: C.pikachu, hand: [C.raichu, C.pikachu] });
        const lp = later.players[p];
        later.applyCommand(p, { type: 'playBasic', uid: lp.hand[1].uid });
        const fresh = lp.bench[lp.bench.length - 1];
        expect(later.applyCommand(p, { type: 'evolve', uid: lp.hand[0].uid, target: fresh.id })).toBe(false);
        expect(later.applyCommand(p, { type: 'evolve', uid: lp.hand[0].uid, target: lp.active.id })).toBe(true);
        expect(later.topCard(lp.active).id).toBe(C.raichu);
    });
});

describe('エネルギーとワザ', () => {
    it('エネルギーは1ターンに1回だけ手札からつけられる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [LIGHTNING, LIGHTNING] });
        expect(game.applyCommand(me, { type: 'attachEnergy', uid: player.hand[0].uid, target: player.active.id })).toBe(true);
        expect(game.applyCommand(me, { type: 'attachEnergy', uid: player.hand[0].uid, target: player.active.id })).toBe(false);
        expect(player.active.energies).toHaveLength(1);
    });

    it('エネルギーが足りないワザは使えない。無色はどのエネルギーでも払える', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.raichu, cards: [C.pikachu, C.raichu], energies: [LIGHTNING, FIRE] } });
        expect(game.canPayCost(player.active, ['lightning', 'lightning', 'colorless'])).toBe(false);
        player.active.energies.push(makeCard(game, LIGHTNING));
        expect(game.canPayCost(player.active, ['lightning', 'lightning', 'colorless'])).toBe(true);
        expect(game.canPayCost(player.active, ['fire', 'fire'])).toBe(false);
    });

    it('弱点のタイプのワザは2倍、抵抗力のタイプは30減る', () => {
        CARDS['test-water'] = { ...CARDS[C.magnemite], id: 'test-water', name: '水のテスト', type: 'water', resistance: 'lightning' };
        const { game, me, opp } = midGame();
        arrange(game, me, { active: 'test-water' });
        arrange(game, opp, { active: C.charmander });
        game.dealAttackDamage({ attacker: game.players[me].active }, game.players[opp].active, 30);
        expect(game.players[opp].active.damage).toBe(60);
        const pikachu = { attacker: arrange(game, opp, { active: C.pikachu }).active };
        game.dealAttackDamage(pikachu, game.players[me].active, 20);
        expect(game.players[me].active.damage).toBe(0);
        delete CARDS['test-water'];
    });

    it('ワザを使うと番が終わり、相手の番になる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] } });
        arrange(game, opp, { active: C.growlithe, deck: [C.potion, C.potion] });
        const turn = game.turn;
        expect(game.applyCommand(me, { type: 'attack', index: 1 })).toBe(true);
        expect(game.players[opp].active.damage).toBe(30);
        expect(game.turn).toBe(turn + 1);
        expect(game.current).toBe(opp);
        expect(game.players[opp].hand.some(inst => inst.id === C.potion)).toBe(true);
    });

    it('ベンチのテラスタルのポケモンはワザのダメージを受けない', () => {
        CARDS['test-tera'] = { ...CARDS[C.pikachu], id: 'test-tera', tera: true };
        const { game, me, opp } = midGame();
        arrange(game, me, { active: C.pikachu });
        arrange(game, opp, { active: C.charmander, bench: ['test-tera'] });
        const ctx = { attacker: game.players[me].active };
        game.dealAttackDamage(ctx, game.players[opp].bench[0], 100);
        expect(game.players[opp].bench[0].damage).toBe(0);
        delete CARDS['test-tera'];
    });

    it('プロージョンY：エネルギーを3個トラッシュし、選んだポケモンに280。ベンチは弱点を計算しない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { ...MEGA_Y, energies: [FIRE, FIRE, FIRE, FIRE] } });
        CARDS['test-water-weak'] = { ...CARDS[C.pikachu], id: 'test-water-weak', hp: 300, weakness: 'fire' };
        const target = arrange(game, opp, { active: C.growlithe, bench: ['test-water-weak'] });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(player.active.energies).toHaveLength(1);
        expect(game.pendingPrompt.purpose).toBe('snipe-target');
        answer(game, [target.bench[0]]);
        expect(target.bench[0].damage).toBe(280);
        expect(target.active.damage).toBe(0);
        delete CARDS['test-water-weak'];
    });

    it('ほえる：相手のバトルポケモンを入れ替え、出すポケモンは相手が選ぶ', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.growlithe, energies: [FIRE] } });
        const target = arrange(game, opp, { active: C.pikachu, bench: [C.magnemite, C.charmander], deck: Array(5).fill(C.potion) });
        const [pikachu, , charmander] = [target.active, ...target.bench];
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(game.pendingPrompt.player.id).toBe(opp);
        answer(game, [charmander]);
        expect(target.active).toBe(charmander);
        expect(target.bench).toContain(pikachu);
    });

    it('条件で増えるダメージ：はりきりファング・ハドロンスパーク', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.arcanine, cards: [C.growlithe, C.arcanine], energies: [FIRE, FIRE, FIRE] } });
        arrange(game, opp, { active: { id: C['miraidon-ex'] }, prizes: [C.potion, C.potion, C.potion, C.potion], deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(game.players[opp].active.damage).toBe(180);

        const { game: g2, me: m2, opp: o2 } = midGame();
        arrange(g2, m2, { active: { id: C['miraidon-ex'], energies: [LIGHTNING, LIGHTNING, LIGHTNING] } });
        arrange(g2, o2, { active: { ...MEGA_Y }, deck: Array(5).fill(C.potion) });
        g2.applyCommand(m2, { type: 'attack', index: 1 });
        expect(g2.players[o2].active.damage).toBe(240);
    });

    it('アッパースパーク：この番にレアコイルから進化していれば120追加。フラッシュボルトは次の番に使えない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.magneton, cards: [C.magnemite, C.magneton], energies: [LIGHTNING, LIGHTNING] }, hand: [C.magnezone], deck: Array(10).fill(LIGHTNING) });
        arrange(game, opp, { active: { ...MEGA_Y }, deck: Array(10).fill(C.potion) });
        game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.active.id });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(game.players[opp].active.damage).toBe(170);

        game.applyCommand(opp, { type: 'endTurn' });
        // 次の番は、進化していないので追加はない。フラッシュボルトを使うと、その次の番は使えない
        game.applyCommand(me, { type: 'attack', index: 1 });
        game.applyCommand(opp, { type: 'endTurn' });
        expect(game.applyCommand(me, { type: 'attack', index: 1 })).toBe(false);
        // 170 + 160 + 50 で、HP360 のメガリザードンYex がきぜつする
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(true);
        expect(game.players[me].prizes).toHaveLength(PRIZE_COUNT - 3);
    });

    it('ストロングボルトは雷エネルギーを1個トラッシュする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.raichu, cards: [C.pikachu, C.raichu], energies: [LIGHTNING, LIGHTNING, LIGHTNING] } });
        arrange(game, opp, { active: { ...MEGA_Y }, deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(player.active.energies).toHaveLength(2);
        expect(game.players[opp].active.damage).toBe(150);
    });
});

describe('特殊状態とポケモンチェック', () => {
    it('どくは10、やけどは20のダメージ。やけどはコインがオモテなら治る', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu });
        game.addCondition(player.active, 'poisoned');
        game.addCondition(player.active, 'burned');
        heads(game);
        game.pokemonCheckup();
        expect(player.active.damage).toBe(30);
        expect(player.active.poisoned).toBe(true);
        expect(player.active.burned).toBe(false);
    });

    it('ねむり・マヒ・こんらんは重ならない。マヒのポケモンはワザもにげるも使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING] }, bench: [C.magnemite] });
        game.addCondition(player.active, 'asleep');
        game.addCondition(player.active, 'paralyzed');
        expect(player.active.rotation).toBe('paralyzed');
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(false);
        expect(game.applyCommand(me, { type: 'retreat', target: player.bench[0].id })).toBe(false);
    });

    it('マヒは、マヒしたポケモンの持ち主の番の終わりに治る', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.magneton, cards: [C.magnemite, C.magneton], energies: [LIGHTNING] }, deck: Array(5).fill(C.potion) });
        arrange(game, opp, { active: C.growlithe, deck: Array(5).fill(C.potion) });
        heads(game);
        game.applyCommand(me, { type: 'attack', index: 0 });
        const defender = game.players[opp].active;
        expect(defender.rotation).toBe('paralyzed'); // 自分の番の終わりには治らない
        game.applyCommand(opp, { type: 'endTurn' });
        expect(defender.rotation).toBe(null);
    });

    it('こんらんのワザはコインがウラなら失敗し、自分に30ダメージ', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING] } });
        arrange(game, opp, { active: C.magnemite, deck: Array(5).fill(C.potion) });
        game.addCondition(player.active, 'confused');
        tails(game);
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(player.active.damage).toBe(30);
        expect(game.players[opp].active.damage).toBe(0);
    });

    it('にげるとベンチに下がったポケモンの特殊状態は消える', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, bench: [C.magnemite] });
        const pikachu = player.active;
        game.addCondition(pikachu, 'poisoned');
        game.addCondition(pikachu, 'confused');
        expect(game.applyCommand(me, { type: 'retreat', target: player.bench[0].id })).toBe(true);
        expect(player.bench[0]).toBe(pikachu);
        expect(pikachu.energies).toHaveLength(1);
        expect(pikachu.poisoned).toBe(false);
        expect(pikachu.rotation).toBe(null);
        expect(game.applyCommand(me, { type: 'retreat', target: pikachu.id })).toBe(false); // 1ターンに1回
    });
});

describe('きぜつ・サイド・勝敗', () => {
    it('ex がきぜつしたら、相手はサイドを2枚取る。バトル場が空いたらベンチから出す', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C['miraidon-ex'], energies: [LIGHTNING, LIGHTNING, LIGHTNING] } });
        const target = arrange(game, opp, { active: { id: C['miraidon-ex'], damage: 10 }, bench: [C.pikachu], deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(game.players[me].prizes).toHaveLength(PRIZE_COUNT - 2);
        expect(game.pendingPrompt.purpose).toBe('promote');
        expect(game.pendingPrompt.player.id).toBe(opp);
        answer(game, [target.bench[0]]);
        expect(game.topCard(target.active).id).toBe(C.pikachu);
        expect(game.current).toBe(opp);
    });

    it('メガシンカex がきぜつしたら、相手はサイドを3枚取る', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C['miraidon-ex'], energies: [LIGHTNING, LIGHTNING, LIGHTNING] } });
        arrange(game, opp, { active: { ...MEGA_Y, damage: 200 }, bench: [C.pikachu], deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(game.players[me].prizes).toHaveLength(PRIZE_COUNT - 3);
    });

    it('サイドをすべて取ったら勝ち', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, prizes: [C.potion] });
        arrange(game, opp, { active: { id: C.magnemite, damage: 50 }, bench: [C.magnemite] });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(game.phase).toBe('end');
        expect(game.winner).toBe(me);
        expect(game.endReason).toBe('prizes');
    });

    it('相手の場にポケモンがいなくなったら勝ち', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] } });
        arrange(game, opp, { active: { id: C.magnemite, damage: 50 }, bench: [] });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(game.winner).toBe(me);
        expect(game.endReason).toBe('nopokemon');
    });

    it('番の始めに山札を引けなければ負け', () => {
        const { game, me, opp } = midGame();
        arrange(game, opp, { deck: [] });
        game.applyCommand(me, { type: 'endTurn' });
        expect(game.winner).toBe(me);
        expect(game.endReason).toBe('deckout');
    });
});

describe('トレーナーズ', () => {
    it('サポートは1ターンに1回。ガイは3枚、リーリエの決心はサイド6枚なら8枚引く', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { hand: [C.guy, C.guy], deck: Array(20).fill(FIRE) });
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(true);
        expect(player.hand).toHaveLength(4);
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(false);

        const { game: g2, me: m2 } = midGame();
        const p2 = arrange(g2, m2, { hand: [C['lillies-determination'], C.potion], deck: Array(20).fill(FIRE) });
        g2.applyCommand(m2, { type: 'playTrainer', uid: p2.hand[0].uid });
        expect(p2.hand).toHaveLength(8);
    });

    it('MCの盛り上げは、相手のサイドが3枚以下なら4枚引く', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: [C['mc-hype']], deck: Array(20).fill(FIRE) });
        arrange(game, opp, { prizes: [C.potion, C.potion, C.potion] });
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        expect(player.hand).toHaveLength(4);
    });

    it('ボスの指令で、相手のベンチポケモンをバトル場に呼び出す', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: [C['bosss-orders']] });
        const target = arrange(game, opp, { active: C.charmander, bench: [C.growlithe] });
        const growlithe = target.bench[0];
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        answer(game, [growlithe]);
        expect(target.active).toBe(growlithe);
    });

    it('ふしぎなアメで、たねポケモンから2進化ポケモンに進化する', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.charmander, bench: [], hand: [C['rare-candy'], C['mega-charizard-y-ex']] });
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        answer(game, [C['mega-charizard-y-ex']]);
        answer(game, [player.active]);
        expect(game.topCard(player.active).id).toBe(C['mega-charizard-y-ex']);
        expect(player.discard.some(inst => inst.id === C['rare-candy'])).toBe(true);
    });

    it('なかよしポフィンは、HP70以下のたねポケモンだけを2枚までベンチに出す', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, bench: [], hand: [C['buddy-buddy-poffin']], deck: [C.pikachu, C.magnemite, C.charmander, C['miraidon-ex']] });
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        expect(game.pendingPrompt.cards.map(inst => inst.id).sort()).toEqual([C.magnemite, C.pikachu]);
        game.applyCommand(me, { type: 'answer', answer: [0, 1] });
        expect(player.bench).toHaveLength(2);
    });

    it('エネルギーつけかえで、基本エネルギーを別のポケモンに動かす', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, bench: [{ id: C.magnemite, energies: [LIGHTNING] }], hand: [C['energy-switch']] });
        const [active, bench] = [player.active, player.bench[0]];
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        answer(game, [bench]);
        answer(game, [active]);
        expect(active.energies).toHaveLength(1);
        expect(bench.energies).toHaveLength(0);
    });

    it('ふうせんは、にげるためのエネルギーを2個減らす', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.arcanine, cards: [C.growlithe, C.arcanine], energies: [FIRE, FIRE] }, bench: [C.pikachu], hand: [C['float-stone']] });
        expect(game.retreatCost(player.active)).toBe(4);
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid, target: player.active.id });
        expect(game.retreatCost(player.active)).toBe(2);
        expect(game.applyCommand(me, { type: 'retreat', target: player.bench[0].id })).toBe(true);
    });

    it('ブレイブバングルは、ルールを持たないポケモンのワザの、バトル場の ex へのダメージを30増やす', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING], tool: C['brave-bangle'] } });
        arrange(game, opp, { active: { id: C['miraidon-ex'] }, bench: [C.pikachu], deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(game.players[opp].active.damage).toBe(60);
        // ex ではない相手や、ルールを持つポケモンがつけているときは増えない
        const ctx = { attacker: game.players[me].active };
        game.dealAttackDamage(ctx, game.players[opp].bench[0], 10);
        expect(game.players[opp].bench[0].damage).toBe(10);
        const ex = arrange(game, me, { active: { id: C['miraidon-ex'], tool: C['brave-bangle'] } }).active;
        game.dealAttackDamage({ attacker: ex }, game.players[opp].active, 40);
        expect(game.players[opp].active.damage).toBe(100);
    });

    it('グラビティーマウンテンは、2進化ポケモンの最大HPを30減らす。出したときにHPがなくなればきぜつ', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [C['gravity-mountain']] });
        const target = arrange(game, opp, { active: { ...MAGNEZONE, damage: 140 }, bench: [C.magnemite] });
        expect(game.maxHp(target.active)).toBe(160);
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        expect(game.players[me].prizes).toHaveLength(PRIZE_COUNT - 1);
        expect(game.pendingPrompt.purpose).toBe('promote');
    });

    it('ミアレシティの効果を使うと、たねポケモンをベンチに出して番が終わる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.charmander, bench: [], hand: [C['lumiose-city']], deck: [C.growlithe, C.potion] });
        arrange(game, opp, { deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        expect(game.applyCommand(me, { type: 'useStadium' })).toBe(true);
        answer(game, [C.growlithe]);
        expect(player.bench).toHaveLength(1);
        expect(game.current).toBe(opp);
    });

    it('スタジアムを出すと、前のスタジアムはその持ち主のトラッシュへ。同じ名前は出せない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { hand: [C['lumiose-city'], C['lumiose-city'], C['gravity-mountain']] });
        game.applyCommand(me, { type: 'playTrainer', uid: game.players[me].hand[0].uid });
        expect(game.stadium.owner).toBe(me);
        game.turnState.stadiumPlayed = false;
        expect(game.applyCommand(me, { type: 'playTrainer', uid: game.players[me].hand[0].uid })).toBe(false);
        game.applyCommand(me, { type: 'playTrainer', uid: game.players[me].hand[1].uid });
        expect(game.players[me].discard.some(inst => inst.id === C['lumiose-city'])).toBe(true);
        expect(game.players[opp].discard.some(inst => inst.id === C['lumiose-city'])).toBe(false);
    });
});

describe('操作の記録', () => {
    it('断った操作は状態を変えない', () => {
        const game = startedGame(9);
        const commands = [
            { type: 'attack', index: 0 },
            { type: 'attack', index: 5 },
            { type: 'retreat', target: 'nothing' },
            { type: 'evolve', uid: 'x', target: 'y' },
            { type: 'answer', answer: [0] },
            { type: 'useStadium' },
            { type: 'playTrainer', uid: 'nope' },
            { type: 'unknown' }
        ];
        for (const playerId of [0, 1]) {
            for (const command of commands) {
                const before = snapshot(game);
                if (!game.applyCommand(playerId, command)) expect(snapshot(game)).toBe(before);
            }
            // 手札のカードを、相手の番に使おうとする
            const other = game.players[1 - game.current];
            other.hand.forEach(inst => {
                const before = snapshot(game);
                expect(game.applyCommand(other.id, { type: 'playTrainer', uid: inst.uid })).toBe(false);
                expect(snapshot(game)).toBe(before);
            });
        }
    });

    it('記録から同じ状態を作り直せる', async () => {
        const { runCpuStep } = await import('../public/js/cpu-player.js');
        const players = PLAYERS.map(player => ({ ...player, isCPU: true }));
        const options = deckOptions(42);
        const game = new Game(players, options);
        game.setup();
        for (let i = 0; i < 300 && game.phase !== 'end'; i++) runCpuStep(game);
        const replayed = Game.replay(players, options, game.commands);
        expect(snapshot(replayed)).toBe(snapshot(game));
    });
});
