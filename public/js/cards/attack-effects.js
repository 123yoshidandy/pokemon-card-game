/**
 * ワザの効果の文を、決まった形に読み替えて動かす
 *
 * 文を「。」で区切り、1文ずつ RULES の形に当てはめる。すべての文が当てはまれば、そのワザは動く
 * 1文は「手順」{ phase, run(ctx), expected(ctx, damage) } になる
 *   phase：'before'（ダメージの前。ダメージの増減・失敗の判定）か 'after'（ダメージの後）
 *   expected：CPU の見積もり（乱数を使わない。コインはオモテ・ウラの平均で見る）
 * ctx はワザの ctx（game・player・opponent・attacker・defender・attack・damage・failed）に、
 *   ignoreWeakness・ignoreResistance・ignoreEffects（ダメージの計算の指定）と dealt（相手のバトルポケモンに与えたダメージ）が加わる
 */

import { normalizeText } from './text.js';

const TYPE_WORDS = {
    草: 'grass', 炎: 'fire', 水: 'water', 雷: 'lightning', 超: 'psychic', 闘: 'fighting', 悪: 'darkness', 鋼: 'metal', ドラゴン: 'dragon', 無色: 'colorless',
    '[G]': 'grass', '[R]': 'fire', '[W]': 'water', '[L]': 'lightning', '[P]': 'psychic', '[F]': 'fighting', '[D]': 'darkness', '[M]': 'metal', '[C]': 'colorless', '[N]': 'dragon'
};
const TYPE_PATTERN = '(草|炎|水|雷|超|闘|悪|鋼|ドラゴン|無色|\\[[GRWLPFDMCN]\\])';
const CONDITIONS = { どく: 'poisoned', やけど: 'burned', マヒ: 'paralyzed', ねむり: 'asleep', こんらん: 'confused' };

// 文の注意書き（効果は変わらないもの）
const REMINDERS = [/\[ベンチは弱点・抵抗力を計算しない。\]/g, /\[バトル場に出すポケモンは相手が選ぶ。\]/g];

const before = (run, expected) => ({ phase: 'before', run, expected });
const after = run => ({ phase: 'after', run });
const noop = () => ({ phase: 'after', run: () => {} });

// ===== 効果の道具 =====

const isEx = card => card.rule === 'ex' || card.rule === 'mega';
const counters = pokemon => Math.floor(pokemon.damage / 10);
const energyCount = (game, pokemon, type) => pokemon.energies.filter(inst => !type || game.cardOf(inst).energyType === type).length;

// 相手のポケモンに、ワザの効果を与えられるか（「ワザの効果を受けない」がかかっていないか）
const canAffect = (ctx, pokemon) => Boolean(pokemon) && ctx.game.canAffectByAttack(ctx, pokemon);

// ポケモンについているエネルギーを count 個選んでトラッシュする（選ぶ人は chooser）
function discardEnergies(ctx, pokemon, count, { type = null, chooser = ctx.player, to = 'discard' } = {}) {
    const { game } = ctx;
    if (!pokemon) return;
    const owner = game.ownerOf(pokemon);
    const candidates = pokemon.energies.filter(inst => !type || game.cardOf(inst).energyType === type);
    const n = Math.min(count, candidates.length);
    if (n === 0) return;
    const finish = selected => {
        selected.forEach(inst => game.moveCard(pokemon.energies, to === 'hand' ? owner.hand : owner.discard, inst));
        game.log(`${game.topCard(pokemon).name}のエネルギーを${n}個${to === 'hand' ? '手札にもどした' : 'トラッシュした'}`);
    };
    const kinds = new Set(candidates.map(inst => inst.id));
    if (n === candidates.length || kinds.size === 1) {
        finish(candidates.slice(0, n));
        return;
    }
    game.promptCards({
        player: chooser,
        cards: candidates,
        min: n,
        max: n,
        title: `${game.topCard(pokemon).name}の${to === 'hand' ? '手札にもどす' : 'トラッシュする'}エネルギーを${n}個選ぶ`,
        purpose: chooser === ctx.player && owner === ctx.player ? 'discard-own-energy' : 'discard-opponent-energy',
        callback: finish
    });
}

// 選んだポケモン（count 匹まで、違うポケモン）にダメージ
function damageChosen(ctx, list, count, amount, purpose = 'snipe-target') {
    const { game } = ctx;
    const targets = list.filter(Boolean);
    const n = Math.min(count, targets.length);
    if (n === 0) return;
    const deal = selected => selected.forEach(target => game.dealAttackDamage(ctx, target, amount));
    if (n === targets.length) {
        deal(targets);
        return;
    }
    game.promptPokemon({ player: ctx.player, pokemon: targets, min: n, max: n, title: `${amount}ダメージを与えるポケモンを${n}匹選ぶ`, purpose, amount, callback: deal });
}

function putCountersChosen(ctx, list, count, amount) {
    const { game } = ctx;
    const targets = list.filter(Boolean);
    const n = Math.min(count, targets.length);
    if (n === 0) return;
    const put = selected => selected.forEach(target => game.putDamage(target, amount));
    if (n === targets.length) {
        put(targets);
        return;
    }
    game.promptPokemon({ player: ctx.player, pokemon: targets, min: n, max: n, title: `ダメカンをのせるポケモンを${n}匹選ぶ`, purpose: 'snipe-target', callback: put });
}

function flipCoins(game, times) {
    let heads = 0;
    for (let i = 0; i < times; i++) if (game.flipCoin()) heads++;
    return heads;
}

function flipUntilTails(game) {
    let heads = 0;
    while (game.flipCoin()) heads++;
    return heads;
}

// 山札から探すカードの条件
function searchFilter(word) {
    const quoted = word.match(/^「(.+)」$/);
    if (quoted) {
        const name = quoted[1];
        if (name === 'ポケモンex') return card => card.kind === 'pokemon' && isEx(card);
        const energy = name.match(new RegExp(`^基本${TYPE_PATTERN}エネルギー$`));
        if (energy) return card => card.kind === 'energy' && card.basic && card.energyType === TYPE_WORDS[energy[1]];
        return card => card.name === name;
    }
    const typedEnergy = word.match(new RegExp(`^基本${TYPE_PATTERN}エネルギー$`));
    if (typedEnergy) return card => card.kind === 'energy' && card.basic && card.energyType === TYPE_WORDS[typedEnergy[1]];
    const typedPokemon = word.match(new RegExp(`^${TYPE_PATTERN}ポケモン$`));
    if (typedPokemon) return card => card.kind === 'pokemon' && card.type === TYPE_WORDS[typedPokemon[1]];
    return {
        ポケモン: card => card.kind === 'pokemon',
        たねポケモン: card => card.kind === 'pokemon' && card.stage === 0,
        進化ポケモン: card => card.kind === 'pokemon' && card.stage > 0,
        基本エネルギー: card => card.kind === 'energy' && card.basic,
        エネルギー: card => card.kind === 'energy',
        グッズ: card => card.kind === 'trainer' && card.trainerType === 'item',
        サポート: card => card.kind === 'trainer' && card.trainerType === 'supporter',
        スタジアム: card => card.kind === 'trainer' && card.trainerType === 'stadium',
        ポケモンのどうぐ: card => card.kind === 'trainer' && card.trainerType === 'tool',
        トレーナーズ: card => card.kind === 'trainer',
        好きなカード: () => true
    }[word] ?? null;
}

