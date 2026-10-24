import { describe, it, expect, afterEach } from 'vitest';
import { CARDS, resolveCardId } from '../public/js/card-data.js';
import { startedGame, arrange, answer, makeCard } from './helpers.js';

// 「相手の効果を受けない」ポケモンを、特性（abilities-*.js）とワザ（attack-overrides-b.js）の効果が変えないことを確かめる
const CHADES = resolveCardId('M5-005'); // チャデス：ばけがくれ（相手のワザや特性の効果を受けない）
const SHUPPET = resolveCardId('M5-031'); // カゲボウズ：ばけがくれ
const BANETTE = resolveCardId('M5-032'); // ジュペッタ：ばけがくれ（1進化）
const MEGA_CLEFABLE_EX = resolveCardId('M3-112'); // メガピクシーex：ひかりのつばさ（相手の特性の効果を受けない）
const ABRA = resolveCardId('SV6-047'); // ケーシィ
const KADABRA = resolveCardId('M1S-037'); // ユンゲラー（1進化）
const PATRAT = resolveCardId('M-P-141'); // ミネズミ：かんしのめ（ダメカンをのせ替えられない）
const DUSKNOIR = resolveCardId('SV6a-070'); // ヨノワール：カースドボム
const MUNKIDORI = resolveCardId('SV6-107'); // マシマシラ：アドレナブレイン
const ARCHEOPS = resolveCardId('SV11W-130'); // アーケオス：げんしのつばさ
const RAMPARDOS_EX = resolveCardId('M5-098'); // ラムパルドex：はかいのずつき
const VOLCANION_EX = resolveCardId('SV9-017'); // ボルケニオンex：やけつくじょうき
const NIDOQUEEN = resolveCardId('M6-043'); // ニドクイン：ははのいざない
const TURTONATOR = resolveCardId('M3-017'); // バクガメス：こうらのトゲ
const COFAGRIGUS = resolveCardId('SV11W-120'); // デスカーン：のびるダメカーン
const RABSCA = resolveCardId('SV7a-023'); // クエスパトラ：ミスティックアイ
const GRIMMSNARL = resolveCardId('SV7-066'); // オーロンゲ：ちょうはつクラッチ
const ESPEON_EX = resolveCardId('SV8a-211'); // エーフィex：アマゼツ
const SINISTCHA_EX = resolveCardId('SV5a-009'); // ヤバソチャex：せんじがえし
const DUCKLETT = resolveCardId('SV11W-106'); // コアルヒー：しょうか
const COLOSSEUM = resolveCardId('M2-108'); // バトルコロシアム

const PSYCHIC = 'basic-psychic-energy';
const GRASS = 'basic-grass-energy';
const DARKNESS = 'basic-darkness-energy';
const FIRE = 'basic-fire-energy';
const LIGHTNING = 'basic-lightning-energy';
const POTIONS = Array(10).fill('basic-grass-energy');

// HP の大きい、守りのないポケモン（ワザのダメージできぜつしないように）
const BIG = 'test-guard-big';
const BIG_TURTONATOR = 'test-guard-turtonator';
const TEST_IDS = [BIG, BIG_TURTONATOR];

// 3ターン目（どちらも最初の番を終えた後）の、手番のプレイヤーの番にする
function midGame(seed = 1) {
    const game = startedGame(seed);
    game.turn = 3;
    game.players.forEach(player => { player.turnsTaken = 2; });
    game.turnState.energyAttached = false;
    const pikachu = Object.values(CARDS).find(card => card.name === 'ピカチュウ' && card.supported && card.attacks.some(attack => attack.damage > 0));
    CARDS[BIG] = { ...pikachu, id: BIG, hp: 900, weakness: null, resistance: null };
    CARDS[BIG_TURTONATOR] = { ...CARDS[TURTONATOR], id: BIG_TURTONATOR, hp: 900, weakness: null, resistance: null };
    return { game, me: game.current, opp: 1 - game.current };
}

afterEach(() => { TEST_IDS.forEach(id => { delete CARDS[id]; }); });

