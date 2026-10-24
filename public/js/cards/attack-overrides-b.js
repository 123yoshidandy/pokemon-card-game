/**
 * 決まった形に読み替えられないワザの効果（そのb）。「カード名/ワザ名」で引く（同じ名前で文の違う版があるなら「カードのID/ワザ名」）
 * { before(ctx), after(ctx), expected(ctx), canUse(game, player, pokemon), firstTurnOk }。ctx は attack-effects.js と同じ。書き方は cards/HOOKS.md
 *
 * 一覧（node tools/list-unsupported.mjs attacks 182 400）のうち、書かなかったワザと理由：
 *   カードのデータに「古代」「未来」の印がない
 *     イダイナキバ/じばんほうかい・トドロクツキ/あだうちやばね・テツノブジン/マジェスティソード・テツノイバラ/デスタプレッサー・
 *     テツノドクガ/ワイルドリジェクター・チヲハウハネ/てつつぶし・ミライドン/プロテクトコード・ハバタクカミ/まどわしうつす・コライドン/はじょうもうこう
 *   カードのデータに「テラスタル」の印がない
 *     テラパゴス/プリズムチャージ・レジギガス/ジュエルブレイク
 *   TCGdex の文からタイプの記号が抜けていて、意味が確かめられない
 *     ガントル/うちおとす（「抵抗力がタイプなら」）
 *   ゲームの本体に新しい仕組みが要る
 *     ローブシン/ガッツスイング・オトスパス/テンタクルレイジ：ワザ自身が、条件しだいでワザを使うためのエネルギーを変える仕組みがない（攻撃の cost は決まった配列）
 *     ランターン/さくらんフラッシュ：こんらんでのせるダメカンの数を変える仕組みがない（game.js の CONFUSION_DAMAGE が決まった値）
 *     クレセリア/クレセントパージ：サイドのオモテ・ウラを持っていない
 *     Nのシンボラー/ビクトリーシンボル：勝ちにする道具（endGame）はあるが、画面の終わりの文が新しい理由に対応していない（「両者が同時に勝利条件を満たした」と出てしまう）
 *
 * 前の番に使ったワザを見るもの（タイレーツ/いっせいこうげき・マタドガス/クレイジーボム）と、別のワザのダメージを変えるもの（ミルホッグ/きあいだめ）のため、
 * 相方のワザ（じんけいをくむ・じゅうまんガス・ひっさつまえば）も、文の読み替えを包んでここに書く
 */

import { compileAttackText } from './attack-effects.js';
import { CATALOG } from './catalog.js';

const FOREVER = 1e9;

// ===== 効果の道具 =====

const isEx = card => card.rule === 'ex' || card.rule === 'mega';
const counters = pokemon => Math.floor(pokemon.damage / 10);
const remainingHp = (game, pokemon) => game.maxHp(pokemon) - pokemon.damage;
// ワザの効果を与えられるか（kind を渡すと、その種類の効果だけを止めるもの（バトルコロシアムのダメカンなど）も見る。kind は game.canAffect と同じ）
const canAffect = (ctx, pokemon, kind = null) => Boolean(pokemon) && ctx.game.canAffectByAttack(ctx, pokemon) && (!kind || ctx.game.canAffect(pokemon, kind));
const isBasicEnergy = (card, type = null) => card.kind === 'energy' && card.basic && (!type || card.energyType === type);
const isSpecialEnergy = card => card.kind === 'energy' && !card.basic;
const hasType = (game, pokemon, type) => game.typesOf(pokemon).includes(type);
const nameStarts = (game, pokemon, prefix) => game.topCard(pokemon).name.startsWith(prefix);
const indicesUpTo = n => Array.from({ length: n }, (_, index) => index);

function fail(ctx) {
    ctx.failed = true;
    ctx.game.log('ワザは失敗した');
}

function flipCoins(game, times) {
    let heads = 0;
    for (let i = 0; i < times; i++) if (game.flipCoin()) heads++;
    return heads;
}

// そのエネルギーが、指定したタイプのエネルギーになるか（どのタイプにもなる特殊エネルギーもふくむ）
function provides(game, pokemon, inst, type) {
    return game.energyUnits(pokemon, [inst]).some(unit => unit === type || unit === 'any' || unit.split('|').includes(type));
}

const typedEnergies = (game, pokemon, type) => pokemon.energies.filter(inst => provides(game, pokemon, inst, type));

// 一番大きい値のインデックス（CPU の答えに使う）
function bestIndex(items, score) {
    let best = 0;
    items.forEach((item, index) => { if (score(item) > score(items[best])) best = index; });
    return best;
}

// きぜつさせる（残りHPぶんのダメカンをのせる）
function knockOut(game, pokemon) {
    const rest = remainingHp(game, pokemon);
    if (rest > 0) game.putDamage(pokemon, rest);
}

// ダメカンをのせ替える（本体の game.moveCounters が、のせ替えを止める効果と、効果を受けないポケモンを見る）
function moveCounters(game, from, to, count) {
    if (count <= 0) return;
    game.moveCounters(from, to, count * 10);
}

// ポケモンについているエネルギーを、持ち主の手札・山札・トラッシュに動かす
//   （本体の game.removeEnergy が、効果を受けないポケモンと、手札にもどせないポケモンを見る）
function moveEnergiesOff(game, pokemon, insts, to = 'discard') {
    if (!game.ownerOf(pokemon) || insts.length === 0) return;
    const moved = insts.filter(inst => game.removeEnergy(pokemon, inst, to));
    if (moved.length === 0) return;
    const words = { hand: '手札にもどした', deck: '山札にもどした', discard: 'トラッシュした' };
    game.log(`${game.topCard(pokemon).name}のエネルギーを${moved.length}個${words[to]}`);
}

// ポケモンについているエネルギーを count 個選ぶ（候補がちょうどか、同じカードだけなら選ばせない）
function pickEnergies(ctx, pokemon, count, done, { filter = () => true, chooser = ctx.player, title = 'エネルギーを選ぶ' } = {}) {
    const { game } = ctx;
    const candidates = pokemon.energies.filter(filter);
    const n = Math.min(count, candidates.length);
    if (n === 0) {
        done([]);
        return;
    }
    if (n === candidates.length || new Set(candidates.map(inst => inst.id)).size === 1) {
        done(candidates.slice(0, n));
        return;
    }
    game.promptCards({
        player: chooser,
        cards: candidates,
        min: n,
        max: n,
        title: `${title}（${n}個）`,
        purpose: game.ownerOf(pokemon) === chooser ? 'discard-own-energy' : 'discard-opponent-energy',
        callback: done
    });
}

// ポケモンと、ついているすべてのカードを、持ち主の山札にもどす（shuffle なら切る。相手の効果を受けないポケモンは、もどさない）
function returnToDeck(game, pokemon, { shuffle = true } = {}) {
    const owner = game.ownerOf(pokemon);
    if (!owner) return;
    if (!game.canAffect(pokemon, 'return')) {
        game.log(`${game.topCard(pokemon).name}は山札にもどらない`);
        return;
    }
    if (owner.active === pokemon) owner.active = null;
    else game.removeCard(owner.bench, pokemon);
    owner.deck.push(...pokemon.cards, ...pokemon.energies, ...[pokemon.tool, pokemon.tool2].filter(Boolean));
    if (shuffle) game.shuffleDeck(owner);
    game.log(`${owner.name}の${game.topCard(pokemon).name}と、ついているカードを山札にもどした`);
}

// 「進化カード」を1枚はがして退化させる（はがしたカードは持ち主の手札か山札へ。本体の game.devolve が、効果を受けないポケモンを見る）
function devolve(game, pokemon, to) {
    if (!game.ownerOf(pokemon) || pokemon.cards.length < 2) return;
    if (game.devolve(pokemon, 1, to).length > 0) pokemon.evolvedFrom = null;
}

// 選んだポケモン（count 匹まで）にワザのダメージ
function damageChosen(ctx, list, count, amount) {
    const { game } = ctx;
    const targets = list.filter(Boolean);
    const n = Math.min(count, targets.length);
    if (n === 0) return;
    const deal = selected => selected.forEach(target => game.dealAttackDamage(ctx, target, amount));
    if (n === targets.length) {
        deal(targets);
        return;
    }
    game.promptPokemon({ player: ctx.player, pokemon: targets, min: n, max: n, title: `${amount}ダメージを与えるポケモンを${n}匹選ぶ`, purpose: 'snipe-target', amount, callback: deal });
}

// 山札を上から count 枚見て、好きな順番に入れ替えて、山札の上にもどす
function reorderTop(game, player, owner, count) {
    const top = owner.deck.splice(0, Math.min(count, owner.deck.length));
    if (top.length === 0) return;
    game.log(`${player.name}は${owner === player ? '自分' : owner.name}の山札を上から${top.length}枚見た`);
    game.log(`山札の上：${top.map(inst => game.cardName(inst)).join('・')}`, { to: player.id });
    const ordered = [];
    const step = () => {
        if (top.length <= 1) {
            ordered.push(...top);
            owner.deck.unshift(...ordered);
            game.log(`${player.name}は山札の上のカードを並べ替えてもどした`);
            return;
        }
        game.promptCards({
            player,
            cards: top,
            min: 1,
            max: 1,
            title: `山札の上から${ordered.length + 1}枚目にするカードを選ぶ`,
            purpose: 'order-deck',
            callback: ([inst]) => {
                game.removeCard(top, inst);
                ordered.push(inst);
                step();
            }
        });
    };
    step();
}

// 山札を上から count 枚見て、その中のたねポケモンを好きなだけベンチに出す。残りは山札にもどして切る
function benchFromTop(game, player, count, filter = () => true) {
    const top = player.deck.slice(0, count);
    game.log(`${player.name}は山札を上から${top.length}枚見た`);
    const candidates = top.filter(inst => { const card = game.cardOf(inst); return card.kind === 'pokemon' && card.stage === 0 && filter(card); });
    const max = Math.min(game.benchSize - player.bench.length, candidates.length);
    const finish = selected => {
        selected.forEach(inst => {
            game.removeCard(player.deck, inst);
            player.bench.push(game.createPokemon(inst));
            game.log(`${player.name}は${game.cardName(inst)}をベンチに出した`);
        });
        game.shuffleDeck(player);
    };
    if (max === 0) {
        finish([]);
        return;
    }
    game.promptCards({ player, cards: candidates, min: 0, max, title: 'ベンチに出すポケモンを選ぶ', purpose: 'bench-basic', callback: finish });
}

// トラッシュのたねポケモンを max 枚までベンチに出す
function benchFromDiscard(game, player, filter, max) {
    const candidates = player.discard.filter(inst => { const card = game.cardOf(inst); return card.kind === 'pokemon' && card.stage === 0 && filter(card); });
    const n = Math.min(max, candidates.length, game.benchSize - player.bench.length);
    if (n <= 0) return;
    game.promptCards({
        player,
        cards: candidates,
        min: 0,
        max: n,
        title: 'トラッシュからベンチに出すポケモンを選ぶ',
        purpose: 'bench-basic',
        callback: selected => selected.forEach(inst => {
            game.removeCard(player.discard, inst);
            player.bench.push(game.createPokemon(inst));
            game.log(`${player.name}は${game.cardName(inst)}をトラッシュからベンチに出した`);
        })
    });
}

// 自分の手札から条件に合うエネルギーを1枚選び、つける（where：つけ先の候補）
function attachFromHand(ctx, filter, where, then = () => {}) {
    const { game, player } = ctx;
    const cards = player.hand.filter(inst => filter(game.cardOf(inst)));
    const targets = where(player);
    if (cards.length === 0 || targets.length === 0) {
        then(null);
        return;
    }
    game.promptCards({
        player,
        cards,
        min: 1,
        max: 1,
        title: '手札からつけるエネルギーを選ぶ',
        purpose: 'attach-from-hand',
        callback: ([inst]) => {
            const attach = target => {
                game.removeCard(player.hand, inst);
                game.attachFromOutside(target, inst);
                then(target);
            };
            if (targets.length === 1) {
                attach(targets[0]);
                return;
            }
            game.promptPokemon({ player, pokemon: targets, min: 1, max: 1, title: `${game.cardName(inst)}をつけるポケモンを選ぶ`, purpose: 'attach-energy-target', callback: ([target]) => attach(target) });
        }
    });
}