// 「〜の数×N」の数え方
function counter(phrase) {
    const table = [
        [/^相手のバトルポケモンについているエネルギーの数$/, ctx => (ctx.defender ? energyCount(ctx.game, ctx.defender) : 0)],
        [/^このポケモンについているエネルギーの数$/, ctx => energyCount(ctx.game, ctx.attacker)],
        [new RegExp(`^このポケモンについている${TYPE_PATTERN}エネルギーの数$`), (ctx, m) => energyCount(ctx.game, ctx.attacker, TYPE_WORDS[m[1]])],
        [/^このポケモンにのっているダメカンの数$/, ctx => counters(ctx.attacker)],
        [/^相手のバトルポケモンにのっているダメカンの数$/, ctx => (ctx.defender ? counters(ctx.defender) : 0)],
        [/^相手のベンチポケモンの数$/, ctx => ctx.opponent.bench.length],
        [/^自分のベンチポケモンの数$/, ctx => ctx.player.bench.length],
        [/^おたがいのベンチポケモンの数$/, ctx => ctx.opponent.bench.length + ctx.player.bench.length],
        [/^相手のポケモン全員についているエネルギーの数$/, ctx => ctx.game.inPlay(ctx.opponent).reduce((sum, pk) => sum + pk.energies.length, 0)],
        [/^自分のポケモン全員についているエネルギーの数$/, ctx => ctx.game.inPlay(ctx.player).reduce((sum, pk) => sum + pk.energies.length, 0)],
        [new RegExp(`^自分のポケモン全員についている「基本${TYPE_PATTERN}エネルギー」の数$`), (ctx, m) => ctx.game.inPlay(ctx.player).reduce((sum, pk) => sum + energyCount(ctx.game, pk, TYPE_WORDS[m[1]]), 0)],
        [new RegExp(`^自分のポケモン全員についている${TYPE_PATTERN}エネルギーの数$`), (ctx, m) => ctx.game.inPlay(ctx.player).reduce((sum, pk) => sum + energyCount(ctx.game, pk, TYPE_WORDS[m[1]]), 0)],
        [/^相手の手札の枚数$/, ctx => ctx.opponent.hand.length],
        [/^自分の手札の枚数$/, ctx => ctx.player.hand.length],
        [/^相手がすでにとったサイドの枚数$/, ctx => ctx.game.prizesTaken(ctx.opponent)],
        [/^自分がすでにとったサイドの枚数$/, ctx => ctx.game.prizesTaken(ctx.player)],
        [/^自分のトラッシュにある「(.+)」の枚数$/, (ctx, m) => ctx.player.discard.filter(inst => ctx.game.cardName(inst) === m[1]).length],
        [/^自分の場の「(.+)」の数$/, (ctx, m) => ctx.game.inPlay(ctx.player).filter(pk => ctx.game.topCard(pk).name === m[1]).length],
        [/^相手の場の「ポケモンex」の数$/, ctx => ctx.game.inPlay(ctx.opponent).filter(pk => isEx(ctx.game.topCard(pk))).length],
        [/^相手のポケモン全員にのっているダメカンの数$/, ctx => ctx.game.inPlay(ctx.opponent).reduce((sum, pk) => sum + counters(pk), 0)],
        [/^自分のトラッシュにあるエネルギーの枚数$/, ctx => ctx.player.discard.filter(inst => ctx.game.cardOf(inst).kind === 'energy').length],
        [/^自分のトラッシュにある基本エネルギーの枚数$/, ctx => ctx.player.discard.filter(inst => { const card = ctx.game.cardOf(inst); return card.kind === 'energy' && card.basic; }).length],
        [/^自分の場のポケモンの数$/, ctx => ctx.game.inPlay(ctx.player).length],
        [/^相手の場のポケモンの数$/, ctx => ctx.game.inPlay(ctx.opponent).length],
        [/^相手のバトルポケモンのにげるためのエネルギーの数$/, ctx => (ctx.defender ? ctx.game.retreatCost(ctx.defender) : 0)],
        [/^自分のポケモン全員についている「ポケモンのどうぐ」の数$/, ctx => ctx.game.inPlay(ctx.player).filter(pk => pk.tool).length],
        [/^相手のトラッシュにある基本エネルギーの枚数$/, ctx => ctx.opponent.discard.filter(inst => { const card = ctx.game.cardOf(inst); return card.kind === 'energy' && card.basic; }).length],
        [/^相手のバトルポケモンが受けている特殊状態の数$/, ctx => (ctx.defender
            ? ['asleep', 'paralyzed', 'confused', 'poisoned', 'burned'].filter(condition => ctx.game.hasCondition(ctx.defender, condition)).length : 0)],
        [/^おたがいのバトルポケモンについているエネルギーの数$/, ctx => ctx.attacker.energies.length + (ctx.defender?.energies.length ?? 0)],
        [/^相手の場の「ポケモンex・V」の数$/, ctx => ctx.game.inPlay(ctx.opponent).filter(pk => isEx(ctx.game.topCard(pk))).length],
        [/^自分の場の([12])進化ポケモンの数$/, (ctx, m) => ctx.game.inPlay(ctx.player).filter(pk => ctx.game.topCard(pk).stage === Number(m[1])).length],
        [/^自分のベンチの([12])進化ポケモンの数$/, (ctx, m) => ctx.player.bench.filter(pk => ctx.game.topCard(pk).stage === Number(m[1])).length],
        [/^自分の場の、ワザ「(.+)」を持つポケモンの数$/, (ctx, m) => ctx.game.inPlay(ctx.player).filter(pk => ctx.game.topCard(pk).attacks.some(attack => attack.name === m[1])).length]
    ];
    for (const [re, fn] of table) {
        const m = phrase.match(re);
        if (m) return ctx => fn(ctx, m);
    }
    return null;
}

