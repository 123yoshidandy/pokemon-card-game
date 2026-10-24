import { describe, it, expect } from 'vitest';
import { getCard } from '../public/js/card-data.js';
import { startedGame, arrange, answer, makeCard, C } from './helpers.js';

// 特性（そのb）のテスト。カードは catalog.js の id で指定する
const GRASS = 'basic-grass-energy';
const WATER = 'basic-water-energy';
const LIGHTNING = 'basic-lightning-energy';
const FIGHTING = 'basic-fighting-energy';
const DARKNESS = 'basic-darkness-energy';
const POTIONS = Array(10).fill(C.potion);

const DODEKABASHI = 'M5-092'; // ドデカバシ：スカイドロー
const N_ZOROARK_EX = 'M2a-242'; // Nのゾロアークex：とりひき
const DRAKLOAK = 'SV6-080'; // ドロンチ：ていさつしれい
const MEOWSCARADA = 'SV9-012'; // マスカーニャ：ショータイム
const PECHARUNT_EX = 'SV6a-092'; // モモワロウex：しはいのくさり
const MEGA_VENUSAUR_EX = 'M1L-087'; // メガフシギバナex：ソーラートランス
const FERALIGATR = 'SV5K-015'; // オーダイル：トレントハート
const DIPPLIN_EX = 'SV7-127'; // カミツオロチex：じゅくせいチャージ
const ABRA = 'SV6-047'; // ケーシィ
const KADABRA = 'M1S-037'; // ユンゲラー：サイコドロー
const ROCKET_ZUBAT = 'SV10-064'; // ロケット団のズバット
const ROCKET_GOLBAT = 'SV10-065'; // ロケット団のゴルバット：こっそりかみつく
const INDEEDEE = 'SV8-058'; // イエッサン：せわやきヒール
const BRAMBLEGHAST = 'SV5M-013'; // アノホラグサ：ざっそうだましい
const ALTARIA = 'M6-087'; // チルタリス：コットンキャリー
const CRUSTLE = 'M2a-014'; // イワパレス：しんぴのいしやど
const ROSELIA = 'SV5K-001'; // ロゼリア：どくのトゲ
const MEGA_DIANCIE_EX = 'M2a-238'; // メガディアンシーex：ダイヤコート
const GARGANACL = 'MC-418'; // キョジオーン：ちからのしお
const SLAKING_EX = 'SV8-126'; // ケッキングex：さぼりたいしつ
const VELUZA = 'SV7-027'; // ミガルーサ：したごしらえ
const KARRABLAST = 'SV11B-094'; // カブルモ：しげきしんか
const SHELMET = 'SV11W-093'; // チョボマキ
const MUNKIDORI = 'M2a-115'; // モモワロウ：さいごのくさり
const PIKACHU_EX = 'MC-764'; // ピカチュウex（10まんボルト 120）
const HAIDAI = 'SV7-125'; // ハイダイ

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    return { game, me: game.current, opp: 1 - game.current };
}

const useAbility = (game, playerId, pokemon) => game.applyCommand(playerId, { type: 'useAbility', target: pokemon.id });
const ids = list => list.map(inst => inst.id);

