import { describe, it, expect } from 'vitest';
import { CARDS } from '../public/js/card-data.js';
import { startedGame, arrange, answer, C } from './helpers.js';

const GRASS = 'basic-grass-energy';
const FIRE = 'basic-fire-energy';
const WATER = 'basic-water-energy';
const LIGHTNING = 'basic-lightning-energy';
const PSYCHIC = 'basic-psychic-energy';
const DARKNESS = 'basic-darkness-energy';
const POTIONS = Array(10).fill(C.potion);
// HP の大きい相手役（ホエルオーex：HP380・弱点は雷）
const BIG = 'M5-095';

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    return { game, me: game.current, opp: 1 - game.current };
}

const attackIndex = (id, name) => CARDS[id].attacks.findIndex(attack => attack.name === name);
const attack = (game, playerId, id, name) => game.applyCommand(playerId, { type: 'attack', index: attackIndex(id, name) });
const choose = (game, indices) => {
    if (!game.applyCommand(game.pendingPrompt.player.id, { type: 'answer', answer: indices })) throw new Error(game.lastError);
};

describe('読み替えられないワザ（そのb）', () => {
    it('すべて書いたカードは使えるようになる', () => {
        ['SV11W-110', 'SV11W-141', 'SV11W-152', 'SV6a-005', 'SV6a-078', 'SV7-060', 'SV9-057', 'SV8a-212'].forEach(id => expect(CARDS[id].supported).toBe(true));
        // 「未来」のサポートを見るワザが残っているので、テツノブジンはまだ使えない
        expect(CARDS['SV5M-035'].supported).toBe(false);
    });

    it('ダブルフリーズ（バイバニラ）：オモテの数×90ダメージ。1回でもオモテならマヒ', () => {
        const { game, me, opp } = midGame();
        game.flipCoin = () => true;
        arrange(game, me, { active: { id: 'SV11W-110', energies: [WATER, WATER, WATER] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, deck: POTIONS });
        expect(attack(game, me, 'SV11W-110', 'ダブルフリーズ')).toBe(true);
        expect(other.active.damage).toBe(180);
        expect(game.hasCondition(other.active, 'paralyzed')).toBe(true);
    });

    it('のびるダメカーン（デスカーン）：自分のベンチのダメカンをすべて、相手のポケモンにのせ替える', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'SV11W-120', energies: [PSYCHIC, PSYCHIC] }, bench: [{ id: C.pikachu, damage: 50 }], deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, bench: [BIG], deck: POTIONS });
        expect(attack(game, me, 'SV11W-120', 'のびるダメカーン')).toBe(true);
        answer(game, [player.bench[0]]);
        answer(game, [other.bench[0]]);
        expect(player.bench[0].damage).toBe(0);
        expect(other.bench[0].damage).toBe(50);
    });

    it('フォーチュンアイ（ゴチミル）：相手の山札を上から5枚見て、好きな順番にもどす', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV11W-122', energies: [PSYCHIC] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, hand: [], deck: [C.pikachu, C.raichu, C.charmander, C.potion, C.switch, C.judge] });
        expect(attack(game, me, 'SV11W-122', 'フォーチュンアイ')).toBe(true);
        answer(game, [C.potion]);
        answer(game, [C.charmander]);
        answer(game, [C.raichu]);
        answer(game, [C.switch]);
        // 相手の番になり、相手は一番上のカードを引く
        expect(other.hand.map(inst => inst.id)).toEqual([C.potion]);
        expect(other.deck.map(inst => inst.id)).toEqual([C.charmander, C.raichu, C.switch, C.pikachu, C.judge]);
    });

    it('イカサマ（ゾロアーク）：相手のバトルポケモンのワザを、このワザとして使う', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV11W-141', energies: [DARKNESS, DARKNESS, DARKNESS] }, bench: [C.pikachu, C.pikachu], deck: POTIONS });
        const other = arrange(game, opp, { active: 'SV7-130', deck: POTIONS });
        expect(attack(game, me, 'SV11W-141', 'イカサマ')).toBe(true);
        expect(game.pendingPrompt.options).toEqual(['ユニオンビート', 'クラウンオパール']);
        choose(game, [0]); // ユニオンビート：自分のベンチポケモンの数×30ダメージ
        expect(other.active.damage).toBe(60);
    });

    it('きあいだめ（ミルホッグ）：次の自分の番、「ひっさつまえば」のダメージは240になる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'SV11W-152', energies: [FIRE] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, deck: POTIONS });
        expect(attack(game, me, 'SV11W-152', 'きあいだめ')).toBe(true);
        expect(game.applyCommand(opp, { type: 'endTurn' })).toBe(true);
        game.flipCoin = () => true;
        expect(attack(game, me, 'SV11W-152', 'ひっさつまえば')).toBe(true);
        expect(other.active.damage).toBe(240);
        // その次の番は、もとの80
        game.applyCommand(opp, { type: 'endTurn' });
        other.active.damage = 0;
        expect(game.current).toBe(me);
        expect(attack(game, me, 'SV11W-152', 'ひっさつまえば')).toBe(true);
        expect(other.active.damage).toBe(80);
        expect(player.active.energies).toHaveLength(1);
    });

    it('スロークランチ（カイロス）：エネルギーをすべてトラッシュし、次の相手の番の終わりに、ワザを受けたポケモンはきぜつする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'SV5a-003', energies: [GRASS, GRASS] }, deck: POTIONS, prizes: POTIONS.slice(0, 6) });
        const other = arrange(game, opp, { active: BIG, bench: [C.pikachu], deck: POTIONS });
        expect(attack(game, me, 'SV5a-003', 'スロークランチ')).toBe(true);
        expect(player.active.energies).toHaveLength(0);
        expect(other.active.damage).toBe(0);
        expect(game.applyCommand(opp, { type: 'endTurn' })).toBe(true);
        expect(other.discard.some(inst => inst.id === BIG)).toBe(true);
        expect(player.prizes).toHaveLength(4); // ポケモンexなのでサイドを2枚とる
        expect(game.pendingPrompt.purpose).toBe('promote');
    });

    it('スロークランチ：ワザを受けたポケモンがベンチにもどれば、きぜつしない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV5a-003', energies: [GRASS, GRASS] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, bench: [C.pikachu], deck: POTIONS });
        expect(attack(game, me, 'SV5a-003', 'スロークランチ')).toBe(true);
        const big = other.active;
        game.switchActive(other, other.bench[0]);
        expect(game.applyCommand(opp, { type: 'endTurn' })).toBe(true);
        expect(big.damage).toBe(0);
        expect(other.bench).toContain(big);
    });

    it('うねりさく（ウネルミナモ）：このポケモンにダメカンを9個までのせ、のせた数×20ダメージ', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'SV5a-026', energies: [WATER, WATER, WATER] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, deck: POTIONS });
        expect(attack(game, me, 'SV5a-026', 'うねりさく')).toBe(true);
        expect(game.pendingPrompt.options).toHaveLength(10);
        choose(game, [5]);
        expect(player.active.damage).toBe(50);
        expect(other.active.damage).toBe(100);
    });

    it('しんかジャマー（ドータクン）：次の相手の番、相手は手札から進化させられない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV5K-029', energies: [PSYCHIC] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, bench: [C.charmander], hand: [C.charmeleon], deck: POTIONS });
        expect(attack(game, me, 'SV5K-029', 'しんかジャマー')).toBe(true);
        const evolve = () => game.applyCommand(opp, { type: 'evolve', uid: other.hand.find(inst => inst.id === C.charmeleon).uid, target: other.bench[0].id });
        expect(evolve()).toBe(false);
        expect(game.lastError).toContain('しんかジャマー');
        game.applyCommand(opp, { type: 'endTurn' });
        game.applyCommand(me, { type: 'endTurn' });
        expect(evolve()).toBe(true);
    });

    it('れっかばくしん（ウガツホムラex）：使ったら、バトル場をはなれるまで使えない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'SV5K-098', energies: [FIRE, FIRE, FIRE] }, bench: [C.pikachu], deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, deck: POTIONS });
        const index = attackIndex('SV5K-098', 'れっかばくしん');
        expect(attack(game, me, 'SV5K-098', 'れっかばくしん')).toBe(true);
        expect(other.active.damage).toBe(260);
        game.applyCommand(opp, { type: 'endTurn' });
        expect(game.getLegalActions(me).attacks[index]).toBe(false);
        // ベンチにもどれば、効果はなくなる
        const ugatsu = player.active;
        game.switchActive(player, player.bench[0]);
        game.switchActive(player, ugatsu);
        expect(game.getLegalActions(me).attacks[index]).toBe(true);
    });

    it('ドラムアタック（ゴリランダー）：次の相手の番、ワザを受けたポケモンのワザとにげるためのエネルギーが[C]1個ぶん多くなる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV6-010', energies: [GRASS] }, deck: POTIONS });
        const other = arrange(game, opp, { active: { id: BIG, energies: [WATER, WATER, WATER] }, deck: POTIONS });
        const surf = CARDS[BIG].attacks[0];
        const retreat = game.retreatCost(other.active);
        expect(attack(game, me, 'SV6-010', 'ドラムアタック')).toBe(true);
        expect(other.active.damage).toBe(60);
        expect(game.attackCost(other.active, surf)).toEqual([...surf.cost, 'colorless']);
        expect(game.retreatCost(other.active)).toBe(retreat + 1);
        expect(game.getLegalActions(opp).attacks[0]).toBe(false); // エネルギーが足りない
        game.applyCommand(opp, { type: 'endTurn' });
        expect(game.attackCost(other.active, surf)).toEqual(surf.cost);
    });

    it('ジャンピングアッパー（ニョロボン）：のぞむなら120ダメージ追加し、このポケモンを山札にもどして切る', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'SV6-025', energies: [WATER, WATER] }, bench: [C.pikachu], deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, deck: POTIONS });
        expect(attack(game, me, 'SV6-025', 'ジャンピングアッパー')).toBe(true);
        answer(game, true);
        expect(other.active.damage).toBe(240);
        expect(player.active).toBeNull();
        expect(player.deck.some(inst => inst.id === 'SV6-025')).toBe(true);
        expect(player.deck.filter(inst => inst.id === WATER)).toHaveLength(2);
        expect(game.pendingPrompt.purpose).toBe('promote');
    });

    it('はくちゅうむ（スリーパー）：次の相手の番、ワザを受けたポケモンに手札からエネルギーをつけたなら、相手の番は終わる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV6a-017', energies: [PSYCHIC, PSYCHIC] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, bench: [C.pikachu], hand: [WATER, WATER], deck: POTIONS });
        expect(attack(game, me, 'SV6a-017', 'はくちゅうむ')).toBe(true);
        expect(game.current).toBe(opp);
        // ベンチポケモンにつけても、番は終わらない
        game.applyCommand(opp, { type: 'attachEnergy', uid: other.hand[0].uid, target: other.bench[0].id });
        expect(game.current).toBe(opp);
        game.turnState.energyAttached = false;
        game.applyCommand(opp, { type: 'attachEnergy', uid: other.hand.find(inst => inst.id === WATER).uid, target: other.active.id });
        expect(game.current).toBe(me);
    });

    it('けったくテンタクル（カラマネロ）：「クセロシキのたくらみ」を使っていないなら失敗。使っていれば呼び出したポケモンに120ダメージ', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV6a-034', energies: [DARKNESS] }, deck: POTIONS });
        const other = arrange(game, opp, { active: C.pikachu, bench: [BIG], deck: POTIONS });
        expect(attack(game, me, 'SV6a-034', 'けったくテンタクル')).toBe(true);
        expect(game.pendingPrompt).toBeNull();
        expect(other.bench[0].damage).toBe(0);

        const second = midGame(2);
        arrange(second.game, second.me, { active: { id: 'SV6a-034', energies: [DARKNESS] }, deck: POTIONS });
        const target = arrange(second.game, second.opp, { active: C.pikachu, bench: [BIG], deck: POTIONS });
        second.game.turnState.supporterNames = ['クセロシキのたくらみ'];
        expect(attack(second.game, second.me, 'SV6a-034', 'けったくテンタクル')).toBe(true);
        answer(second.game, [target.bench[0]]);
        expect(second.game.topCard(target.active).id).toBe(BIG);
        expect(target.active.damage).toBe(120);
    });

    it('いっせいこうげき（タイレーツ）：前の自分の番に「じんけいをくむ」を使っていたなら、90ダメージ追加', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV7-060', energies: [FIRE, FIRE] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, deck: POTIONS });
        expect(attack(game, me, 'SV7-060', 'じんけいをくむ')).toBe(true);
        game.applyCommand(opp, { type: 'endTurn' });
        expect(attack(game, me, 'SV7-060', 'いっせいこうげき')).toBe(true);
        expect(other.active.damage).toBe(120);
        game.applyCommand(opp, { type: 'endTurn' });
        expect(attack(game, me, 'SV7-060', 'いっせいこうげき')).toBe(true);
        expect(other.active.damage).toBe(150); // 前の番は「いっせいこうげき」なので、追加なし
    });

    it('クラウンオパール（テラパゴスex）：次の相手の番、たねポケモン（[C]ポケモンをのぞく）からワザのダメージを受けない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'SV7-130', energies: [GRASS, WATER, LIGHTNING] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, bench: [C.pikachu, 'SV7-130'], deck: POTIONS });
        expect(attack(game, me, 'SV7-130', 'クラウンオパール')).toBe(true);
        expect(other.active.damage).toBe(180);
        const ctxFrom = attacker => ({ game, player: other, opponent: player, attacker, defender: player.active, attack: { name: 'テスト' }, damage: 50 });
        expect(game.dealAttackDamage(ctxFrom(other.bench[0]), player.active, 50)).toBe(0); // ピカチュウ（雷のたねポケモン）
        expect(game.dealAttackDamage(ctxFrom(other.bench[1]), player.active, 50)).toBe(50); // 無色のたねポケモン
        expect(game.dealAttackDamage(ctxFrom(other.active), player.active, 50)).toBe(50); // 1進化
    });

    it('ミスティックアイ（クエスパトラ）：相手の進化しているポケモンを退化させ、はがしたカードを相手の手札にもどす', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV7a-023', energies: [PSYCHIC] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, bench: [{ cards: [C.charmander, C.charmeleon], damage: 20 }], hand: [], deck: POTIONS });
        expect(attack(game, me, 'SV7a-023', 'ミスティックアイ')).toBe(true);
        answer(game, [other.bench[0]]);
        expect(game.topCard(other.bench[0]).name).toBe('ヒトカゲ');
        expect(other.bench[0].damage).toBe(20);
        expect(other.hand.some(inst => inst.id === C.charmeleon)).toBe(true);
    });

    it('エンジェライト（ニンフィアex）：相手のベンチポケモンを2匹山札にもどす。前の自分の番に使っていたなら使えない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV8a-212', energies: [WATER, LIGHTNING, PSYCHIC] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, bench: [C.pikachu, C.charmander, C.raichu], deck: POTIONS });
        const index = attackIndex('SV8a-212', 'エンジェライト');
        expect(attack(game, me, 'SV8a-212', 'エンジェライト')).toBe(true);
        answer(game, [other.bench[0], other.bench[1]]);
        expect(other.bench.map(pokemon => game.topCard(pokemon).id)).toEqual([C.raichu]);
        game.applyCommand(opp, { type: 'endTurn' });
        expect(game.getLegalActions(me).attacks[index]).toBe(false);
        game.applyCommand(me, { type: 'endTurn' });
        game.applyCommand(opp, { type: 'endTurn' });
        expect(game.getLegalActions(me).attacks[index]).toBe(true);
    });

    it('よわみをにぎる（ヤレユータン）：次の自分の番の終わりまで、ワザを受けたポケモンの弱点は[C]になる', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: 'SV8-090', energies: [FIRE] }, deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, deck: POTIONS });
        expect(attack(game, me, 'SV8-090', 'よわみをにぎる')).toBe(true);
        expect(game.weaknessOf(other.active)).toBe('colorless');
        game.applyCommand(opp, { type: 'endTurn' });
        expect(game.weaknessOf(other.active)).toBe('colorless');
        game.applyCommand(me, { type: 'endTurn' });
        expect(game.weaknessOf(other.active)).toBe('lightning');
    });

    it('オロチブレス（カミツオロチ）：手札の基本エネルギーを6枚トラッシュし、相手のバトルポケモンをきぜつさせる。6枚ないなら失敗', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'SV9a-068', energies: [GRASS] }, hand: Array(5).fill(FIRE), deck: POTIONS });
        const other = arrange(game, opp, { active: BIG, bench: [C.pikachu], deck: POTIONS });
        expect(attack(game, me, 'SV9a-068', 'オロチブレス')).toBe(true);
        expect(other.active.damage).toBe(0);
        expect(player.hand).toHaveLength(5);

        const second = midGame(2);
        const mine = arrange(second.game, second.me, { active: { id: 'SV9a-068', energies: [GRASS] }, hand: [...Array(6).fill(FIRE), C.potion], deck: POTIONS });
        const target = arrange(second.game, second.opp, { active: BIG, bench: [C.pikachu], deck: POTIONS });
        expect(attack(second.game, second.me, 'SV9a-068', 'オロチブレス')).toBe(true);
        expect(mine.hand.filter(inst => inst.id === FIRE)).toHaveLength(0);
        expect(mine.discard.filter(inst => inst.id === FIRE)).toHaveLength(6);
        expect(target.discard.some(inst => inst.id === BIG)).toBe(true);
    });

    it('よけいなかふん（アブリボン）：次の自分の番、ワザを受けたポケモンがきぜつしたとき、サイドを2枚多くとる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: 'SV5M-034', energies: [FIRE] }, deck: POTIONS, prizes: POTIONS.slice(0, 6) });
        const other = arrange(game, opp, { active: C.pikachu, bench: [C.charmander], deck: POTIONS });
        expect(attack(game, me, 'SV5M-034', 'よけいなかふん')).toBe(true);
        expect(other.active.damage).toBe(30);
        game.applyCommand(opp, { type: 'endTurn' });
        other.active.damage = game.maxHp(other.active);
        game.checkKnockouts();
        expect(player.prizes).toHaveLength(3); // たねポケモンの1枚に、2枚多くとる
    });
});
