/**
 * 決まった形に読み替えられないワザの効果（そのa）。「カード名/ワザ名」で引く（同じ名前で文の違う版があるなら「カードのID/ワザ名」）
 * { before(ctx), after(ctx), expected(ctx), canUse(game, player, pokemon), firstTurnOk }。ctx は attack-effects.js と同じ。書き方は cards/HOOKS.md
 *
 * 対象：tools/list-unsupported.mjs attacks 0 182 の一覧。次のワザは書いていない（ゲームの本体に仕組みが要る・文の意味を確かめられない）
 *   - シザリガー/やりかえしシザー（M1L-037）：「ダメカンがのっているなら、エネルギー1個で使える」。ワザ自身がコストを変える仕組みがない
 *     （attackCost のフックは場の特性・どうぐなどからしか呼ばれない）
 *   - メガヘラクロスex/パンツァーホーン（M2-093）：「前の相手の番に、このポケモンが受けたワザのダメージ」を覚えておく仕組みがない
 *   - イイネイヌ/おれいまいり（M2a-098）：「前の相手の番に、相手がとったサイドの枚数」を覚えておく仕組みがない
 *   - ヤヤコマ/とりぶえ（M3-065）：「抵抗力がタイプのポケモン」と、文からタイプの記号が抜けていて、どのタイプか確かめられない
 *   - サケブシッポ/うたいはげます（MC-352）・コライドン/げんせいらんだ（SV-P-152）：「古代」のポケモンかどうかが、カードのデータにない
 *   - ミライドン/アクセルピーク（SV-P-151）：「未来」のポケモンかどうかが、カードのデータにない
 *   - ロケット団のミミッキュ/ほうせきごっこ（SV10-042）：「テラスタル」のポケモンかどうかが、カードのデータにない（card-data.js で tera はいつも false）
 *
 * 解釈したところ
 *   - 山札から「ポケモン」を「ベンチに出す」ワザ（トリックポータル・おとどけチャレンジ）は、attack-effects.js の読み替えと同じく、たねポケモンだけを出す
 *   - メガリザードンXex/インフェルノX は、M2-116 の文から [R] が抜けている。M2a-223 の文で [R] と確かめられるので、名前で引いて、どちらも炎エネルギーにする
 */

const canAffect = (ctx, pokemon) => Boolean(pokemon) && ctx.game.canAffectByAttack(ctx, pokemon);
const counters = pokemon => Math.floor(pokemon.damage / 10);
const remainingHp = (game, pokemon) => game.maxHp(pokemon) - pokemon.damage;
const isBasicEnergy = (card, type) => card.kind === 'energy' && card.basic && (!type || card.energyType === type);
const isBasicPokemon = card => card.kind === 'pokemon' && card.stage === 0;
const isSupporter = card => card.kind === 'trainer' && card.trainerType === 'supporter';
const indicesUpTo = n => Array.from({ length: n }, (_, index) => index);
const names = (game, insts) => insts.map(inst => game.cardName(inst)).join('・');

function fail(ctx) {
    ctx.failed = true;
    ctx.game.log('ワザは失敗した');
}

function knockOut(game, pokemon) {
    const rest = remainingHp(game, pokemon);
    if (rest > 0) game.putDamage(pokemon, rest);
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

// そのエネルギーが、指定したタイプのエネルギーになるか（特殊エネルギーも含める）
function providesType(game, pokemon, inst, type) {
    return game.energyUnits(pokemon, [inst]).some(unit => unit === type || unit === 'any' || unit.split('|').includes(type));
}
const typedEnergies = (game, pokemon, type) => pokemon.energies.filter(inst => providesType(game, pokemon, inst, type));

// 弱点を突けるか（CPU の見積もり）
function hitsWeakness(game, attacker, defender) {
    const weakness = defender ? game.weaknessOf(defender) : null;
    return Boolean(weakness) && game.typesOf(attacker).includes(weakness);
}

// CPU：1枚（1個）につき per ダメージのとき、相手のバトルポケモンをきぜつさせるのに要る数（max まで）。base は先に与えるダメージ
function cpuCount(game, ctx, per, max, base = 0) {
    const defender = ctx.defender;
    if (!defender) return max;
    const multiplier = hitsWeakness(game, ctx.attacker, defender) ? 2 : 1;
    const rest = remainingHp(game, defender) - base * multiplier;
    if (rest <= 0) return 0;
    return Math.min(max, Math.ceil(rest / (per * multiplier)));
}

// CPU：追加のダメージで、はじめて相手のバトルポケモンをきぜつさせられるか
function cpuBonusKnocksOut(game, ctx, bonus) {
    const defender = ctx.defender;
    if (!defender) return false;
    const multiplier = hitsWeakness(game, ctx.attacker, defender) ? 2 : 1;
    const rest = remainingHp(game, defender);
    return ctx.damage * multiplier < rest && (ctx.damage + bonus) * multiplier >= rest;
}

// カードを選ばせる。選ぶ余地がなければ（すべて選ぶしかない・候補がない）選択を出さない
function chooseCards(game, { player, cards, min, max, title, purpose, cpuAnswer, callback }) {
    const n = Math.min(max, cards.length);
    const low = Math.min(min, n);
    if (n === 0) {
        callback([]);
        return;
    }
    if (low === n && cards.length === n) {
        callback([...cards]);
        return;
    }
    game.promptCards({ player, cards, min: low, max: n, title, purpose, cpuAnswer, callback });
}

// ポケモンを1匹選ばせる（1匹だけなら選択を出さない）
function choosePokemon(game, { player, pokemon, title, purpose, amount, cpuAnswer, callback }) {
    if (pokemon.length === 0) return;
    if (pokemon.length === 1) {
        callback(pokemon[0]);
        return;
    }
    game.promptPokemon({ player, pokemon, min: 1, max: 1, title, purpose, amount, cpuAnswer, callback: ([target]) => callback(target) });
}

// ポケモンについているエネルギーを、条件に合うものから選んで動かす（count 個まで。min 個は必ず）
function chooseEnergies(ctx, pokemon, { filter = () => true, min, max, title, purpose = 'discard-own-energy', cpuAnswer, callback }) {
    const { game } = ctx;
    const candidates = pokemon.energies.filter(inst => filter(inst));
    const n = Math.min(max, candidates.length);
    // 同じカードしかないなら、どれを選んでも同じ
    if (n > 0 && Math.min(min, n) === n && new Set(candidates.map(inst => inst.id)).size === 1) {
        callback(candidates.slice(0, n));
        return;
    }
    chooseCards(game, { player: ctx.player, cards: candidates, min, max, title, purpose, cpuAnswer, callback });
}

// ポケモンと、ついているすべてのカードを、持ち主の山札にもどして切る
function shuffleIntoDeck(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    if (!owner) return;
    const name = game.topCard(pokemon).name;
    if (owner.active === pokemon) owner.active = null;
    else game.removeCard(owner.bench, pokemon);
    owner.deck.push(...pokemon.cards, ...pokemon.energies, ...(pokemon.tool ? [pokemon.tool] : []));
    game.shuffleDeck(owner);
    game.log(`${owner.name}の${name}と、ついているカードを山札にもどして切った`);
}

// 相手の手札からオモテを見ないで count 枚選び、オモテを見て、山札にもどして切る
function returnRandomFromHand(game, owner, count) {
    const returned = [];
    for (let i = 0; i < count && owner.hand.length > 0; i++) {
        const inst = owner.hand[Math.floor(game.random() * owner.hand.length)];
        game.moveCard(owner.hand, owner.deck, inst);
        returned.push(inst);
    }
    if (returned.length === 0) return;
    game.shuffleDeck(owner);
    game.log(`${owner.name}の手札の${returned.map(inst => game.cardName(inst)).join('と')}を山札にもどして切った`);
}

// 自分の山札を上から count 枚トラッシュし、条件に合うカードの枚数を返す
function millAndCount(game, player, count, filter) {
    const milled = player.deck.slice(0, count);
    game.millDeck(player, count);
    return milled.filter(inst => filter(game.cardOf(inst))).length;
}

// 次の相手の番まで残る効果。ポケモンにしるしをつけ、プレイヤーの効果のフックで働かせる
//   しるしはポケモンの効果なので、ベンチにもどる・進化すると消える（ルールどおり、効果もなくなる）
function lastingEffect(ctx, pokemon, kind, makeHooks) {
    const { game } = ctx;
    const until = game.turn + 1;
    game.addEffect(pokemon, kind, until);
    const active = g => g.hasEffect(pokemon, kind) && Boolean(g.ownerOf(pokemon));
    game.addPlayerEffect(ctx.player, kind, until, { hooks: makeHooks(active, until) });
}

// 次の相手の番、このポケモンが受けるワザのダメージを止める（attackerTest がワザを使うポケモンを見て true なら）
function preventDamageFrom(kind, attackerTest) {
    return ctx => lastingEffect(ctx, ctx.attacker, kind, active => ({
        preventDamage: (game, source, actx, target) => target === ctx.attacker && active(game) && !actx.ignoreEffects
            && game.ownerOf(target) !== actx.player && attackerTest(game, actx.attacker)
    }));
}

// 次の相手の番の終わりに、このワザを受けたポケモンと、ついているすべてのカードを、トラッシュする
function discardAtNextTurnEnd(ctx) {
    const { defender } = ctx;
    if (!canAffect(ctx, defender)) return;
    lastingEffect(ctx, defender, 'discardAtTurnEnd', (active, until) => ({
        onTurnEnd: game => {
            if (game.turn !== until || !active(game)) return;
            const owner = game.ownerOf(defender);
            game.log(`${game.topCard(defender).name}と、ついているすべてのカードをトラッシュした`);
            game.removeFromPlay(owner, defender);
        }
    }));
}

// ほかのワザを、このワザとして使う（そのワザのダメージと効果。エネルギーはいらない）
function useAttackAsThis(ctx, attack) {
    ctx.game.log(`「${attack.name}」として使う`);
    ctx.copied = attack;
    ctx.attack = attack;
    ctx.damage = attack.damage;
    attack.before?.(ctx);
}
const copiedAfter = ctx => { if (ctx.copied?.after) ctx.copied.after(ctx); };

// ワザの選択肢（効果の動くワザだけ）。list は { label, attack }
function chooseAttack(ctx, list, { optional, title }) {
    const { game, player } = ctx;
    if (list.length === 0) return;
    const options = list.map(entry => entry.label);
    if (optional) options.push('使わない');
    game.promptChoose({
        player,
        options,
        title,
        purpose: 'copy-attack',
        cpuAnswer: () => [list.reduce((best, entry, index) => (entry.attack.damage > list[best].attack.damage ? index : best), 0)],
        callback: ([index]) => { if (index < list.length) useAttackAsThis(ctx, list[index].attack); }
    });
}
const attackEntries = (game, cards) => cards.flatMap(card => card.attacks
    .filter(attack => attack.supported)
    .map(attack => ({ label: `${card.name}：${attack.name}（${attack.damageText || 0}）`, attack })));

// 自分の山札を下から7枚オモテにして、ワザ「バグパニック」を持つポケモンの枚数×50ダメージ
const BUG_PANIC = {
    before: ctx => {
        const { game, player } = ctx;
        const revealed = player.deck.splice(Math.max(0, player.deck.length - 7));
        game.log(`${player.name}は山札を下から${revealed.length}枚オモテにした（${names(game, revealed) || 'なし'}）`);
        const pokemon = revealed.filter(inst => game.cardOf(inst).kind === 'pokemon');
        const count = pokemon.filter(inst => game.cardOf(inst).attacks.some(attack => attack.name === 'バグパニック')).length;
        ctx.damage = count * 50;
        player.discard.push(...revealed.filter(inst => !pokemon.includes(inst)));
        player.deck.push(...pokemon);
        game.shuffleDeck(player);
    },
    expected: () => 50
};

// 次の相手の番、このワザを受けたポケモンは…（カードを手札からつけるたびにダメカン）
function counterOnAttach(amount) {
    return ctx => {
        const { defender } = ctx;
        if (!canAffect(ctx, defender)) return;
        lastingEffect(ctx, defender, 'counterOnAttach', active => ({
            onAttachEnergy: (game, source, player, pokemon) => {
                if (pokemon !== defender || !active(game)) return;
                game.putDamage(defender, amount);
                game.runNext(() => game.checkKnockouts());
            }
        }));
    };
}

// のぞむなら、このポケモンについているエネルギーを（条件・数）トラッシュ（手札・山札にもどす）し、bonus ダメージ追加
function optionalEnergyBonus({ bonus, count = Infinity, type = null, to = 'discard', title }) {
    return {
        before: ctx => {
            const { game, player, attacker } = ctx;
            const candidates = type ? typedEnergies(game, attacker, type) : attacker.energies;
            const need = count === Infinity ? 1 : count;
            if (candidates.length < need) return;
            game.promptConfirm({
                player,
                title,
                purpose: 'optional-bonus',
                cpuAnswer: g => cpuBonusKnocksOut(g, ctx, bonus),
                callback: yes => {
                    if (!yes) return;
                    const finish = selected => {
                        const destination = to === 'hand' ? player.hand : (to === 'deck' ? player.deck : player.discard);
                        selected.forEach(inst => game.moveCard(attacker.energies, destination, inst));
                        if (to === 'deck') game.shuffleDeck(player);
                        game.log(`${game.topCard(attacker).name}のエネルギーを${selected.length}個${{ hand: '手札にもどした', deck: '山札にもどして切った', discard: 'トラッシュした' }[to]}`);
                        ctx.damage += bonus;
                    };
                    if (count === Infinity) finish([...candidates]);
                    else chooseEnergies(ctx, attacker, { filter: inst => candidates.includes(inst), min: count, max: count, title: `エネルギーを${count}個選ぶ`, callback: finish });
                }
            });
        },
        expected: ctx => {
            const candidates = type ? typedEnergies(ctx.game, ctx.attacker, type) : ctx.attacker.energies;
            return candidates.length >= (count === Infinity ? 1 : count) ? ctx.damage + bonus : ctx.damage;
        }
    };
}

// このポケモンについているエネルギーを（条件で）max 個までトラッシュし、その枚数×per ダメージ
function discardOwnEnergyTimes({ per, max = Infinity, filter }) {
    const candidatesOf = ctx => ctx.attacker.energies.filter(inst => filter(ctx.game, ctx.attacker, inst));
    return {
        before: ctx => {
            const { game, player, attacker } = ctx;
            const candidates = candidatesOf(ctx);
            const limit = Math.min(max, candidates.length);
            ctx.damage = 0;
            if (limit === 0) return;
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: limit,
                title: `トラッシュするエネルギーを選ぶ（1個につき${per}ダメージ）`,
                purpose: 'discard-own-energy',
                cpuAnswer: g => indicesUpTo(cpuCount(g, ctx, per, limit)),
                callback: selected => {
                    selected.forEach(inst => game.moveCard(attacker.energies, player.discard, inst));
                    if (selected.length) game.log(`${game.topCard(attacker).name}のエネルギーを${selected.length}個トラッシュした`);
                    ctx.damage = selected.length * per;
                }
            });
        },
        expected: ctx => Math.min(max, candidatesOf(ctx).length) * per
    };
}

