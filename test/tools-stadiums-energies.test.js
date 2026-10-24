import { describe, it, expect } from 'vitest';
import { CARDS } from '../public/js/card-data.js';
import { startedGame, arrange, answer, makeCard, C } from './helpers.js';

const LIGHTNING = 'basic-lightning-energy';
const FIGHTING = 'basic-fighting-energy';

// 名前からカードのIDを引く（どうぐ・スタジアム・特殊エネルギー・ポケモン）
const ID = name => {
    const card = Object.values(CARDS).find(c => c.name === name);
    if (!card) throw new Error(`カードがない: ${name}`);
    return card.id;
};
const PIKACHU_EX = ID('ピカチュウex');
const POTIONS = Array(8).fill(C.potion);

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    return { game, me: game.current, opp: 1 - game.current };
}

function setStadium(game, owner, name) {
    game.stadium = { inst: makeCard(game, ID(name)), owner };
}

// 選択待ちに、インデックスで答える（同じカードが何枚もあるとき）
function answerIndices(game, indices) {
    const ok = game.applyCommand(game.pendingPrompt.player.id, { type: 'answer', answer: indices });
    if (!ok) throw new Error(game.lastError);
}

describe('ポケモンのどうぐ', () => {
    it('マキシマムベルト：相手のバトル場のポケモンexへのダメージが+50', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING], tool: ID('マキシマムベルト') }, deck: POTIONS });
        const target = arrange(game, opp, { active: PIKACHU_EX, deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 }); // プチボルト 30
        expect(target.active.damage).toBe(80);
    });

    it('マキシマムベルト：ポケモンex でなければ増えない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING], tool: ID('マキシマムベルト') }, deck: POTIONS });
        const target = arrange(game, opp, { active: C.charmander, deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(target.active.damage).toBe(30);
    });

    it('ヒーローマント：最大HPが+100。ジャミングタワーがあれば効果がなくなる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, tool: ID('ヒーローマント') } });
        expect(game.maxHp(player.active)).toBe(170);
        setStadium(game, me, 'ジャミングタワー');
        expect(game.maxHp(player.active)).toBe(70);
    });

    it('ラッキーメット：バトル場でワザのダメージを受けたら、山札を2枚引く', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const target = arrange(game, opp, { active: { id: C.charmander, tool: ID('ラッキーメット') }, hand: [], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(target.hand.length).toBe(3); // 2枚 ＋ 番のはじめの1枚
    });

    it('パンクメット：ワザを使ったポケモンにダメカンを4個のせる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, deck: POTIONS });
        arrange(game, opp, { active: { id: C.charmander, tool: ID('パンクメット') }, deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(player.active.damage).toBe(40);
    });

    it('デラックスボム：ワザを使ったポケモンにダメカンを12個のせ、どうぐはトラッシュする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, bench: [C.raichu], deck: POTIONS });
        const target = arrange(game, opp, { active: { id: C.charmander, tool: ID('デラックスボム') }, deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(target.active.tool).toBeNull();
        expect(target.discard.some(inst => inst.id === ID('デラックスボム'))).toBe(true);
        expect(player.discard.some(inst => inst.id === C.pikachu)).toBe(true); // HP70 に 120 でワザを使ったピカチュウはきぜつ
    });

    it('サバイブギプス：HPがまんたんなら、きぜつせずHP10で残り、どうぐはトラッシュする', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: PIKACHU_EX, energies: [LIGHTNING, LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const target = arrange(game, opp, { active: { id: C.charmander, tool: ID('サバイブギプス') }, bench: [C.pikachu], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 0 }); // 10まんボルト 120
        expect(target.active.cards[0].id).toBe(C.charmander);
        expect(game.maxHp(target.active) - target.active.damage).toBe(10);
        expect(target.active.tool).toBeNull();
    });

    it('サバイブギプス：HPがまんたんでなければ、きぜつする', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: PIKACHU_EX, energies: [LIGHTNING, LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const target = arrange(game, opp, { active: { id: C.charmander, tool: ID('サバイブギプス'), damage: 10 }, bench: [C.pikachu], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(target.active).toBeNull();
        expect(target.discard.some(inst => inst.id === C.charmander)).toBe(true);
    });

    it('緊急ボード：にげるためのエネルギーが1個少なく、残りHP30以下なら0', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: ID('ガーディ'), tool: ID('緊急ボード') } });
        expect(game.retreatCost(player.active)).toBe(1);
        player.active.damage = 50;
        expect(game.retreatCost(player.active)).toBe(0);
    });

    it('重力玉：つけたポケモンがバトル場にいるかぎり、おたがいのバトルポケモンのにげるエネルギーが+1', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, tool: ID('重力玉') }, bench: [C.raichu] });
        const other = arrange(game, opp, { active: C.charmander, bench: [C.pikachu] });
        expect(game.retreatCost(player.active)).toBe(2);
        expect(game.retreatCost(other.active)).toBe(2);
        expect(game.retreatCost(other.bench[0])).toBe(1);
        [player.active, player.bench[0]] = [player.bench[0], player.active]; // 重力玉のポケモンがベンチに下がる
        expect(game.retreatCost(other.active)).toBe(1);
    });

    it('カウンターゲイン：自分のサイドが相手より多く残っていれば、ワザのエネルギーが無色1個少ない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING], tool: ID('カウンターゲイン') }, prizes: Array(6).fill(C.potion) });
        arrange(game, opp, { prizes: Array(6).fill(C.potion) });
        const attack = game.topCard(player.active).attacks[1]; // プチボルト [雷][無]
        expect(game.attackCost(player.active, attack)).toEqual(['lightning', 'colorless']);
        expect(game.checkAttack(player, 1)).toBe('エネルギーが足りません');
        arrange(game, opp, { prizes: Array(5).fill(C.potion) });
        expect(game.attackCost(player.active, attack)).toEqual(['lightning']);
        expect(game.checkAttack(player, 1)).toBeNull();
    });

    it('力の砂時計：自分の番の終わりに、バトル場にいれば、トラッシュの基本エネルギーを1枚つけてよい', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, tool: ID('力の砂時計') }, deck: POTIONS });
        arrange(game, opp, { deck: POTIONS });
        player.discard = [makeCard(game, LIGHTNING)];
        game.applyCommand(me, { type: 'endTurn' });
        expect(game.pendingPrompt?.purpose).toBe('power-hourglass');
        answer(game, [LIGHTNING]);
        expect(player.active.energies.map(inst => inst.id)).toEqual([LIGHTNING]);
        expect(player.discard.length).toBe(0);
        expect(game.current).toBe(opp);
    });

    it('ヘビーバトン：にげる4のポケモンがバトル場でワザできぜつしたら、基本エネルギーを3枚までベンチにつけ替える', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: PIKACHU_EX, energies: [LIGHTNING, LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const target = arrange(game, opp, {
            active: { id: ID('イワーク'), energies: [FIGHTING, FIGHTING, FIGHTING, FIGHTING], tool: ID('ヘビーバトン') },
            bench: [C.charmander],
            deck: POTIONS
        });
        game.applyCommand(me, { type: 'attack', index: 0 }); // 120：イワーク（HP120）はきぜつ
        expect(game.pendingPrompt.purpose).toBe('promote');
        answer(game, [target.bench[0]]);
        expect(game.pendingPrompt.purpose).toBe('heavy-baton');
        answerIndices(game, [0, 1, 2]);
        // きぜつしたときベンチにいたヒトカゲ（今はバトル場）に3枚つく
        expect(target.active.energies.length).toBe(3);
        expect(target.discard.filter(inst => inst.id === FIGHTING).length).toBe(1);
    });
});

