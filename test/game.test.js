import { describe, it, expect } from 'vitest';
import Game, { PRIZE_COUNT } from '../public/js/game.js';
import { CARDS } from '../public/js/card-data.js';
import { startedGame, arrange, snapshot, answer, makeCard, deckOptions, PLAYERS } from './helpers.js';

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    game.turnState.supporterPlayed = false;
    return { game, me: game.current, opp: 1 - game.current };
}

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
        // 先攻・後攻の選択とプレイヤー0のバトル場の選択まで進める
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
        for (let seed = 1; seed < 200 && !found; seed++) {
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

describe('最初の番の制限', () => {
    it('先攻の最初の番は、ワザとサポートを使えない', () => {
        const game = startedGame(2);
        const me = game.current;
        arrange(game, me, { active: { id: 'pikachu', energies: ['basic-lightning-energy'] }, hand: ['professors-research'] });
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(false);
        expect(game.applyCommand(me, { type: 'playTrainer', uid: game.players[me].hand[0].uid })).toBe(false);
    });

    it('最初の自分の番と、出したばかりのポケモンは進化できない', () => {
        const game = startedGame(2);
        const me = game.current;
        arrange(game, me, { active: 'pikachu', hand: ['raichu'] });
        const player = game.players[me];
        expect(game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.active.id })).toBe(false);

        const { game: later, me: p } = midGame(2);
        arrange(later, p, { active: 'pikachu', hand: ['raichu', 'pikachu'] });
        const lp = later.players[p];
        later.applyCommand(p, { type: 'playBasic', uid: lp.hand[1].uid });
        const fresh = lp.bench[lp.bench.length - 1];
        expect(later.applyCommand(p, { type: 'evolve', uid: lp.hand[0].uid, target: fresh.id })).toBe(false);
        expect(later.applyCommand(p, { type: 'evolve', uid: lp.hand[0].uid, target: lp.active.id })).toBe(true);
        expect(later.topCard(lp.active).id).toBe('raichu');
    });
});

describe('エネルギーとワザ', () => {
    it('エネルギーは1ターンに1回だけ手札からつけられる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: 'pikachu', hand: ['basic-lightning-energy', 'basic-lightning-energy'] });
        expect(game.applyCommand(me, { type: 'attachEnergy', uid: player.hand[0].uid, target: player.active.id })).toBe(true);
        expect(game.applyCommand(me, { type: 'attachEnergy', uid: player.hand[0].uid, target: player.active.id })).toBe(false);
        expect(player.active.energies).toHaveLength(1);
    });

    it('エネルギーが足りないワザは使えない。無色はどのエネルギーでも払える', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: 'raichu', cards: ['pikachu', 'raichu'], energies: ['basic-lightning-energy', 'basic-fire-energy'] } });
        expect(game.canPayCost(player.active, ['lightning', 'lightning', 'colorless'])).toBe(false);
        player.active.energies.push(makeCard(game, 'basic-lightning-energy'));
        expect(game.canPayCost(player.active, ['lightning', 'lightning', 'colorless'])).toBe(true);
        expect(game.canPayCost(player.active, ['fire', 'fire'])).toBe(false);
    });

    it('弱点のタイプのワザは2倍、抵抗力のタイプは30減る', () => {
        CARDS['test-water'] = { ...CARDS.magnemite, id: 'test-water', name: '水のテスト', type: 'water', resistance: 'lightning' };
        const { game, me, opp } = midGame();
        arrange(game, me, { active: 'test-water' });
        arrange(game, opp, { active: 'charmander' });
        const ctx = { attacker: game.players[me].active };
        game.dealAttackDamage(ctx, game.players[opp].active, 30);
        expect(game.players[opp].active.damage).toBe(60);
        const pikachu = { attacker: arrange(game, opp, { active: 'pikachu' }).active };
        game.dealAttackDamage(pikachu, game.players[me].active, 20);
        expect(game.players[me].active.damage).toBe(0);
        delete CARDS['test-water'];

        const { game: g2, me: m2, opp: o2 } = midGame();
        arrange(g2, m2, { active: { id: 'charmander', energies: ['basic-fire-energy'] } });
        arrange(g2, o2, { active: { id: 'charizard-ex', cards: ['charmander', 'charmeleon', 'charizard-ex'] }, bench: [] });
        // 炎のワザは、悪タイプ（弱点草）のリザードンexには等倍
        g2.applyCommand(m2, { type: 'attack', index: 1 });
        expect(g2.players[o2].active.damage).toBe(30);
    });

    it('ワザを使うと番が終わり、相手の番になる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'magnemite', energies: ['basic-lightning-energy', 'basic-lightning-energy'] } });
        arrange(game, opp, { active: 'growlithe', deck: ['potion', 'potion'] });
        const turn = game.turn;
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(true);
        expect(game.turn).toBe(turn + 1);
        expect(game.current).toBe(opp);
        expect(game.players[opp].hand.some(inst => inst.id === 'potion')).toBe(true);
    });

    it('ベンチのテラスタルのポケモンはワザのダメージを受けない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: 'pikachu' });
        arrange(game, opp, { active: 'charmander', bench: [{ id: 'charizard-ex', cards: ['charmander', 'charmeleon', 'charizard-ex'] }] });
        const ctx = { attacker: game.players[me].active };
        game.dealAttackDamage(ctx, game.players[opp].bench[0], 100);
        expect(game.players[opp].bench[0].damage).toBe(0);
        game.dealAttackDamage(ctx, game.players[opp].active, 40);
        expect(game.players[opp].active.damage).toBe(40);
    });

    it('フォトンブラスターの次の自分の番は、ワザを使えない', () => {
        const { game, me, opp } = midGame();
        const energies = ['basic-lightning-energy', 'basic-lightning-energy', 'basic-lightning-energy'];
        arrange(game, me, { active: { id: 'miraidon-ex', energies }, deck: Array(10).fill('basic-lightning-energy') });
        arrange(game, opp, { active: { id: 'charizard-ex', cards: ['charmander', 'charmeleon', 'charizard-ex'] }, bench: ['growlithe'], deck: Array(10).fill('potion') });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(game.current).toBe(opp);
        game.applyCommand(opp, { type: 'endTurn' });
        expect(game.current).toBe(me);
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(false);
        game.applyCommand(me, { type: 'endTurn' });
        game.applyCommand(opp, { type: 'endTurn' });
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(true);
    });
});

