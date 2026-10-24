import { describe, it, expect } from 'vitest';
import { CARDS } from '../public/js/card-data.js';
import { startedGame, arrange, answer, C } from './helpers.js';

const find = test => Object.values(CARDS).find(test);
const named = name => find(card => card.name === name);
const BIG = 'test-big-mech';

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    CARDS[BIG] = { ...CARDS[C.pikachu], id: BIG, hp: 900, weakness: null, resistance: null };
    return { game, me: game.current, opp: 1 - game.current };
}

describe('ベンチの数・どうぐ2枚・サイドのオモテ など', () => {
    it('ゼロの大空洞：テラスタルのポケモンがいればベンチは8匹まで。スタジアムがなくなると、多いぶんをトラッシュする', () => {
        const cavern = named('ゼロの大空洞');
        const tera = C['miraidon-ex'];
        const { game, me } = midGame();
        const player = arrange(game, me, { active: tera, bench: Array(5).fill(C.pikachu), hand: [cavern.id, C.magnemite, C.magnemite] });
        expect(game.benchLimit(player)).toBe(5);
        game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid });
        expect(game.benchLimit(player)).toBe(8);
        expect(game.applyCommand(me, { type: 'playBasic', uid: player.hand[0].uid })).toBe(true);
        expect(player.bench).toHaveLength(6);
        game.discardStadium();
        game.checkKnockouts();
        game.processEffects();
        expect(game.pendingPrompt.purpose).toBe('bench-overflow');
        answer(game, [player.bench[5]]);
        expect(player.bench).toHaveLength(5);
    });

    it('マルチアダプタ：名前に「ロトム」とつくポケモンは、どうぐを2枚つけられる。特性がなくなると多いぶんをトラッシュ', () => {
        const rotomEx = find(card => card.ability?.name === 'マルチアダプタ');
        const potionTool = named('ふうせん');
        const tool2 = find(card => card.kind === 'trainer' && card.trainerType === 'tool' && card.supported && card.name !== 'ふうせん');
        const { game, me } = midGame();
        const player = arrange(game, me, { active: rotomEx.id, hand: [potionTool.id, tool2.id] });
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid, target: player.active.id })).toBe(true);
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid, target: player.active.id })).toBe(true);
        expect(player.active.tool).toBeTruthy();
        expect(player.active.tool2).toBeTruthy();
        player.active.effects.push({ kind: 'abilityLock', untilTurn: game.turn });
        game.checkKnockouts();
        expect(player.active.tool2).toBeNull();
    });

    it('クレセントパージ：のぞむなら、ウラの自分のサイドを1枚オモテにして80ダメージ追加', () => {
        const cresselia = find(card => card.name === 'クレセリア' && card.attacks.some(attack => attack.name === 'クレセントパージ'));
        const index = cresselia.attacks.findIndex(attack => attack.name === 'クレセントパージ');
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: cresselia.id, energies: Array(3).fill('basic-psychic-energy') } });
        const target = arrange(game, opp, { active: BIG, deck: Array(5).fill(C.potion) });
        game.applyCommand(me, { type: 'attack', index });
        answer(game, true);
        answer(game, [0]);
        expect(target.active.damage).toBe(cresselia.attacks[index].damage + 80);
        expect(player.prizes.filter(inst => inst.faceUp)).toHaveLength(1);
    });

    it('変化の書：2枚同時に使い、トラッシュのたねポケモンと場のたねポケモンを入れ替える（ダメカンは引きつぐ）', () => {
        const book = named('変化の書');
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, damage: 20 }, hand: [book.id, book.id] });
        player.discard = [{ uid: 'x1', id: C.charmander }];
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(true);
        answer(game, [C.charmander]);
        answer(game, [player.active]);
        expect(game.topCard(player.active).name).toBe('ヒトカゲ');
        expect(player.active.damage).toBe(20);
        expect(player.discard.filter(inst => inst.id === book.id)).toHaveLength(2);
        expect(player.hand).toHaveLength(0);
    });

    it('リトライバッジ：無色ポケモンのワザでダメージの前に投げたコインを、この番に1回投げなおせる', () => {
        const badge = named('リトライバッジ');
        const coinAttacker = find(card => card.kind === 'pokemon' && card.type === 'colorless' && card.supported && card.attacks.some(attack => /コインを1回投げウラなら、このワザは失敗/.test(attack.text)));
        const index = coinAttacker.attacks.findIndex(attack => /コインを1回投げウラなら、このワザは失敗/.test(attack.text));
        const attack = coinAttacker.attacks[index];
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: coinAttacker.id, tool: badge.id, energies: attack.cost.map(() => 'basic-lightning-energy') } });
        const target = arrange(game, opp, { active: BIG, deck: Array(5).fill(C.potion) });
        let flips = 0;
        game.random = () => (flips++ === 0 ? 0.9 : 0.1); // 1回目はウラ、投げなおしはオモテ
        game.applyCommand(me, { type: 'attack', index });
        expect(game.pendingPrompt.purpose).toBe('coin-retry');
        answer(game, true);
        expect(target.active.damage).toBe(attack.damage);
    });

    it('アンジュフラエッテ：プリズムタワーが出ているときだけ出せ、プリズムタワーを出した番でも出せる', () => {
        const angeFlorette = named('アンジュフラエッテ');
        const prism = named('プリズムタワー');
        const { game, me } = midGame();
        const player = arrange(game, me, { active: C.pikachu, hand: [angeFlorette.id, prism.id] });
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(false);
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[1].uid })).toBe(true);
        expect(game.applyCommand(me, { type: 'playTrainer', uid: player.hand[0].uid })).toBe(true);
        expect(game.cardName(game.stadium.inst)).toBe('アンジュフラエッテ');
    });
});