// 自分の手札から（条件で）max 枚までトラッシュ（見せる）し、その枚数×per ダメージ
function handCardsTimes({ per, max = Infinity, filter, reveal = false, title }) {
    const candidatesOf = ctx => ctx.player.hand.filter(inst => filter(ctx.game.cardOf(inst)));
    return {
        before: ctx => {
            const { game, player } = ctx;
            const candidates = candidatesOf(ctx);
            const limit = Math.min(max, candidates.length);
            ctx.damage = 0;
            if (limit === 0) return;
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: limit,
                title,
                purpose: reveal ? 'reveal-hand' : 'discard-hand-for-damage',
                // 見せるだけなら、すべて見せる。トラッシュするなら、きぜつさせるのに要る枚数だけ
                cpuAnswer: g => indicesUpTo(reveal ? limit : cpuCount(g, ctx, per, limit)),
                callback: selected => {
                    if (reveal) game.log(`${player.name}は手札の${names(game, selected) || 'なし'}を見せた`);
                    else {
                        selected.forEach(inst => game.moveCard(player.hand, player.discard, inst));
                        if (selected.length) game.log(`${player.name}は手札の${names(game, selected)}をトラッシュした`);
                    }
                    ctx.damage = selected.length * per;
                }
            });
        },
        expected: ctx => Math.min(max, candidatesOf(ctx).length) * per
    };
}

// 自分の手札から（条件の）カードを count 枚トラッシュする。count 枚トラッシュできないなら、このワザは失敗
function discardFromHandOrFail({ count, filter, title }) {
    const candidatesOf = ctx => ctx.player.hand.filter(inst => filter(ctx.game.cardOf(inst)));
    return {
        before: ctx => {
            const { game, player } = ctx;
            const candidates = candidatesOf(ctx);
            if (candidates.length < count) {
                fail(ctx);
                return;
            }
            const finish = selected => {
                selected.forEach(inst => game.moveCard(player.hand, player.discard, inst));
                game.log(`${player.name}は手札の${names(game, selected)}をトラッシュした`);
            };
            if (new Set(candidates.map(inst => inst.id)).size === 1) finish(candidates.slice(0, count));
            else game.promptCards({ player, cards: candidates, min: count, max: count, title, purpose: 'ultra-ball-discard', callback: finish });
        },
        expected: ctx => (candidatesOf(ctx).length >= count ? ctx.damage : 0)
    };
}

// 自分のトラッシュにある（条件の）カードをすべて見せて、その枚数×per ダメージ。その後、見せたカードを山札にもどして切る
function revealDiscardTimes({ per, filter }) {
    const countOf = ctx => ctx.player.discard.filter(inst => filter(ctx.game.cardOf(inst))).length;
    return {
        before: ctx => {
            const shown = ctx.player.discard.filter(inst => filter(ctx.game.cardOf(inst)));
            ctx.game.log(`${ctx.player.name}はトラッシュの${shown.length}枚を見せた`);
            ctx.revealed = shown;
            ctx.damage = shown.length * per;
        },
        after: ctx => {
            const { game, player } = ctx;
            const shown = (ctx.revealed ?? []).filter(inst => player.discard.includes(inst));
            if (shown.length === 0) return;
            shown.forEach(inst => game.moveCard(player.discard, player.deck, inst));
            game.shuffleDeck(player);
            game.log(`${player.name}は見せたカードを山札にもどして切った`);
        },
        expected: ctx => countOf(ctx) * per
    };
}

// 自分の山札を上から count 枚トラッシュし、その中の（条件の）カードの枚数×per ダメージ
function millTimes({ count, per, filter, guess }) {
    return {
        before: ctx => { ctx.damage = millAndCount(ctx.game, ctx.player, count, filter) * per; },
        expected: () => guess * per
    };
}

// 「〜なら、N ダメージ追加」（test(ctx) が true なら）
function bonusIf(amount, test) {
    const value = ctx => ctx.damage + (test(ctx) ? amount : 0);
    return { before: ctx => { ctx.damage = value(ctx); }, expected: value };
}

// 「（数）× N ダメージ（追加）」
function timesDamage(per, count, { add = false } = {}) {
    const value = ctx => (add ? ctx.damage : 0) + count(ctx) * per;
    return { before: ctx => { ctx.damage = value(ctx); }, expected: value };
}

// 「〜なら（〜でないなら）、このワザは失敗」（test(ctx) が true なら失敗）
function failIf(test) {
    return { before: ctx => { if (test(ctx)) fail(ctx); }, expected: ctx => (test(ctx) ? 0 : ctx.damage) };
}

// 自分のトラッシュから（条件の）基本エネルギーを max 枚まで選び、（条件の）ポケモンに好きなようにつける
function attachFromDiscard(ctx, { filter, max, where, title }) {
    const { game, player } = ctx;
    if (!game.inPlay(player).some(where)) return;
    const candidates = player.discard.filter(inst => filter(game.cardOf(inst)));
    const n = Math.min(max, candidates.length);
    if (n === 0) return;
    game.promptCards({
        player,
        cards: candidates,
        min: 0,
        max: n,
        title,
        purpose: 'energy-retrieval',
        callback: selected => {
            selected.forEach(inst => game.removeCard(player.discard, inst));
            game.attachAnyWay(player, selected, where, 'attach-energy-target');
        }
    });
}

// 自分の山札から（条件の）カードを max 枚まで選び、（条件の）ポケモンに好きなようにつける
function attachFromDeck(ctx, { filter, max, where }) {
    const { game, player } = ctx;
    if (!game.inPlay(player).some(where)) return;
    game.searchDeck({
        player,
        filter,
        max,
        title: 'つけるエネルギーを選ぶ',
        purpose: 'search-energy',
        onSelected: found => game.attachAnyWay(player, found, where, 'attach-energy-target')
    });
}

// 自分のベンチポケモンを1匹選び、のっているダメカンをすべて、相手のバトルポケモンにのせ替える
function moveAllCountersToDefender(ctx, filter) {
    const { game, player, defender } = ctx;
    if (!canAffect(ctx, defender)) return;
    const candidates = player.bench.filter(pk => pk.damage > 0 && filter(game.topCard(pk)));
    choosePokemon(game, {
        player,
        pokemon: candidates,
        title: 'ダメカンをのせ替えるベンチポケモンを選ぶ',
        purpose: 'move-counters-source',
        cpuAnswer: g => [candidates.reduce((best, pk, index) => (pk.damage > candidates[best].damage ? index : best), 0)],
        callback: source => {
            const amount = source.damage;
            source.damage = 0;
            game.log(`${game.topCard(source).name}のダメカンを${amount / 10}個、${game.topCard(defender).name}にのせ替えた`);
            game.putDamage(defender, amount);
        }
    });
}

// 相手のバトルポケモンについているエネルギーを1個選び、相手のベンチポケモンにつけ替える（のぞむなら）
function optionalMoveOpponentEnergy(ctx) {
    const { game, player, opponent, defender } = ctx;
    if (!canAffect(ctx, defender) || defender.energies.length === 0 || opponent.bench.length === 0) return;
    game.promptCards({
        player,
        cards: defender.energies,
        min: 0,
        max: 1,
        title: 'つけ替える相手のエネルギーを選ぶ（つけ替えないなら選ばない）',
        purpose: 'move-opponent-energy',
        cpuAnswer: () => [0],
        callback: ([inst]) => {
            if (!inst) return;
            choosePokemon(game, {
                player,
                pokemon: opponent.bench,
                title: 'エネルギーをつけ替える相手のベンチポケモンを選ぶ',
                purpose: 'move-opponent-energy-target',
                cpuAnswer: () => [0],
                callback: target => game.moveEnergy(defender, target, inst)
            });
        }
    });
}