// 「〜なら」の条件
function condition(phrase) {
    const table = [
        // スタンダードに「ポケモンV」はいないので、「ポケモンex・V」は「ポケモンex」と同じ
        [/^相手のバトルポケモンが「ポケモンex(・V)?」$/, ctx => Boolean(ctx.defender) && isEx(ctx.game.topCard(ctx.defender))],
        [/^このポケモンに「ポケモンのどうぐ」がついている$/, ctx => Boolean(ctx.attacker.tool)],
        [/^このポケモンに特殊エネルギーがついている$/, ctx => ctx.attacker.energies.some(inst => !ctx.game.cardOf(inst).basic)],
        [/^このポケモンに「(.+)」がついている$/, (ctx, m) => ctx.attacker.energies.some(inst => ctx.game.cardName(inst) === m[1])
            || (ctx.attacker.tool && ctx.game.cardName(ctx.attacker.tool) === m[1])],
        [/^自分の場にエネルギーが(\d+)個以上ある$/, (ctx, m) => ctx.game.inPlay(ctx.player).reduce((sum, pk) => sum + pk.energies.length, 0) >= Number(m[1])],
        [new RegExp(`^自分のベンチに${TYPE_PATTERN}ポケモンがいる$`), (ctx, m) => ctx.player.bench.some(pk => ctx.game.topCard(pk).type === TYPE_WORDS[m[1]])],
        [/^相手のバトルポケモンが進化ポケモン$/, ctx => Boolean(ctx.defender) && ctx.game.topCard(ctx.defender).stage > 0],
        [/^相手のバトルポケモンがたねポケモン$/, ctx => Boolean(ctx.defender) && ctx.game.topCard(ctx.defender).stage === 0],
        [new RegExp(`^相手のバトルポケモンが${TYPE_PATTERN}ポケモン$`), (ctx, m) => Boolean(ctx.defender) && ctx.game.topCard(ctx.defender).type === TYPE_WORDS[m[1]]],
        [/^相手のバトルポケモンにダメカンがのっている$/, ctx => Boolean(ctx.defender) && ctx.defender.damage > 0],
        [/^相手のバトルポケモンが(どく|やけど|マヒ|ねむり|こんらん)$/, (ctx, m) => Boolean(ctx.defender) && ctx.game.hasCondition(ctx.defender, CONDITIONS[m[1]])],
        [/^相手のバトルポケモンが特殊状態$/, ctx => Boolean(ctx.defender) && ctx.game.hasAnyCondition(ctx.defender)],
        [/^相手のバトルポケモンにエネルギーがついている$/, ctx => Boolean(ctx.defender) && ctx.defender.energies.length > 0],
        [/^相手のサイドの残り枚数が(\d+)枚以下$/, (ctx, m) => ctx.opponent.prizes.length <= Number(m[1])],
        [/^自分のサイドの残り枚数が(\d+)枚以下$/, (ctx, m) => ctx.player.prizes.length <= Number(m[1])],
        [/^自分のサイドの残り枚数が、相手のサイドの残り枚数より多い$/, ctx => ctx.player.prizes.length > ctx.opponent.prizes.length],
        [/^このポケモンにダメカンがのっていない$/, ctx => ctx.attacker.damage === 0],
        [/^このポケモンにダメカンがのっている$/, ctx => ctx.attacker.damage > 0],
        [/^自分のベンチポケモンにダメカンがのっている$/, ctx => ctx.player.bench.some(pk => pk.damage > 0)],
        [/^場にスタジアムが出ている$/, ctx => Boolean(ctx.game.stadium)],
        [/^この番に、このポケモンが「(.+)」から進化していた$/, (ctx, m) => ctx.game.evolvedThisTurnFrom(ctx.attacker, m[1])],
        [/^この番に、このポケモンがベンチからバトル場に出ていた$/, ctx => ctx.attacker.movedToActiveTurn === ctx.game.turn],
        [/^前の相手の番に、ワザのダメージで、自分のポケモンがきぜつしていた$/, ctx => ctx.player.knockedOutByAttackTurn === ctx.game.turn - 1],
        [/^前の相手の番に、ワザのダメージで、自分の「(.+)」がきぜつしていた$/, (ctx, m) => ctx.player.knockedOutByAttackTurn === ctx.game.turn - 1
            && ctx.player.knockedOutByAttackNames.includes(m[1])],
        [/^このワザを使うためのエネルギーより、(\d+)個多くエネルギーがついている$/, (ctx, m) => ctx.attacker.energies.length >= ctx.attack.cost.length + Number(m[1])],
        [/^自分のベンチに「(.+)」がいる$/, (ctx, m) => ctx.player.bench.some(pk => ctx.game.topCard(pk).name === m[1])],
        [/^自分の場に「(.+)」がいる$/, (ctx, m) => ctx.game.inPlay(ctx.player).some(pk => ctx.game.topCard(pk).name === m[1])],
        [/^この番に、このポケモンのHPを回復していた$/, ctx => ctx.attacker.healedTurn === ctx.game.turn],
        [/^この番、手札からサポートを出して使っていた$/, ctx => ctx.game.turnState.supporterPlayed],
        [/^自分の手札が(\d+)枚$/, (ctx, m) => ctx.player.hand.length === Number(m[1])],
        [/^相手の手札が(\d+)枚以下$/, (ctx, m) => ctx.opponent.hand.length <= Number(m[1])],
        [/^このポケモンが(どく|やけど|マヒ|ねむり|こんらん)$/, (ctx, m) => ctx.game.hasCondition(ctx.attacker, CONDITIONS[m[1]])],
        [/^相手のバトルポケモンが([12])進化ポケモン$/, (ctx, m) => Boolean(ctx.defender) && ctx.game.topCard(ctx.defender).stage === Number(m[1])],
        [/^自分のサイドの残り枚数が(\d+)枚$/, (ctx, m) => ctx.player.prizes.length === Number(m[1])],
        [/^場に自分のスタジアムが出ている$/, ctx => Boolean(ctx.game.stadium) && ctx.game.stadium.owner === ctx.player.id],
        [/^このポケモンの残りHPが「(\d+)」以下$/, (ctx, m) => ctx.game.maxHp(ctx.attacker) - ctx.attacker.damage <= Number(m[1])],
        [/^このポケモンと相手のバトルポケモンについているエネルギーの数が同じ$/, ctx => Boolean(ctx.defender) && ctx.attacker.energies.length === ctx.defender.energies.length],
        [new RegExp(`^自分の場に${TYPE_PATTERN}エネルギーが(\\d+)個以上ある$`), (ctx, m) => ctx.game.inPlay(ctx.player)
            .reduce((sum, pk) => sum + energyCount(ctx.game, pk, TYPE_WORDS[m[1]]), 0) >= Number(m[2])],
        [/^この番、このポケモンが「(.+)」から進化していた$/, (ctx, m) => ctx.game.evolvedThisTurnFrom(ctx.attacker, m[1])]
    ];
    for (const [re, fn] of table) {
        const m = phrase.match(re);
        if (m) return ctx => fn(ctx, m);
    }
    return null;
}

// ===== 文の形 =====
// make(match, info) が手順を返す。返さなければ（null）その文は読み替えられない

const RULES = [];
const rule = (re, make) => RULES.push({ re, make });

// --- コイン ---
rule(/^コインを1回投げオモテなら、(.+)$/, m => {
    const inner = compileSentence(m[1]);
    if (!inner) return null;
    return {
        phase: inner.phase,
        run: ctx => { if (ctx.game.flipCoin()) inner.run(ctx); },
        expected: inner.expected && ((ctx, damage) => (damage + inner.expected(ctx, damage)) / 2)
    };
});
rule(/^コインを1回投げウラなら、このワザは失敗$/, () => before(
    ctx => { if (!ctx.game.flipCoin()) { ctx.failed = true; ctx.game.log('ワザは失敗した'); } },
    (ctx, damage) => damage / 2
));
rule(/^コインを(\d+)回投げ、オモテの数×(\d+)ダメージ(追加)?$/, m => {
    const times = Number(m[1]);
    const each = Number(m[2]);
    const add = Boolean(m[3]);
    return before(
        ctx => { const heads = flipCoins(ctx.game, times); ctx.damage = (add ? ctx.damage : 0) + heads * each; },
        (ctx, damage) => (add ? damage : 0) + times * each / 2
    );
});
rule(/^ウラが出るまでコインを投げ、オモテの数×(\d+)ダメージ(追加)?$/, m => {
    const each = Number(m[1]);
    const add = Boolean(m[2]);
    return before(
        ctx => { const heads = flipUntilTails(ctx.game); ctx.damage = (add ? ctx.damage : 0) + heads * each; },
        (ctx, damage) => (add ? damage : 0) + each
    );
});
rule(/^このポケモンについているエネルギーの数ぶんコインを投げ、オモテの数×(\d+)ダメージ(追加)?$/, m => {
    const each = Number(m[1]);
    const add = Boolean(m[2]);
    return before(
        ctx => { const heads = flipCoins(ctx.game, ctx.attacker.energies.length); ctx.damage = (add ? ctx.damage : 0) + heads * each; },
        (ctx, damage) => (add ? damage : 0) + ctx.attacker.energies.length * each / 2
    );
});
rule(/^コインを(\d+)回投げ、オモテの数ぶん、相手のバトルポケモンについているエネルギーを選び、トラッシュする$/, m => after(ctx => {
    const heads = flipCoins(ctx.game, Number(m[1]));
    if (canAffect(ctx, ctx.defender)) discardEnergies(ctx, ctx.defender, heads);
}));

rule(/^コインを1回投げウラなら、(.+)$/, m => {
    const inner = compileSentence(m[1]);
    if (!inner || inner.expected) return null;
    return { phase: inner.phase, run: ctx => { if (!ctx.game.flipCoin()) inner.run(ctx); } };
});

// --- ワザの使い方 ---
rule(/^このワザは、先攻プレイヤーの最初の番でも使える$/, () => ({ phase: 'flag', flag: 'firstTurnOk' }));