// 自分の場のポケモンについているエネルギー（条件に合うもの）を、まとめて選ぶための一覧
function fieldEnergies(game, pokemons, filter) {
    const owners = new Map();
    pokemons.forEach(pokemon => pokemon.energies.forEach(inst => { if (filter(pokemon, inst)) owners.set(inst, pokemon); }));
    return owners;
}

function discardFieldEnergies(game, owners, selected) {
    selected.forEach(inst => {
        const pokemon = owners.get(inst);
        game.moveCard(pokemon.energies, game.ownerOf(pokemon).discard, inst);
    });
    if (selected.length) game.log(`場のエネルギーを${selected.length}個トラッシュした`);
}

// CPU：相手のバトルポケモンをきぜつさせるのに要る数（base に per ずつ足す。足りなければ max）
function countToKnockOut(ctx, base, per, max) {
    const { game, attacker, defender } = ctx;
    if (!defender || max <= 0) return max;
    const weakness = game.weaknessOf(defender);
    const times = weakness && game.typesOf(attacker).includes(weakness) ? 2 : 1;
    const need = Math.ceil(Math.max(0, remainingHp(game, defender) - base * times) / (per * times));
    return need <= max ? need : max;
}

// CPU：そのダメージで相手のバトルポケモンをきぜつさせられるか（弱点だけを見る）
function wouldKnockOut(ctx, damage) {
    const { game, attacker, defender } = ctx;
    if (!defender) return false;
    const weakness = game.weaknessOf(defender);
    const times = weakness && game.typesOf(attacker).includes(weakness) ? 2 : 1;
    return damage * times >= remainingHp(game, defender);
}

// 次の相手の番の終わりに、このワザを受けたポケモンへ効果を与える（ベンチにもどる・進化するなど、効果がなくなっていれば何もしない）
function atEndOfOpponentTurn(ctx, pokemon, kind, run) {
    const { game } = ctx;
    const turn = game.turn + 1;
    game.addEffect(pokemon, kind, turn);
    game.addPlayerEffect(ctx.player, kind, turn, {
        hooks: {
            onTurnEnd: g => {
                if (g.turn !== turn || !g.ownerOf(pokemon) || !g.hasEffect(pokemon, kind)) return;
                run(g, pokemon);
            }
        }
    });
}

// ポケモンにかかる効果に、フックを持たせる（ポケモンの効果を印にして、印が残っている間だけ働く）
function markedHooks(ctx, pokemon, kind, untilTurn, hooks) {
    const { game } = ctx;
    game.addEffect(pokemon, kind, untilTurn);
    const live = g => Boolean(g.ownerOf(pokemon)) && g.hasEffect(pokemon, kind);
    const wrapped = Object.fromEntries(Object.entries(hooks).map(([name, fn]) => [name, (g, source, ...args) => (live(g) ? fn(g, source, ...args) : undefined)]));
    game.addPlayerEffect(ctx.player, kind, untilTurn, { hooks: wrapped });
}

// ===== ほかのワザを、このワザとして使う =====

// CPU の見積もり（ほかのワザを使うワザは、見積もりの中で数えない。たがいに呼び合って止まらなくなるため）
function copiedExpected(ctx, attacks) {
    const values = attacks.filter(attack => !attack.copiesAttack)
        .map(attack => (attack.expected ? attack.expected({ ...ctx, attack, damage: attack.damage }) : attack.damage));
    return values.length ? Math.max(...values) : 0;
}

function useAsThisAttack(ctx, attack) {
    const { game } = ctx;
    game.log(`「${attack.name}」として使う`);
    ctx.attack = attack;
    ctx.damage = attack.damage;
    ctx.copiedAttack = attack;
    if (attack.before) game.runNext(() => { if (!ctx.failed) attack.before(ctx); });
}

function chooseAttackToCopy(ctx, candidates, title) {
    const { game, player } = ctx;
    // ほかのワザをこのワザとして使うワザ（ナイトジョーカーなど）は選ばない（選ぶと、選び続けて終わらなくなる）
    const attacks = candidates.filter(attack => !attack.copiesAttack);
    if (attacks.length === 0) {
        ctx.damage = 0;
        return;
    }
    game.promptChoose({
        player,
        options: attacks.map(attack => attack.name),
        title,
        purpose: 'copy-attack',
        cpuAnswer: () => [bestIndex(attacks, attack => (attack.copiesAttack ? -1 : copiedExpected(ctx, [attack])))],
        callback: ([index]) => useAsThisAttack(ctx, attacks[index])
    });
}

const copiedAfter = ctx => { ctx.copiedAttack?.after?.(ctx); };

// ===== 前の番に使ったワザ・ほかのワザを変える効果（相方のワザを、文の読み替えを包んで書く） =====

function compiledOf(id, name) {
    const attack = CATALOG.find(card => card.id === id).attacks.find(a => a.name === name);
    return (attack.text ? compileAttackText(attack.text) : {}) ?? {};
}

// ワザを使ったことを、プレイヤーにかかる効果として残す（入れ替え・進化しても消えない。ポケモンはIDで見る）
function rememberUse(id, name) {
    const base = compiledOf(id, name);
    return {
        ...base,
        before: ctx => {
            ctx.game.addPlayerEffect(ctx.player, 'usedAttack', ctx.game.turn + 2, { pokemonId: ctx.attacker.id, attack: name, turn: ctx.game.turn });
            base.before?.(ctx);
        }
    };
}

const usedLastTurn = (ctx, name) => ctx.player.effects.some(effect => effect.kind === 'usedAttack' && effect.attack === name
    && effect.pokemonId === ctx.attacker.id && effect.turn === ctx.game.turn - 2);

const HISSATSU = compiledOf('SV11W-152', 'ひっさつまえば');

// ===== 小さな形 =====

// 条件を満たせば、ダメージ追加
const bonusIf = (test, amount) => ({
    before: ctx => { if (test(ctx)) ctx.damage += amount; },
    expected: ctx => ctx.damage + (test(ctx) ? amount : 0)
});

// 数×N ダメージ（add なら追加）
const perCount = (count, each, add = false) => ({
    before: ctx => { ctx.damage = (add ? ctx.damage : 0) + count(ctx) * each; },
    expected: ctx => (add ? ctx.damage : 0) + count(ctx) * each
});

// 条件を満たさなければ失敗
const failUnless = test => ({
    before: ctx => { if (!test(ctx)) fail(ctx); },
    expected: ctx => (test(ctx) ? ctx.damage : 0)
});

// 相手の手札からオモテを見ないで1枚選び、オモテを見て、相手の山札にもどして切る
const surprise = {
    after: ctx => {
        const { game, opponent } = ctx;
        if (opponent.hand.length === 0) return;
        const inst = opponent.hand[Math.floor(game.random() * opponent.hand.length)];
        game.moveCard(opponent.hand, opponent.deck, inst);
        game.shuffleDeck(opponent);
        game.log(`${opponent.name}の手札の${game.cardName(inst)}を山札にもどして切った`);
    }
};

// 相手のバトルポケモンが持つワザを1つ選び、このワザとして使う
const copyDefender = {
    copiesAttack: true,
    before: ctx => chooseAttackToCopy(ctx, ctx.defender ? ctx.game.topCard(ctx.defender).attacks : [], 'このワザとして使う、相手のバトルポケモンのワザを選ぶ'),
    after: copiedAfter,
    expected: ctx => (ctx.defender ? copiedExpected(ctx, ctx.game.topCard(ctx.defender).attacks) : 0)
};

// 相手のベンチポケモンを1匹選び、山札にもどして切る
function shuffleOpponentBench(ctx, count = 1) {
    const { game, player, opponent } = ctx;
    const targets = opponent.bench.filter(pokemon => canAffect(ctx, pokemon, 'return'));
    const n = Math.min(count, targets.length);
    if (n === 0) return;
    game.promptPokemon({
        player,
        pokemon: targets,
        min: n,
        max: n,
        title: '山札にもどす相手のベンチポケモンを選ぶ',
        purpose: 'boss-target',
        callback: selected => selected.forEach(pokemon => returnToDeck(game, pokemon))
    });
}

// 自分の場のエネルギーを max 枚までトラッシュし、その枚数×each ダメージ
function discardFieldForDamage(filter, max, each) {
    return {
        before: ctx => {
            const { game, player } = ctx;
            const owners = fieldEnergies(game, game.inPlay(player), filter(game));
            const cards = [...owners.keys()];
            const n = Math.min(max, cards.length);
            if (n === 0) {
                ctx.damage = 0;
                return;
            }
            game.promptCards({
                player,
                cards,
                min: 0,
                max: n,
                title: `トラッシュするエネルギーを選ぶ（1枚につき${each}ダメージ）`,
                purpose: 'discard-for-damage',
                cpuAnswer: () => indicesUpTo(countToKnockOut(ctx, 0, each, n)),
                callback: selected => {
                    discardFieldEnergies(game, owners, selected);
                    ctx.damage = selected.length * each;
                }
            });
        },
        expected: ctx => Math.min(max, fieldEnergies(ctx.game, ctx.game.inPlay(ctx.player), filter(ctx.game)).size) * each
    };
}

// ===== ワザ =====