describe('特殊状態とポケモンチェック', () => {
    it('どくは10、やけどは20のダメージ。やけどはコインがオモテなら治る', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: 'pikachu' });
        game.addCondition(player.active, 'poisoned');
        game.addCondition(player.active, 'burned');
        game.random = () => 0.1; // オモテ
        game.pokemonCheckup();
        expect(player.active.damage).toBe(30);
        expect(player.active.poisoned).toBe(true);
        expect(player.active.burned).toBe(false);
    });

    it('ねむり・マヒ・こんらんは重ならない。マヒのポケモンはワザもにげるも使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: 'pikachu', energies: ['basic-lightning-energy'] }, bench: ['magnemite'] });
        game.addCondition(player.active, 'asleep');
        game.addCondition(player.active, 'paralyzed');
        expect(player.active.rotation).toBe('paralyzed');
        expect(game.applyCommand(me, { type: 'attack', index: 0 })).toBe(false);
        expect(game.applyCommand(me, { type: 'retreat', target: player.bench[0].id })).toBe(false);
    });

    it('マヒは、マヒしたポケモンの持ち主の番の終わりに治る', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'pikachu', energies: ['basic-lightning-energy'] }, deck: Array(5).fill('potion') });
        arrange(game, opp, { active: 'magnemite', deck: Array(5).fill('potion') });
        game.random = () => 0.1; // オモテでマヒ
        game.applyCommand(me, { type: 'attack', index: 0 });
        const defender = game.players[opp].active;
        expect(defender.rotation).toBe('paralyzed'); // 自分の番の終わりには治らない
        game.applyCommand(opp, { type: 'endTurn' });
        expect(defender.rotation).toBe(null);
    });

    it('こんらんのワザはコインがウラなら失敗し、自分に30ダメージ', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'pikachu', energies: ['basic-lightning-energy'] } });
        arrange(game, opp, { active: 'magnemite', deck: Array(5).fill('potion') });
        game.addCondition(player.active, 'confused');
        game.random = () => 0.9; // ウラ
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(player.active.damage).toBe(30);
        expect(game.players[opp].active.damage).toBe(0);
    });

    it('にげるとベンチに下がったポケモンの特殊状態は消える', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: 'pikachu', energies: ['basic-lightning-energy', 'basic-lightning-energy'] }, bench: ['magnemite'] });
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
        const energies = ['basic-lightning-energy', 'basic-lightning-energy', 'basic-lightning-energy'];
        arrange(game, me, { active: { id: 'miraidon-ex', energies } });
        const target = arrange(game, opp, { active: { id: 'miraidon-ex', damage: 10 }, bench: ['pikachu'], deck: Array(5).fill('potion') });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(game.players[me].prizes).toHaveLength(PRIZE_COUNT - 2);
        expect(game.pendingPrompt.purpose).toBe('promote');
        expect(game.pendingPrompt.player.id).toBe(opp);
        answer(game, [target.bench[0]]);
        expect(game.topCard(target.active).id).toBe('pikachu');
        expect(game.current).toBe(opp);
    });

    it('サイドをすべて取ったら勝ち', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'pikachu', energies: ['basic-lightning-energy'] }, prizes: ['potion'] });
        arrange(game, opp, { active: { id: 'magnemite', damage: 50 }, bench: ['magnemite'] });
        game.random = () => 0.9;
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(game.phase).toBe('end');
        expect(game.winner).toBe(me);
        expect(game.endReason).toBe('prizes');
    });

    it('相手の場にポケモンがいなくなったら勝ち', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'pikachu', energies: ['basic-lightning-energy'] } });
        arrange(game, opp, { active: { id: 'magnemite', damage: 50 }, bench: [] });
        game.random = () => 0.9;
        game.applyCommand(me, { type: 'attack', index: 0 });
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
    it('サポートは1ターンに1回。博士の研究は手札をトラッシュして7枚引く', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { hand: ['professors-research', 'professors-research', 'potion'], deck: Array(20).fill('basic-fire-energy') });
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(true);
        expect(player.hand).toHaveLength(7);
        expect(player.discard.filter(inst => inst.id === 'professors-research')).toHaveLength(2);
        player.hand.push(makeCard(game, 'judge'));
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[7].uid })).toBe(false);
    });

    it('ボスの指令で、相手のベンチポケモンをバトル場に呼び出す', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { hand: ['bosss-orders'] });
        const target = arrange(game, opp, { active: 'charmander', bench: ['growlithe'] });
        const growlithe = target.bench[0];
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        answer(game, [growlithe]);
        expect(target.active).toBe(growlithe);
    });

    it('ふしぎなアメで、たねポケモンから2進化ポケモンに進化し、特性を使える', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, {
            active: 'charmander',
            bench: [],
            hand: ['rare-candy', 'charizard-ex'],
            deck: ['basic-fire-energy', 'basic-fire-energy', 'basic-fire-energy', 'basic-fire-energy', 'potion']
        });
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        answer(game, ['charizard-ex']);
        answer(game, [player.active]);
        expect(game.topCard(player.active).id).toBe('charizard-ex');
        expect(game.pendingPrompt.type).toBe('confirm');
        game.applyCommand(me, { type: 'answer', answer: true });
        answer(game, ['basic-fire-energy', 'basic-fire-energy', 'basic-fire-energy'].map((id, index) => game.pendingPrompt.cards[index].uid));
        expect(player.active.energies).toHaveLength(3);
        expect(player.deck).toHaveLength(2);
        expect(player.discard.some(inst => inst.id === 'rare-candy')).toBe(true);
    });

    it('ゆうきのおまもりは、たねポケモンの最大HPを50増やす', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: 'pikachu', bench: [{ id: 'raichu', cards: ['pikachu', 'raichu'] }], hand: ['bravery-charm', 'bravery-charm'] });
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid, target: player.active.id });
        expect(game.maxHp(player.active)).toBe(120);
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid, target: player.bench[0].id });
        expect(game.maxHp(player.bench[0])).toBe(120);
        expect(game.applyCommand(me, { type: 'playTrainer', uid: makeCard(game, 'bravery-charm').uid, target: player.active.id })).toBe(false);
    });

    it('スタジアムを出すと、前のスタジアムはその持ち主のトラッシュへ。同じ名前は出せない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { hand: ['artazon', 'artazon'] });
        game.applyCommand(me, { type: 'playTrainer', uid: game.players[me].hand[0].uid });
        expect(game.stadium.owner).toBe(me);
        game.turnState.stadiumPlayed = false;
        expect(game.applyCommand(me, { type: 'playTrainer', uid: game.players[me].hand[0].uid })).toBe(false);
        expect(game.players[opp].discard.some(inst => inst.id === 'artazon')).toBe(false);
    });

    it('タンデムユニットは、雷のたねポケモンを2枚までベンチに出す', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: 'miraidon-ex', bench: [], deck: ['pikachu', 'magnemite', 'charmander', 'potion'] });
        expect(game.applyCommand(me, { type: 'useAbility', target: player.active.id })).toBe(true);
        expect(game.pendingPrompt.cards.map(inst => inst.id).sort()).toEqual(['magnemite', 'pikachu']);
        game.applyCommand(me, { type: 'answer', answer: [0, 1] });
        expect(player.bench).toHaveLength(2);
        expect(game.applyCommand(me, { type: 'useAbility', target: player.active.id })).toBe(false);
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