// --- ダメージの増減 ---
rule(/^(\d+)ダメージ追加$/, m => {
    const amount = Number(m[1]);
    return before(ctx => { ctx.damage += amount; }, (ctx, damage) => damage + amount);
});
rule(/^(.+?)の(数|枚数)×(\d+)ダメージ(追加)?$/, m => {
    const count = counter(`${m[1]}の${m[2]}`);
    if (!count) return null;
    const each = Number(m[3]);
    const add = Boolean(m[4]);
    const value = (ctx, damage) => (add ? damage : 0) + count(ctx) * each;
    return before(ctx => { ctx.damage = value(ctx, ctx.damage); }, value);
});
rule(/^(.+?)の(数|枚数)×(\d+)ダメージぶん、このワザのダメージは小さくなる$/, m => {
    const count = counter(`${m[1]}の${m[2]}`);
    if (!count) return null;
    const each = Number(m[3]);
    const value = (ctx, damage) => Math.max(0, damage - count(ctx) * each);
    return before(ctx => { ctx.damage = value(ctx, ctx.damage); }, value);
});
rule(/^(.+)なら、(\d+)ダメージ追加$/, m => {
    const test = condition(m[1]);
    if (!test) return null;
    const amount = Number(m[2]);
    const value = (ctx, damage) => damage + (test(ctx) ? amount : 0);
    return before(ctx => { ctx.damage = value(ctx, ctx.damage); }, value);
});
rule(/^(.+)なら、このワザは失敗$/, m => {
    const test = condition(m[1]);
    if (!test) return null;
    return before(ctx => { if (test(ctx)) { ctx.failed = true; ctx.game.log('ワザは失敗した'); } }, (ctx, damage) => (test(ctx) ? 0 : damage));
});
rule(/^(.+)ないなら、このワザは失敗$/, () => null);
rule(/^場にスタジアムが出ていないなら、このワザは失敗$/, () => before(
    ctx => { if (!ctx.game.stadium) { ctx.failed = true; ctx.game.log('ワザは失敗した'); } },
    (ctx, damage) => (ctx.game.stadium ? damage : 0)
));
rule(/^このワザのダメージは、相手のバトルポケモンにかかっている効果を計算しない$/, () => before(ctx => { ctx.ignoreEffects = true; }));
rule(/^このワザのダメージは抵抗力を計算しない$/, () => before(ctx => { ctx.ignoreResistance = true; }));
rule(/^このワザのダメージは弱点を計算しない$/, () => before(ctx => { ctx.ignoreWeakness = true; }));
rule(/^このワザのダメージは弱点・抵抗力を計算しない$/, () => before(ctx => { ctx.ignoreWeakness = true; ctx.ignoreResistance = true; }));
rule(/^このワザのダメージは、弱点・抵抗力と、相手のバトルポケモンにかかっている効果を計算しない$/, () => before(ctx => {
    ctx.ignoreWeakness = true;
    ctx.ignoreResistance = true;
    ctx.ignoreEffects = true;
}));

// --- 自分へ ---
rule(/^このポケモンにも(\d+)ダメージ$/, m => after(ctx => ctx.game.putDamage(ctx.attacker, Number(m[1]))));
rule(/^このポケモンのHPを「(\d+)」回復する$/, m => after(ctx => ctx.game.heal(ctx.attacker, Number(m[1]))));
rule(/^自分のポケモン全員のHPを、それぞれ「(\d+)」回復する$/, m => after(ctx => ctx.game.inPlay(ctx.player).forEach(pk => ctx.game.heal(pk, Number(m[1])))));
rule(/^自分のベンチポケモン全員のHPを、それぞれ「(\d+)」回復する$/, m => after(ctx => ctx.player.bench.forEach(pk => ctx.game.heal(pk, Number(m[1])))));
rule(/^自分のポケモン(\d+)匹のHPを「(\d+)」回復する$/, m => after(ctx => {
    const { game, player } = ctx;
    const damaged = game.inPlay(player).filter(pk => pk.damage > 0);
    const n = Math.min(Number(m[1]), damaged.length);
    if (n === 0) return;
    game.promptPokemon({
        player,
        pokemon: damaged,
        min: n,
        max: n,
        title: '回復するポケモンを選ぶ',
        purpose: 'potion',
        callback: selected => selected.forEach(pk => game.heal(pk, Number(m[2])))
    });
}));
rule(/^相手のバトルポケモンに与えたダメージぶん、このポケモンのHPを回復する$/, () => after(ctx => { if (ctx.dealt > 0) ctx.game.heal(ctx.attacker, ctx.dealt); }));
rule(/^このポケモンについているエネルギーを(\d+)個選び、トラッシュする$/, m => after(ctx => discardEnergies(ctx, ctx.attacker, Number(m[1]))));
rule(new RegExp(`^このポケモンについている${TYPE_PATTERN}エネルギーを(\\d+)個(選び、)?トラッシュする$`), m => after(ctx => discardEnergies(ctx, ctx.attacker, Number(m[2]), { type: TYPE_WORDS[m[1]] })));
rule(/^このポケモンについているエネルギーを、すべてトラッシュする$/, () => after(ctx => discardEnergies(ctx, ctx.attacker, Infinity)));
rule(/^このポケモンについているエネルギーを(\d+)個選び、手札にもどす$/, m => after(ctx => discardEnergies(ctx, ctx.attacker, Number(m[1]), { to: 'hand' })));
rule(/^このポケモンについているエネルギーを(\d+)個選び、ベンチポケモンにつけ替える$/, m => after(ctx => {
    const { game, player, attacker } = ctx;
    if (player.bench.length === 0) return;
    const steps = Array.from({ length: Math.min(Number(m[1]), attacker.energies.length) }, () => () => {
        if (attacker.energies.length === 0) return;
        game.promptPokemon({
            player,
            pokemon: player.bench,
            min: 1,
            max: 1,
            title: 'エネルギーをつけ替えるベンチポケモンを選ぶ',
            purpose: 'energy-switch-target',
            callback: ([target]) => game.moveEnergy(attacker, target, attacker.energies[0])
        });
    });
    game.runNext(...steps);
}));
rule(/^このポケモンをベンチポケモンと入れ替える$/, () => after(ctx => ctx.game.promptSwitchOwnActive(ctx.player, 'switch')));
rule(/^のぞむなら、このポケモンをベンチポケモンと入れ替える$/, () => after(ctx => ctx.game.promptSwitchOwnActive(ctx.player, 'switch', { optional: true })));
rule(/^このポケモンを(こんらん|ねむり|マヒ|どく|やけど)にする$/, m => after(ctx => ctx.game.addCondition(ctx.attacker, CONDITIONS[m[1]])));
rule(/^このポケモンと、ついているすべてのカードを、手札にもどす$/, () => after(ctx => ctx.game.returnToHand(ctx.player, ctx.attacker)));
rule(/^このポケモンから進化するカードを、自分の山札から(\d+)枚選び、このポケモンにのせて進化させる$/, () => after(ctx => {
    const { game, player, attacker } = ctx;
    if (!game.inPlay(player).includes(attacker)) return;
    const name = game.topCard(attacker).name;
    game.searchDeck({
        player,
        filter: card => card.kind === 'pokemon' && card.evolvesFrom === name,
        max: 1,
        title: '進化させるカードを選ぶ',
        purpose: 'search-evolution',
        onSelected: ([inst]) => { if (inst) game.evolveFromOutside(player, attacker, inst); }
    });
}));

// --- 次の番まで残る効果 ---
rule(/^次の自分の番、このポケモンはワザが使えない$/, () => after(ctx => ctx.game.addEffect(ctx.attacker, 'cannotAttack', ctx.game.turn + 2)));
rule(/^次の自分の番、このポケモンは「(.+)」が使えない$/, m => after(ctx => ctx.game.addEffect(ctx.attacker, 'cannotUseAttack', ctx.game.turn + 2, { attack: m[1] })));
rule(/^次の自分の番、このポケモンが使うワザの、相手のバトルポケモンへのダメージは「\+(\d+)」される$/, m => after(ctx =>
    ctx.game.addEffect(ctx.attacker, 'attackDamageModifier', ctx.game.turn + 2, { amount: Number(m[1]) })));
rule(/^次の自分の番、このポケモンの「(.+)」のダメージは「\+(\d+)」される$/, m => after(ctx =>
    ctx.game.addEffect(ctx.attacker, 'attackDamageModifier', ctx.game.turn + 2, { amount: Number(m[2]), attack: m[1] })));