// 山札から進化するカードを選び、そのポケモンにのせて進化させる
function evolveFromDeck(game, player, pokemon) {
    if (!game.inPlay(player).includes(pokemon)) return;
    const name = game.topCard(pokemon).name;
    game.searchDeck({
        player,
        filter: card => card.kind === 'pokemon' && card.evolvesFrom === name,
        max: 1,
        title: `${name}から進化するカードを選ぶ`,
        purpose: 'search-evolution',
        onSelected: ([inst]) => { if (inst) game.evolveFromOutside(player, pokemon, inst); }
    });
}
const hasEvolutionInDeck = (game, player, pokemon) => player.deck.some(inst => {
    const card = game.cardOf(inst);
    return card.kind === 'pokemon' && card.evolvesFrom === game.topCard(pokemon).name;
});

// 相手のポケモンを1匹選び、amount ダメージ（ベンチは弱点・抵抗力を計算しない）
function snipe(ctx, targets, amount) {
    if (targets.length === 0 || amount <= 0) return;
    choosePokemon(ctx.game, {
        player: ctx.player,
        pokemon: targets,
        title: `${amount}ダメージを与えるポケモンを選ぶ`,
        purpose: 'snipe-target',
        amount,
        callback: target => ctx.game.dealAttackDamage(ctx, target, amount)
    });
}

// 相手のポケモンを1匹選び、きぜつさせる
function chooseAndKnockOut(ctx, targets) {
    choosePokemon(ctx.game, {
        player: ctx.player,
        pokemon: targets,
        title: 'きぜつさせるポケモンを選ぶ',
        purpose: 'snipe-target',
        amount: 9999,
        callback: target => { if (canAffect(ctx, target)) knockOut(ctx.game, target); }
    });
}

const stadiumNameIncludes = (game, word) => Boolean(game.stadium) && game.cardName(game.stadium.inst).includes(word);
const pokemonNamed = (game, pokemon, word) => game.topCard(pokemon).name.includes(word);
const hiddenCount = (game, player) => player.discard.filter(inst => game.cardOf(inst).ability?.name === 'ばけがくれ').length;
const hasAbility = (game, pokemon) => Boolean(game.topCard(pokemon).ability) && !game.abilitySuppressed(pokemon);