const useAbility = (game, playerId, pokemon) => game.applyCommand(playerId, { type: 'useAbility', target: pokemon.id });
const attackNamed = (game, playerId, name) => {
    const index = game.topCard(game.players[playerId].active).attacks.findIndex(attack => attack.name === name);
    return game.applyCommand(playerId, { type: 'attack', index });
};
const heads = game => { game.random = () => 0.1; };

describe('特性の効果は、効果を受けないポケモンに働かない', () => {
    it('カースドボム：ばけがくれのポケモンは、ダメカンをのせる候補にならない（守りのないポケモンにはのる）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: BIG, bench: [DUSKNOIR] });
        const target = arrange(game, opp, { active: CHADES, bench: [BIG] });
        expect(useAbility(game, me, player.bench[0])).toBe(true);
        expect(game.pendingPrompt.pokemon).toEqual([target.bench[0]]);
        answer(game, [target.bench[0]]);
        expect(target.bench[0].damage).toBe(130);
        expect(target.active.damage).toBe(0);
    });

    it('カースドボム：相手の場がばけがくれのポケモンだけなら、選択を出さず、ヨノワールもきぜつしない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: BIG, bench: [DUSKNOIR] });
        const target = arrange(game, opp, { active: CHADES, bench: [] });
        useAbility(game, me, player.bench[0]);
        game.processEffects();
        expect(game.pendingPrompt).toBeNull();
        expect(target.active.damage).toBe(0);
        expect(player.bench).toHaveLength(1);
    });

    it('アドレナブレイン：ばけがくれのポケモンには、ダメカンをのせ替えられない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: MUNKIDORI, energies: [DARKNESS], damage: 30 } });
        const target = arrange(game, opp, { active: CHADES, bench: [BIG] });
        expect(useAbility(game, me, player.active)).toBe(true);
        answer(game, [player.active]);
        answer(game, [0]); // 1個
        expect(game.pendingPrompt.pokemon).toEqual([target.bench[0]]);
        answer(game, [target.bench[0]]);
        expect(target.bench[0].damage).toBe(10);
        expect(player.active.damage).toBe(20);
        // 相手の場がばけがくれのポケモンだけなら使えない（この番はもう使ったので、canUse を直接確かめる）
        arrange(game, opp, { active: CHADES, bench: [] });
        expect(CARDS[MUNKIDORI].ability.canUse(game, player, player.active)).toBe(false);
    });

    it('げんしのつばさ：ばけがくれのポケモンは退化させられない（守りのないポケモンは退化して、はがしたカードは手札へ）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: ARCHEOPS });
        const target = arrange(game, opp, { active: { id: BANETTE, cards: [SHUPPET, BANETTE] }, bench: [], hand: [] });
        expect(useAbility(game, me, player.active)).toBe(false);
        expect(game.topCard(target.active).id).toBe(BANETTE);
        arrange(game, opp, { active: { id: KADABRA, cards: [ABRA, KADABRA] } });
        expect(useAbility(game, me, player.active)).toBe(true);
        answer(game, [target.active]);
        expect(game.topCard(target.active).id).toBe(ABRA);
        expect(target.hand.map(inst => inst.id)).toContain(KADABRA);
    });

    it('はかいのずつき：ひかりのつばさのポケモンのエネルギーはトラッシュできない（守りのないポケモンのはできる）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: RAMPARDOS_EX });
        const target = arrange(game, opp, { active: { id: MEGA_CLEFABLE_EX, energies: [PSYCHIC] } });
        expect(useAbility(game, me, player.active)).toBe(false);
        expect(target.active.energies).toHaveLength(1);
        arrange(game, opp, { active: { id: BIG, energies: [PSYCHIC] } });
        heads(game);
        expect(useAbility(game, me, player.active)).toBe(true);
        answer(game, [PSYCHIC]);
        expect(target.active.energies).toHaveLength(0);
        expect(target.discard.map(inst => inst.id)).toContain(PSYCHIC);
    });

    it('やけつくじょうき：ひかりのつばさ・ばけがくれのポケモンはやけどにできない（守りのないポケモンはやけどになる）', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: VOLCANION_EX });
        arrange(game, opp, { active: MEGA_CLEFABLE_EX });
        expect(useAbility(game, me, player.active)).toBe(false);
        arrange(game, opp, { active: CHADES });
        expect(useAbility(game, me, player.active)).toBe(false);
        const target = arrange(game, opp, { active: BIG });
        expect(useAbility(game, me, player.active)).toBe(true);
        expect(game.hasCondition(target.active, 'burned')).toBe(true);
    });

    it('ははのいざない：ばけがくれのベンチポケモンは、バトル場に呼び出せない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: NIDOQUEEN });
        const target = arrange(game, opp, { active: BIG, bench: [CHADES] });
        expect(useAbility(game, me, player.active)).toBe(false);
        arrange(game, opp, { bench: [CHADES, BIG] });
        const big = target.bench[1];
        heads(game);
        expect(useAbility(game, me, player.active)).toBe(true);
        game.processEffects();
        expect(target.active).toBe(big);
        expect(game.topCard(target.bench[0]).id === CHADES || game.topCard(target.bench[1]).id === CHADES).toBe(true);
    });

    it('こうらのトゲ：ひかりのつばさのポケモンのエネルギーはトラッシュされない（守りのないポケモンのはされる）', () => {
        const clefable = midGame();
        arrange(clefable.game, clefable.me, { active: { id: MEGA_CLEFABLE_EX, energies: [PSYCHIC, PSYCHIC] } });
        arrange(clefable.game, clefable.opp, { active: BIG_TURTONATOR, deck: POTIONS });
        attackNamed(clefable.game, clefable.me, 'シューティングムーン');
        clefable.game.processEffects();
        expect(clefable.game.pendingPrompt?.purpose).not.toBe('discard-opponent-energy');
        expect(clefable.game.players[clefable.me].active.energies).toHaveLength(2);

        const { game, me, opp } = midGame();
        const attack = CARDS[BIG].attacks.find(a => a.damage > 0);
        const energies = attack.cost.map(type => (type === 'colorless' ? LIGHTNING : `basic-${type}-energy`));
        const player = arrange(game, me, { active: { id: BIG, energies: [...energies, LIGHTNING] } });
        arrange(game, opp, { active: BIG_TURTONATOR, deck: POTIONS });
        attackNamed(game, me, attack.name);
        expect(game.pendingPrompt.purpose).toBe('discard-opponent-energy');
        answer(game, [LIGHTNING]);
        expect(player.active.energies).toHaveLength(energies.length);
    });
});