rule(/^次の相手の番、このワザを受けたポケモンは、にげられない$/, () => after(ctx => {
    if (canAffect(ctx, ctx.defender)) ctx.game.addEffect(ctx.defender, 'cannotRetreat', ctx.game.turn + 1);
}));
rule(/^次の相手の番、このワザを受けたポケモンは、ワザが使えない$/, () => after(ctx => {
    if (canAffect(ctx, ctx.defender)) ctx.game.addEffect(ctx.defender, 'cannotAttack', ctx.game.turn + 1);
}));
rule(/^次の相手の番、このワザを受けたポケモンが使うワザのダメージは「-(\d+)」される$/, m => after(ctx => {
    if (canAffect(ctx, ctx.defender)) ctx.game.addEffect(ctx.defender, 'attackDamageModifier', ctx.game.turn + 1, { amount: -Number(m[1]) });
}));
rule(/^次の相手の番、このポケモンが受けるワザのダメージは「-(\d+)」される$/, m => after(ctx =>
    ctx.game.addEffect(ctx.attacker, 'damageReduction', ctx.game.turn + 1, { amount: Number(m[1]) })));
rule(/^次の相手の番、このポケモンはワザのダメージや効果を受けない$/, () => after(ctx => ctx.game.addEffect(ctx.attacker, 'preventAll', ctx.game.turn + 1)));
rule(/^次の相手の番、このポケモンはワザのダメージを受けない$/, () => after(ctx => ctx.game.addEffect(ctx.attacker, 'preventDamage', ctx.game.turn + 1)));
rule(/^次の相手の番、このポケモンはたねポケモンからワザのダメージを受けない$/, () => after(ctx =>
    ctx.game.addEffect(ctx.attacker, 'preventDamageFromBasic', ctx.game.turn + 1)));
rule(/^次の相手の番、このポケモンは「ポケモンex」からワザのダメージを受けない$/, () => after(ctx =>
    ctx.game.addEffect(ctx.attacker, 'preventDamageFromEx', ctx.game.turn + 1)));
rule(/^次の相手の番、このワザを受けたポケモンがワザを使うとき、相手はコインを1回投げる$/, () => after(ctx => {
    if (canAffect(ctx, ctx.defender)) ctx.game.addEffect(ctx.defender, 'attackCoinFlip', ctx.game.turn + 1);
}));
// 前の文（コインを1回投げる）の続き。失敗の判定は game.js の attack で行う
rule(/^ウラならそのワザは失敗$/, noop);
rule(/^次の相手の番、このワザを受けたポケモンは、手札から出すエネルギーをつけられない$/, () => after(ctx => {
    if (canAffect(ctx, ctx.defender)) ctx.game.addEffect(ctx.defender, 'cannotAttachFromHand', ctx.game.turn + 1);
}));
rule(/^次の自分の番、このワザを受けたポケモンが受けるワザのダメージは「\+(\d+)」される$/, m => after(ctx => {
    if (canAffect(ctx, ctx.defender)) ctx.game.addEffect(ctx.defender, 'damageIncrease', ctx.game.turn + 2, { amount: Number(m[1]) });
}));
rule(/^次の相手の番、このポケモンがワザのダメージを受けたとき、ワザを使ったポケモンにダメカンを(\d+)個のせる$/, m => after(ctx =>
    ctx.game.addEffect(ctx.attacker, 'counterOnDamaged', ctx.game.turn + 1, { amount: Number(m[1]) * 10 })));
rule(/^次の相手の番、相手は手札からグッズを出して使えない$/, () => after(ctx => ctx.game.addPlayerEffect(ctx.opponent, 'itemLock', ctx.game.turn + 1)));
rule(/^次の相手の番、相手は手札からサポートを出して使えない$/, () => after(ctx => ctx.game.addPlayerEffect(ctx.opponent, 'supporterLock', ctx.game.turn + 1)));