describe('スタジアム', () => {
    it('エキサイトスタジアム：たねポケモンの最大HPが+30', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.charmander, bench: [C.charmeleon] });
        setStadium(game, me, 'エキサイトスタジアム');
        expect(game.maxHp(player.active)).toBe(110);
        expect(game.maxHp(player.bench[0])).toBe(100);
    });

    it('伝説の溶岩洞：進化ポケモンの特性がなくなる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.charmander, bench: [C.charmeleon] });
        setStadium(game, me, '伝説の溶岩洞');
        expect(game.abilitySuppressed(player.active)).toBe(false);
        expect(game.abilitySuppressed(player.bench[0])).toBe(true);
    });

    it('フルメタルラボ：[M]ポケモンが相手から受けるワザのダメージは-30', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const target = arrange(game, opp, { active: ID('カヌチャン'), deck: POTIONS });
        setStadium(game, me, 'フルメタルラボ');
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(target.active.damage).toBe(0);
    });

    it('Nの城：「Nのポケモン」のにげるためのエネルギーがなくなる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: ID('Nのバニプッチ'), bench: [C.pikachu] });
        setStadium(game, me, 'Nの城');
        expect(game.retreatCost(player.active)).toBe(0);
        expect(game.retreatCost(player.bench[0])).toBe(1);
    });

    it('プリズムタワー：手札を2枚トラッシュして、山札を1枚引く', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [ID('プリズムタワー'), C.potion, C.switch], deck: POTIONS });
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(true);
        expect(game.applyCommand(me, { type: 'useStadium' })).toBe(true);
        answer(game, [C.potion, C.switch]);
        expect(player.hand.length).toBe(1);
        expect(player.discard.length).toBe(2);
        expect(game.applyCommand(me, { type: 'useStadium' })).toBe(false); // 1つの番に1回
    });

    it('偉大な大樹：山札の1進化・2進化ポケモンで続けて進化させる。最初の番は使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.charmander, deck: [C.charmeleon, C['mega-charizard-y-ex'], C.potion] });
        setStadium(game, me, '偉大な大樹');
        player.turnsTaken = 1;
        expect(game.checkStadium(player)).not.toBeNull();
        player.turnsTaken = 2;
        expect(game.applyCommand(me, { type: 'useStadium' })).toBe(true);
        answer(game, [C.charmeleon]);
        answer(game, [C['mega-charizard-y-ex']]);
        expect(game.topCard(player.active).name).toBe('メガリザードンYex');
        expect(player.deck.length).toBe(1);
    });

    it('公民館：この番にサポートを使っていれば、自分のポケモン全員を10回復できる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, damage: 30 }, bench: [{ id: C.raichu, damage: 10 }] });
        setStadium(game, me, '公民館');
        expect(game.checkStadium(player)).not.toBeNull();
        game.turnState.supporterPlayed = true;
        expect(game.applyCommand(me, { type: 'useStadium' })).toBe(true);
        expect(player.active.damage).toBe(20);
        expect(player.bench[0].damage).toBe(0);
    });
});