describe('ワザ（attack-overrides-b）の効果は、効果を受けないポケモンに働かない', () => {
    it('のびるダメカーン：ばけがくれのポケモンには、ダメカンをのせ替えられない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: COFAGRIGUS, energies: [PSYCHIC, PSYCHIC] }, bench: [{ id: BIG, damage: 50 }] });
        const target = arrange(game, opp, { active: CHADES, bench: [BIG], deck: POTIONS });
        attackNamed(game, me, 'のびるダメカーン');
        answer(game, [player.bench[0]]);
        expect(game.pendingPrompt.pokemon).toEqual([target.bench[0]]);
        answer(game, [target.bench[0]]);
        expect(target.bench[0].damage).toBe(50);
        expect(player.bench[0].damage).toBe(0);
        expect(target.active.damage).toBe(0);
    });

    it('のびるダメカーン：かんしのめのポケモンがいれば、ダメカンはのせ替えられない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: COFAGRIGUS, energies: [PSYCHIC, PSYCHIC] }, bench: [{ id: BIG, damage: 50 }] });
        const target = arrange(game, opp, { active: PATRAT, bench: [BIG], deck: POTIONS });
        attackNamed(game, me, 'のびるダメカーン');
        answer(game, [player.bench[0]]);
        answer(game, [target.bench[0]]);
        expect(target.bench[0].damage).toBe(0);
        expect(player.bench[0].damage).toBe(50);
    });

    it('ミスティックアイ：ばけがくれのポケモンは退化させる候補にならない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: RABSCA, energies: [PSYCHIC] } });
        const target = arrange(game, opp, {
            active: { id: BANETTE, cards: [SHUPPET, BANETTE] },
            bench: [{ id: KADABRA, cards: [ABRA, KADABRA] }],
            hand: [],
            deck: POTIONS
        });
        attackNamed(game, me, 'ミスティックアイ');
        expect(game.pendingPrompt.pokemon).toEqual([target.bench[0]]);
        answer(game, [target.bench[0]]);
        expect(game.topCard(target.bench[0]).id).toBe(ABRA);
        expect(game.topCard(target.active).id).toBe(BANETTE);
        // （番が相手に移り、相手は1枚引いている）
        expect(target.hand.map(inst => inst.id)).toContain(KADABRA);
    });

    it('アマゼツ：ばけがくれのポケモンは退化しない（守りのないポケモンは退化して、はがしたカードは山札へ）', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: ESPEON_EX, energies: [GRASS, PSYCHIC, DARKNESS] } });
        const target = arrange(game, opp, {
            active: { id: BANETTE, cards: [SHUPPET, BANETTE] },
            bench: [{ id: KADABRA, cards: [ABRA, KADABRA] }],
            deck: POTIONS
        });
        attackNamed(game, me, 'アマゼツ');
        game.processEffects();
        expect(game.topCard(target.active).id).toBe(BANETTE);
        expect(game.topCard(target.bench[0]).id).toBe(ABRA);
        expect(target.deck.map(inst => inst.id)).toContain(KADABRA);
    });

    it('ちょうはつクラッチ：ばけがくれのベンチポケモンは、相手がバトル場に出す候補にならない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: GRIMMSNARL, energies: [DARKNESS, DARKNESS] } });
        const target = arrange(game, opp, { active: BIG, bench: [CHADES, BIG], deck: POTIONS });
        const big = target.bench[1];
        attackNamed(game, me, 'ちょうはつクラッチ');
        expect(game.pendingPrompt.player.id).toBe(opp);
        expect(game.pendingPrompt.pokemon).toEqual([big]);
        answer(game, [big]);
        expect(target.active).toBe(big);
        expect(big.damage).toBe(160);
    });

    it('ちょうはつクラッチ：バトルポケモンがばけがくれなら、入れ替えず、ダメージも与えない', () => {
        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: GRIMMSNARL, energies: [DARKNESS, DARKNESS] } });
        const target = arrange(game, opp, { active: CHADES, bench: [BIG], deck: POTIONS });
        const chades = target.active;
        attackNamed(game, me, 'ちょうはつクラッチ');
        game.processEffects();
        expect(game.pendingPrompt).toBeNull();
        expect(target.active).toBe(chades);
        expect(target.bench[0].damage).toBe(0);
    });

    it('せんじがえし：バトルコロシアムがあれば、相手のベンチポケモンはダメカンをのせる候補にならない', () => {
        const { game, me, opp } = midGame();
        const player = arrange(game, me, { active: { id: SINISTCHA_EX, energies: [GRASS] } });
        player.discard = [makeCard(game, GRASS), makeCard(game, GRASS)];
        const target = arrange(game, opp, { active: BIG, bench: [BIG], deck: POTIONS });
        game.stadium = { inst: makeCard(game, COLOSSEUM), owner: opp };
        attackNamed(game, me, 'せんじがえし');
        expect(game.pendingPrompt.pokemon).toEqual([target.active]);
        answer(game, [target.active]);
        expect(target.active.damage).toBe(40);
        expect(target.bench[0].damage).toBe(0);
        expect(player.discard.filter(inst => inst.id === GRASS)).toHaveLength(0);
    });

    it('しょうか：ばけがくれのポケモンの炎エネルギーはトラッシュされない（守りのないポケモンのはされる）', () => {
        const chades = midGame();
        arrange(chades.game, chades.me, { active: { id: DUCKLETT, energies: [PSYCHIC] } });
        const guarded = arrange(chades.game, chades.opp, { active: { id: CHADES, energies: [FIRE] }, deck: POTIONS });
        attackNamed(chades.game, chades.me, 'しょうか');
        chades.game.processEffects();
        expect(guarded.active.energies).toHaveLength(1);

        const { game, me, opp } = midGame();
        arrange(game, me, { active: { id: DUCKLETT, energies: [PSYCHIC] } });
        const target = arrange(game, opp, { active: { id: BIG, energies: [FIRE] }, deck: POTIONS });
        attackNamed(game, me, 'しょうか');
        game.processEffects();
        expect(target.active.energies).toHaveLength(0);
        expect(target.discard.map(inst => inst.id)).toContain(FIRE);
    });
});