// --- 相手へ ---
rule(/^相手のバトルポケモンを(.+)にする$/, m => {
    const names = m[1].split('と');
    if (!names.every(name => CONDITIONS[name])) return null;
    return after(ctx => {
        if (!canAffect(ctx, ctx.defender)) return;
        names.forEach(name => ctx.game.addCondition(ctx.defender, CONDITIONS[name]));
    });
});
rule(/^このどくでのせるダメカンの数は(\d+)個になる$/, m => after(ctx => {
    if (ctx.defender && ctx.defender.poisoned) ctx.defender.poisonDamage = Number(m[1]) * 10;
}));
rule(/^相手のバトルポケモンについているエネルギーを(\d+)個選び、トラッシュする$/, m => after(ctx => {
    if (canAffect(ctx, ctx.defender)) discardEnergies(ctx, ctx.defender, Number(m[1]));
}));
rule(/^相手のバトルポケモンについている特殊エネルギーを(\d+)個選び、トラッシュする$/, m => after(ctx => {
    if (!canAffect(ctx, ctx.defender)) return;
    const special = ctx.defender.energies.filter(inst => !ctx.game.cardOf(inst).basic);
    if (special.length === 0) return;
    ctx.game.promptCards({
        player: ctx.player,
        cards: special,
        min: Math.min(Number(m[1]), special.length),
        max: Math.min(Number(m[1]), special.length),
        title: 'トラッシュする特殊エネルギーを選ぶ',
        purpose: 'discard-opponent-energy',
        callback: selected => selected.forEach(inst => ctx.game.moveCard(ctx.defender.energies, ctx.opponent.discard, inst))
    });
}));
rule(/^相手の山札を上から(\d+)枚トラッシュする$/, m => after(ctx => ctx.game.millDeck(ctx.opponent, Number(m[1]))));
rule(/^相手のベンチポケモン(\d+)匹にも、(\d+)ダメージ$/, m => after(ctx => damageChosen(ctx, ctx.opponent.bench, Number(m[1]), Number(m[2]))));
rule(/^相手のベンチポケモン(\d+)匹に、(\d+)ダメージ$/, m => after(ctx => damageChosen(ctx, ctx.opponent.bench, Number(m[1]), Number(m[2]))));
rule(/^相手のベンチポケモン全員にも、それぞれ(\d+)ダメージ$/, m => after(ctx => ctx.opponent.bench.forEach(pk => ctx.game.dealAttackDamage(ctx, pk, Number(m[1])))));
rule(/^相手のポケモン(\d+)匹に、(それぞれ)?(\d+)ダメージ$/, m => after(ctx => damageChosen(ctx, ctx.game.inPlay(ctx.opponent), Number(m[1]), Number(m[3]))));
rule(/^相手のポケモン全員に、それぞれ(\d+)ダメージ$/, m => after(ctx => ctx.game.inPlay(ctx.opponent).forEach(pk => ctx.game.dealAttackDamage(ctx, pk, Number(m[1])))));
rule(/^自分のベンチポケモン全員にも、それぞれ(\d+)ダメージ$/, m => after(ctx => ctx.player.bench.forEach(pk => ctx.game.putDamage(pk, Number(m[1])))));
rule(/^自分のベンチポケモン(\d+)匹にも、(\d+)ダメージ$/, m => after(ctx => {
    const { game, player } = ctx;
    const n = Math.min(Number(m[1]), player.bench.length);
    if (n === 0) return;
    game.promptPokemon({
        player,
        pokemon: player.bench,
        min: n,
        max: n,
        title: `${m[2]}ダメージを受ける自分のベンチポケモンを選ぶ`,
        purpose: 'self-damage-target',
        callback: selected => selected.forEach(pk => game.putDamage(pk, Number(m[2])))
    });
}));
rule(/^相手のバトルポケモンに、ダメカンを(\d+)個のせる$/, m => after(ctx => { if (canAffect(ctx, ctx.defender)) ctx.game.putDamage(ctx.defender, Number(m[1]) * 10); }));
rule(/^相手のポケモン(\d+)匹に、ダメカンを(\d+)個のせる$/, m => after(ctx => putCountersChosen(ctx, ctx.game.inPlay(ctx.opponent), Number(m[1]), Number(m[2]) * 10)));
rule(/^相手のバトルポケモンをベンチポケモンと入れ替える$/, () => after(ctx => {
    const { game, opponent } = ctx;
    if (opponent.bench.length === 0 || !opponent.active) return;
    game.promptPokemon({
        player: opponent,
        pokemon: opponent.bench,
        min: 1,
        max: 1,
        title: 'バトル場に出すポケモンを選ぶ',
        purpose: 'forced-switch',
        callback: ([target]) => game.switchActive(opponent, target)
    });
}));
rule(/^相手のベンチポケモンを1匹選び、バトルポケモンと入れ替える$/, () => after(ctx => {
    const { game, player, opponent } = ctx;
    if (opponent.bench.length === 0) return;
    game.promptPokemon({
        player,
        pokemon: opponent.bench,
        min: 1,
        max: 1,
        title: 'バトル場に呼び出す相手のポケモンを選ぶ',
        purpose: 'boss-target',
        callback: ([target]) => game.switchActive(opponent, target)
    });
}));
rule(/^新しく出てきたポケモンに(\d+)ダメージ$/, m => after(ctx => { if (ctx.opponent.active) ctx.game.dealAttackDamage(ctx, ctx.opponent.active, Number(m[1])); }));
rule(/^相手の手札からオモテを見ないで(\d+)枚選び、トラッシュする$/, m => after(ctx => ctx.game.discardRandomFromHand(ctx.opponent, Number(m[1]))));
rule(/^相手は相手自身の手札を(\d+)枚選び、トラッシュする$/, m => after(ctx => {
    const { game, opponent } = ctx;
    const n = Math.min(Number(m[1]), opponent.hand.length);
    if (n === 0) return;
    game.promptCards({
        player: opponent,
        cards: opponent.hand,
        min: n,
        max: n,
        title: `トラッシュする手札を${n}枚選ぶ`,
        purpose: 'discard-hand',
        callback: selected => {
            selected.forEach(inst => game.moveCard(opponent.hand, opponent.discard, inst));
            game.log(`${opponent.name}は${selected.map(inst => game.cardName(inst)).join('と')}をトラッシュした`);
        }
    });
}));
rule(/^相手の手札を見る$/, () => after(ctx => ctx.game.revealHand(ctx.opponent, ctx.player)));
rule(/^相手の手札を見て、その中からカードを(\d+)枚選び、トラッシュする$/, m => after(ctx => {
    const { game, player, opponent } = ctx;
    const n = Math.min(Number(m[1]), opponent.hand.length);
    if (n === 0) return;
    game.promptCards({
        player,
        cards: opponent.hand,
        min: n,
        max: n,
        title: `相手の手札からトラッシュするカードを${n}枚選ぶ`,
        purpose: 'discard-opponent-hand',
        callback: selected => {
            selected.forEach(inst => game.moveCard(opponent.hand, opponent.discard, inst));
            game.log(`${opponent.name}の手札の${selected.map(inst => game.cardName(inst)).join('と')}がトラッシュされた`);
        }
    });
}));
rule(/^ダメージを与える前に、相手のバトルポケモンについている「ポケモンのどうぐ」をトラッシュする$/, () => before(ctx => {
    if (ctx.defender?.tool && canAffect(ctx, ctx.defender)) ctx.game.discardTool(ctx.defender);
}));
rule(/^相手のバトルポケモンの残りHPが「(\d+)」になるように、ダメカンをのせる$/, m => after(ctx => {
    const { game, defender } = ctx;
    if (!canAffect(ctx, defender)) return;
    const extra = game.maxHp(defender) - defender.damage - Number(m[1]);
    if (extra > 0) game.putDamage(defender, extra);
}));
rule(/^ダメカン(\d+)個を、相手のベンチポケモンに好きなようにのせる$/, m => after(ctx => {
    const { game, player, opponent } = ctx;
    const steps = Array.from({ length: Number(m[1]) }, () => () => {
        if (opponent.bench.length === 0) return;
        game.promptPokemon({
            player,
            pokemon: opponent.bench,
            min: 1,
            max: 1,
            title: 'ダメカンを1個のせるポケモンを選ぶ',
            purpose: 'snipe-target',
            callback: ([target]) => game.putDamage(target, 10)
        });
    });
    game.runNext(...steps);
}));
rule(/^おたがいのベンチポケモン全員にも、それぞれ(\d+)ダメージ$/, m => after(ctx => {
    ctx.opponent.bench.forEach(pk => ctx.game.dealAttackDamage(ctx, pk, Number(m[1])));
    ctx.player.bench.forEach(pk => ctx.game.putDamage(pk, Number(m[1])));
}));
rule(/^相手のポケモン(\d+)匹に、このポケモンについているエネルギーの数×(\d+)ダメージ$/, m => after(ctx =>
    damageChosen(ctx, ctx.game.inPlay(ctx.opponent), Number(m[1]), ctx.attacker.energies.length * Number(m[2])))
);
rule(/^このワザのダメージで、相手のポケモンがきぜつしたなら、(.+)$/, m => {
    const inner = compileSentence(m[1]);
    if (!inner || inner.phase !== 'after') return null;
    return after(ctx => {
        const knocked = ctx.game.inPlay(ctx.opponent).some(pk => pk.damage >= ctx.game.maxHp(pk));
        if (knocked) inner.run(ctx);
    });
});
rule(/^のぞむなら、場に出ているスタジアムをトラッシュする$/, () => after(ctx => {
    if (!ctx.game.stadium) return;
    ctx.game.promptConfirm({ player: ctx.player, title: '場に出ているスタジアムをトラッシュしますか？', purpose: 'discard-stadium', callback: yes => { if (yes) ctx.game.discardStadium(); } });
}));

// --- 山札・手札 ---
rule(/^(自分の)?山札を(\d+)枚引く$/, m => after(ctx => ctx.game.draw(ctx.player, Number(m[2]))));
rule(/^のぞむなら、自分の手札が(\d+)枚になるように、山札を引く$/, m => after(ctx => {
    const count = Number(m[1]) - ctx.player.hand.length;
    if (count > 0) ctx.game.draw(ctx.player, count);
}));
rule(/^自分の手札をすべて山札にもどして切る$/, () => after(ctx => ctx.game.shuffleHandIntoDeck(ctx.player)));
rule(/^自分の手札をすべてトラッシュし、山札を(\d+)枚引く$/, m => after(ctx => {
    ctx.game.discardHand(ctx.player);
    ctx.game.draw(ctx.player, Number(m[1]));
}));
rule(/^自分の山札を上から(\d+)枚トラッシュする$/, m => after(ctx => ctx.game.millDeck(ctx.player, Number(m[1]))));
rule(/^そして山札を切る$/, noop);
rule(/^自分の山札から(.+?)を(\d+)枚(まで)?選び、ベンチに出す$/, m => {
    const filter = searchFilter(m[1]);
    if (!filter) return null;
    return after(ctx => ctx.game.benchFromDeck(ctx.player, card => card.kind === 'pokemon' && card.stage === 0 && filter(card), Number(m[2]), 'bench-basic'));
});
rule(/^(のぞむなら、)?自分の山札から(.+?)を(\d+)枚(まで)?選び、(相手に見せて、)?手札に加える$/, m => {
    const filter = searchFilter(m[2]);
    if (!filter) return null;
    const max = Number(m[3]);
    return after(ctx => ctx.game.searchDeck({
        player: ctx.player,
        filter,
        max,
        title: `手札に加える${m[2]}を選ぶ`,
        purpose: m[2].includes('エネルギー') ? 'search-energy' : (m[2].includes('ポケモン') ? 'search-pokemon' : 'search-card'),
        onSelected: found => ctx.game.addToHand(ctx.player, found, { reveal: Boolean(m[5]) })
    }));
});
rule(/^自分の山札から(.+?)を(\d+)枚(まで)?選び、(このポケモン|自分のポケモン|ベンチポケモン)に(好きなように)?つける$/, m => {
    const filter = searchFilter(m[1]);
    if (!filter) return null;
    const max = Number(m[2]);
    const where = m[4];
    return after(ctx => {
        const { game, player, attacker } = ctx;
        game.searchDeck({
            player,
            filter: card => card.kind === 'energy' && filter(card),
            max,
            title: 'つけるエネルギーを選ぶ',
            purpose: 'search-energy',
            onSelected: found => {
                if (where === 'このポケモン') {
                    found.forEach(inst => game.attachFromOutside(attacker, inst));
                    return;
                }
                game.attachAnyWay(player, found, pk => where !== 'ベンチポケモン' || pk !== player.active, 'attach-energy-target');
            }
        });
    });
});
rule(/^自分のトラッシュから(.+?)を(\d+)枚(まで)?選び、(このポケモン|自分のポケモン|ベンチポケモン)に(好きなように)?つける$/, m => {
    const filter = searchFilter(m[1]);
    if (!filter) return null;
    const max = Number(m[2]);
    const where = m[4];
    return after(ctx => {
        const { game, player, attacker } = ctx;
        const candidates = player.discard.filter(inst => { const card = game.cardOf(inst); return card.kind === 'energy' && filter(card); });
        const n = Math.min(max, candidates.length);
        if (n === 0) return;
        game.promptCards({
            player,
            cards: candidates,
            min: m[3] ? 0 : n,
            max: n,
            title: 'トラッシュからつけるエネルギーを選ぶ',
            purpose: 'energy-retrieval',
            callback: selected => {
                selected.forEach(inst => game.removeCard(player.discard, inst));
                if (where === 'このポケモン') selected.forEach(inst => game.attachFromOutside(attacker, inst));
                else game.attachAnyWay(player, selected, pk => where !== 'ベンチポケモン' || pk !== player.active, 'attach-energy-target');
            }
        });
    });
});
rule(/^場に出ているスタジアムをトラッシュする$/, () => after(ctx => ctx.game.discardStadium()));
rule(/^そのスタジアムをトラッシュする$/, () => after(ctx => ctx.game.discardStadium()));