describe('特殊エネルギー', () => {
    it('プリズムエネルギー：たねポケモンならどのタイプにもなり、進化ポケモンなら無色', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [ID('プリズムエネルギー')] }, bench: [{ id: C.raichu, energies: [ID('プリズムエネルギー')] }] });
        expect(game.canPayCost(player.active, ['fire'])).toBe(true);
        expect(game.canPayCost(player.bench[0], ['lightning'])).toBe(false);
        expect(game.canPayCost(player.bench[0], ['colorless'])).toBe(true);
    });

    it('ネオアッパーエネルギー：2進化ポケモンなら、すべてのタイプのエネルギー2個ぶん', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, {
            active: { id: C.magnezone, energies: [ID('ネオアッパーエネルギー')] },
            bench: [{ id: C.magnemite, energies: [ID('ネオアッパーエネルギー')] }]
        });
        expect(game.canPayCost(player.active, ['lightning', 'lightning'])).toBe(true);
        expect(game.canPayCost(player.bench[0], ['lightning'])).toBe(false);
        expect(game.canPayCost(player.bench[0], ['colorless'])).toBe(true);
    });

    it('イグニッションエネルギー：進化ポケモンなら無色3個ぶん。自分の番の終わりにトラッシュする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, {
            active: { id: C.raichu, energies: [ID('イグニッションエネルギー')] },
            bench: [{ id: C.pikachu, energies: [ID('イグニッションエネルギー')] }],
            deck: POTIONS
        });
        arrange(game, opp, { deck: POTIONS });
        expect(game.canPayCost(player.active, ['colorless', 'colorless', 'colorless'])).toBe(true);
        expect(game.canPayCost(player.active, ['lightning'])).toBe(false);
        expect(game.canPayCost(player.bench[0], ['colorless', 'colorless'])).toBe(false);
        game.applyCommand(me, { type: 'endTurn' });
        expect(player.active.energies.length).toBe(0);
        expect(player.bench[0].energies.length).toBe(0);
        expect(player.discard.filter(inst => inst.id === ID('イグニッションエネルギー')).length).toBe(2);
    });

    it('レガシーエネルギー：どのタイプにもなり、ワザできぜつしたとき、とられるサイドが1枚少ない（対戦中1回）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: PIKACHU_EX, energies: [LIGHTNING, LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const target = arrange(game, opp, { active: { id: PIKACHU_EX, energies: [ID('レガシーエネルギー')], damage: 100 }, bench: [C.pikachu], deck: POTIONS });
        expect(game.canPayCost(target.active, ['grass'])).toBe(true);
        const before = player.prizes.length;
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(before - player.prizes.length).toBe(1); // ポケモンex なので本当は2枚
        expect(game.hasPlayerEffect(target, 'legacyEnergyUsed')).toBe(true);
    });

    it('グロウ草エネルギー：[G]エネルギー1個ぶん。[G]ポケモンなら最大HPが+20', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, {
            active: { id: ID('チコリータ'), energies: [ID('グロウ草エネルギー')] },
            bench: [{ id: C.pikachu, energies: [ID('グロウ草エネルギー')] }]
        });
        expect(game.canPayCost(player.active, ['grass'])).toBe(true);
        expect(game.canPayCost(player.active, ['lightning'])).toBe(false);
        expect(game.maxHp(player.active)).toBe(90);
        expect(game.maxHp(player.bench[0])).toBe(70);
    });

    it('マグネット鋼エネルギー：[M]ポケモンのにげるためのエネルギーがなくなる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: ID('ドーミラー'), energies: [ID('マグネット鋼エネルギー')] } });
        expect(game.canPayCost(player.active, ['metal'])).toBe(true);
        expect(game.retreatCost(player.active)).toBe(0);
    });

    it('ボルト雷エネルギー：[L]ポケモンのワザの、相手のバトルポケモンへのダメージが+20', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.pikachu, energies: [ID('ボルト雷エネルギー'), LIGHTNING] }, deck: POTIONS });
        const target = arrange(game, opp, { active: C.charmander, deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(target.active.damage).toBe(50);
    });

    it('シャドー悪エネルギー：[D]ポケモンは、ベンチにいるかぎり相手のワザのダメージを受けない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu });
        const target = arrange(game, opp, {
            active: { id: ID('エレズン'), energies: [ID('シャドー悪エネルギー')] },
            bench: [{ id: ID('エレズン'), energies: [ID('シャドー悪エネルギー')] }]
        });
        const ctx = { game, player, opponent: target, attacker: player.active, defender: target.active, attack: { name: 'テスト' } };
        expect(game.dealAttackDamage(ctx, target.bench[0], 30)).toBe(0);
        expect(game.dealAttackDamage(ctx, target.active, 30)).toBe(30);
    });

    it('ミストエネルギー：つけているポケモンは、相手のワザの効果を受けない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: C.pikachu });
        const target = arrange(game, opp, { active: { id: C.charmander, energies: [ID('ミストエネルギー')] }, bench: [C.charmander] });
        const ctx = { game, player, opponent: target, attacker: player.active, defender: target.active, attack: { name: 'テスト' } };
        expect(game.canPayCost(target.active, ['colorless'])).toBe(true);
        expect(game.canAffectByAttack(ctx, target.active)).toBe(false);
        expect(game.canAffectByAttack(ctx, target.bench[0])).toBe(true);
    });

    it('リッチエネルギー：手札からつけたとき、山札を4枚引く', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [ID('リッチエネルギー')], deck: POTIONS });
        expect(game.applyCommand(me, { type: 'attachEnergy', uid: player.hand[0].uid, target: player.active.id })).toBe(true);
        expect(player.hand.length).toBe(4);
        expect(game.canPayCost(player.active, ['colorless'])).toBe(true);
    });

    it('スパイクエネルギー：バトル場でワザのダメージを受けたら、ワザを使ったポケモンにダメカンを2個のせる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, deck: POTIONS });
        arrange(game, opp, { active: { id: C.charmander, energies: [ID('スパイクエネルギー')] }, deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 });
        expect(player.active.damage).toBe(20);
    });
});