export const ATTACK_OVERRIDES = {
    'コアルヒー/しょうか': {
        after: ctx => {
            const { game, defender } = ctx;
            if (!canAffect(ctx, defender)) return;
            pickEnergies(ctx, defender, 1, selected => moveEnergiesOff(game, defender, selected), {
                filter: inst => provides(game, defender, inst, 'fire'),
                title: 'トラッシュする[R]エネルギーを選ぶ'
            });
        }
    },
    'バイバニラ/ダブルフリーズ': {
        before: ctx => {
            const heads = flipCoins(ctx.game, 2);
            ctx.damage = heads * 90;
            ctx.paralyze = heads > 0;
        },
        after: ctx => { if (ctx.paralyze && canAffect(ctx, ctx.defender)) ctx.game.addCondition(ctx.defender, 'paralyzed'); },
        expected: () => 90
    },
    'デンチュラ/ほうでん': {
        before: ctx => {
            const energies = [...ctx.attacker.energies];
            moveEnergiesOff(ctx.game, ctx.attacker, energies);
            ctx.damage = energies.length * 50;
        },
        expected: ctx => ctx.attacker.energies.length * 50
    },
    'マッギョ/マッドボルト': bonusIf(ctx => ctx.attacker.energies.length > 0, 20),
    'ココロモリ/ハッピーリターン': {
        after: ctx => {
            const { game, player } = ctx;
            if (player.bench.length === 0) return;
            game.promptPokemon({
                player,
                pokemon: player.bench,
                min: 1,
                max: 1,
                title: '手札にもどすベンチポケモンを選ぶ',
                purpose: 'return-own',
                cpuAnswer: (g, prompt) => [bestIndex(prompt.pokemon, pokemon => pokemon.damage)],
                callback: ([pokemon]) => game.returnToHand(player, pokemon)
            });
        }
    },
    'デスカーン/のびるダメカーン': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const sources = player.bench.filter(pokemon => pokemon.damage > 0);
            if (sources.length === 0) return;
            game.promptPokemon({
                player,
                pokemon: sources,
                min: 1,
                max: 1,
                title: 'ダメカンをのせ替える自分のベンチポケモンを選ぶ',
                purpose: 'counter-source',
                cpuAnswer: (g, prompt) => [bestIndex(prompt.pokemon, pokemon => pokemon.damage)],
                callback: ([source]) => {
                    const targets = game.inPlay(opponent).filter(pokemon => canAffect(ctx, pokemon, 'moveCounters'));
                    if (targets.length === 0) return;
                    game.promptPokemon({
                        player,
                        pokemon: targets,
                        min: 1,
                        max: 1,
                        title: `ダメカン${counters(source)}個をのせる相手のポケモンを選ぶ`,
                        purpose: 'snipe-target',
                        amount: source.damage,
                        callback: ([target]) => moveCounters(game, source, target, counters(source))
                    });
                }
            });
        }
    },
    'ゴチミル/フォーチュンアイ': {
        after: ctx => reorderTop(ctx.game, ctx.player, ctx.opponent, 5)
    },
    'ゴチルゼル/シンクロショット': bonusIf(ctx => ctx.player.hand.length === ctx.opponent.hand.length, 90),
    'ギガイアス/リベンジキャノン': perCount(ctx => ctx.player.bench.reduce((sum, pokemon) => sum + counters(pokemon), 0), 20),
    'ズルズキン/ごろつきアタック': {
        before: ctx => { ctx.damage = flipCoins(ctx.game, ctx.game.inPlay(ctx.player).length) * 60; },
        expected: ctx => ctx.game.inPlay(ctx.player).length * 30
    },
    'ゾロアーク/イカサマ': copyDefender,
    'ミルホッグ/きあいだめ': {
        after: ctx => ctx.game.addEffect(ctx.attacker, 'kiaidame', ctx.game.turn + 2)
    },
    // きあいだめの相方：「次の自分の番、このポケモンの『ひっさつまえば』のダメージは『240』になる」
    'SV11W-152/ひっさつまえば': {
        ...HISSATSU,
        before: ctx => {
            if (ctx.game.hasEffect(ctx.attacker, 'kiaidame')) ctx.damage = 240;
            HISSATSU.before?.(ctx);
        },
        expected: ctx => (ctx.game.hasEffect(ctx.attacker, 'kiaidame') ? 240 : ctx.damage) / 2
    },
    'ムーランド/かぎわける': {
        after: ctx => {
            const { game, player } = ctx;
            const heads = flipCoins(game, 3);
            // トラッシュから動かせないカードは選べない
            const cards = player.discard.filter(inst => !game.isDiscardLocked(inst));
            const n = Math.min(heads, cards.length);
            if (n === 0) return;
            game.promptCards({
                player,
                cards,
                min: 0,
                max: n,
                title: `トラッシュから手札に加えるカードを${n}枚まで選ぶ`,
                purpose: 'search-card',
                callback: selected => {
                    selected.forEach(inst => game.moveCard(player.discard, player.hand, inst));
                    if (selected.length) game.log(`${player.name}は${selected.map(inst => game.cardName(inst)).join('と')}をトラッシュから手札に加えた`);
                }
            });
        }
    },
    'トルネロス/かぜをまとう': {
        after: ctx => attachFromHand(ctx, card => isBasicEnergy(card), () => [ctx.attacker])
    },
    'トルネロス/ぼうふう': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            if (player.bench.length === 0) return;
            pickEnergies(ctx, attacker, 1, ([inst]) => {
                if (!inst) return;
                game.promptPokemon({
                    player,
                    pokemon: player.bench,
                    min: 1,
                    max: 1,
                    title: 'エネルギーをつけ替えるベンチポケモンを選ぶ',
                    purpose: 'energy-switch-target',
                    callback: ([target]) => game.moveEnergy(attacker, target, inst)
                });
            }, { filter: inst => game.cardOf(inst).basic, title: 'つけ替える基本エネルギーを選ぶ' });
        }
    },
    'エルフーンex/ワンダーコットン': {
        before: ctx => {
            ctx.game.revealHand(ctx.opponent, ctx.player);
            ctx.damage = ctx.opponent.hand.filter(inst => ctx.game.cardOf(inst).kind === 'trainer').length * 50;
        },
        expected: ctx => ctx.opponent.hand.filter(inst => ctx.game.cardOf(inst).kind === 'trainer').length * 50
    },
    'カイロス/スロークランチ': {
        after: ctx => {
            moveEnergiesOff(ctx.game, ctx.attacker, [...ctx.attacker.energies]);
            if (!canAffect(ctx, ctx.defender)) return;
            atEndOfOpponentTurn(ctx, ctx.defender, 'slowCrunch', (g, pokemon) => {
                g.log(`スロークランチの効果で、${g.topCard(pokemon).name}はきぜつする`);
                knockOut(g, pokemon);
            });
        }
    },
    'リーフィア/わかばのめぐみ': {
        after: ctx => attachFromHand(ctx, card => isBasicEnergy(card, 'grass'), player => player.bench, target => {
            if (target) ctx.game.heal(target, target.damage);
        })
    },
    'ヤバソチャex/せんじがえし': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const energies = player.discard.filter(inst => isBasicEnergy(game.cardOf(inst), 'grass'));
            if (energies.length === 0) return;
            game.log(`${player.name}はトラッシュの基本草エネルギー${energies.length}枚を見せた`);
            const finish = () => {
                energies.forEach(inst => game.moveCard(player.discard, player.deck, inst));
                game.shuffleDeck(player);
                game.log(`${player.name}は見せたエネルギーを山札にもどして切った`);
            };
            const targets = game.inPlay(opponent).filter(pokemon => canAffect(ctx, pokemon, 'counters'));
            if (targets.length === 0) {
                finish();
                return;
            }
            game.promptPokemon({
                player,
                pokemon: targets,
                min: 1,
                max: 1,
                title: `ダメカンを${energies.length * 2}個のせる相手のポケモンを選ぶ`,
                purpose: 'snipe-target',
                amount: energies.length * 20,
                callback: ([target]) => {
                    game.putDamage(target, energies.length * 20);
                    finish();
                }
            });
        }
    },
    'マグカルゴex/グラウンドバーン': {
        before: ctx => {
            const { game, player, opponent } = ctx;
            const top = [player.deck[0], opponent.deck[0]].filter(Boolean);
            game.millDeck(player, 1);
            game.millDeck(opponent, 1);
            ctx.damage += top.filter(inst => game.cardOf(inst).kind === 'energy').length * 140;
        },
        expected: ctx => ctx.damage
    },
    'グレイシア/しみいるれいき': {
        after: ctx => {
            if (!canAffect(ctx, ctx.defender)) return;
            atEndOfOpponentTurn(ctx, ctx.defender, 'shimiiru', (g, pokemon) => g.putDamage(pokemon, 90));
        }
    },
    'ウネルミナモ/うねりさく': (() => {
        // CPU は、きぜつしない範囲で一番多くのせる
        const cpuCount = ctx => Math.max(0, Math.min(9, Math.floor((remainingHp(ctx.game, ctx.attacker) - 1) / 10)));
        return {
            before: ctx => {
                const { game, player, attacker } = ctx;
                game.promptChoose({
                    player,
                    options: indicesUpTo(10).map(n => `${n}個`),
                    title: 'このポケモンにのせるダメカンの数を選ぶ（1個につき20ダメージ）',
                    purpose: 'choose-count',
                    cpuAnswer: () => [cpuCount(ctx)],
                    callback: ([n]) => {
                        if (n > 0) game.putDamage(attacker, n * 10);
                        ctx.damage = n * 20;
                    }
                });
            },
            expected: ctx => cpuCount(ctx) * 20
        };
    })(),
    'ラブトロス/ラブレゾナンス': bonusIf(ctx => {
        const { game, player, opponent } = ctx;
        const types = new Set(game.inPlay(opponent).flatMap(pokemon => game.typesOf(pokemon)));
        return game.inPlay(player).some(pokemon => game.typesOf(pokemon).some(type => types.has(type)));
    }, 120),
    'ダイノーズ/アサルトレーザー': bonusIf(ctx => Boolean(ctx.defender?.tool), 80),
    'ディンルー/グラウンドクラック': {
        after: ctx => {
            if (!ctx.game.stadium) return;
            ctx.opponent.bench.forEach(pokemon => ctx.game.dealAttackDamage(ctx, pokemon, 30));
            ctx.game.discardStadium();
        }
    },
    'カビゴン/はらごしらえ': {
        after: ctx => attachFromHand(ctx, card => card.kind === 'energy', () => [ctx.attacker], () => ctx.game.heal(ctx.attacker, 60))
    },
    'シェイミ/ピンポイントダイブ': {
        after: ctx => damageChosen(ctx, ctx.opponent.bench.filter(pokemon => isEx(ctx.game.topCard(pokemon))), 1, 60)
    },
    'クイタラン/なめやきファイヤー': {
        after: ctx => {
            const tails = 3 - flipCoins(ctx.game, 3);
            pickEnergies(ctx, ctx.attacker, tails, selected => moveEnergiesOff(ctx.game, ctx.attacker, selected), { title: 'トラッシュするエネルギーを選ぶ' });
        }
    },
    'サメハダー/かみすてる': {
        after: ctx => ctx.game.discardRandomFromHand(ctx.opponent, flipCoins(ctx.game, 3))
    },
    'イルカマン/ヴァンガードパンチ': {
        after: ctx => { if (ctx.attacker.damage > 0) ctx.game.putDamage(ctx.attacker, counters(ctx.attacker) * 10); }
    },
    'ドータクン/しんかジャマー': {
        after: ctx => ctx.game.addPlayerEffect(ctx.opponent, 'evolutionJammer', ctx.game.turn + 1, {
            hooks: { blockEvolve: (g, source, who) => (who === source.player ? 'しんかジャマーの効果で、手札から進化させられません' : null) }
        })
    },
    'ヤミラミ/ダメージコレクト': {
        after: ctx => {
            const { game, player, opponent, defender } = ctx;
            if (!canAffect(ctx, defender, 'moveCounters')) return;
            const steps = opponent.bench.filter(pokemon => pokemon.damage > 0 && canAffect(ctx, pokemon, 'moveCounters')).map(pokemon => () => {
                if (!game.inPlay(opponent).includes(pokemon) || opponent.active !== defender) return;
                game.promptChoose({
                    player,
                    options: indicesUpTo(counters(pokemon) + 1).map(n => `${n}個`),
                    title: `${game.topCard(pokemon).name}からバトルポケモンにのせ替えるダメカンの数を選ぶ`,
                    purpose: 'choose-count',
                    cpuAnswer: () => [counters(pokemon)],
                    callback: ([n]) => moveCounters(game, pokemon, defender, n)
                });
            });
            game.runNext(...steps);
        }
    },
    'ランクルス/サモンゲート': {
        after: ctx => benchFromTop(ctx.game, ctx.player, 8)
    },
    'バンバドロ/マッドストック': {
        after: ctx => {
            const { game, player } = ctx;
            player.bench.forEach(pokemon => {
                const inst = player.discard.find(card => isBasicEnergy(game.cardOf(card), 'fighting'));
                if (!inst) return;
                game.removeCard(player.discard, inst);
                game.attachFromOutside(pokemon, inst);
            });
        }
    },
    'チラーミィ/おそうじ': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const targets = game.inPlay(opponent).filter(pokemon => pokemon.tool && canAffect(ctx, pokemon, 'tool'));
            const n = Math.min(2, targets.length);
            if (n === 0) return;
            game.promptPokemon({
                player,
                pokemon: targets,
                min: 0,
                max: n,
                title: `「ポケモンのどうぐ」をトラッシュする相手のポケモンを${n}匹まで選ぶ`,
                purpose: 'discard-opponent-tool',
                cpuAnswer: () => indicesUpTo(n),
                callback: selected => selected.forEach(pokemon => game.discardTool(pokemon))
            });
        }
    },
    'チラチーノ/スペシャルころころ': perCount(ctx => ctx.attacker.energies.filter(inst => isSpecialEnergy(ctx.game.cardOf(inst))).length, 70),
    'ドダイトスex/もりのこうしん': perCount(ctx => ctx.game.inPlay(ctx.player).filter(pokemon => hasType(ctx.game, pokemon, 'grass')).length, 30),
    'ウミトリオex/トリコロポンプ': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const energies = player.hand.filter(inst => game.cardOf(inst).kind === 'energy');
            const n = Math.min(3, energies.length);
            if (n === 0) return;
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: n,
                title: 'トラッシュする手札のエネルギーを3枚まで選ぶ（1枚につき60ダメージ）',
                purpose: 'discard-for-damage',
                cpuAnswer: () => indicesUpTo(n),
                callback: selected => {
                    selected.forEach(inst => game.moveCard(player.hand, player.discard, inst));
                    if (selected.length === 0) return;
                    game.log(`${player.name}は手札のエネルギーを${selected.length}枚トラッシュした`);
                    damageChosen(ctx, game.inPlay(opponent), 1, selected.length * 60);
                }
            });
        }
    },
    'ゲンガーex/トリックステップ': {
        after: ctx => {
            const { game, player, opponent, defender } = ctx;
            if (!canAffect(ctx, defender, 'energy') || defender.energies.length === 0 || !opponent.bench.some(pokemon => canAffect(ctx, pokemon))) return;
            game.promptConfirm({
                player,
                title: '相手のバトルポケモンのエネルギーを1個、相手のベンチポケモンにつけ替えますか？',
                purpose: 'optional-energy-move',
                cpuAnswer: () => true,
                callback: yes => {
                    if (!yes) return;
                    pickEnergies(ctx, defender, 1, ([inst]) => {
                        // つけ替える先も、効果を受けないポケモンは選べない
                        const targets = opponent.bench.filter(pokemon => canAffect(ctx, pokemon));
                        if (!inst || targets.length === 0) return;
                        game.promptPokemon({
                            player,
                            pokemon: targets,
                            min: 1,
                            max: 1,
                            title: 'エネルギーをつけ替える相手のベンチポケモンを選ぶ',
                            purpose: 'opponent-energy-target',
                            callback: ([target]) => game.moveEnergy(defender, target, inst)
                        });
                    }, { title: 'つけ替えるエネルギーを選ぶ' });
                }
            });
        }
    },
    'ウガツホムラex/れっかばくしん': {
        // バトル場をはなれる（ベンチにもどる）と、ポケモンにかかっている効果は消える
        after: ctx => ctx.game.addEffect(ctx.attacker, 'cannotUseAttack', FOREVER, { attack: 'れっかばくしん' })
    },
    'タケルライコex/きょくらいごう': discardFieldForDamage(game => (pokemon, inst) => game.cardOf(inst).basic, Infinity, 70),
    'ライチュウ/まきこみボルト': {
        after: ctx => {
            const { game, player, opponent, attacker } = ctx;
            const mine = game.inPlay(player).filter(pokemon => pokemon !== attacker && pokemon.damage > 0);
            const theirs = game.inPlay(opponent).filter(pokemon => pokemon.damage > 0);
            theirs.forEach(pokemon => game.dealAttackDamage(ctx, pokemon, 50));
            mine.forEach(pokemon => game.putDamage(pokemon, 50));
        }
    },
    'エレキブル/ろうでんナックル': bonusIf(ctx => ctx.game.inPlay(ctx.opponent).some(pokemon => hasType(ctx.game, pokemon, 'water')), 120),
    'クワガノン/ちょくれつキャノン': perCount(ctx => ctx.player.bench.filter(pokemon => ctx.game.topCard(pokemon).name === 'デンヂムシ').length, 80, true),
    'バリヤード/そっくりショー': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            game.revealHand(opponent, player);
            const supporters = opponent.hand.filter(inst => {
                const card = game.cardOf(inst);
                return card.kind === 'trainer' && card.trainerType === 'supporter' && card.supported && card.canPlay(game, player);
            });
            if (supporters.length === 0) return;
            game.promptCards({
                player,
                cards: supporters,
                min: 0,
                max: 1,
                title: 'このワザの効果として使うサポートを選ぶ（使わないなら選ばない）',
                purpose: 'copy-supporter',
                callback: ([inst]) => {
                    if (!inst) return;
                    const card = game.cardOf(inst);
                    game.log(`${card.name}の効果を、このワザの効果として使う`);
                    card.play(game, player, inst);
                }
            });
        }
    },
    'アブリボン/よけいなかふん': {
        after: ctx => {
            const { game, defender } = ctx;
            if (!canAffect(ctx, defender)) return;
            const turn = game.turn + 2;
            markedHooks(ctx, defender, 'extraPollen', turn, {
                prizeModifier: (g, source, pokemon) => (pokemon === defender && g.turn === turn ? 2 : 0)
            });
        }
    },
    'テツノブジン/えんざん': {
        after: ctx => reorderTop(ctx.game, ctx.player, ctx.player, 4)
    },
    'エネコロロ/エナジーミキサー': {
        after: ctx => {
            const { game, player } = ctx;
            const move = () => {
                const sources = game.inPlay(player).filter(pokemon => pokemon.energies.length > 0);
                if (sources.length === 0 || game.inPlay(player).length < 2) return;
                game.promptPokemon({
                    player,
                    pokemon: sources,
                    min: 0,
                    max: 1,
                    title: 'エネルギーをつけ替える元のポケモンを選ぶ（終えるなら選ばない）',
                    purpose: 'energy-mixer-source',
                    callback: ([source]) => {
                        if (!source) return;
                        game.promptCards({
                            player,
                            cards: source.energies,
                            min: 1,
                            max: 1,
                            title: 'つけ替えるエネルギーを選ぶ',
                            purpose: 'energy-mixer-card',
                            callback: ([inst]) => {
                                game.promptPokemon({
                                    player,
                                    pokemon: game.inPlay(player).filter(pokemon => pokemon !== source),
                                    min: 1,
                                    max: 1,
                                    title: 'エネルギーをつけ替える先のポケモンを選ぶ',
                                    purpose: 'energy-switch-target',
                                    callback: ([target]) => {
                                        game.moveEnergy(source, target, inst);
                                        game.runNext(move);
                                    }
                                });
                            }
                        });
                    }
                });
            };
            move();
        }
    },
    'ケンホロウ/リバースウインド': {
        after: ctx => {
            const { game, player, defender } = ctx;
            if (!canAffect(ctx, defender) || defender.energies.length === 0) return;
            game.promptConfirm({
                player,
                title: '相手のバトルポケモンのエネルギーを2個、相手の手札にもどしますか？',
                purpose: 'optional-energy-return',
                cpuAnswer: () => true,
                callback: yes => {
                    if (yes) pickEnergies(ctx, defender, 2, selected => moveEnergiesOff(game, defender, selected, 'hand'), { title: '相手の手札にもどすエネルギーを選ぶ' });
                }
            });
        }
    },
    'ダーテング/おいだしトルネード': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            if (opponent.bench.length <= 3) return;
            game.promptPokemon({
                player,
                pokemon: opponent.bench,
                min: 3,
                max: 3,
                title: '残す相手のベンチポケモンを3匹選ぶ（ほかは山札にもどす）',
                purpose: 'keep-opponent-bench',
                // CPU は、エネルギーの少ないポケモンを残す
                cpuAnswer: (g, prompt) => prompt.pokemon.map((pokemon, index) => ({ index, score: pokemon.energies.length }))
                    .sort((a, b) => a.score - b.score || a.index - b.index).slice(0, 3).map(entry => entry.index).sort((a, b) => a - b),
                callback: kept => {
                    opponent.bench.filter(pokemon => !kept.includes(pokemon) && canAffect(ctx, pokemon)).forEach(pokemon => returnToDeck(game, pokemon, { shuffle: false }));
                    game.shuffleDeck(opponent);
                }
            });
        }
    },
    'ベロリンガ/ベロでひきこむ': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            game.revealHand(opponent, player);
            const basics = opponent.hand.filter(inst => { const card = game.cardOf(inst); return card.kind === 'pokemon' && card.stage === 0; });
            const n = Math.min(2, basics.length, game.benchSize - opponent.bench.length);
            if (n <= 0) return;
            game.promptCards({
                player,
                cards: basics,
                min: 0,
                max: n,
                title: `相手のベンチに出すたねポケモンを${n}枚まで選ぶ`,
                purpose: 'bench-opponent',
                cpuAnswer: (g, prompt) => prompt.cards.map((inst, index) => ({ index, hp: g.cardOf(inst).hp }))
                    .sort((a, b) => a.hp - b.hp || a.index - b.index).slice(0, n).map(entry => entry.index).sort((a, b) => a - b),
                callback: selected => selected.forEach(inst => {
                    game.removeCard(opponent.hand, inst);
                    opponent.bench.push(game.createPokemon(inst));
                    game.log(`${opponent.name}のベンチに${game.cardName(inst)}を出した`);
                })
            });
        }
    },
    'ジジーロン/げきこうほう': bonusIf(ctx => ctx.player.bench.length > 0 && ctx.player.bench.every(pokemon => pokemon.damage > 0), 120),
    'イルミーゼ/スローパフューム': {
        canUse: game => game.turn === 2,
        after: ctx => shuffleOpponentBench(ctx, 1)
    },
    'ゴリランダー/ドラムアタック': {
        after: ctx => {
            const { game, defender } = ctx;
            if (!canAffect(ctx, defender)) return;
            markedHooks(ctx, defender, 'drumAttack', game.turn + 1, {
                attackCost: (g, source, pokemon, attack, cost) => (pokemon === defender ? [...cost, 'colorless'] : undefined),
                retreatCost: (g, source, pokemon) => (pokemon === defender ? 1 : 0)
            });
        }
    },
    'ヤバソチャ/ぶちまけちゃ': discardFieldForDamage(game => (pokemon, inst) => provides(game, pokemon, inst, 'grass'), 3, 70),
    'ニョロボン/ジャンピングアッパー': (() => {
        // CPU は、追加でちょうどきぜつさせられ、ベンチにポケモンがいるときだけのぞむ
        const wants = ctx => ctx.player.bench.length > 0 && !wouldKnockOut(ctx, ctx.damage) && wouldKnockOut(ctx, ctx.damage + 120);
        return {
            before: ctx => ctx.game.promptConfirm({
                player: ctx.player,
                title: '120ダメージ追加しますか？（このポケモンと、ついているカードを山札にもどして切る）',
                purpose: 'optional-bonus',
                cpuAnswer: () => wants(ctx),
                callback: yes => {
                    if (!yes) return;
                    ctx.damage += 120;
                    ctx.jumpBack = true;
                }
            }),
            after: ctx => { if (ctx.jumpBack) returnToDeck(ctx.game, ctx.attacker); },
            expected: ctx => ctx.damage + (wants(ctx) ? 120 : 0)
        };
    })(),
    'ルージュラ/おさそいキッス': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            if (player.bench.length >= game.benchSize) return;
            game.searchDeck({
                player,
                filter: card => card.kind === 'pokemon' && card.stage === 0,
                max: 1,
                title: 'ベンチに出すたねポケモンを選ぶ',
                purpose: 'bench-basic',
                onSelected: ([inst]) => {
                    if (!inst) return;
                    const pokemon = game.createPokemon(inst);
                    player.bench.push(pokemon);
                    game.log(`${player.name}は${game.cardName(inst)}をベンチに出した`);
                    game.runNext(() => pickEnergies(ctx, attacker, 1, ([energy]) => { if (energy) game.moveEnergy(attacker, pokemon, energy); }, { title: 'つけ替えるエネルギーを選ぶ' }));
                }
            });
        }
    },
    'ユキワラシ/おどろかす': surprise,
    'テツノツツミ/インタージェット': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            game.runNext(
                () => game.promptSwitchOwnActive(player, 'switch'),
                () => {
                    const bench = opponent.bench.filter(pokemon => canAffect(ctx, pokemon, 'switch'));
                    if (bench.length === 0 || !canAffect(ctx, opponent.active, 'switch')) return;
                    game.promptPokemon({
                        player: opponent,
                        pokemon: bench,
                        min: 1,
                        max: 1,
                        title: 'バトル場に出すポケモンを選ぶ',
                        purpose: 'forced-switch',
                        callback: ([target]) => game.switchActive(opponent, target)
                    });
                }
            );
        }
    },
    'ピクシー/ゆびをふる': copyDefender,
    'フーディン/ストレンジハック': {
        after: ctx => {
            const { game, player, opponent, defender } = ctx;
            if (canAffect(ctx, defender)) game.addCondition(defender, 'confused');
            const move = () => {
                const affected = game.inPlay(opponent).filter(pokemon => canAffect(ctx, pokemon, 'moveCounters'));
                const sources = affected.filter(pokemon => pokemon.damage > 0);
                if (sources.length === 0 || affected.length < 2) return;
                game.promptPokemon({
                    player,
                    pokemon: sources,
                    min: 0,
                    max: 1,
                    title: 'ダメカンをのせ替える元の相手のポケモンを選ぶ（終えるなら選ばない）',
                    purpose: 'counter-source',
                    callback: ([source]) => {
                        if (!source) return;
                        game.promptChoose({
                            player,
                            options: indicesUpTo(counters(source)).map(n => `${n + 1}個`),
                            title: 'のせ替えるダメカンの数を選ぶ',
                            purpose: 'choose-count',
                            callback: ([index]) => game.promptPokemon({
                                player,
                                pokemon: affected.filter(pokemon => pokemon !== source),
                                min: 1,
                                max: 1,
                                title: 'ダメカンをのせ替える先の相手のポケモンを選ぶ',
                                purpose: 'snipe-target',
                                callback: ([target]) => {
                                    moveCounters(game, source, target, index + 1);
                                    game.runNext(move);
                                }
                            })
                        });
                    }
                });
            };
            move();
        }
    },
    'ペロリーム/ペロペロリン': {
        before: ctx => {
            const heads = flipCoins(ctx.game, 2);
            ctx.damage = heads * 90;
            ctx.confuse = heads === 0;
        },
        after: ctx => { if (ctx.confuse && canAffect(ctx, ctx.defender)) ctx.game.addCondition(ctx.defender, 'confused'); },
        expected: () => 90
    },
    'ボスゴドラ/アングリースラム': perCount(ctx => ctx.game.inPlay(ctx.player).filter(pokemon => pokemon.damage > 0).length, 50),
    'ヒードラン/スチールバースト': {
        before: ctx => {
            const energies = typedEnergies(ctx.game, ctx.attacker, 'metal');
            moveEnergiesOff(ctx.game, ctx.attacker, energies);
            ctx.damage = energies.length * 50;
        },
        expected: ctx => typedEnergies(ctx.game, ctx.attacker, 'metal').length * 50
    },
    'キマワリ/ひざしがえし': perCount(ctx => ctx.game.inPlay(ctx.opponent).reduce((sum, pokemon) => sum + typedEnergies(ctx.game, pokemon, 'fire').length, 0), 60),
    'チリーン/おかえりチャイム': {
        after: ctx => {
            const { game, player } = ctx;
            if (player.bench.length === 0) return;
            game.promptPokemon({
                player,
                pokemon: player.bench,
                min: 1,
                max: 1,
                title: '山札にもどすベンチポケモンを選ぶ',
                purpose: 'return-own',
                cpuAnswer: (g, prompt) => [bestIndex(prompt.pokemon, pokemon => pokemon.damage)],
                callback: ([pokemon]) => returnToDeck(game, pokemon)
            });
        }
    },
    'ラッキー/ラッキーアタッチ': {
        after: ctx => attachFromHand(ctx, card => isBasicEnergy(card), player => ctx.game.inPlay(player))
    },
    'オーガポン いどのめんex/げきりゅうポンプ': {
        after: ctx => {
            const { game, player, opponent, attacker } = ctx;
            if (attacker.energies.length < 3) return;
            game.promptConfirm({
                player,
                title: 'このポケモンのエネルギーを3個山札にもどして、相手のベンチポケモン1匹に120ダメージを与えますか？',
                purpose: 'optional-bonus',
                cpuAnswer: g => opponent.bench.some(pokemon => remainingHp(g, pokemon) <= 120),
                callback: yes => {
                    if (!yes) return;
                    pickEnergies(ctx, attacker, 3, selected => {
                        moveEnergiesOff(game, attacker, selected, 'deck');
                        game.shuffleDeck(player);
                        damageChosen(ctx, opponent.bench, 1, 120);
                    }, { title: '山札にもどすエネルギーを選ぶ' });
                }
            });
        }
    },
    'デンチュラ/ビリビリウェブ': bonusIf(ctx => typedEnergies(ctx.game, ctx.attacker, 'lightning').length > 0, 80),
    'フクスロー/だんけつのつばさ': perCount(ctx => ctx.player.discard.filter(inst => {
        const card = ctx.game.cardOf(inst);
        return card.kind === 'pokemon' && card.attacks.some(attack => attack.name === 'だんけつのつばさ');
    }).length, 20),
    'ジュナイパー/フェザーストック': {
        after: ctx => {
            const count = 7 - ctx.player.hand.length;
            if (count > 0) ctx.game.draw(ctx.player, count);
        }
    },
    'ジュナイパー/ストロングショット': {
        before: ctx => {
            const { game, player } = ctx;
            const inst = player.hand.find(card => isBasicEnergy(game.cardOf(card), 'grass'));
            if (!inst) {
                fail(ctx);
                return;
            }
            game.moveCard(player.hand, player.discard, inst);
            game.log(`${player.name}は手札の${game.cardName(inst)}をトラッシュした`);
        },
        expected: ctx => (ctx.player.hand.some(inst => isBasicEnergy(ctx.game.cardOf(inst), 'grass')) ? ctx.damage : 0)
    },
    'スリーパー/はくちゅうむ': {
        after: ctx => {
            const { game, opponent, defender } = ctx;
            if (!canAffect(ctx, defender)) return;
            const turn = game.turn + 1;
            markedHooks(ctx, defender, 'daydream', turn, {
                onAttachEnergy: (g, source, who, pokemon) => {
                    if (g.turn !== turn || who !== opponent || pokemon !== defender) return;
                    g.log('はくちゅうむの効果で、番が終わる');
                    g.endTurnByEffect(who);
                }
            });
        }
    },
    'ニンフィア/ミスティックリターン': {
        after: ctx => { if (ctx.game.flipCoin()) shuffleOpponentBench(ctx, 1); }
    },
    'マーイーカ/いたずらしょくしゅ': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            if (opponent.deck.length === 0) return;
            game.log(`${player.name}は${opponent.name}の山札を上から1枚見た`);
            game.log(`山札の上：${game.cardName(opponent.deck[0])}`, { to: player.id });
            game.promptConfirm({
                player,
                title: `相手の山札の上は${game.cardName(opponent.deck[0])}。相手の山札を切りますか？`,
                purpose: 'optional-shuffle',
                callback: yes => {
                    if (!yes) return;
                    game.shuffleDeck(opponent);
                    game.log(`${opponent.name}の山札を切った`);
                }
            });
        }
    },
    'カラマネロ/けったくテンタクル': {
        before: ctx => { if (!ctx.game.turnState.supporterNames.includes('クセロシキのたくらみ')) fail(ctx); },
        after: ctx => {
            const { game, player, opponent } = ctx;
            // 入れ替えの効果を受けないポケモンは選べない（バトルポケモンが受けないなら、入れ替えられない）
            const bench = opponent.bench.filter(pokemon => canAffect(ctx, pokemon, 'switch'));
            if (bench.length === 0 || !canAffect(ctx, opponent.active, 'switch')) return;
            game.promptPokemon({
                player,
                pokemon: bench,
                min: 1,
                max: 1,
                title: 'バトル場に呼び出す相手のポケモンを選ぶ（120ダメージ）',
                purpose: 'snipe-target',
                amount: 120,
                callback: ([target]) => {
                    game.switchActive(opponent, target);
                    // 「新しく出てきたポケモン」にだけダメージを与える
                    if (opponent.active === target) game.dealAttackDamage(ctx, target, 120);
                }
            });
        },
        expected: ctx => (ctx.game.turnState.supporterNames.includes('クセロシキのたくらみ') ? 120 : 0)
    },
    'イベルタル/むしばむかぜ': {
        after: ctx => ctx.game.inPlay(ctx.opponent).filter(pokemon => pokemon.damage > 0 && canAffect(ctx, pokemon)).forEach(pokemon => ctx.game.putDamage(pokemon, 20))
    },
    'ダイオウドウ/ノーズラリアット': (() => {
        const wants = ctx => !wouldKnockOut(ctx, ctx.damage) && wouldKnockOut(ctx, ctx.damage + 100);
        return {
            before: ctx => ctx.game.promptConfirm({
                player: ctx.player,
                title: '100ダメージ追加しますか？（次の自分の番、このポケモンはワザが使えない）',
                purpose: 'optional-bonus',
                cpuAnswer: () => wants(ctx),
                callback: yes => {
                    if (!yes) return;
                    ctx.damage += 100;
                    ctx.game.addEffect(ctx.attacker, 'cannotAttack', ctx.game.turn + 2);
                }
            }),
            expected: ctx => ctx.damage + (wants(ctx) ? 100 : 0)
        };
    })(),
    'オノノクス/アックスダウン': {
        after: ctx => {
            const { game, defender } = ctx;
            if (canAffect(ctx, defender) && defender.energies.some(inst => isSpecialEnergy(game.cardOf(inst)))) knockOut(game, defender);
        }
    },
    'ヨマワル/むかえにいく': {
        after: ctx => benchFromDiscard(ctx.game, ctx.player, card => card.name === 'ヨマワル', 3)
    },
    'キングドラex/おうのごうれい': {
        after: ctx => benchFromDiscard(ctx.game, ctx.player, card => card.type === 'water', 3)
    },
    'ブロロロームex/アクセルフラッシュ': bonusIf(ctx => ctx.attacker.movedToActiveTurn === ctx.game.turn, 120),
    'ブロロロームex/スピードブレイク': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            if (!game.inPlay(player).includes(attacker)) return;
            game.log(`${game.topCard(attacker).name}と、ついているすべてのカードをトラッシュした`);
            game.removeFromPlay(player, attacker);
        }
    },
    'イイネイヌex/ポイズンマッスル': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            game.searchDeck({
                player,
                filter: card => isBasicEnergy(card, 'darkness'),
                max: 2,
                title: 'このポケモンにつける基本悪エネルギーを2枚まで選ぶ',
                purpose: 'search-energy',
                onSelected: found => {
                    found.forEach(inst => game.attachFromOutside(attacker, inst));
                    if (found.length > 0) game.addCondition(attacker, 'poisoned');
                }
            });
        }
    },
    'カットロトム/かりとりダッシュ': {
        before: ctx => {
            const { game, defender } = ctx;
            if (!canAffect(ctx, defender)) return;
            game.discardTool(defender);
            moveEnergiesOff(game, defender, defender.energies.filter(inst => isSpecialEnergy(game.cardOf(inst))));
        },
        expected: ctx => ctx.damage
    },
    'ワタシラガ/そよかぜギフト': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            returnToDeck(game, attacker, { shuffle: false });
            game.searchDeck({
                player,
                filter: () => true,
                max: 3,
                title: '手札に加えるカードを3枚まで選ぶ',
                purpose: 'search-card',
                onSelected: found => game.addToHand(player, found)
            });
        }
    },
    'エンニュート/いきなりあぶる': {
        after: ctx => {
            const { game, opponent } = ctx;
            const count = 1 + (game.evolvedThisTurnFrom(ctx.attacker, 'ヤトウモリ') ? 2 : 0);
            const n = Math.min(count, opponent.hand.length);
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
        }
    },
    'エレキブル/ライトニングダウン': {
        after: ctx => {
            const turn = ctx.game.turn + 2;
            ctx.game.addPlayerEffect(ctx.player, 'lightningDown', turn, {
                hooks: { blockAttack: (g, source, who) => (who === source.player && g.turn === turn ? 'ライトニングダウンの効果で、この番はワザが使えません' : null) }
            });
        }
    },
    'クワガノン/ボルトチェンジ': {
        after: ctx => {
            const { game, player } = ctx;
            const targets = player.bench.filter(pokemon => hasType(game, pokemon, 'lightning'));
            if (targets.length === 0) return;
            game.promptPokemon({
                player,
                pokemon: targets,
                min: 1,
                max: 1,
                title: '入れ替えるベンチの雷ポケモンを選ぶ',
                purpose: 'switch',
                callback: ([target]) => game.switchActive(player, target)
            });
        }
    },
    'トゲデマル/ビリビリチャンス': {
        after: ctx => { if (ctx.player.prizes.length === 1 && canAffect(ctx, ctx.defender)) ctx.game.addCondition(ctx.defender, 'paralyzed'); }
    },
    'ヤドキング/ひらめきチャレンジ': {
        copiesAttack: true,
        before: ctx => {
            const { game, player } = ctx;
            const top = player.deck[0];
            game.millDeck(player, 1);
            const card = top && game.cardOf(top);
            if (!card || card.kind !== 'pokemon' || card.rule) {
                ctx.damage = 0;
                return;
            }
            chooseAttackToCopy(ctx, card.attacks, `このワザとして使う、${card.name}のワザを選ぶ`);
        },
        after: copiedAfter,
        expected: () => 0
    },
    'フワライド/みんなでばくはつ': (() => {
        const members = ctx => ctx.game.inPlay(ctx.player).filter(pokemon => ['フワンテ', 'フワライド'].includes(ctx.game.topCard(pokemon).name));
        return {
            before: ctx => { ctx.damage = members(ctx).length * 50; },
            after: ctx => members(ctx).forEach(pokemon => ctx.game.putDamage(pokemon, 30)),
            expected: ctx => members(ctx).length * 50
        };
    })(),
    'キュワワー/フラワーシャワー': {
        after: ctx => {
            ctx.game.draw(ctx.player, 3);
            ctx.game.draw(ctx.opponent, 3);
        }
    },
    'マホイップ/いろどりスイーツ': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            const types = new Set(attacker.energies.map(inst => game.cardOf(inst)).filter(card => card.basic).map(card => card.energyType));
            game.searchDeck({
                player,
                filter: card => card.kind === 'pokemon' && types.has(card.type),
                max: 5,
                title: '手札に加えるポケモンを5枚まで選ぶ',
                purpose: 'search-card',
                onSelected: found => game.addToHand(player, found, { reveal: true })
            });
        }
    },
    'テツノイワオ/アジャストホーン': failUnless(ctx => ctx.player.hand.length === ctx.opponent.hand.length),
    'ガラガラ/ほねリベンジ': bonusIf(ctx => ctx.player.bench.some(pokemon => ctx.game.topCard(pokemon).name === 'カラカラ' && pokemon.damage > 0), 120),
    'ディアンシー/らんはんしゃ': perCount(ctx => ctx.game.inPlay(ctx.opponent)
        .reduce((sum, pokemon) => sum + pokemon.energies.filter(inst => isSpecialEnergy(ctx.game.cardOf(inst))).length, 0), 40),
    'SV7-060/じんけいをくむ': rememberUse('SV7-060', 'じんけいをくむ'),
    'タイレーツ/いっせいこうげき': bonusIf(ctx => usedLastTurn(ctx, 'じんけいをくむ'), 90),
    'マルノーム/パックンマウス': bonusIf(ctx => Boolean(ctx.defender) && ctx.attacker.energies.length > ctx.defender.energies.length, 160),
    'オーロンゲ/ちょうはつクラッチ': {
        after: ctx => {
            const { game, opponent } = ctx;
            // 入れ替えの効果を受けないポケモンは、バトル場に出す候補にしない
            const bench = opponent.bench.filter(pokemon => canAffect(ctx, pokemon, 'switch'));
            if (bench.length === 0 || !canAffect(ctx, opponent.active, 'switch')) return;
            game.promptPokemon({
                player: opponent,
                pokemon: bench,
                min: 1,
                max: 1,
                title: 'バトル場に出すポケモンを選ぶ',
                purpose: 'forced-switch',
                callback: ([target]) => {
                    game.switchActive(opponent, target);
                    // 「新しく出てきたポケモン」にだけダメージを与える
                    if (opponent.active === target) game.dealAttackDamage(ctx, target, 160);
                }
            });
        },
        expected: ctx => (ctx.opponent.bench.length > 0 ? 160 : 0)
    },
    'メルメタル/リモデルアックス': {
        before: ctx => {
            if (!ctx.attacker.tool) {
                fail(ctx);
                return;
            }
            ctx.game.discardTool(ctx.attacker);
        },
        expected: ctx => (ctx.attacker.tool ? ctx.damage : 0)
    },
    'ファイアロー/エアロチェイス': bonusIf(ctx => Boolean(ctx.defender) && ctx.game.retreatCost(ctx.defender) >= 2, 110),
    'バチュル/バチュチャージ': {
        after: ctx => {
            const { game, player } = ctx;
            const search = (type, then) => game.searchDeck({
                player,
                filter: card => isBasicEnergy(card, type),
                max: 2,
                title: `${type === 'grass' ? '基本草' : '基本雷'}エネルギーを2枚まで選ぶ`,
                purpose: 'search-energy',
                onSelected: then
            });
            search('grass', grass => search('lightning', lightning => game.attachAnyWay(player, [...grass, ...lightning], () => true, 'attach-energy-target')));
        }
    },
    'ラプラスex/ラリマーレイン': {
        after: ctx => {
            const { game, player } = ctx;
            const top = player.deck.slice(0, 20);
            game.log(`${player.name}は山札を上から${top.length}枚見た`);
            const energies = top.filter(inst => game.cardOf(inst).kind === 'energy');
            if (energies.length === 0) {
                game.shuffleDeck(player);
                return;
            }
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: energies.length,
                title: '自分のポケモンにつけるエネルギーを選ぶ',
                purpose: 'energy-from-top',
                cpuAnswer: () => indicesUpTo(energies.length),
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.deck, inst));
                    game.shuffleDeck(player);
                    game.attachAnyWay(player, selected, () => true, 'attach-energy-target');
                }
            });
        }
    },
    'テラパゴスex/クラウンオパール': {
        after: ctx => {
            const { game, attacker } = ctx;
            markedHooks(ctx, attacker, 'crownOpal', game.turn + 1, {
                preventDamage: (g, source, attackCtx, target) => target === attacker && !attackCtx.ignoreEffects
                    && g.topCard(attackCtx.attacker).stage === 0 && !g.typesOf(attackCtx.attacker).includes('colorless')
            });
        }
    },
    'ザルード/ジャングルウィップ': (() => {
        const wants = ctx => !wouldKnockOut(ctx, ctx.damage) && wouldKnockOut(ctx, ctx.damage + 80);
        return {
            before: ctx => ctx.game.promptConfirm({
                player: ctx.player,
                title: 'このポケモンのエネルギーをすべて手札にもどし、80ダメージ追加しますか？',
                purpose: 'optional-bonus',
                cpuAnswer: () => wants(ctx),
                callback: yes => {
                    if (!yes) return;
                    moveEnergiesOff(ctx.game, ctx.attacker, [...ctx.attacker.energies], 'hand');
                    ctx.damage += 80;
                }
            }),
            expected: ctx => ctx.damage + (wants(ctx) ? 80 : 0)
        };
    })(),
    'ポワルン たいようのすがた/サニーアシスト': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            if (player.bench.length === 0 || attacker.energies.length === 0) return;
            game.promptPokemon({
                player,
                pokemon: player.bench,
                min: 1,
                max: 1,
                title: 'エネルギーをすべてつけ替えるベンチポケモンを選ぶ',
                purpose: 'energy-switch-target',
                callback: ([target]) => [...attacker.energies].forEach(inst => game.moveEnergy(attacker, target, inst))
            });
        }
    },
    'ブラックキュレムex/アイスエイジ': {
        after: ctx => { if (canAffect(ctx, ctx.defender) && hasType(ctx.game, ctx.defender, 'dragon')) ctx.game.addCondition(ctx.defender, 'paralyzed'); }
    },
    'ムチュール/るんるんキッス': {
        after: ctx => {
            const { game, player } = ctx;
            if (player.bench.length === 0) return;
            game.searchDeck({
                player,
                filter: card => isBasicEnergy(card),
                max: 2,
                title: 'ベンチポケモンにつける基本エネルギーを2枚まで選ぶ',
                purpose: 'search-energy',
                onSelected: found => {
                    if (found.length === 0) return;
                    game.promptPokemon({
                        player,
                        pokemon: player.bench,
                        min: 1,
                        max: 1,
                        title: 'エネルギーをつけるベンチポケモンを選ぶ',
                        purpose: 'attach-energy-target',
                        callback: ([target]) => found.forEach(inst => game.attachFromOutside(target, inst))
                    });
                }
            });
        }
    },
    'クエスパトラ/ミスティックアイ': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            // 退化の効果を受けないポケモンと、手札にもどせないポケモン（なぎのきょうち）は選べない
            const targets = game.inPlay(opponent).filter(pokemon => pokemon.cards.length > 1 && canAffect(ctx, pokemon, 'devolve')
                && !game.hookAny('blockReturnToHand', pokemon));
            if (targets.length === 0) return;
            game.promptPokemon({
                player,
                pokemon: targets,
                min: 1,
                max: 1,
                title: '退化させる相手のポケモンを選ぶ',
                purpose: 'devolve-target',
                cpuAnswer: (g, prompt) => [bestIndex(prompt.pokemon, pokemon => pokemon.damage - g.maxHp(pokemon) + g.topCard(pokemon).hp)],
                callback: ([target]) => devolve(game, target, 'hand')
            });
        }
    },
    'ナゲツケサル/れんけいスロー': perCount(ctx => ctx.game.inPlay(ctx.player).filter(pokemon => ctx.game.topCard(pokemon).stage === 0).length, 20),
    'テツノカシラ/デリートスラッシュ': bonusIf(ctx => ctx.opponent.bench.length >= 3, 80),
    'ディアルガ/タイムコントロール': {
        after: ctx => {
            const { game, player } = ctx;
            const n = Math.min(2, player.deck.length);
            if (n === 0) return;
            game.promptCards({
                player,
                cards: player.deck,
                min: n,
                max: n,
                title: `山札の上に置くカードを${n}枚選ぶ`,
                purpose: 'search-card',
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.deck, inst));
                    game.shuffleDeck(player);
                    const place = ordered => {
                        player.deck.unshift(...ordered);
                        game.log(`${player.name}は山札から${ordered.length}枚選び、山札を切って、山札の上に置いた`);
                    };
                    if (selected.length < 2) {
                        place(selected);
                        return;
                    }
                    game.promptCards({
                        player,
                        cards: selected,
                        min: 1,
                        max: 1,
                        title: '山札の一番上にするカードを選ぶ',
                        purpose: 'order-deck',
                        callback: ([first]) => place([first, ...selected.filter(inst => inst !== first)])
                    });
                }
            });
        }
    },
    'パルキア/スペースクラッシュ': perCount(ctx => ctx.attacker.energies.filter(inst => ctx.game.cardOf(inst).basic).length, 40),
    'バクガメス/こがしつくす': {
        after: ctx => {
            const { game, defender } = ctx;
            if (!canAffect(ctx, defender) || !isEx(game.topCard(defender))) return;
            pickEnergies(ctx, defender, 1, selected => moveEnergiesOff(game, defender, selected), { title: 'トラッシュするエネルギーを選ぶ' });
        }
    },
    'モトトカゲex/ジルコンロード': {
        after: ctx => {
            const { game, player } = ctx;
            if (player.deck.length === 0) return;
            game.promptConfirm({
                player,
                title: '山札を5枚引きますか？',
                purpose: 'optional-draw',
                cpuAnswer: () => player.deck.length > 10,
                callback: yes => { if (yes) game.draw(player, 5); }
            });
        }
    },
    'ナッシー/たまなげアワー': {
        before: ctx => { ctx.damage = flipCoins(ctx.game, ctx.attacker.energies.length + (ctx.defender?.energies.length ?? 0)) * 60; },
        expected: ctx => (ctx.attacker.energies.length + (ctx.defender?.energies.length ?? 0)) * 30
    },
    'ベラカス/どんでんがえし': bonusIf(ctx => ctx.player.deck.length <= 3, 200),
    'チオンジェン/グリードハザード': {
        after: ctx => { if (ctx.player.deck.length <= 3) damageChosen(ctx, ctx.opponent.bench, 2, 120); }
    },
    'グレンアルマ/グレンブラスター': {
        after: ctx => {
            moveEnergiesOff(ctx.game, ctx.attacker, typedEnergies(ctx.game, ctx.attacker, 'fire'));
            damageChosen(ctx, ctx.opponent.bench, 1, 180);
        }
    },
    'パルデア ケンタロス/かちあげホーン': {
        after: ctx => {
            const { game, player, defender } = ctx;
            if (!canAffect(ctx, defender) || game.topCard(defender).stage !== 2 || defender.energies.length === 0) return;
            game.promptConfirm({
                player,
                title: '相手のバトルポケモンのエネルギーを2個、相手の手札にもどしますか？',
                purpose: 'optional-energy-return',
                cpuAnswer: () => true,
                callback: yes => {
                    if (yes) pickEnergies(ctx, defender, 2, selected => moveEnergiesOff(game, defender, selected, 'hand'), { title: '相手の手札にもどすエネルギーを選ぶ' });
                }
            });
        }
    },
    'トドゼルガ/とうけつファング': {
        after: ctx => ctx.game.addPlayerEffect(ctx.opponent, 'freezeFang', ctx.game.turn + 1, {
            hooks: { blockAttack: (g, source, who, pokemon) => (who === source.player && pokemon.energies.length <= 2 ? 'とうけつファングの効果で、エネルギーが2個以下のポケモンはワザが使えません' : null) }
        })
    },
    'ロトム/クラッシュパルス': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            game.revealHand(opponent, player);
            const targets = opponent.hand.filter(inst => { const card = game.cardOf(inst); return card.kind === 'trainer' && (card.trainerType === 'item' || card.trainerType === 'tool'); });
            targets.forEach(inst => game.moveCard(opponent.hand, opponent.discard, inst));
            if (targets.length) game.log(`${opponent.name}の手札の${targets.map(inst => game.cardName(inst)).join('と')}をトラッシュした`);
        }
    },
    'ロトム/おどろかす': surprise,
    'タイカイデン/ストームボルト': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            if (player.bench.length === 0) return;
            const steps = [...attacker.energies].map(inst => () => {
                if (!attacker.energies.includes(inst)) return;
                if (player.bench.length === 1) {
                    game.moveEnergy(attacker, player.bench[0], inst);
                    return;
                }
                game.promptPokemon({
                    player,
                    pokemon: player.bench,
                    min: 1,
                    max: 1,
                    title: `${game.cardName(inst)}をつけ替えるベンチポケモンを選ぶ`,
                    purpose: 'energy-switch-target',
                    callback: ([target]) => game.moveEnergy(attacker, target, inst)
                });
            });
            game.runNext(...steps);
        }
    },
    'ユクシー/いたみのきおく': {
        after: ctx => ctx.game.inPlay(ctx.opponent).filter(pokemon => canAffect(ctx, pokemon)).forEach(pokemon => ctx.game.putDamage(pokemon, 20))
    },
    'デスカーン/めいふのおきて': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const hasAbility = pokemon => Boolean(game.topCard(pokemon).ability) && !game.abilitySuppressed(pokemon);
            const theirs = game.inPlay(opponent).filter(pokemon => hasAbility(pokemon) && canAffect(ctx, pokemon));
            const mine = game.inPlay(player).filter(hasAbility);
            [...theirs, ...mine].forEach(pokemon => game.putDamage(pokemon, 60));
        }
    },
    'コノヨザル/みちづれファイト': {
        after: ctx => {
            const { game, attacker, defender } = ctx;
            if (canAffect(ctx, defender)) knockOut(game, defender);
            knockOut(game, attacker);
        }
    },
    'パルデア ケンタロス/ブロックスタンプ': {
        after: ctx => {
            const { game, defender } = ctx;
            if (canAffect(ctx, defender) && game.topCard(defender).stage === 0) game.addEffect(defender, 'cannotAttack', game.turn + 1);
        }
    },
    'タギングル/いたずらペイント': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const energies = opponent.discard.filter(inst => game.cardOf(inst).kind === 'energy');
            const targets = () => game.inPlay(opponent).filter(pokemon => canAffect(ctx, pokemon));
            const n = Math.min(3, energies.length);
            if (n === 0 || targets().length === 0) return;
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: n,
                title: '相手のトラッシュから、相手のポケモンにつけるエネルギーを3枚まで選ぶ',
                purpose: 'opponent-energy-from-discard',
                callback: selected => {
                    const steps = selected.map(inst => () => {
                        const list = targets();
                        if (list.length === 0) return;
                        game.promptPokemon({
                            player,
                            pokemon: list,
                            min: 1,
                            max: 1,
                            title: `${game.cardName(inst)}をつける相手のポケモンを選ぶ`,
                            purpose: 'opponent-energy-target',
                            callback: ([target]) => {
                                game.removeCard(opponent.discard, inst);
                                game.attachFromOutside(target, inst);
                            }
                        });
                    });
                    game.runNext(...steps);
                }
            });
        }
    },
    'ムゲンダイナ/ワールドエンド': {
        before: ctx => {
            if (!ctx.game.stadium) {
                fail(ctx);
                return;
            }
            ctx.game.discardStadium();
        },
        expected: ctx => (ctx.game.stadium ? ctx.damage : 0)
    },
    'ザングース/れんぞくぎり': {
        before: ctx => { ctx.damage += [0, 20, 50, 80][flipCoins(ctx.game, 3)]; },
        // オモテが1回は 3/8、2回は 3/8、3回は 1/8
        expected: ctx => ctx.damage + (3 * 20 + 3 * 50 + 80) / 8
    },
    'ヤレユータン/よわみをにぎる': {
        after: ctx => {
            const { game, defender } = ctx;
            if (!canAffect(ctx, defender)) return;
            markedHooks(ctx, defender, 'weaknessGrip', game.turn + 2, {
                weaknessOverride: (g, source, pokemon) => (pokemon === defender ? 'colorless' : undefined)
            });
        }
    },
    'ビビヨン/エボルパウダー': {
        after: ctx => {
            const { game, player } = ctx;
            const steps = [...player.bench].map(pokemon => () => {
                if (!player.bench.includes(pokemon)) return;
                const name = game.topCard(pokemon).name;
                const canEvolve = card => card.kind === 'pokemon' && card.evolvesFrom === name
                    && !game.checkCanEvolveNow(player, pokemon, card) && !game.hookAny('blockEvolve', player, pokemon, card);
                if (!player.deck.some(inst => canEvolve(game.cardOf(inst)))) return;
                game.searchDeck({
                    player,
                    filter: canEvolve,
                    max: 1,
                    title: `${name}を進化させるカードを選ぶ`,
                    purpose: 'search-evolution',
                    onSelected: ([inst]) => { if (inst) game.evolveFromOutside(player, pokemon, inst); }
                });
            });
            game.runNext(...steps, () => game.shuffleDeck(player));
        }
    },
    'ソウブレイズ/ブレイズカース': {
        after: ctx => ctx.game.inPlay(ctx.opponent).filter(pokemon => canAffect(ctx, pokemon))
            .forEach(pokemon => moveEnergiesOff(ctx.game, pokemon, pokemon.energies.filter(inst => isSpecialEnergy(ctx.game.cardOf(inst)))))
    },
    'マッギョ/バチッとしびれる': {
        after: ctx => {
            const { game, defender } = ctx;
            if (!game.flipCoin() || !canAffect(ctx, defender)) return;
            game.addCondition(defender, 'paralyzed');
            pickEnergies(ctx, defender, 1, selected => moveEnergiesOff(game, defender, selected), { title: 'トラッシュするエネルギーを選ぶ' });
        }
    },
    'エムリット/こころをみたす': {
        after: ctx => {
            const { game, player } = ctx;
            const energies = player.hand.filter(inst => isBasicEnergy(game.cardOf(inst), 'psychic'));
            const n = Math.min(2, energies.length);
            if (n === 0) return;
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: n,
                title: '自分のポケモンにつける基本超エネルギーを2枚まで選ぶ',
                purpose: 'attach-from-hand',
                cpuAnswer: () => indicesUpTo(n),
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.hand, inst));
                    game.attachAnyWay(player, selected, () => true, 'attach-energy-target');
                }
            });
        }
    },
    'シロデスナex/バライトジェイル': {
        after: ctx => ctx.opponent.bench.filter(pokemon => canAffect(ctx, pokemon)).forEach(pokemon => {
            const extra = remainingHp(ctx.game, pokemon) - 100;
            if (extra > 0) ctx.game.putDamage(pokemon, extra);
        })
    },
    'シャリタツex/シナバールアー': {
        after: ctx => benchFromTop(ctx.game, ctx.player, 10)
    },
    'ブースターex/バーニングチャージ': {
        after: ctx => {
            const { game, player } = ctx;
            game.searchDeck({
                player,
                filter: card => isBasicEnergy(card),
                max: 2,
                title: 'つける基本エネルギーを2枚まで選ぶ',
                purpose: 'search-energy',
                onSelected: found => {
                    if (found.length === 0) return;
                    const targets = game.inPlay(player);
                    const attach = target => found.forEach(inst => game.attachFromOutside(target, inst));
                    if (targets.length === 1) {
                        attach(targets[0]);
                        return;
                    }
                    game.promptPokemon({ player, pokemon: targets, min: 1, max: 1, title: 'エネルギーをつけるポケモンを選ぶ', purpose: 'attach-energy-target', callback: ([target]) => attach(target) });
                }
            });
        }
    },
    'グレイシアex/ユークレース': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            const targets = game.inPlay(opponent).filter(pokemon => counters(pokemon) === 6 && canAffect(ctx, pokemon, 'counters'));
            if (targets.length === 0) return;
            game.promptPokemon({
                player,
                pokemon: targets,
                min: 1,
                max: 1,
                title: 'きぜつさせる相手のポケモンを選ぶ',
                purpose: 'knockout-target',
                cpuAnswer: (g, prompt) => [bestIndex(prompt.pokemon, pokemon => g.prizeValue(g.topCard(pokemon)))],
                callback: ([target]) => knockOut(game, target)
            });
        }
    },
    'サンダースex/フラッシュスピア': {
        before: ctx => {
            const { game, player } = ctx;
            const owners = fieldEnergies(game, player.bench, (pokemon, inst) => game.cardOf(inst).basic);
            const cards = [...owners.keys()];
            const n = Math.min(2, cards.length);
            if (n === 0) return;
            game.promptCards({
                player,
                cards,
                min: 0,
                max: n,
                title: 'トラッシュするベンチポケモンの基本エネルギーを2枚まで選ぶ（1枚につき90ダメージ追加）',
                purpose: 'discard-for-damage',
                cpuAnswer: () => indicesUpTo(countToKnockOut(ctx, ctx.damage, 90, n)),
                callback: selected => {
                    discardFieldEnergies(game, owners, selected);
                    ctx.damage += selected.length * 90;
                }
            });
        },
        expected: ctx => ctx.damage + Math.min(2, fieldEnergies(ctx.game, ctx.player.bench, (pokemon, inst) => ctx.game.cardOf(inst).basic).size) * 90
    },
    'エーフィex/アマゼツ': {
        after: ctx => {
            const { game, opponent } = ctx;
            const targets = game.inPlay(opponent).filter(pokemon => pokemon.cards.length > 1 && canAffect(ctx, pokemon));
            if (targets.length === 0) return;
            targets.forEach(pokemon => devolve(game, pokemon, 'deck'));
            game.shuffleDeck(opponent);
        }
    },
    'ニンフィアex/エンジェライト': {
        canUse: (game, player) => !player.effects.some(effect => effect.kind === 'angelite' && effect.turn === game.turn - 2),
        after: ctx => {
            ctx.game.addPlayerEffect(ctx.player, 'angelite', ctx.game.turn + 2, { turn: ctx.game.turn });
            shuffleOpponentBench(ctx, 2);
        }
    },
    'ブラッキーex/オニキス': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            moveEnergiesOff(game, attacker, [...attacker.energies]);
            const taken = player.prizes.splice(0, 1);
            if (taken.length === 0) return;
            player.hand.push(...taken);
            game.log(`${player.name}はサイドを1枚取った（残り${player.prizes.length}枚）`);
            game.log(`サイドから${game.cardName(taken[0])}を手札に加えた`, { to: player.id });
        }
    },
    'バタフリー/りんぷんハリケーン': {
        before: ctx => {
            const heads = flipCoins(ctx.game, 4);
            ctx.damage = heads * 60;
            ctx.paralyze = heads >= 2;
        },
        after: ctx => { if (ctx.paralyze && canAffect(ctx, ctx.defender)) ctx.game.addCondition(ctx.defender, 'paralyzed'); },
        expected: () => 120
    },
    'ニャローテ/マジカルリーフ': {
        before: ctx => {
            if (!ctx.game.flipCoin()) return;
            ctx.damage += 30;
            ctx.healSelf = true;
        },
        after: ctx => { if (ctx.healSelf) ctx.game.heal(ctx.attacker, 30); },
        expected: ctx => ctx.damage + 15
    },
    'オクタン/アクアウォッシャー': {
        after: ctx => {
            const { game, player, defender } = ctx;
            if (!canAffect(ctx, defender) || defender.energies.length === 0) return;
            game.promptConfirm({
                player,
                title: '相手のバトルポケモンのエネルギーを1個、相手の手札にもどしますか？',
                purpose: 'optional-energy-return',
                cpuAnswer: () => true,
                callback: yes => {
                    if (yes) pickEnergies(ctx, defender, 1, selected => moveEnergiesOff(game, defender, selected, 'hand'), { title: '相手の手札にもどすエネルギーを選ぶ' });
                }
            });
        }
    },
    'ナンジャモのビリリダマ/チェインボルト': perCount(ctx => ctx.game.inPlay(ctx.player).filter(pokemon => nameStarts(ctx.game, pokemon, 'ナンジャモの'))
        .reduce((sum, pokemon) => sum + typedEnergies(ctx.game, pokemon, 'lightning').length, 0), 20, true),
    'Nのバチュル/バチバチショート': {
        before: ctx => {
            const { game, defender } = ctx;
            if (!defender?.tool || !canAffect(ctx, defender)) return;
            game.discardTool(defender);
            ctx.toolDiscarded = true;
        },
        after: ctx => { if (ctx.toolDiscarded && canAffect(ctx, ctx.defender)) ctx.game.addCondition(ctx.defender, 'paralyzed'); },
        expected: ctx => ctx.damage
    },
    'バリヤード/ものまね': {
        after: ctx => {
            ctx.game.shuffleHandIntoDeck(ctx.player);
            if (ctx.opponent.hand.length > 0) ctx.game.draw(ctx.player, ctx.opponent.hand.length);
        }
    },
    'イワンコ/ほりかえす': {
        after: ctx => {
            const { game, player } = ctx;
            if (player.deck.length === 0) return;
            const top = player.deck[0];
            game.log(`${player.name}は山札を上から1枚見た`);
            game.promptConfirm({
                player,
                title: `山札の上は${game.cardName(top)}。トラッシュしますか？`,
                purpose: 'optional-mill',
                callback: yes => { if (yes) game.millDeck(player, 1); }
            });
        }
    },
    'SV9-057/じゅうまんガス': rememberUse('SV9-057', 'じゅうまんガス'),
    'マタドガス/クレイジーボム': bonusIf(ctx => usedLastTurn(ctx, 'じゅうまんガス'), 120),
    'Nのチョロネコ/ちょろまかす': {
        after: ctx => {
            const { game, player, opponent } = ctx;
            game.revealHand(opponent, player);
            if (opponent.hand.length === 0) return;
            game.promptCards({
                player,
                cards: opponent.hand,
                min: 1,
                max: 1,
                title: '相手の山札の下にもどすカードを選ぶ',
                purpose: 'opponent-hand-to-bottom',
                callback: ([inst]) => {
                    game.moveCard(opponent.hand, opponent.deck, inst);
                    game.log(`${opponent.name}の手札の${game.cardName(inst)}を山札の下にもどした`);
                }
            });
        }
    },
    'ロケット団のミミッキュ/ほうせきごっこ': (() => {
        // 相手のバトル場の「テラスタル」のポケモンが持つワザを1つ選び、このワザとして使う
        const attacksOf = ctx => (ctx.opponent.active && ctx.game.topCard(ctx.opponent.active).tera ? ctx.game.topCard(ctx.opponent.active).attacks : []);
        return {
            copiesAttack: true,
            before: ctx => chooseAttackToCopy(ctx, attacksOf(ctx), 'このワザとして使う、相手のテラスタルのポケモンのワザを選ぶ'),
            after: copiedAfter,
            expected: ctx => copiedExpected(ctx, attacksOf(ctx))
        };
    })(),
    'Nのゾロアークex/ナイトジョーカー': (() => {
        const attacksOf = ctx => ctx.player.bench.filter(pokemon => nameStarts(ctx.game, pokemon, 'Nの')).flatMap(pokemon => ctx.game.topCard(pokemon).attacks);
        return {
            copiesAttack: true,
            before: ctx => chooseAttackToCopy(ctx, attacksOf(ctx), 'このワザとして使う、ベンチの「Nのポケモン」のワザを選ぶ'),
            after: copiedAfter,
            expected: ctx => copiedExpected(ctx, attacksOf(ctx))
        };
    })(),
    'ネッコアラ/おやすみノック': {
        after: ctx => {
            const { game, attacker, defender } = ctx;
            game.addCondition(attacker, 'asleep');
            if (canAffect(ctx, defender)) game.addCondition(defender, 'asleep');
            game.addEffect(attacker, 'attackDamageModifier', game.turn + 2, { amount: 100 });
        }
    },
    'ホップのウッウ/きまぐれスピット': failUnless(ctx => [3, 4].includes(ctx.opponent.prizes.length)),
    'ヒビキのマグカルゴ/ようがんバースト': {
        before: ctx => {
            const { game, player, attacker } = ctx;
            const energies = typedEnergies(game, attacker, 'fire');
            const n = Math.min(5, energies.length);
            if (n === 0) {
                ctx.damage = 0;
                return;
            }
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: n,
                title: 'トラッシュする炎エネルギーを5枚まで選ぶ（1枚につき70ダメージ）',
                purpose: 'discard-for-damage',
                cpuAnswer: () => indicesUpTo(countToKnockOut(ctx, 0, 70, n)),
                callback: selected => {
                    moveEnergiesOff(game, attacker, selected);
                    ctx.damage = selected.length * 70;
                }
            });
        },
        expected: ctx => Math.min(5, typedEnergies(ctx.game, ctx.attacker, 'fire').length) * 70
    },
    'カスミのギャラドス/ザブザブパニック': {
        before: ctx => {
            const { game, player } = ctx;
            const top = player.deck.slice(0, 7);
            game.millDeck(player, 7);
            ctx.damage = top.filter(inst => { const card = game.cardOf(inst); return card.kind === 'pokemon' && card.name.startsWith('カスミの'); }).length * 70;
        },
        expected: () => 70
    },
    'ゼラオラ/サンダーブリッツ': {
        after: ctx => {
            moveEnergiesOff(ctx.game, ctx.attacker, [...ctx.attacker.energies]);
            damageChosen(ctx, ctx.opponent.bench.filter(pokemon => isEx(ctx.game.topCard(pokemon))), 1, 210);
        }
    },
    'ヒビキのウソッキー/まねてみる': {
        copiesAttack: true,
        before: ctx => {
            if (!ctx.game.flipCoin()) {
                ctx.damage = 0;
                return;
            }
            copyDefender.before(ctx);
        },
        after: copiedAfter,
        expected: ctx => copyDefender.expected(ctx) / 2
    },
    'シロナのミカルゲ/レイジングカース': {
        before: ctx => {
            ctx.ignoreWeakness = true;
            ctx.damage = ctx.player.bench.filter(pokemon => nameStarts(ctx.game, pokemon, 'シロナの')).reduce((sum, pokemon) => sum + counters(pokemon), 0) * 10;
        },
        expected: ctx => ctx.player.bench.filter(pokemon => nameStarts(ctx.game, pokemon, 'シロナの')).reduce((sum, pokemon) => sum + counters(pokemon), 0) * 10
    },
    'カミツオロチ/オロチブレス': {
        before: ctx => {
            const { game, player } = ctx;
            const energies = player.hand.filter(inst => isBasicEnergy(game.cardOf(inst)));
            if (energies.length < 6) {
                fail(ctx);
                return;
            }
            const discard = selected => {
                selected.forEach(inst => game.moveCard(player.hand, player.discard, inst));
                game.log(`${player.name}は手札の基本エネルギーを6枚トラッシュした`);
            };
            if (energies.length === 6 || new Set(energies.map(inst => inst.id)).size === 1) {
                discard(energies.slice(0, 6));
                return;
            }
            game.promptCards({ player, cards: energies, min: 6, max: 6, title: 'トラッシュする基本エネルギーを6枚選ぶ', purpose: 'discard-hand-energy', callback: discard });
        },
        after: ctx => { if (canAffect(ctx, ctx.defender)) knockOut(ctx.game, ctx.defender); },
        expected: ctx => (ctx.player.hand.filter(inst => isBasicEnergy(ctx.game.cardOf(inst))).length >= 6 && ctx.defender ? remainingHp(ctx.game, ctx.defender) : 0)
    },
    'メガヤンマex/ジェットサイクロン': {
        after: ctx => {
            const { game, player, attacker } = ctx;
            if (player.bench.length === 0 || attacker.energies.length === 0) return;
            pickEnergies(ctx, attacker, 3, selected => {
                const move = target => selected.forEach(inst => game.moveEnergy(attacker, target, inst));
                if (player.bench.length === 1) {
                    move(player.bench[0]);
                    return;
                }
                game.promptPokemon({ player, pokemon: player.bench, min: 1, max: 1, title: 'エネルギーをつけ替えるベンチポケモンを選ぶ', purpose: 'energy-switch-target', callback: ([target]) => move(target) });
            }, { title: 'つけ替えるエネルギーを選ぶ' });
        }
    }
};