// --- 使える番の制限 ---
rule(/^このワザは、先行プレイヤーの最初の番でも使える$/, () => ({ phase: 'flag', flag: 'firstTurnOk' }));
rule(/^このワザは、後攻プレイヤーの最初の番には使えない$/, () => ({ phase: 'flag', flag: 'canUse', value: game => game.turn !== 2 }));
rule(/^このワザは、後攻プレイヤーの最初の番にだけ使える$/, () => ({ phase: 'flag', flag: 'canUse', value: game => game.turn === 2 }));

// --- 失敗の条件（〜でないなら・〜いないなら）---
rule(/^(.+)でないなら、このワザは失敗$/, m => {
    const test = condition(m[1]);
    if (!test) return null;
    return before(ctx => { if (!test(ctx)) { ctx.failed = true; ctx.game.log('ワザは失敗した'); } }, (ctx, damage) => (test(ctx) ? damage : 0));
});
rule(/^(.+)がいないなら、このワザは失敗$/, m => {
    const test = condition(`${m[1]}がいる`);
    if (!test) return null;
    return before(ctx => { if (!test(ctx)) { ctx.failed = true; ctx.game.log('ワザは失敗した'); } }, (ctx, damage) => (test(ctx) ? damage : 0));
});

// --- ダメージ ---
rule(/^このポケモンに(\d+)ダメージ$/, m => after(ctx => ctx.game.putDamage(ctx.attacker, Number(m[1]))));
rule(/^相手のベンチポケモン全員に、それぞれ(\d+)ダメージ$/, m => after(ctx => ctx.opponent.bench.forEach(pk => ctx.game.dealAttackDamage(ctx, pk, Number(m[1])))));
rule(/^相手のベンチポケモン(\d+)匹にも、それぞれ(\d+)ダメージ$/, m => after(ctx => damageChosen(ctx, ctx.opponent.bench, Number(m[1]), Number(m[2]))));
rule(/^相手の「ポケモンex(・V)?」全員に、それぞれ(\d+)ダメージ$/, m => after(ctx =>
    ctx.game.inPlay(ctx.opponent).filter(pk => isEx(ctx.game.topCard(pk))).forEach(pk => ctx.game.dealAttackDamage(ctx, pk, Number(m[2])))));
rule(/^相手のバトルポケモンにダメカンがのっているなら、このワザのダメージは「(\d+)」になる$/, m => {
    const value = (ctx, damage) => (ctx.defender?.damage > 0 ? Number(m[1]) : damage);
    return before(ctx => { ctx.damage = value(ctx, ctx.damage); }, value);
});
rule(/^ダメカン(\d+)個を、相手のポケモンに好きなようにのせる$/, m => after(ctx => {
    const { game, player, opponent } = ctx;
    const steps = Array.from({ length: Number(m[1]) }, () => () => {
        const targets = game.inPlay(opponent);
        if (targets.length === 0) return;
        game.promptPokemon({ player, pokemon: targets, min: 1, max: 1, title: 'ダメカンを1個のせるポケモンを選ぶ', purpose: 'snipe-target', callback: ([target]) => game.putDamage(target, 10) });
    });
    game.runNext(...steps);
}));
rule(/^相手のバトルポケモンをきぜつさせる$/, () => after(ctx => {
    const { game, defender } = ctx;
    if (!canAffect(ctx, defender)) return;
    const rest = game.maxHp(defender) - defender.damage;
    if (rest > 0) game.putDamage(defender, rest);
}));
rule(/^このポケモンについているエネルギーを(\d+)個トラッシュし、(.+)$/, m => {
    const inner = compileSentence(m[2]);
    if (!inner || inner.phase !== 'after') return null;
    return after(ctx => {
        discardEnergies(ctx, ctx.attacker, Number(m[1]));
        ctx.game.runNext(() => inner.run(ctx));
    });
});
rule(/^このポケモンについているエネルギーをすべてトラッシュし、(.+)$/, m => {
    const inner = compileSentence(m[1]);
    if (!inner || inner.phase !== 'after') return null;
    return after(ctx => {
        discardEnergies(ctx, ctx.attacker, Infinity);
        ctx.game.runNext(() => inner.run(ctx));
    });
});
rule(/^のぞむなら、(\d+)ダメージ追加し、このポケモンにも(\d+)ダメージ$/, m => {
    const bonus = Number(m[1]);
    const recoil = Number(m[2]);
    return before(ctx => {
        const { game, player, attacker } = ctx;
        game.promptConfirm({
            player,
            title: `${bonus}ダメージ追加しますか？（このポケモンにも${recoil}ダメージ）`,
            purpose: 'optional-bonus',
            cpuAnswer: g => g.maxHp(attacker) - attacker.damage > recoil,
            callback: yes => {
                if (!yes) return;
                ctx.damage += bonus;
                game.putDamage(attacker, recoil);
            }
        });
    }, (ctx, damage) => damage + bonus);
});

// --- 残る効果 ---
rule(/^次の相手の番、このポケモンの弱点は、すべてなくなる$/, () => after(ctx => ctx.game.addEffect(ctx.attacker, 'noWeakness', ctx.game.turn + 1)));
rule(/^次の相手の番、このポケモンは「(\d+)」以下のワザのダメージを受けない$/, m => after(ctx =>
    ctx.game.addEffect(ctx.attacker, 'preventDamageUpTo', ctx.game.turn + 1, { amount: Number(m[1]) })));
rule(/^次の自分の番、このポケモンはにげられない$/, () => after(ctx => ctx.game.addEffect(ctx.attacker, 'cannotRetreat', ctx.game.turn + 2)));
rule(/^相手のバトルポケモンが持つワザを1つ選び、次の相手の番、このワザを受けたポケモンは、そのワザが使えない$/, () => after(ctx => {
    const { game, player, defender } = ctx;
    if (!canAffect(ctx, defender)) return;
    const attacks = game.topCard(defender).attacks;
    if (attacks.length === 0) return;
    game.promptChoose({
        player,
        options: attacks.map(attack => attack.name),
        title: '次の番に使えなくするワザを選ぶ',
        purpose: 'disable-attack',
        cpuAnswer: () => [attacks.reduce((best, attack, index) => (attack.damage > attacks[best].damage ? index : best), 0)],
        callback: ([index]) => game.addEffect(defender, 'cannotUseAttack', game.turn + 1, { attack: attacks[index].name })
    });
}));