export const ATTACK_OVERRIDES = {
    'メガマフォクシーex/トリックポータル': {
        after: ctx => {
            const { game, player } = ctx;
            const top = player.deck.slice(0, 9);
            game.log(`${player.name}は山札を上から${top.length}枚見た`);
            game.log(`山札の上：${names(game, top)}`, { to: player.id });
            const room = game.benchSize - player.bench.length;
            const candidates = top.filter(inst => isBasicPokemon(game.cardOf(inst)));
            const finish = selected => {
                selected.forEach(inst => {
                    game.removeCard(player.deck, inst);
                    player.bench.push(game.createPokemon(inst));
                    game.log(`${player.name}は${game.cardName(inst)}をベンチに出した`);
                });
                game.shuffleDeck(player);
            };
            if (room <= 0 || candidates.length === 0) {
                finish([]);
                return;
            }
            game.promptCards({ player, cards: candidates, min: 0, max: Math.min(room, candidates.length), title: 'ベンチに出すポケモンを選ぶ', purpose: 'bench-basic', callback: finish });
        }
    },
    'セレビィ/ときをめぐる': {
        after: ctx => ctx.game.searchDeck({
            player: ctx.player,
            filter: card => card.kind === 'pokemon' || (card.kind === 'trainer' && card.trainerType === 'stadium'),
            max: 3,
            title: '手札に加えるポケモンとスタジアムを選ぶ（合計3枚まで）',
            purpose: 'search-card',
            onSelected: found => ctx.game.addToHand(ctx.player, found, { reveal: true })
        })
    },
    'ダーテング/とっぷうがえし': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            if (!game.flipCoin()) return;
            const targets = game.inPlay(opponent);
            choosePokemon(game, {
                player,
                pokemon: targets,
                title: '山札にもどす相手のポケモンを選ぶ',
                purpose: 'shuffle-opponent-pokemon',
                cpuAnswer: g => [targets.reduce((best, pk, index) => {
                    const score = target => g.prizeValue(g.topCard(target)) * 100 + target.energies.length * 10 + g.topCard(target).stage;
                    return score(pk) > score(targets[best]) ? index : best;
                }, 0)],
                callback: target => { if (canAffect(ctx, target)) shuffleIntoDeck(game, target); }
            });
        }
    },
    'キュウコン/あやかしへんげ': {
        after: ctx => {
            const { game, player } = ctx;
            const top = player.deck[0];
            if (!top) return;
            game.millDeck(player, 1);
            const card = game.cardOf(top);
            if (!isSupporter(card) || !card.supported) return;
            game.log(`${card.name}の効果を、ワザの効果として使う`);
            // ワザの後に番は終わるので、「自分の番を終える」効果は二重に番を終えないようにする
            game.endTurnByEffect = () => {};
            try {
                card.play(game, player, top);
            } finally {
                delete game.endTurnByEffect;
            }
        }
    },
    'タギングル/ミラクルペイント': {
        after: ctx => {
            const { game, player, defender } = ctx;
            if (!game.flipCoin() || !canAffect(ctx, defender)) return;
            const conditions = ['poisoned', 'burned', 'asleep', 'paralyzed', 'confused'];
            game.promptChoose({
                player,
                options: ['どく', 'やけど', 'ねむり', 'マヒ', 'こんらん'],
                title: '相手のバトルポケモンをする特殊状態を選ぶ',
                purpose: 'choose-condition',
                cpuAnswer: () => [3],
                callback: ([index]) => game.addCondition(defender, conditions[index])
            });
        }
    },
    'ディアルガ/クロノバースト': optionalEnergyBonus({ bonus: 80, to: 'deck', title: 'このポケモンのエネルギーをすべて山札にもどして、80ダメージ追加しますか？' }),
    'サーフゴー/つかみほうだい': {
        after: ctx => {
            const heads = flipUntilTails(ctx.game);
            if (heads === 0) return;
            ctx.game.searchDeck({
                player: ctx.player,
                filter: () => true,
                max: heads,
                title: `手札に加えるカードを${heads}枚まで選ぶ`,
                purpose: 'search-card',
                onSelected: found => ctx.game.addToHand(ctx.player, found)
            });
        }
    },
    'ミルタンク/まんぷくミルク': {
        after: ctx => {
            const { game, player } = ctx;
            if (flipCoins(game, 2) < 2) return;
            const damaged = game.inPlay(player).filter(pk => pk.damage > 0);
            choosePokemon(game, { player, pokemon: damaged, title: 'HPをすべて回復するポケモンを選ぶ', purpose: 'potion', callback: target => game.heal(target, target.damage) });
        }
    },
    'メガアブソルex/デスピリオド': {
        after: ctx => { if (canAffect(ctx, ctx.defender) && counters(ctx.defender) === 6) knockOut(ctx.game, ctx.defender); },
        expected: ctx => (ctx.defender && counters(ctx.defender) === 6 ? remainingHp(ctx.game, ctx.defender) : 0)
    },
    'モジャンボ/ムキムキウィップ': bonusIf(140, ctx => ctx.game.energyUnits(ctx.attacker).length >= ctx.attack.cost.length + 2),
    'イーユイ/やけつくだいち': {
        after: ctx => {
            const { game, opponent } = ctx;
            if (!game.stadium || game.stadium.owner !== opponent.id) return;
            game.discardStadium();
            game.addPlayerEffect(opponent, 'stadiumLock', game.turn + 1, {
                hooks: {
                    blockTrainer: (g, source, player, card) => (player === source.player && card.trainerType === 'stadium' ? 'この番はスタジアムを出せません' : null)
                }
            });
            game.log(`次の番、${opponent.name}は手札からスタジアムを出せない`);
        }
    },
    'カイオーガ/ぎゃくりゅう': revealDiscardTimes({ per: 20, filter: card => isBasicEnergy(card, 'water') }),
    'パチリス/しびれるまえば': { after: counterOnAttach(80) },
    'ゼルネアス/ジオゲート': {
        after: ctx => ctx.game.benchFromDeck(ctx.player, card => isBasicPokemon(card) && card.type === 'psychic', 3, 'bench-basic')
    },
    'キテルグマ/ひっさつラリアット': {
        before: ctx => { if (flipCoins(ctx.game, 2) === 2) ctx.damage += 100; },
        expected: ctx => ctx.damage + 25
    },
    'インテレオン/しとめる': {
        after: ctx => {
            const { game, player, opponent, attacker } = ctx;
            const all = [...game.inPlay(opponent), ...game.inPlay(player)].filter(pk => pk !== attacker);
            if (all.length === 0) return;
            const lowest = Math.min(...all.map(pk => remainingHp(game, pk)));
            const targets = all.filter(pk => remainingHp(game, pk) === lowest);
            choosePokemon(game, {
                player,
                pokemon: targets,
                title: 'きぜつさせるポケモンを選ぶ',
                purpose: 'knockout-lowest',
                cpuAnswer: g => {
                    const index = targets.findIndex(pk => g.ownerOf(pk) === opponent);
                    return [Math.max(0, index)];
                },
                callback: target => { if (canAffect(ctx, target)) knockOut(game, target); }
            });
        }
    },
    'フーディン/ハンドパワー': {
        after: ctx => { if (canAffect(ctx, ctx.defender) && ctx.player.hand.length > 0) ctx.game.putDamage(ctx.defender, ctx.player.hand.length * 20); },
        expected: ctx => ctx.player.hand.length * 20
    },
    'ハカドッグ/ホラーバイト': {
        after: ctx => returnRandomFromHand(ctx.game, ctx.opponent, flipUntilTails(ctx.game))
    },
    'メガユキノオーex/アバランチハンマー': millTimes({ count: 6, per: 100, filter: card => isBasicEnergy(card, 'water'), guess: 2 }),
    'メガライボルトex/ライオットブラスター': optionalEnergyBonus({ bonus: 130, title: 'このポケモンのエネルギーをすべてトラッシュして、130ダメージ追加しますか？' }),
    'メガサーナイトex/あふれるねがい': {
        after: ctx => {
            const { game, player } = ctx;
            const energies = player.deck.filter(inst => isBasicEnergy(game.cardOf(inst), 'psychic'));
            const bench = [...player.bench];
            bench.slice(0, energies.length).forEach((pk, index) => {
                game.removeCard(player.deck, energies[index]);
                game.attachFromOutside(pk, energies[index]);
            });
            game.shuffleDeck(player);
        }
    },
    'ソウブレイズ/れんごくざん': discardFromHandOrFail({ count: 4, filter: card => isBasicEnergy(card), title: 'トラッシュする基本エネルギーを4枚選ぶ' }),
    'パーモット/ボルテージフィスト': {
        after: ctx => {
            const { game, player, attacker, defender } = ctx;
            game.promptConfirm({
                player,
                title: 'このポケモンにも60ダメージを与えて、相手のバトルポケモンをマヒにしますか？',
                purpose: 'optional-effect',
                cpuAnswer: g => remainingHp(g, attacker) > 60 && Boolean(defender) && remainingHp(g, defender) > 0,
                callback: yes => {
                    if (!yes) return;
                    game.putDamage(attacker, 60);
                    if (canAffect(ctx, defender)) game.addCondition(defender, 'paralyzed');
                }
            });
        }
    },
    'エルフーン/いやしのわたげ': {
        after: ctx => {
            const { game, player } = ctx;
            const damaged = player.bench.filter(pk => pk.damage > 0);
            choosePokemon(game, { player, pokemon: damaged, title: 'HPをすべて回復するベンチポケモンを選ぶ', purpose: 'potion', callback: target => game.heal(target, target.damage) });
        }
    },
    'パルデア ケンタロス/いかりのとっしん': timesDamage(40, ctx => ctx.game.inPlay(ctx.player).filter(pk => pk.damage > 0 && pokemonNamed(ctx.game, pk, 'ケンタロス')).length),
    'ドータクン/どうぐおとし': timesDamage(40, ctx => [...ctx.game.inPlay(ctx.player), ...ctx.game.inPlay(ctx.opponent)].filter(pk => pk.tool).length),
    'エイパム/おどろかす': { after: ctx => returnRandomFromHand(ctx.game, ctx.opponent, 1) },
    'ドーブル/エナジースケッチ': {
        after: ctx => {
            const heads = flipCoins(ctx.game, 3);
            attachFromDiscard(ctx, { filter: card => isBasicEnergy(card), max: heads, where: pk => pk !== ctx.player.active, title: `ベンチにつける基本エネルギーを${heads}枚まで選ぶ` });
        }
    },
    'メガリザードンXex/インフェルノX': {
        before: ctx => {
            const { game, player } = ctx;
            const owners = new Map();
            game.inPlay(player).forEach(pk => typedEnergies(game, pk, 'fire').forEach(inst => owners.set(inst, pk)));
            const list = [...owners.keys()];
            ctx.damage = 0;
            if (list.length === 0) return;
            game.promptCards({
                player,
                cards: list,
                min: 0,
                max: list.length,
                title: 'トラッシュする炎エネルギーを選ぶ（1個につき90ダメージ）',
                purpose: 'discard-own-energy',
                cpuAnswer: g => indicesUpTo(cpuCount(g, ctx, 90, list.length)),
                callback: selected => {
                    selected.forEach(inst => game.moveCard(owners.get(inst).energies, player.discard, inst));
                    if (selected.length) game.log(`${player.name}は炎エネルギーを${selected.length}個トラッシュした`);
                    ctx.damage = selected.length * 90;
                }
            });
        },
        expected: ctx => ctx.game.inPlay(ctx.player).reduce((sum, pk) => sum + typedEnergies(ctx.game, pk, 'fire').length, 0) * 90
    },
    'Nのバイバニラ/かさねゆき': {
        after: ctx => ctx.game.inPlay(ctx.opponent).forEach(pk => {
            if (pk.damage > 0 && canAffect(ctx, pk)) ctx.game.putDamage(pk, counters(pk) * 10);
        })
    },
    'モスノウ/コールドサイクロン': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            if (player.bench.length === 0 || !game.inPlay(player).includes(attacker)) return;
            chooseEnergies(ctx, attacker, {
                filter: inst => providesType(game, attacker, inst, 'water'),
                min: 1,
                max: 1,
                title: 'つけ替える水エネルギーを選ぶ',
                callback: ([inst]) => {
                    if (!inst) return;
                    choosePokemon(game, { player, pokemon: player.bench, title: 'エネルギーをつけ替えるベンチポケモンを選ぶ', purpose: 'energy-switch-target', callback: target => game.moveEnergy(attacker, target, inst) });
                }
            });
        }
    },
    'ロケット団のナッシー/トライキネシス': {
        after: ctx => { if (flipCoins(ctx.game, 3) === 3) chooseAndKnockOut(ctx, ctx.game.inPlay(ctx.opponent)); }
    },
    'ムウマージ/アサシンマジック': {
        after: ctx => {
            const { game, opponent, defender } = ctx;
            if (!defender || !game.hasAnyCondition(defender)) return;
            const targets = opponent.bench.filter(pk => canAffect(ctx, pk));
            choosePokemon(game, { player: ctx.player, pokemon: targets, title: 'ダメカンを6個のせるポケモンを選ぶ', purpose: 'snipe-target', amount: 60, callback: target => game.putDamage(target, 60) });
        }
    },
    'ロトム/ロトコール': {
        after: ctx => ctx.game.benchFromDeck(ctx.player, card => isBasicPokemon(card) && card.name.includes('ロトム'), ctx.game.benchSize, 'bench-basic')
    },
    'セキタンザン/タールキャノン': {
        before: ctx => {
            const count = ctx.player.discard.filter(inst => isBasicEnergy(ctx.game.cardOf(inst), 'fighting')).length;
            if (count < 10) fail(ctx);
        },
        after: ctx => snipe(ctx, ctx.game.inPlay(ctx.opponent), 140),
        expected: ctx => (ctx.player.discard.filter(inst => isBasicEnergy(ctx.game.cardOf(inst), 'fighting')).length >= 10 ? 140 : 0)
    },
    'ロケット団のドンカラス/ロケットフェザー': handCardsTimes({ per: 60, filter: card => isSupporter(card) && card.name.includes('ロケット団'), title: 'トラッシュする「ロケット団」のサポートを選ぶ（1枚につき60ダメージ）' }),
    'ゴロンダ/おやぶんパンチ': bonusIf(120, ctx => ctx.player.bench.some(pk => ctx.game.topCard(pk).name === 'ヤンチャム' && pk.damage > 0)),
    'アゲハント/エナジーストロー': {
        before: ctx => {
            const { game, player, opponent } = ctx;
            game.revealHand(opponent, player);
            ctx.damage = opponent.hand.filter(inst => game.cardOf(inst).kind === 'energy').length * 80;
        },
        // CPU は相手の手札を見ずに見積もる
        expected: ctx => Math.floor(ctx.opponent.hand.length / 4) * 80
    },
    'メガシビルドンex/ディザスターショック': {
        after: ctx => {
            const { game, player, attacker, defender } = ctx;
            if (typedEnergies(game, attacker, 'lightning').length < 2) return;
            game.promptConfirm({
                player,
                title: 'このポケモンの雷エネルギーを2個トラッシュして、相手のバトルポケモンをマヒにしますか？',
                purpose: 'optional-effect',
                cpuAnswer: g => Boolean(defender) && remainingHp(g, defender) > 0,
                callback: yes => {
                    if (!yes) return;
                    chooseEnergies(ctx, attacker, {
                        filter: inst => providesType(game, attacker, inst, 'lightning'),
                        min: 2,
                        max: 2,
                        title: 'トラッシュする雷エネルギーを2個選ぶ',
                        callback: selected => {
                            selected.forEach(inst => game.moveCard(attacker.energies, player.discard, inst));
                            game.log(`${game.topCard(attacker).name}のエネルギーを2個トラッシュした`);
                            if (canAffect(ctx, defender)) game.addCondition(defender, 'paralyzed');
                        }
                    });
                }
            });
        }
    },
    'メガディアンシーex/ガーランドレイ': discardOwnEnergyTimes({ per: 120, max: 2, filter: () => true }),
    'シェイミ/はなをとどける': {
        after: ctx => attachFromDeck(ctx, { filter: card => card.kind === 'energy', max: 1, where: pk => pk !== ctx.player.active })
    },
    'ジャローダ/ソーラーワインダー': bonusIf(150, ctx => ctx.player.discard.some(inst => ctx.game.cardName(inst) === 'メイのはげまし')),
    'クチート/ダブルイーター': handCardsTimes({ per: 60, max: 2, filter: card => card.kind === 'energy', title: 'トラッシュするエネルギーを2枚まで選ぶ（1枚につき60ダメージ）' }),
    'カバルドン/たつまきふんしゃ': {
        after: ctx => { if (ctx.game.turnState.supporterNames.includes('タラゴン')) ctx.game.millDeck(ctx.opponent, 3); }
    },
    'カビゴン/おおぐい': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            const heads = flipUntilTails(game);
            if (heads === 0) return;
            game.searchDeck({
                player,
                filter: card => isBasicEnergy(card),
                max: heads,
                title: `このポケモンにつける基本エネルギーを${heads}枚まで選ぶ`,
                purpose: 'search-energy',
                onSelected: found => found.forEach(inst => game.attachFromOutside(attacker, inst))
            });
        }
    },
    'トリミアン/ハンドカット': {
        after: ctx => { if (ctx.opponent.hand.length > 5) ctx.game.discardRandomFromHand(ctx.opponent, ctx.opponent.hand.length - 5); }
    },
    'デデンネ/しっぽはつでん': {
        after: ctx => {
            const count = ctx.game.inPlay(ctx.opponent).reduce((sum, pk) => sum + pk.energies.length, 0);
            attachFromDiscard(ctx, { filter: card => isBasicEnergy(card), max: count, where: () => true, title: `つける基本エネルギーを${count}枚まで選ぶ` });
        }
    },
    'ニダンギル/ソードウェポン': handCardsTimes({ per: 60, filter: card => ['ヒトツキ', 'ニダンギル', 'ギルガルド'].includes(card.name), reveal: true, title: '見せる「ヒトツキ」「ニダンギル」「ギルガルド」を選ぶ（1枚につき60ダメージ）' }),
    'ラッタ/ぎゃくしゅうまえば': timesDamage(40, ctx => ctx.player.bench.filter(pk => ctx.game.topCard(pk).name === 'コラッタ').reduce((sum, pk) => sum + counters(pk), 0)),
    'イベルタルex/デスソウル': {
        after: ctx => ctx.game.inPlay(ctx.opponent).forEach(pk => {
            if (remainingHp(ctx.game, pk) <= 50 && canAffect(ctx, pk)) knockOut(ctx.game, pk);
        })
    },
    'メガエアームドex/ソニックリッパー': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            const count = attacker.energies.length;
            if (count > 0) {
                player.deck.push(...attacker.energies.splice(0));
                game.shuffleDeck(player);
                game.log(`${game.topCard(attacker).name}のエネルギーを${count}個山札にもどして切った`);
            }
            snipe(ctx, game.inPlay(ctx.opponent), 220);
        },
        expected: () => 220
    },
    'メガジガルデex/ムニキスゼロ': {
        after: ctx => ctx.game.inPlay(ctx.opponent).forEach(pk => {
            if (ctx.game.flipCoin()) ctx.game.dealAttackDamage(ctx, pk, 150);
        }),
        expected: () => 75
    },
    'マスキッパ/まるかじり': bonusIf(80, ctx => Boolean(ctx.defender) && ctx.game.retreatCost(ctx.defender) === 0),
    'キュウコン/きゅうびうつし': {
        after: ctx => moveAllCountersToDefender(ctx, () => true),
        expected: ctx => Math.max(0, ...ctx.player.bench.map(pk => pk.damage))
    },
    'ホウオウ/さいきのほのお': {
        after: ctx => {
            const { game, player } = ctx;
            const room = game.benchSize - player.bench.length;
            const candidates = player.discard.filter(inst => isBasicPokemon(game.cardOf(inst)));
            const n = Math.min(3, room, candidates.length);
            if (n <= 0) return;
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: n,
                title: 'トラッシュからベンチに出すたねポケモンを選ぶ',
                purpose: 'bench-basic',
                callback: selected => selected.forEach(inst => {
                    game.removeCard(player.discard, inst);
                    player.bench.push(game.createPokemon(inst));
                    game.log(`${player.name}は${game.cardName(inst)}をトラッシュからベンチに出した`);
                })
            });
        }
    },
    'マフォクシー/エナジーストーム': timesDamage(30, ctx => [...ctx.game.inPlay(ctx.player), ...ctx.game.inPlay(ctx.opponent)].reduce((sum, pk) => sum + pk.energies.length, 0)),
    'オクタン/すみふんしゃ': {
        after: ctx => {
            const { defender } = ctx;
            if (!canAffect(ctx, defender)) return;
            lastingEffect(ctx, defender, 'inkSpray', active => ({
                beforeAttack: (game, source, actx) => {
                    if (actx.attacker !== defender || !active(game)) return;
                    const heads = flipCoins(game, 2);
                    if (heads < 2) fail(actx);
                }
            }));
        }
    },
    'デリバード/ハッピープレゼント': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            // 相手から行う
            const step = who => () => {
                const energies = who.hand.filter(inst => isBasicEnergy(game.cardOf(inst)));
                if (energies.length === 0 || game.inPlay(who).length === 0) return;
                game.promptCards({
                    player: who,
                    cards: energies,
                    min: 0,
                    max: Math.min(3, energies.length),
                    title: '自分のポケモンにつける基本エネルギーを3枚まで選ぶ（つけないなら選ばない）',
                    purpose: 'happy-present',
                    cpuAnswer: (g, prompt) => indicesUpTo(prompt.max),
                    callback: selected => {
                        selected.forEach(inst => game.removeCard(who.hand, inst));
                        game.attachAnyWay(who, selected, () => true, 'attach-energy-target');
                    }
                });
            };
            game.runNext(step(opponent), step(player));
        }
    },
    'クレベース/ひょうざんくずし': millTimes({ count: 6, per: 60, filter: card => isBasicEnergy(card, 'water'), guess: 2 }),
    'デオキシス/サイコスピア': {
        after: ctx => {
            if (ctx.game.energyUnits(ctx.attacker).length < ctx.attack.cost.length + 2) return;
            snipe(ctx, ctx.opponent.bench, 120);
        }
    },
    'デオキシス/サイコプロテクト': { after: preventDamageFrom('psychoProtect', (game, attacker) => hasAbility(game, attacker)) },
    'ニャスパー/バディアタック': bonusIf(60, ctx => ctx.game.turnState.supporterNames.includes('マチエール')),
    'ニャオニクス/トリックステップ': { after: optionalMoveOpponentEnergy },
    'メタグロス/メタリックハンマー': optionalEnergyBonus({ bonus: 150, count: 3, type: 'metal', title: 'このポケモンの鋼エネルギーを3個トラッシュして、150ダメージ追加しますか？' }),
    'ネンドール/たいかこうせん': {
        after: ctx => {
            const { game, opponent, defender } = ctx;
            if (!canAffect(ctx, defender) || defender.cards.length < 2 || game.topCard(defender).stage === 0) return;
            const top = defender.cards.pop();
            opponent.hand.push(top);
            game.clearConditions(defender);
            defender.evolvedFrom = null;
            game.log(`${game.cardName(top)}をはがして${game.topCard(defender).name}に退化させ、相手の手札にもどした`);
        }
    },
    'ケンタロス/むれでねらう': {
        after: ctx => {
            const { game, player } = ctx;
            const count = game.inPlay(player).filter(pk => pokemonNamed(game, pk, 'ケンタロス')).length;
            choosePokemon(game, {
                player,
                pokemon: game.inPlay(ctx.opponent),
                title: 'ダメージを与えるポケモンを選ぶ',
                purpose: 'snipe-target',
                amount: count * 25,
                callback: target => {
                    const heads = flipCoins(game, count);
                    if (heads > 0) game.dealAttackDamage(ctx, target, heads * 50);
                }
            });
        },
        expected: ctx => ctx.game.inPlay(ctx.player).filter(pk => pokemonNamed(ctx.game, pk, 'ケンタロス')).length * 25
    },
    'ミルホッグ/ぬきうちチェック': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const heads = flipCoins(game, 3);
            if (heads === 0 || opponent.hand.length === 0) return;
            game.revealHand(opponent, player);
            const n = Math.min(heads, opponent.hand.length);
            game.promptCards({
                player,
                cards: opponent.hand,
                min: n,
                max: n,
                title: `相手の山札にもどすカードを${n}枚選ぶ`,
                purpose: 'discard-opponent-hand',
                callback: selected => {
                    selected.forEach(inst => game.moveCard(opponent.hand, opponent.deck, inst));
                    game.shuffleDeck(opponent);
                    game.log(`${opponent.name}の手札の${names(game, selected)}を山札にもどして切った`);
                }
            });
        }
    },
    'パンプジンex/ホラーロンド': timesDamage(50, ctx => ctx.player.bench.filter(pk => pk.damage > 0).length, { add: true }),
    'メガフラエッテex/やさしいひかり': {
        after: ctx => {
            ctx.game.inPlay(ctx.player).forEach(pk => ctx.game.heal(pk, 30));
            ctx.game.inPlay(ctx.opponent).forEach(pk => { if (canAffect(ctx, pk)) ctx.game.heal(pk, 30); });
        }
    },
    'メガドラミドロex/ふしょくえき': {
        after: ctx => ctx.game.inPlay(ctx.opponent).forEach(pk => {
            const { game, opponent } = ctx;
            if (!canAffect(ctx, pk)) return;
            if (pk.tool) game.discardTool(pk);
            const special = pk.energies.filter(inst => !game.cardOf(inst).basic);
            special.forEach(inst => game.moveCard(pk.energies, opponent.discard, inst));
            if (special.length) game.log(`${game.topCard(pk).name}の特殊エネルギーを${special.length}個トラッシュした`);
        })
    },
    'メガゲッコウガex/ニンジャスピナー': optionalEnergyBonus({ bonus: 80, count: 1, type: 'water', to: 'hand', title: 'このポケモンの水エネルギーを1個手札にもどして、80ダメージ追加しますか？' }),
    'トロピウス/かじつのかおり': {
        after: ctx => {
            const { game, player } = ctx;
            const top = player.deck.slice(0, 6);
            game.log(`${player.name}は山札を上から${top.length}枚見た`);
            game.log(`山札の上：${names(game, top)}`, { to: player.id });
            const candidates = top.filter(inst => game.cardOf(inst).kind === 'pokemon');
            const finish = selected => {
                selected.forEach(inst => game.removeCard(player.deck, inst));
                game.addToHand(player, selected, { reveal: true });
                game.shuffleDeck(player);
            };
            if (candidates.length === 0) {
                finish([]);
                return;
            }
            game.promptCards({ player, cards: candidates, min: 0, max: candidates.length, title: '手札に加えるポケモンを選ぶ', purpose: 'search-card', callback: finish });
        }
    },
    'ヒードラン/ようがんウォール': { after: preventDamageFrom('lavaWall', (game, attacker) => game.hasCondition(attacker, 'burned')) },
    'ヤクデ/バグパニック': BUG_PANIC,
    'ミツハニー/バグパニック': BUG_PANIC,
    'イトマル/バグパニック': BUG_PANIC,
    'アメモース/バグパニック': BUG_PANIC,
    'アズマオウ/ハイドロショット': {
        after: ctx => snipe(ctx, ctx.game.inPlay(ctx.opponent), typedEnergies(ctx.game, ctx.attacker, 'water').length * 30),
        expected: ctx => typedEnergies(ctx.game, ctx.attacker, 'water').length * 30
    },
    'ジーランス/フォッシルビート': timesDamage(30, ctx => ctx.player.bench.filter(pk => pokemonNamed(ctx.game, pk, '古びた')).length, { add: true }),
    'イルカマン/ジャスティスナックル': bonusIf(200, ctx => ctx.opponent.prizes.length === 1),
    'クワガノン/ギガレールガン': failIf(ctx => !ctx.attacker.energies.some(inst => ctx.game.cardName(inst) === 'ボルト雷エネルギー')),
    'ヤドン/すてほうだい': {
        after: ctx => {
            const { game, player } = ctx;
            if (player.hand.length === 0) return;
            game.promptCards({
                player,
                cards: player.hand,
                min: 0,
                max: player.hand.length,
                title: 'トラッシュする手札を選ぶ（好きなだけ）',
                purpose: 'discard-any-hand',
                callback: selected => {
                    selected.forEach(inst => game.moveCard(player.hand, player.discard, inst));
                    if (selected.length) game.log(`${player.name}は手札の${names(game, selected)}をトラッシュした`);
                }
            });
        }
    },
    'ルージュラ/きょうれつキッス': { after: discardAtNextTurnEnd },
    'ミカルゲ/たましいエンド': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            if (hiddenCount(game, player) < 13) return;
            const targets = game.inPlay(opponent);
            const n = Math.min(2, targets.length);
            const quadruple = selected => selected.forEach(pk => { if (pk.damage > 0 && canAffect(ctx, pk)) game.putDamage(pk, counters(pk) * 30); });
            if (n === targets.length) {
                quadruple(targets);
                return;
            }
            game.promptPokemon({
                player,
                pokemon: targets,
                min: n,
                max: n,
                title: 'ダメカンを4倍にするポケモンを2匹選ぶ',
                purpose: 'multiply-counters',
                cpuAnswer: () => targets.map((pk, index) => ({ pk, index })).sort((a, b) => b.pk.damage - a.pk.damage).slice(0, n).map(entry => entry.index).sort((a, b) => a - b),
                callback: quadruple
            });
        }
    },
    'コノヨザル/ゴーストブロー': {
        after: ctx => {
            const targets = ctx.opponent.bench.filter(pk => canAffect(ctx, pk));
            choosePokemon(ctx.game, { player: ctx.player, pokemon: targets, title: 'ダメカンを5個のせるポケモンを選ぶ', purpose: 'snipe-target', amount: 50, callback: target => ctx.game.putDamage(target, 50) });
        }
    },
    'バルジーナ/ボーンスナイプ': {
        after: ctx => snipe(ctx, ctx.game.inPlay(ctx.opponent).filter(pk => pk.energies.some(inst => !ctx.game.cardOf(inst).basic)), 70),
        expected: ctx => (ctx.game.inPlay(ctx.opponent).some(pk => pk.energies.some(inst => !ctx.game.cardOf(inst).basic)) ? 70 : 0)
    },
    'マフィティフ/とびこみヘッド': {
        after: ctx => ctx.game.addEffect(ctx.attacker, 'damageIncrease', ctx.game.turn + 1, { amount: 100 })
    },
    'イーユイ/うずまくねたみ': {
        before: ctx => {
            ctx.ignoreWeakness = true;
            if (counters(ctx.attacker) >= 2) ctx.damage += 90;
        },
        expected: ctx => ctx.damage + (counters(ctx.attacker) >= 2 ? 90 : 0)
    },
    'エアームド/スチールカッター': handCardsTimes({ per: 40, max: 2, filter: card => isBasicEnergy(card, 'metal'), title: 'トラッシュする基本鋼エネルギーを2枚まで選ぶ（1枚につき40ダメージ）' }),
    'ドータクン/メタルブロック': {
        after: ctx => lastingEffect(ctx, ctx.attacker, 'metalBlock', active => ({
            damageTaken: (game, source, actx, target) => (target === ctx.attacker && active(game) && !actx.ignoreEffects
                && game.ownerOf(target) !== actx.player && game.topCard(actx.attacker).stage > 0 ? -100 : 0)
        }))
    },
    'ケララッパ/そらをとぶ': flyAttack(),
    'ハトーボー/そらをとぶ': flyAttack(),
    'オトシドリ/おとどけチャレンジ': {
        after: ctx => { if (flipCoins(ctx.game, 2) === 2) ctx.game.benchFromDeck(ctx.player, isBasicPokemon, 1, 'bench-basic'); }
    },
    'グレンアルマ/フレイムレギオン': timesDamage(40, ctx => ctx.player.bench.filter(pk => typedEnergies(ctx.game, pk, 'fire').length > 0).length, { add: true }),
    'ライボルト/フラッシュバリア': { after: preventDamageFrom('flashBarrier', (game, attacker) => game.topCard(attacker).stage > 0) },
    'ヤドラン/スッカラカン': bonusIf(160, ctx => ctx.player.hand.length === 0),
    'ダダリン/むねんのイカリ': bonusIf(140, ctx => hiddenCount(ctx.game, ctx.player) >= 4),
    'フォクスライ/スキルシーフ': {
        before: ctx => {
            const { game, player, opponent } = ctx;
            if (player.hand.length > 0) return;
            const cards = game.inPlay(opponent).map(pk => game.topCard(pk));
            chooseAttack(ctx, attackEntries(game, cards), { optional: false, title: 'このワザとして使う、相手のポケモンのワザを選ぶ' });
        },
        after: copiedAfter,
        expected: ctx => (ctx.player.hand.length > 0 ? 0
            : Math.max(0, ...ctx.game.inPlay(ctx.opponent).flatMap(pk => ctx.game.topCard(pk).attacks.map(attack => attack.damage))))
    },
    'ザルード/シャドーウィップ': bonusIf(70, ctx => ctx.player.bench.some(pk => pk.energies.some(inst => ctx.game.cardName(inst) === 'シャドー悪エネルギー'))),
    'メガダークライex/アビスアイ': {
        after: ctx => { if (canAffect(ctx, ctx.defender) && ctx.game.hasAnyCondition(ctx.defender)) knockOut(ctx.game, ctx.defender); },
        expected: ctx => (ctx.defender && ctx.game.hasAnyCondition(ctx.defender) ? remainingHp(ctx.game, ctx.defender) : 0)
    },
    'ノクタス/パニッシュニードル': timesDamage(50, ctx => ctx.game.inPlay(ctx.opponent).filter(pk => hasAbility(ctx.game, pk)).length, { add: true }),
    'マンタイン/なみをおこす': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            game.shuffleHandIntoDeck(player);
            game.shuffleHandIntoDeck(opponent);
            game.draw(player, 4);
            game.draw(opponent, 4);
        }
    },
    'ギラティナ/カオスクローラー': {
        canUse: (game, player) => player.chaosCrawlerTurn !== game.turn - 2,
        after: ctx => {
            ctx.player.chaosCrawlerTurn = ctx.game.turn;
            ctx.game.addEffect(ctx.attacker, 'preventDamage', ctx.game.turn + 1);
        }
    },
    'ヤミラミ/おびきだす': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const top = opponent.deck.slice(0, 5);
            if (top.length === 0) return;
            game.log(`${opponent.name}の山札を上から${top.length}枚オモテにした（${names(game, top)}）`);
            const candidates = top.filter(inst => isBasicPokemon(game.cardOf(inst)));
            const room = game.benchSize - opponent.bench.length;
            const finish = selected => {
                selected.forEach(inst => {
                    game.removeCard(opponent.deck, inst);
                    opponent.bench.push(game.createPokemon(inst));
                    game.log(`${opponent.name}のベンチに${game.cardName(inst)}を出した`);
                });
                game.shuffleDeck(opponent);
            };
            if (candidates.length === 0 || room <= 0) {
                finish([]);
                return;
            }
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: Math.min(room, candidates.length),
                title: '相手のベンチに出すたねポケモンを選ぶ',
                purpose: 'lure-basic',
                cpuAnswer: (g, prompt) => indicesUpTo(prompt.max),
                callback: finish
            });
        }
    },
    'カイオーガ/あらぶるうず': {
        after: ctx => {
            if (!stadiumNameIncludes(ctx.game, '伝説')) return;
            ctx.opponent.bench.forEach(pk => ctx.game.dealAttackDamage(ctx, pk, 50));
        }
    },
    'エレキブル/ボルテージハンマー': discardOwnEnergyTimes({ per: 60, filter: (game, pokemon, inst) => game.cardOf(inst).basic }),
    'グラードン/あらぶるだいち': bonusIf(170, ctx => stadiumNameIncludes(ctx.game, '伝説')),
    'カクレオン/カラフルウィップ': {
        before: ctx => {
            const { game, player } = ctx;
            const candidates = player.hand.filter(inst => game.cardOf(inst).kind === 'pokemon');
            ctx.damage = 0;
            if (candidates.length === 0) return;
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: candidates.length,
                title: '見せるポケモンを選ぶ（タイプ1つにつき30ダメージ）',
                purpose: 'reveal-hand',
                cpuAnswer: () => indicesUpTo(candidates.length),
                callback: selected => {
                    game.log(`${player.name}は手札の${names(game, selected) || 'なし'}を見せた`);
                    ctx.damage = new Set(selected.map(inst => game.cardOf(inst).type)).size * 30;
                }
            });
        },
        expected: ctx => new Set(ctx.player.hand.map(inst => ctx.game.cardOf(inst)).filter(card => card.kind === 'pokemon').map(card => card.type)).size * 30
    },
    'ヒートロトムex/さいかねつ': revealDiscardTimes({ per: 30, filter: card => isBasicEnergy(card, 'fire') }),
    'メガレックウザex/ストームエメラルダ': timesDamage(50, ctx => ctx.game.inPlay(ctx.player).reduce((sum, pk) => sum
        + pk.energies.filter(inst => providesType(ctx.game, pk, inst, 'fire') || providesType(ctx.game, pk, inst, 'lightning')).length, 0)),
    'オドリドリ/エネアシスト': {
        after: ctx => {
            const { game, player } = ctx;
            if (player.bench.length === 0) return;
            const candidates = player.discard.filter(inst => isBasicEnergy(game.cardOf(inst)));
            if (candidates.length === 0) return;
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: Math.min(2, candidates.length),
                title: 'ベンチポケモン1匹につける基本エネルギーを2枚まで選ぶ',
                purpose: 'energy-retrieval',
                callback: selected => {
                    if (selected.length === 0) return;
                    choosePokemon(game, {
                        player,
                        pokemon: player.bench,
                        title: 'エネルギーをつけるベンチポケモンを選ぶ',
                        purpose: 'attach-energy-target',
                        callback: target => selected.forEach(inst => {
                            game.removeCard(player.discard, inst);
                            game.attachFromOutside(target, inst);
                        })
                    });
                }
            });
        }
    },
    'トゲデマルex/トゲトゲローリング': {
        before: ctx => {
            if (ctx.attacker.spikyRollingTurn === ctx.game.turn - 2) ctx.damage += 80;
            ctx.attacker.spikyRollingTurn = ctx.game.turn;
        },
        expected: ctx => ctx.damage + (ctx.attacker.spikyRollingTurn === ctx.game.turn - 2 ? 80 : 0)
    },
    'アオキのムクホーク/からげんき': bonusIf(100, ctx => ctx.game.hasCondition(ctx.attacker, 'poisoned') || ctx.game.hasCondition(ctx.attacker, 'burned')),
    'メガタブンネex/カレイドワルツ': {
        after: ctx => {
            const heads = flipCoins(ctx.game, 3);
            if (heads === 0) return;
            attachFromDeck(ctx, { filter: card => isBasicEnergy(card), max: heads * 2, where: () => true });
        }
    },
    'ウパー/みずくみ': {
        after: ctx => {
            const { game, player } = ctx;
            const candidates = player.discard.filter(inst => isBasicEnergy(game.cardOf(inst), 'water'));
            if (candidates.length === 0) return;
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: Math.min(3, candidates.length),
                title: '山札にもどす基本水エネルギーを3枚まで選ぶ',
                purpose: 'energy-retrieval',
                callback: selected => {
                    selected.forEach(inst => game.moveCard(player.discard, player.deck, inst));
                    game.shuffleDeck(player);
                    if (selected.length) game.log(`${player.name}はトラッシュの${names(game, selected)}を見せて、山札にもどして切った`);
                }
            });
        }
    },
    'ヌオー/ずぶぬれヘッド': millTimes({ count: 3, per: 80, filter: card => card.kind === 'energy', guess: 1 }),
    'パチリス/ぱちぱちチャージ': {
        after: ctx => {
            const heads = flipCoins(ctx.game, 3);
            attachFromDiscard(ctx, { filter: card => isBasicEnergy(card, 'lightning'), max: heads, where: pk => pk !== ctx.player.active, title: `ベンチにつける基本雷エネルギーを${heads}枚まで選ぶ` });
        }
    },
    'ズルズキン/かっぱらう': {
        after: ctx => {
            const max = ctx.player.bench.length;
            if (max === 0) return;
            ctx.game.searchDeck({
                player: ctx.player,
                filter: () => true,
                max,
                title: `手札に加えるカードを${max}枚まで選ぶ`,
                purpose: 'search-card',
                onSelected: found => ctx.game.addToHand(ctx.player, found)
            });
        }
    },
    'ミガルーサex/パージストライク': {
        before: ctx => {
            const { game, player } = ctx;
            if (player.hand.length === 0) return;
            game.promptConfirm({
                player,
                title: '手札をすべてトラッシュして、120ダメージ追加しますか？',
                purpose: 'optional-bonus',
                cpuAnswer: g => cpuBonusKnocksOut(g, ctx, 120),
                callback: yes => {
                    if (!yes) return;
                    game.discardHand(player);
                    ctx.damage += 120;
                }
            });
        },
        expected: ctx => ctx.damage + (ctx.player.hand.length > 0 ? 120 : 0)
    },
    'アローラ ナッシーex/トロピカルフィーバー': {
        after: ctx => {
            const { game, player } = ctx;
            const energies = player.hand.filter(inst => isBasicEnergy(game.cardOf(inst)));
            if (energies.length === 0) return;
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: energies.length,
                title: '自分のポケモンにつける基本エネルギーを選ぶ（好きなだけ）',
                purpose: 'attach-from-hand',
                cpuAnswer: () => indicesUpTo(energies.length),
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.hand, inst));
                    game.attachAnyWay(player, selected, () => true, 'attach-energy-target');
                }
            });
        }
    },
    'アローラ ナッシーex/ブンブンスフェーン': {
        after: ctx => {
            const { game, opponent, defender } = ctx;
            if (game.flipCoin()) {
                if (canAffect(ctx, defender) && game.topCard(defender).stage === 0) knockOut(game, defender);
                return;
            }
            chooseAndKnockOut(ctx, opponent.bench.filter(pk => game.topCard(pk).stage === 0));
        }
    },
    'ベラカスex/さかさまドロー': {
        after: ctx => {
            const { game, player } = ctx;
            const drawn = player.deck.splice(Math.max(0, player.deck.length - 3));
            player.hand.push(...drawn);
            if (drawn.length === 0) return;
            game.log(`${player.name}は山札の下からカードを${drawn.length}枚引いた`);
            game.log(`${names(game, drawn)}を引いた`, { to: player.id });
        }
    },
    'カバルドン/おおすなあらし': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const theirs = opponent.bench.filter(pk => pk.damage > 0);
            const ours = player.bench.filter(pk => pk.damage > 0);
            theirs.forEach(pk => game.dealAttackDamage(ctx, pk, 40));
            ours.forEach(pk => game.putDamage(pk, 40));
        }
    },
    'イーブイ/カラフルキャッチ': {
        after: ctx => {
            const { game, player } = ctx;
            const chosen = [];
            const pick = () => {
                if (chosen.length >= 3) return finish();
                const types = new Set(chosen.map(inst => game.cardOf(inst).energyType));
                const candidates = player.deck.filter(inst => isBasicEnergy(game.cardOf(inst)) && !types.has(game.cardOf(inst).energyType) && !chosen.includes(inst));
                if (candidates.length === 0) return finish();
                game.promptCards({
                    player,
                    cards: candidates,
                    min: 0,
                    max: 1,
                    title: `手札に加える基本エネルギーを選ぶ（ちがうタイプで3枚まで。あと${3 - chosen.length}枚）`,
                    purpose: 'search-card',
                    callback: ([inst]) => {
                        if (!inst) return finish();
                        chosen.push(inst);
                        game.runNext(pick);
                    }
                });
            };
            const finish = () => {
                chosen.forEach(inst => game.removeCard(player.deck, inst));
                game.addToHand(player, chosen, { reveal: true });
                game.shuffleDeck(player);
            };
            pick();
        }
    },
    'リーリエのキュワワー/はなまねき': {
        after: ctx => ctx.game.benchFromDeck(ctx.player, card => isBasicPokemon(card) && card.name.startsWith('リーリエの'), ctx.game.benchSize, 'bench-basic')
    },
    'ハッサムex/クロスブレイカー': discardOwnEnergyTimes({ per: 120, max: 2, filter: (game, pokemon, inst) => providesType(game, pokemon, inst, 'metal') }),
    'ロケット団のニャース/ねこばば': { after: ctx => returnRandomFromHand(ctx.game, ctx.opponent, 1) },
    'ロケット団のガルーラex/バッドインパクト': bonusIf(100, ctx => ctx.game.turnState.supporterNames.some(name => name.includes('ロケット団'))),
    'ビクティニ/Vフォース': failIf(ctx => ctx.player.bench.length <= 4),
    'ラランテス/はなきりまい': discardFromHandOrFail({ count: 2, filter: card => isBasicEnergy(card, 'grass'), title: 'トラッシュする基本草エネルギーを2枚選ぶ' }),
    'ロケット団のサッチムシ/サーチアイ': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            if (opponent.prizes.length === 0) return;
            game.promptChoose({
                player,
                options: opponent.prizes.map((_, index) => `${index + 1}枚目`),
                title: 'オモテを見る相手のサイドを選ぶ',
                purpose: 'look-prize',
                callback: ([index]) => {
                    game.log(`${player.name}は${opponent.name}のサイドを1枚見た`);
                    game.log(`相手のサイドの${index + 1}枚目：${game.cardName(opponent.prizes[index])}`, { to: player.id });
                }
            });
        }
    },
    'サクラビス/クレシェンドウェーブ': {
        before: ctx => {
            const { game, player, attacker } = ctx;
            const count = () => { ctx.damage = typedEnergies(game, attacker, 'water').length * 30; };
            const energies = player.hand.filter(inst => isBasicEnergy(game.cardOf(inst), 'water'));
            if (energies.length === 0) {
                count();
                return;
            }
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: energies.length,
                title: 'このポケモンにつける基本水エネルギーを選ぶ（つけないなら選ばない）',
                purpose: 'attach-from-hand',
                cpuAnswer: () => indicesUpTo(energies.length),
                callback: selected => {
                    selected.forEach(inst => {
                        game.removeCard(player.hand, inst);
                        game.attachFromOutside(attacker, inst);
                    });
                    count();
                }
            });
        },
        expected: ctx => (typedEnergies(ctx.game, ctx.attacker, 'water').length
            + ctx.player.hand.filter(inst => isBasicEnergy(ctx.game.cardOf(inst), 'water')).length) * 30
    },
    'ユキノオー/ひょうけつウッド': bonusIf(120, ctx => typedEnergies(ctx.game, ctx.attacker, 'grass').length >= 2),
    'ロケット団のサンダー/ジャミングウイング': { after: optionalMoveOpponentEnergy },
    'ロケット団のスリーパー/ベンチをあやつる': {
        before: ctx => {
            ctx.ignoreWeakness = true;
            ctx.ignoreResistance = true;
            const times = ctx.opponent.bench.length;
            ctx.damage = (times - flipCoins(ctx.game, times)) * 80;
        },
        expected: ctx => ctx.opponent.bench.length * 40
    },
    'ロケット団のレドームシ/かくらんレーダー': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const n = Math.min(5, opponent.deck.length);
            if (n === 0) return;
            const rest = opponent.deck.slice(0, n);
            game.log(`${player.name}は${opponent.name}の山札を上から${n}枚見た`);
            const order = [];
            const pick = () => {
                if (rest.length <= 1) {
                    order.push(...rest);
                    opponent.deck.splice(0, n, ...order);
                    game.log(`${opponent.name}の山札の上を入れ替えた`);
                    return;
                }
                game.promptCards({
                    player,
                    cards: rest,
                    min: 1,
                    max: 1,
                    title: `相手の山札の上から${order.length + 1}枚目にするカードを選ぶ`,
                    purpose: 'order-deck',
                    callback: ([inst]) => {
                        order.push(inst);
                        game.removeCard(rest, inst);
                        game.runNext(pick);
                    }
                });
            };
            pick();
        }
    },
    'ロケット団のニドリーナ/あくのめざめ': {
        after: ctx => {
            const { game, player } = ctx;
            const candidates = game.inPlay(player).filter(pk => game.topCard(pk).type === 'darkness' && hasEvolutionInDeck(game, player, pk));
            if (candidates.length === 0) {
                game.shuffleDeck(player);
                return;
            }
            game.promptPokemon({
                player,
                pokemon: candidates,
                min: 0,
                max: Math.min(2, candidates.length),
                title: '進化させる悪ポケモンを2匹まで選ぶ',
                purpose: 'evolve-from-deck',
                cpuAnswer: (g, prompt) => indicesUpTo(prompt.max),
                callback: selected => game.runNext(...selected.map(pk => () => evolveFromDeck(game, player, pk)))
            });
        }
    },
    'ロケット団のニドクイン/ラブインパクト': bonusIf(120, ctx => ctx.player.bench.some(pk => pokemonNamed(ctx.game, pk, 'ニドキング'))),
    'ロケット団のベトベター/しんしょくヘドロ': { after: discardAtNextTurnEnd },
    'ロケット団のニューラ/ねくびをかく': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const targets = opponent.bench;
            choosePokemon(game, {
                player,
                pokemon: targets,
                title: 'ダメージを与える相手のベンチポケモンを選ぶ',
                purpose: 'snipe-by-counters',
                cpuAnswer: () => [targets.reduce((best, pk, index) => (pk.damage > targets[best].damage ? index : best), 0)],
                callback: target => { if (target.damage > 0) game.dealAttackDamage(ctx, target, counters(target) * 20); }
            });
        },
        expected: ctx => Math.max(0, ...ctx.opponent.bench.map(pk => counters(pk) * 20))
    },
    'フォレトス/アイアンシェイク': {
        after: ctx => {
            const { game, player } = ctx;
            const moved = new Set();
            const step = () => {
                const owners = new Map();
                game.inPlay(player).forEach(pk => typedEnergies(game, pk, 'metal').forEach(inst => { if (!moved.has(inst)) owners.set(inst, pk); }));
                const list = [...owners.keys()];
                if (list.length === 0 || game.inPlay(player).length < 2) return;
                game.promptCards({
                    player,
                    cards: list,
                    min: 0,
                    max: 1,
                    title: 'つけ替える鋼エネルギーを選ぶ（終わるなら選ばない）',
                    purpose: 'move-own-energy',
                    callback: ([inst]) => {
                        if (!inst) return;
                        const source = owners.get(inst);
                        choosePokemon(game, {
                            player,
                            pokemon: game.inPlay(player).filter(pk => pk !== source),
                            title: 'エネルギーをつけ替えるポケモンを選ぶ',
                            purpose: 'energy-switch-target',
                            callback: target => {
                                game.moveEnergy(source, target, inst);
                                moved.add(inst);
                                game.runNext(step);
                            }
                        });
                    }
                });
            };
            step();
        }
    },
    'ロケット団のポリゴン/ハッキング': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const discardOne = (who, title) => () => {
                if (who.hand.length === 0) return;
                game.promptCards({
                    player: who,
                    cards: who.hand,
                    min: 1,
                    max: 1,
                    title,
                    purpose: 'ultra-ball-discard',
                    callback: selected => {
                        selected.forEach(inst => game.moveCard(who.hand, who.discard, inst));
                        game.log(`${who.name}は${names(game, selected)}をトラッシュした`);
                    }
                });
            };
            game.runNext(discardOne(player, 'トラッシュする手札を1枚選ぶ'), discardOne(opponent, 'トラッシュする手札を1枚選ぶ'));
        }
    },
    'ロケット団のポリゴン2/Rコマンド': rocketCommand(),
    'ロケット団のポリゴンZ/Rコマンド': rocketCommand(),
    'イキリンコ/つきとばす': {
        after: ctx => {
            const { game, player, opponent, defender } = ctx;
            if (opponent.bench.length === 0 || !canAffect(ctx, defender)) return;
            game.promptConfirm({
                player,
                title: '相手のバトルポケモンをベンチポケモンと入れ替えますか？（出すポケモンは相手が選ぶ）',
                purpose: 'optional-effect',
                cpuAnswer: () => true,
                callback: yes => {
                    if (!yes) return;
                    game.promptPokemon({
                        player: opponent,
                        pokemon: opponent.bench,
                        min: 1,
                        max: 1,
                        title: 'バトル場に出すポケモンを選ぶ',
                        purpose: 'forced-switch',
                        callback: ([target]) => game.switchActive(opponent, target)
                    });
                }
            });
        }
    },
    'ロケット団のソーナンス/ロケットミラー': {
        after: ctx => moveAllCountersToDefender(ctx, card => card.name.startsWith('ロケット団の')),
        expected: ctx => Math.max(0, ...ctx.player.bench.filter(pk => ctx.game.topCard(pk).name.startsWith('ロケット団の')).map(pk => pk.damage))
    },
    'ロケット団のマタドガス/いっせいばくはつ': timesDamage(40, ctx => [...ctx.game.inPlay(ctx.player), ...ctx.game.inPlay(ctx.opponent)]
        .filter(pk => pokemonNamed(ctx.game, pk, 'ドガース') || pokemonNamed(ctx.game, pk, 'マタドガス')).length),
    'ザマゼンタ/ストロングバッシュ': {
        after: ctx => lastingEffect(ctx, ctx.attacker, 'strongBash', active => ({
            onDamaged: (game, source, actx, target, damage) => {
                if (target !== ctx.attacker || !active(game) || !actx.attacker || !game.ownerOf(actx.attacker)) return;
                game.putDamage(actx.attacker, damage);
            }
        }))
    },
    'ロケット団のラッタ/むこうみず': {
        after: ctx => { if (flipCoins(ctx.game, 2) === 0) ctx.game.putDamage(ctx.attacker, 90); }
    },
    'オリーヴァex/オイルマシンガン': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const times = new Map();
            const steps = Array.from({ length: 6 }, (_, index) => () => {
                const targets = game.inPlay(opponent);
                if (targets.length === 0) return;
                const add = target => times.set(target, (times.get(target) ?? 0) + 1);
                if (targets.length === 1) {
                    add(targets[0]);
                    return;
                }
                game.promptPokemon({ player, pokemon: targets, min: 1, max: 1, title: `ダメージを与えるポケモンを選ぶ（${index + 1}回目／6回）`, purpose: 'snipe-target', callback: ([target]) => add(target) });
            });
            const deal = () => {
                ctx.ignoreWeakness = true;
                ctx.ignoreResistance = true;
                times.forEach((count, target) => game.dealAttackDamage(ctx, target, count * 20));
            };
            game.runNext(...steps, deal);
        },
        expected: () => 120
    },
    'オリーヴァex/アロマシュート': {
        after: ctx => {
            const { attacker } = ctx;
            attacker.rotation = null;
            attacker.poisoned = false;
            attacker.poisonDamage = null;
            attacker.burned = false;
            ctx.game.log(`${ctx.game.topCard(attacker).name}の特殊状態が回復した`);
        }
    },
    'ロケット団のペルシアンex/こうまんしれい': {
        before: ctx => {
            const { game, opponent } = ctx;
            const top = opponent.deck.slice(0, 10);
            if (top.length === 0) return;
            game.log(`${opponent.name}の山札を上から${top.length}枚オモテにした（${names(game, top)}）`);
            ctx.revealedDeck = true;
            const cards = top.map(inst => game.cardOf(inst)).filter(card => card.kind === 'pokemon');
            chooseAttack(ctx, attackEntries(game, cards), { optional: true, title: 'このワザとして使うワザを選ぶ（使わないこともできる）' });
        },
        after: ctx => {
            if (!ctx.revealedDeck) return;
            ctx.game.runNext(() => copiedAfter(ctx), () => ctx.game.shuffleDeck(ctx.opponent));
        },
        expected: () => 0
    },
    'ロケット団のファイヤーex/イビルバーン': {
        after: ctx => {
            const { game, player, opponent, attacker, defender } = ctx;
            const rocket = attacker.energies.find(inst => game.cardName(inst) === 'ロケット団エネルギー');
            if (!rocket) return;
            game.moveCard(attacker.energies, player.discard, rocket);
            game.log(`${game.topCard(attacker).name}のロケット団エネルギーをトラッシュした`);
            if (!canAffect(ctx, defender)) return;
            game.log(`${game.topCard(defender).name}と、ついているすべてのカードをトラッシュした`);
            game.removeFromPlay(opponent, defender);
        },
        expected: ctx => (ctx.defender && ctx.attacker.energies.some(inst => ctx.game.cardName(inst) === 'ロケット団エネルギー') ? remainingHp(ctx.game, ctx.defender) : 0)
    },
    'ロケット団のミュウツーex/イレイザーボール': {
        before: ctx => {
            const { game, player } = ctx;
            const owners = new Map();
            player.bench.forEach(pk => pk.energies.forEach(inst => owners.set(inst, pk)));
            const list = [...owners.keys()];
            if (list.length === 0) return;
            const limit = Math.min(2, list.length);
            game.promptCards({
                player,
                cards: list,
                min: 0,
                max: limit,
                title: 'トラッシュするベンチポケモンのエネルギーを2個まで選ぶ（1個につき60ダメージ追加）',
                purpose: 'discard-own-energy',
                cpuAnswer: g => indicesUpTo(cpuCount(g, ctx, 60, limit, ctx.damage)),
                callback: selected => {
                    selected.forEach(inst => game.moveCard(owners.get(inst).energies, player.discard, inst));
                    if (selected.length) game.log(`${player.name}はベンチポケモンのエネルギーを${selected.length}個トラッシュした`);
                    ctx.damage += selected.length * 60;
                }
            });
        },
        expected: ctx => ctx.damage + Math.min(2, ctx.player.bench.reduce((sum, pk) => sum + pk.energies.length, 0)) * 60
    },
    'ロケット団のクロバットex/アサシンリターン': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            if (!game.inPlay(player).includes(attacker)) return;
            game.promptConfirm({
                player,
                title: 'このポケモンを手札にもどしますか？（ポケモン以外のカードはトラッシュ）',
                purpose: 'optional-return',
                cpuAnswer: () => false,
                callback: yes => {
                    if (!yes || !game.inPlay(player).includes(attacker)) return;
                    if (game.hookAny('blockReturnToHand', attacker)) {
                        game.log(`${game.topCard(attacker).name}は手札にもどらない`);
                        return;
                    }
                    const name = game.topCard(attacker).name;
                    if (player.active === attacker) player.active = null;
                    else game.removeCard(player.bench, attacker);
                    player.hand.push(...attacker.cards);
                    player.discard.push(...attacker.energies, ...(attacker.tool ? [attacker.tool] : []));
                    game.log(`${player.name}は${name}を手札にもどした`);
                }
            });
        }
    },
    'ドレディア/げんわくアロマ': {
        after: ctx => {
            const { game, defender } = ctx;
            const heads = game.flipCoin();
            if (!canAffect(ctx, defender)) return;
            if (heads) {
                game.addCondition(defender, 'poisoned');
                game.addCondition(defender, 'paralyzed');
            } else {
                game.addCondition(defender, 'confused');
            }
        }
    },
    'ヒトモシ/てらしてもやす': {
        after: ctx => {
            const { game, player } = ctx;
            const top = player.deck[0];
            if (!top) return;
            game.log(`${player.name}は山札を上から1枚見た`);
            game.log(`山札の上：${game.cardName(top)}`, { to: player.id });
            game.promptConfirm({
                player,
                title: `山札の上の${game.cardName(top)}をトラッシュしますか？`,
                purpose: 'optional-mill',
                cpuAnswer: () => false,
                callback: yes => { if (yes) game.millDeck(player, 1); }
            });
        }
    },
    'シャンデラ/はじけるひばしら': bonusIf(100, ctx => ctx.player.discard.filter(inst => isBasicEnergy(ctx.game.cardOf(inst))).length >= 10),
    'プロトーガ/たいこのもくず': timesDamage(30, ctx => ctx.opponent.discard.filter(inst => {
        const card = ctx.game.cardOf(inst);
        return card.kind === 'trainer' && card.trainerType === 'item';
    }).length),
    'ムシャーナ/ドリームコール': {
        after: ctx => ctx.game.searchDeck({
            player: ctx.player,
            filter: card => card.name === 'マコモ',
            max: Infinity,
            title: '手札に加える「マコモ」を選ぶ',
            purpose: 'search-card',
            onSelected: found => ctx.game.addToHand(ctx.player, found, { reveal: true })
        })
    },
    'ダブラン/さいぼうしんか': {
        after: ctx => {
            const { game, player } = ctx;
            const candidates = game.inPlay(player).filter(pk => hasEvolutionInDeck(game, player, pk));
            if (candidates.length === 0) {
                game.shuffleDeck(player);
                return;
            }
            choosePokemon(game, { player, pokemon: candidates, title: '進化させるポケモンを選ぶ', purpose: 'evolve-from-deck', cpuAnswer: () => [0], callback: target => evolveFromDeck(game, player, target) });
        }
    },
    'ランクルス/さいぼうかくせい': {
        after: ctx => {
            const { game, player } = ctx;
            const bench = player.bench.filter(pk => hasEvolutionInDeck(game, player, pk));
            if (bench.length === 0) {
                game.shuffleDeck(player);
                return;
            }
            game.runNext(...bench.map(pk => () => evolveFromDeck(game, player, pk)));
        }
    },
    'ランクルス/エボルラリアット': timesDamage(40, ctx => ctx.game.inPlay(ctx.player).filter(pk => ctx.game.topCard(pk).stage > 0).length, { add: true }),
    'リグレー/ちょっとずらす': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const targets = game.inPlay(opponent);
            if (targets.length < 2) return;
            const owners = new Map();
            targets.filter(pk => canAffect(ctx, pk)).forEach(pk => pk.energies.forEach(inst => owners.set(inst, pk)));
            const list = [...owners.keys()];
            if (list.length === 0) return;
            game.promptCards({
                player,
                cards: list,
                min: 1,
                max: 1,
                title: 'つけ替える相手のエネルギーを選ぶ',
                purpose: 'move-opponent-energy',
                cpuAnswer: () => {
                    const index = list.findIndex(inst => owners.get(inst) === opponent.active);
                    return [Math.max(0, index)];
                },
                callback: ([inst]) => {
                    const source = owners.get(inst);
                    const others = targets.filter(pk => pk !== source && game.inPlay(opponent).includes(pk));
                    choosePokemon(game, {
                        player,
                        pokemon: others,
                        title: 'エネルギーをつけ替える相手のポケモンを選ぶ',
                        purpose: 'move-opponent-energy-target',
                        cpuAnswer: () => [Math.max(0, others.findIndex(pk => pk !== opponent.active))],
                        callback: target => game.moveEnergy(source, target, inst)
                    });
                }
            });
        }
    },
    'オノノクス/アックスボンバー': {
        after: ctx => { if (canAffect(ctx, ctx.defender) && ctx.game.topCard(ctx.defender).stage === 0) knockOut(ctx.game, ctx.defender); },
        expected: ctx => (ctx.defender && ctx.game.topCard(ctx.defender).stage === 0 ? remainingHp(ctx.game, ctx.defender) : 0)
    },
    'キュレムex/ブリザードバースト': {
        after: ctx => {
            const amount = ctx.game.prizesTaken(ctx.opponent) * 10;
            if (amount > 0) ctx.opponent.bench.forEach(pk => ctx.game.dealAttackDamage(ctx, pk, amount));
        }
    },
    'ドリュウズex/かんつうドリル': {
        after: ctx => snipe(ctx, ctx.opponent.bench.filter(pk => pk.damage > 0), 60)
    },
    'ハハコモリ/いやしのおくるみ': {
        after: ctx => ctx.game.inPlay(ctx.player).forEach(pk => { if (ctx.game.topCard(pk).stage === 0) ctx.game.heal(pk, 100); })
    },
    'クイタラン/ベロベロキャッチ': {
        after: ctx => ctx.game.searchDeck({
            player: ctx.player,
            filter: card => (card.kind === 'pokemon' && card.type === 'fire') || isBasicEnergy(card, 'fire'),
            max: 3,
            title: '手札に加える炎ポケモンと基本炎エネルギーを選ぶ（合計3枚まで）',
            purpose: 'search-card',
            onSelected: found => ctx.game.addToHand(ctx.player, found, { reveal: true })
        })
    },
    'バスラオ/むらがるキバ': failIf(ctx => !ctx.defender || ctx.defender.damage === 0)
};

// コインを1回投げウラなら、このワザは失敗。オモテなら、次の相手の番、このポケモンはワザのダメージや効果を受けない
function flyAttack() {
    return {
        before: ctx => { if (!ctx.game.flipCoin()) fail(ctx); },
        after: ctx => ctx.game.addEffect(ctx.attacker, 'preventAll', ctx.game.turn + 1),
        expected: ctx => ctx.damage / 2
    };
}

// 自分のトラッシュにある、名前に「ロケット団」とつくサポートの枚数×20ダメージ
function rocketCommand() {
    return timesDamage(20, ctx => ctx.player.discard.filter(inst => {
        const card = ctx.game.cardOf(inst);
        return isSupporter(card) && card.name.includes('ロケット団');
    }).length);
}