describe('特性（自分の番に使う）', () => {
    it('スカイドロー：山札を1枚引く。1匹1回まで', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: DODEKABASHI, hand: [], deck: POTIONS });
        expect(useAbility(game, me, player.active)).toBe(true);
        expect(player.hand.length).toBe(1);
        expect(useAbility(game, me, player.active)).toBe(false);
    });

    it('とりひき：手札を1枚トラッシュして、山札を2枚引く。手札がなければ使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: N_ZOROARK_EX, hand: [], deck: POTIONS });
        expect(useAbility(game, me, player.active)).toBe(false);
        arrange(game, me, { hand: [GRASS] });
        expect(useAbility(game, me, player.active)).toBe(true);
        answer(game, [GRASS]);
        expect(ids(player.discard)).toContain(GRASS);
        expect(player.hand.length).toBe(2);
    });

    it('ていさつしれい：上から2枚のうち1枚を手札に、残りを山札の下にもどす', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: DRAKLOAK, hand: [], deck: [GRASS, WATER, ...POTIONS] });
        useAbility(game, me, player.active);
        expect(game.pendingPrompt.cards.length).toBe(2);
        answer(game, [WATER]);
        expect(ids(player.hand)).toEqual([WATER]);
        expect(player.deck[player.deck.length - 1].id).toBe(GRASS);
        expect(player.deck.length).toBe(POTIONS.length + 1);
    });

    it('ショータイム：ベンチにいるときだけ、バトルポケモンと入れ替わる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: MEOWSCARADA, bench: [MEOWSCARADA, C.pikachu] });
        expect(useAbility(game, me, player.active)).toBe(false);
        const benched = player.bench[0];
        expect(useAbility(game, me, benched)).toBe(true);
        expect(player.active).toBe(benched);
    });

    it('しはいのくさり：ベンチの悪ポケモンと入れ替えてどくにする。この番、別の「しはいのくさり」は使えない', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: PECHARUNT_EX, bench: [PECHARUNT_EX, MUNKIDORI, C.pikachu] });
        const first = player.active;
        useAbility(game, me, first);
        expect(game.pendingPrompt.pokemon.map(pk => game.topCard(pk).name)).toEqual(['モモワロウ']);
        const munkidori = player.bench[1];
        answer(game, [munkidori]);
        expect(player.active).toBe(munkidori);
        expect(munkidori.poisoned).toBe(true);
        const other = player.bench.find(pk => pk !== first && game.topCard(pk).name === 'モモワロウex');
        expect(game.checkAbility(player, other.id)).toContain('しはいのくさり');
    });

    it('ソーラートランス：基本エネルギーを別のポケモンにつけ替える。何回でも使える', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: MEGA_VENUSAUR_EX, bench: [{ id: C.pikachu, energies: [GRASS, GRASS] }] });
        const [bench] = player.bench;
        for (let i = 0; i < 2; i++) {
            expect(useAbility(game, me, player.active)).toBe(true);
            answer(game, [bench]);
            answer(game, [GRASS]);
            answer(game, [player.active]);
        }
        expect(player.active.energies.length).toBe(2);
        expect(bench.energies.length).toBe(0);
    });

    it('トレントハート：自分にダメカンを5個のせ、この番のワザのダメージが+120', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: FERALIGATR, energies: [WATER, WATER] }, deck: POTIONS });
        const target = arrange(game, opp, { active: MEGA_VENUSAUR_EX, bench: [C.pikachu], deck: POTIONS });
        useAbility(game, me, player.active);
        expect(player.active.damage).toBe(50);
        game.applyCommand(me, { type: 'attack', index: 0 }); // おおなみ 160
        expect(target.active.damage).toBe(280);
    });

    it('じゅくせいチャージ：手札の基本草エネルギーをつけ、そのポケモンのHPを30回復する', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: DIPPLIN_EX, damage: 50 }, bench: [C.pikachu], hand: [GRASS, WATER] });
        useAbility(game, me, player.active);
        expect(game.pendingPrompt.cards.map(inst => inst.id)).toEqual([GRASS]);
        answer(game, [GRASS]);
        answer(game, [player.active]);
        expect(ids(player.active.energies)).toEqual([GRASS]);
        expect(player.active.damage).toBe(20);
        expect(game.turnState.energyAttached).toBe(false); // 手札から1回つける権利は残る
    });
});

describe('特性（進化させたとき・ベンチに出したとき）', () => {
    it('サイコドロー（ユンゲラー）：手札から進化させたとき、山札を2枚引く', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: ABRA, hand: [KADABRA], deck: POTIONS });
        const kadabra = player.hand[0];
        expect(game.applyCommand(me, { type: 'evolve', uid: kadabra.uid, target: player.active.id })).toBe(true);
        expect(game.pendingPrompt.type).toBe('confirm');
        answer(game, true);
        expect(player.hand.length).toBe(2);
    });

    it('こっそりかみつく：進化させたとき、相手のポケモン1匹にダメカンを2個のせる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: ROCKET_ZUBAT, hand: [ROCKET_GOLBAT] });
        const target = arrange(game, opp, { active: C.charmander, bench: [C.pikachu] });
        game.applyCommand(me, { type: 'evolve', uid: player.hand[0].uid, target: player.active.id });
        answer(game, true);
        answer(game, [target.bench[0]]);
        expect(target.bench[0].damage).toBe(20);
        expect(target.active.damage).toBe(0);
    });

    it('せわやきヒール：ベンチに出したとき、バトルポケモンのHPを30回復し、特殊状態を1つ回復する', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, damage: 40 }, bench: [], hand: [INDEEDEE] });
        game.addCondition(player.active, 'poisoned');
        game.applyCommand(me, { type: 'playBasic', uid: player.hand[0].uid });
        answer(game, true);
        expect(player.active.damage).toBe(10);
        expect(player.active.poisoned).toBe(false);
    });
});