// --- 山札・手札・トラッシュ ---
rule(/^ウラが出るまでコインを投げ、オモテの数ぶん、相手の山札を上からトラッシュする$/, () => after(ctx => ctx.game.millDeck(ctx.opponent, flipUntilTails(ctx.game))));
rule(/^コインを(\d+)回投げ、オモテの数ぶん、相手の山札を上からトラッシュする$/, m => after(ctx => ctx.game.millDeck(ctx.opponent, flipCoins(ctx.game, Number(m[1])))));
rule(/^相手は相手自身の手札を(\d+)枚選び、山札にもどして切る$/, m => after(ctx => {
    const { game, opponent } = ctx;
    const n = Math.min(Number(m[1]), opponent.hand.length);
    if (n === 0) return;
    game.promptCards({
        player: opponent,
        cards: opponent.hand,
        min: n,
        max: n,
        title: `山札にもどす手札を${n}枚選ぶ`,
        purpose: 'discard-hand',
        callback: selected => {
            selected.forEach(inst => game.moveCard(opponent.hand, opponent.deck, inst));
            game.shuffleDeck(opponent);
            game.log(`${opponent.name}は手札を${n}枚山札にもどして切った`);
        }
    });
}));
rule(/^自分の手札を(\d+)枚トラッシュする$/, m => after(ctx => {
    const { game, player } = ctx;
    const n = Math.min(Number(m[1]), player.hand.length);
    if (n === 0) return;
    game.promptCards({
        player,
        cards: player.hand,
        min: n,
        max: n,
        title: `トラッシュする手札を${n}枚選ぶ`,
        purpose: 'ultra-ball-discard',
        callback: selected => {
            selected.forEach(inst => game.moveCard(player.hand, player.discard, inst));
            game.log(`${player.name}は${selected.map(inst => game.cardName(inst)).join('と')}をトラッシュした`);
        }
    });
}));
rule(/^自分のトラッシュから(.+?)を(\d+)枚(まで)?選び、(相手に見せて、)?手札に加える$/, m => {
    const filter = searchFilter(m[1]);
    if (!filter) return null;
    return after(ctx => {
        const { game, player } = ctx;
        const candidates = player.discard.filter(inst => filter(game.cardOf(inst)));
        const n = Math.min(Number(m[2]), candidates.length);
        if (n === 0) return;
        game.promptCards({
            player,
            cards: candidates,
            min: m[3] ? 0 : n,
            max: n,
            title: `トラッシュから手札に加える${m[1]}を選ぶ`,
            purpose: 'search-card',
            callback: selected => {
                selected.forEach(inst => game.moveCard(player.discard, player.hand, inst));
                if (selected.length) game.log(`${player.name}は${selected.map(inst => game.cardName(inst)).join('と')}をトラッシュから手札に加えた`);
            }
        });
    });
});
rule(/^自分の山札を上から(\d+)枚見て、もとにもどす$/, m => after(ctx => {
    const cards = ctx.player.deck.slice(0, Number(m[1]));
    ctx.game.log(`${ctx.player.name}は山札を上から${cards.length}枚見た`);
    ctx.game.log(`山札の上：${cards.map(inst => ctx.game.cardName(inst)).join('・')}`, { to: ctx.player.id });
}));
// ポケモンと、ついているすべてのカードを、持ち主の山札にもどして切る
function shuffleIntoDeck(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    if (!owner) return;
    if (owner.active === pokemon) owner.active = null;
    else game.removeCard(owner.bench, pokemon);
    owner.deck.push(...pokemon.cards, ...pokemon.energies, ...(pokemon.tool ? [pokemon.tool] : []));
    game.shuffleDeck(owner);
    game.log(`${owner.name}の${game.topCard(pokemon).name}と、ついているカードを山札にもどして切った`);
}
rule(/^(のぞむなら、)?このポケモンと、ついているすべてのカードを、(自分の)?山札にもどして切る$/, m => after(ctx => {
    const { game, player, attacker } = ctx;
    if (!m[1]) {
        shuffleIntoDeck(game, attacker);
        return;
    }
    game.promptConfirm({ player, title: 'このポケモンを山札にもどしますか？', purpose: 'optional-return', cpuAnswer: () => false, callback: yes => { if (yes) shuffleIntoDeck(game, attacker); } });
}));
rule(/^相手のベンチポケモンを(\d+)匹選び、そのポケモンと、ついているすべてのカードを、山札にもどして切る$/, m => after(ctx => {
    const { game, player, opponent } = ctx;
    const n = Math.min(Number(m[1]), opponent.bench.length);
    if (n === 0) return;
    game.promptPokemon({
        player,
        pokemon: opponent.bench,
        min: n,
        max: n,
        title: '山札にもどす相手のベンチポケモンを選ぶ',
        purpose: 'boss-target',
        callback: selected => selected.forEach(pk => { if (canAffect(ctx, pk)) shuffleIntoDeck(game, pk); })
    });
}));

// ===== 読み替え =====

// 2つの文で1つの効果になるものは、区切る前に1つの文にまとめる
const JOINS = [
    [/のぞむなら、(\d+)ダメージ追加。その場合、このポケモンにも(\d+)ダメージ/g, 'のぞむなら、$1ダメージ追加し、このポケモンにも$2ダメージ'],
    [/相手のバトルポケモンが持つワザを1つ選ぶ。次の相手の番、このワザを受けたポケモンは、選ばれたワザが使えない/g,
        '相手のバトルポケモンが持つワザを1つ選び、次の相手の番、このワザを受けたポケモンは、そのワザが使えない']
];

// 文を区切る（[ ] の中の「。」では区切らない）
function splitSentences(text) {
    const sentences = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
        if (ch === '[' || ch === '(') depth++;
        if (ch === ']' || ch === ')') depth--;
        if (ch === '。' && depth === 0) {
            if (current) sentences.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    if (current) sentences.push(current);
    return sentences.map(sentence => sentence.replace(/^その後、/, '').replace(/^その場合、/, ''));
}

function compileSentence(sentence) {
    for (const { re, make } of RULES) {
        const m = sentence.match(re);
        if (!m) continue;
        const step = make(m);
        if (step) return step;
    }
    return null;
}

function prepare(text) {
    let normalized = normalizeText(text);
    REMINDERS.forEach(re => { normalized = normalized.replace(re, ''); });
    JOINS.forEach(([re, joined]) => { normalized = normalized.replace(re, joined); });
    return normalized;
}

// ワザの効果の文 → { before, after, expected, firstTurnOk, canUse }。読み替えられなければ null
export function compileAttackText(text) {
    const sentences = splitSentences(prepare(text));
    const steps = [];
    for (const sentence of sentences) {
        const step = compileSentence(sentence);
        if (!step) return null;
        steps.push(step);
    }
    const phase = name => steps.filter(step => step.phase === name);
    const runAll = list => list.length === 0 ? undefined : ctx => ctx.game.runNext(...list.map(step => () => { if (!ctx.failed) step.run(ctx); }));
    const estimators = steps.filter(step => step.expected);
    const flags = Object.fromEntries(phase('flag').map(step => [step.flag, step.value ?? true]));
    return {
        ...flags,
        before: runAll(phase('before')),
        after: runAll(phase('after')),
        expected: estimators.length === 0 ? undefined : ctx => estimators.reduce((damage, step) => step.expected(ctx, damage), ctx.damage)
    };
}

// 読み替えられない文（数えるときに使う）
export function unsupportedSentences(text) {
    return splitSentences(prepare(text)).filter(sentence => !compileSentence(sentence));
}