describe('特性（いるだけで働く）', () => {
    it('ざっそうだましい：相手がとったサイド1枚につき、最大HPが+50', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: BRAMBLEGHAST });
        arrange(game, opp, { prizes: [C.potion, C.potion, C.potion, C.potion] });
        expect(game.maxHp(player.active)).toBe(200);
    });

    it('コットンキャリー：自分のたねポケモンだけ、にげるためのエネルギーがなくなる', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: SHELMET, bench: [ALTARIA] });
        const other = arrange(game, opp, { active: SHELMET });
        expect(game.retreatCost(player.active)).toBe(0);
        expect(game.retreatCost(player.bench[0])).toBe(1);
        expect(game.retreatCost(other.active)).toBe(3);
    });

    it('しんぴのいしやど：相手のポケモンexからワザのダメージを受けない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: PIKACHU_EX, energies: [LIGHTNING, LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const target = arrange(game, opp, { active: CRUSTLE, bench: [C.pikachu], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 0 });
        expect(target.active.damage).toBe(0);
    });

    it('どくのトゲ：バトル場でワザのダメージを受けたとき、ワザを使ったポケモンをどくにする', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, deck: POTIONS });
        arrange(game, opp, { active: ROSELIA, bench: [C.pikachu], deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 1 }); // プチボルト 30
        expect(player.active.poisoned).toBe(true);
    });

    it('ダイヤコート：受けるワザのダメージが-30', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: PIKACHU_EX, energies: [LIGHTNING, LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const target = arrange(game, opp, { active: MEGA_DIANCIE_EX, deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 0 }); // 10まんボルト 120
        expect(target.active.damage).toBe(90);
    });

    it('ちからのしお：自分の闘ポケモンのワザの、相手のバトルポケモンへのダメージが+30', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: GARGANACL, energies: [FIGHTING, FIGHTING, FIGHTING] }, deck: POTIONS });
        const target = arrange(game, opp, { active: MEGA_VENUSAUR_EX, deck: POTIONS });
        game.applyCommand(me, { type: 'attack', index: 0 }); // ぶちかます 130
        expect(target.active.damage).toBe(160);
    });

    it('さぼりたいしつ：相手の場にポケモンexがいなければ、ワザを使えない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: SLAKING_EX, energies: [DARKNESS, DARKNESS] } });
        arrange(game, opp, { active: C.charmander, bench: [] });
        expect(game.checkAttack(player, 0)).toContain('ワザが使えません');
        arrange(game, opp, { bench: [PIKACHU_EX] });
        expect(game.checkAttack(player, 0)).toBeNull();
    });

    it('したごしらえ：トラッシュの「ハイダイ」の枚数ぶん、ワザの無色エネルギーが少なくなる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: VELUZA });
        const attack = game.topCard(player.active).attacks[0];
        expect(game.attackCost(player.active, attack).length).toBe(4);
        player.discard.push(makeCard(game, HAIDAI), makeCard(game, HAIDAI));
        expect(game.attackCost(player.active, attack)).toEqual(['colorless', 'colorless']);
    });

    it('しげきしんか：自分の場に「チョボマキ」がいれば、出したばかりの番でも進化できる', () => {
        const { game, me } = midGame();
        const player = arrange(game, me, { active: { id: KARRABLAST, enteredTurn: game.turn }, bench: [] });
        const evolution = getCard(ROCKET_GOLBAT); // 進化先のカードは何でもよい（進化元の名前は checkEvolve で見る）
        expect(game.checkCanEvolveNow(player, player.active, evolution)).not.toBeNull();
        arrange(game, me, { bench: [SHELMET] });
        expect(game.checkCanEvolveNow(player, player.active, evolution)).toBeNull();
    });
});

describe('特性（きぜつしたとき）', () => {
    it('さいごのくさり：相手のワザのダメージできぜつしたとき、山札から好きなカードを1枚手札に加える', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: C.pikachu, energies: [LIGHTNING, LIGHTNING] }, deck: POTIONS });
        const target = arrange(game, opp, { active: { id: MUNKIDORI, damage: 60 }, bench: [C.pikachu], hand: [], deck: [GRASS, ...POTIONS] });
        game.applyCommand(me, { type: 'attack', index: 1 }); // プチボルト 30 できぜつ
        expect(ids(target.discard)).toContain(MUNKIDORI);
        // バトル場に出す → 山札から1枚
        answer(game, [target.bench[0]]);
        expect(game.pendingPrompt.purpose).toBe('search-card');
        answer(game, [GRASS]);
        expect(ids(target.hand)).toContain(GRASS);
    });
});
