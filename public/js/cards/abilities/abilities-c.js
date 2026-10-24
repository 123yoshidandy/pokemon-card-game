/**
 * 特性の効果（そのc：名前を日本語の順に並べたときの 176〜264 番目）。書き方は cards/HOOKS.md
 *
 * 文の読み方
 *   SV の版の文には、エネルギーのタイプの印が抜けているものがある（例：ブリジュラス SV7-113「エネルギーがついている」、
 *   メガヤンマex SV9a-085「基本エネルギー」、ルナトーン M1L-026「基本エネルギー」）。同じ名前のカードの別の版（MC・M）の文に
 *   印があるので、その版の文（[M]・[G]・[F] など）のとおりに書いた。効果は名前で引くので、どの版も同じ動きになる
 *
 * まだ書いていない特性（ゲームの本体に仕組みが要るもの・文の意味が確かめられないもの）
 *   ばけがくれ・ひかりのつばさ：「相手の特性の効果を受けない」を、ほかの特性に守らせる仕組みがない（特性の効果の側が確かめない）
 *   マイティソウル：「マイティチェンジの効果でしか場に出せない」（手札からの進化を止める）仕組みがない
 *     （blockPlayPokemon・blockEvolve は場のカードのフックだけを見るので、手札のこのカード自身が止められない）
 *   ほうせきさがし：カードのデータに「テラスタル」の印がない
 *   マルチアダプタ：ポケモンのどうぐを2枚つける仕組みがない（pokemon.tool は1枚だけ）
 *   ゆきにまぎれる・ワイドウォール：「相手のグッズ・サポートの効果を受けない」をトレーナーズに守らせる仕組みがない
 *
 * フックが足されてから書いた特性で、割り切ったところ
 *   ラスターアシスト：「〜がバトル場に出たとき」はフック onPokemonToActive で知り、使うかどうかを持ち主に聞いてから使う
 *   マイティチェンジ：「イルカマンex」はマイティソウルが書けないため、まだデッキに入らない（山札にあれば動く）
 */

import { shuffle } from '../../random.js';

const isBasicEnergy = (card, type) => card.kind === 'energy' && card.basic && (!type || card.energyType === type);
const isSpecialEnergy = card => card.kind === 'energy' && !card.basic;
const isPokemonEx = card => card.rule === 'ex' || card.rule === 'mega';
const hasRule = card => Boolean(card.rule);
const nameStarts = prefix => card => card.name.startsWith(prefix);

const remainingHp = (game, pokemon) => game.maxHp(pokemon) - pokemon.damage;
const cardsIn = (game, list, filter) => list.filter(inst => filter(game.cardOf(inst)));
const hasIn = (game, list, filter) => list.some(inst => filter(game.cardOf(inst)));
const names = (game, insts) => insts.map(inst => game.cardName(inst)).join('と');
const allIndices = count => Array.from({ length: count }, (_, index) => index);

// 点数の高い順に count 個のインデックス（答えは小さい順）
function bestIndices(items, score, count) {
    return items
        .map((item, index) => ({ index, score: score(item) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, count)
        .map(entry => entry.index)
        .sort((a, b) => a - b);
}

// そのポケモンが、持ち主のバトル場にいるか / ベンチにいるか
function isActive(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active === pokemon;
}
function isBenched(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active !== pokemon;
}

// エネルギー1枚が、そのタイプのエネルギーになるか（どのタイプにもなる特殊エネルギーをふくむ）
const providesType = (game, pokemon, inst, type) => game.energyUnits(pokemon, [inst]).some(unit => unit === type || unit === 'any');
const energiesOfType = (game, pokemon, type) => pokemon.energies.filter(inst => providesType(game, pokemon, inst, type));

// 「この特性を持つポケモンが何匹いても、重ならない」：持ち主の場で一番前の1匹だけが働く
function isFirstHolder(game, source) {
    const name = source.card.ability.name;
    const first = game.inPlay(source.player).find(pokemon => game.topCard(pokemon).ability?.name === name && !game.abilitySuppressed(pokemon));
    return first === source.pokemon;
}

// ワザを使うためのエネルギーから、無色を count 個まで減らす（減らせなければ変えない）
function withoutColorless(cost, count) {
    if (count <= 0) return undefined;
    let removed = 0;
    const result = cost.filter(type => {
        if (type !== 'colorless' || removed >= count) return true;
        removed++;
        return false;
    });
    return removed > 0 ? result : undefined;
}

// ワザを使えるか（CPU の目安）
function canAttackNow(game, pokemon) {
    if (!pokemon) return false;
    return game.topCard(pokemon).attacks.some(attack => game.canPayCost(pokemon, game.attackCost(pokemon, attack)));
}

// 相手のワザのダメージを受けたことを、この番の終わりまで覚えておく（「ワザのダメージを受けてきぜつしたとき」に使う）
const ATTACK_DAMAGED = 'abilityAttackDamaged';
function markAttackDamage(game, source, ctx, target) {
    if (target !== source.pokemon) return;
    game.addEffect(target, ATTACK_DAMAGED, game.turn, { byEx: isPokemonEx(game.topCard(ctx.attacker)), inActive: isActive(game, target) });
}
const lastAttackDamage = (game, pokemon) => game.effectsOf(pokemon, ATTACK_DAMAGED).at(-1) ?? null;

// バトル場で相手のワザのダメージを受けたら、ワザを使ったポケモンにダメカンをのせる
function counterAttack(counters) {
    return {
        onDamaged: (game, source, ctx, target) => {
            if (target !== source.pokemon || !isActive(game, target) || !ctx.attacker || !game.ownerOf(ctx.attacker)) return;
            game.log(`${source.card.name}の特性「${source.card.ability.name}」`);
            game.putDamage(ctx.attacker, counters * 10);
        }
    };
}

// このポケモンが受けるワザのダメージを減らす
const reduceDamage = amount => ({
    damageTaken: (game, source, ctx, target) => (target === source.pokemon ? -amount : 0)
});

// 特殊状態にならない
const immuneTo = condition => ({
    conditionImmune: (game, source, pokemon, kind) => pokemon === source.pokemon && kind === condition
});

// 選べるポケモンが1匹だけなら選ばずに決める
function choosePokemon(game, player, pokemon, title, purpose, then, extra = {}) {
    if (pokemon.length === 0) return;
    if (pokemon.length === 1) {
        then(pokemon[0]);
        return;
    }
    game.promptPokemon({ ...extra, player, pokemon, min: 1, max: 1, title, purpose, callback: ([target]) => then(target) });
}

// 手札から条件に合うカードを1枚選ぶ（同じカードしかなければ選ばずに決める）
function chooseFromHand(game, player, filter, title, purpose, then) {
    const candidates = cardsIn(game, player.hand, filter);
    if (candidates.length === 0) return;
    if (new Set(candidates.map(inst => inst.id)).size === 1) {
        then(candidates[0]);
        return;
    }
    game.promptCards({ player, cards: candidates, min: 1, max: 1, title, purpose, callback: ([inst]) => then(inst) });
}

// 手札のエネルギーをポケモンにつける（特殊エネルギーの「手札からつけたとき」と、ほかのカードの「エネルギーがついたとき」も働く）
function attachFromHand(game, player, pokemon, inst) {
    game.removeCard(player.hand, inst);
    pokemon.energies.push(inst);
    game.log(`${player.name}は${game.topCard(pokemon).name}に${game.cardName(inst)}をつけた`);
    const card = game.cardOf(inst);
    if (card.onAttach) game.runNext(() => card.onAttach(game, player, pokemon, inst));
    game.runNext(() => game.hookAll('onAttachEnergy', player, pokemon, inst));
}

// CPU がエネルギーのつけ先を選ぶとき：バトルポケモンがいればそれ
const cpuPreferActive = (game, prompt) => [Math.max(0, prompt.pokemon.indexOf(prompt.player.active))];

// 手札のエネルギーを1枚ずつ、条件に合う自分のポケモンにつける
function attachEachFromHand(game, player, insts, filter, purpose) {
    const steps = insts.map(inst => () => {
        const targets = game.inPlay(player).filter(filter);
        if (targets.length === 0 || !player.hand.includes(inst)) return;
        choosePokemon(game, player, targets, `${game.cardName(inst)}をつけるポケモンを選ぶ`, purpose,
            target => attachFromHand(game, player, target, inst), { cpuAnswer: cpuPreferActive });
    });
    game.runNext(...steps);
}

// 山札から条件に合うカードを max 枚まで選び、相手に見せて手札に加える（最後に山札を切る）
function searchToHand(game, player, { filter, max, title, purpose = 'search-card', cpuAnswer }) {
    const candidates = cardsIn(game, player.deck, filter);
    if (candidates.length === 0) {
        game.log(`${player.name}は山札を見たが、選べるカードはなかった`);
        game.shuffleDeck(player);
        return;
    }
    game.promptCards({
        player,
        cards: candidates,
        min: 0,
        max: Math.min(max, candidates.length),
        title,
        purpose,
        cpuAnswer: cpuAnswer ?? (purpose === 'search-card' ? (g, prompt) => allIndices(prompt.max) : undefined),
        callback: selected => {
            selected.forEach(inst => game.removeCard(player.deck, inst));
            game.addToHand(player, selected, { reveal: true });
            game.shuffleDeck(player);
        }
    });
}

// 山札から条件に合うカードを max 枚まで選んで onSelected（山札から取り除いた後）。最後に山札を切る
function searchThen(game, player, filter, max, title, onSelected) {
    game.searchDeck({ player, filter, max, title, purpose: 'search-card', onSelected });
}

// 山札を上から count 枚見て、条件に合うものを選び onSelected。残りはウラにして切り、山札の下にもどす
function lookTop(game, player, { count, filter, min, max, title, purpose, onSelected }) {
    const top = player.deck.slice(0, count);
    if (top.length === 0) return;
    game.log(`${player.name}は山札を上から${top.length}枚見た`);
    game.log(`山札の上：${names(game, top)}`, { to: player.id });
    const finish = selected => {
        top.forEach(inst => game.removeCard(player.deck, inst));
        const rest = shuffle(top.filter(inst => !selected.includes(inst)), game.random);
        player.deck.push(...rest);
        if (rest.length) game.log(`${player.name}は残りの${rest.length}枚を山札の下にもどした`);
        onSelected(selected);
    };
    const candidates = cardsIn(game, top, filter);
    if (candidates.length === 0) {
        finish([]);
        return;
    }
    game.promptCards({
        player,
        cards: candidates,
        min: Math.min(min, candidates.length),
        max: Math.min(max, candidates.length),
        title,
        purpose,
        cpuAnswer: (g, prompt) => allIndices(prompt.max),
        callback: finish
    });
}

// コインを投げオモテなら、相手のベンチポケモンを1匹選び、バトルポケモンと入れ替える（then に新しく出たポケモン）
function lureOpponent(game, player, then = () => {}) {
    if (!game.flipCoin()) return;
    const opponent = game.opponentOf(player);
    choosePokemon(game, player, opponent.bench, 'バトル場に出す相手のベンチポケモンを選ぶ', 'boss-target', target => {
        game.switchActive(opponent, target);
        then(target);
    });
}

// 相手のベンチに、今のバトルポケモンより倒しやすいポケモンがいるか（CPU が入れ替えたいかの目安）
function hasWeakerBench(game, player) {
    const opponent = game.opponentOf(player);
    if (!opponent.active) return false;
    const activeHp = remainingHp(game, opponent.active);
    return opponent.bench.some(pokemon => remainingHp(game, pokemon) < activeHp);
}

// 自分の手札が count 枚になるように引く
function drawUntil(game, player, count) {
    const need = count - player.hand.length;
    if (need > 0) game.draw(player, need);
    else game.log(`${player.name}の手札はすでに${player.hand.length}枚ある`);
}

// きぜつしたポケモンについていたエネルギーを、トラッシュから選んでベンチポケモン1匹につけ替える（フォトンコード）
function moveEnergiesAfterKnockout(game, player, energies, bench, max, title) {
    game.runNext(() => {
        const candidates = energies.filter(inst => player.discard.includes(inst));
        const targets = bench.filter(pokemon => game.inPlay(player).includes(pokemon));
        if (candidates.length === 0 || targets.length === 0) return;
        game.promptCards({
            player,
            cards: candidates,
            min: 0,
            max: Math.min(max, candidates.length),
            title,
            purpose: 'knockout-energy',
            cpuAnswer: (g, prompt) => allIndices(prompt.max),
            callback: selected => {
                if (selected.length === 0) return;
                choosePokemon(game, player, targets, 'エネルギーをつけ替えるポケモンを選ぶ', 'energy-switch-target', target => {
                    selected.forEach(inst => game.removeCard(player.discard, inst));
                    target.energies.push(...selected);
                    game.log(`${names(game, selected)}を${game.topCard(target).name}につけた`);
                });
            }
        });
    });
}

export const ABILITY_EFFECTS = {
    'バイタルサンバ': {
        type: 'passive',
        hooks: {
            maxHp: (game, source, pokemon) => (game.ownerOf(pokemon) === source.player && isFirstHolder(game, source) ? 40 : 0)
        }
    },
    'はかいのずつき': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.active === pokemon && Boolean(game.opponentOf(player).active),
        use: (game, player) => {
            if (!game.flipCoin()) return;
            const target = game.opponentOf(player).active;
            if (!target || target.energies.length === 0) return;
            const opponent = game.opponentOf(player);
            game.promptCards({
                player,
                cards: target.energies,
                min: 1,
                max: 1,
                title: 'トラッシュする相手のエネルギーを選ぶ',
                purpose: 'discard-opponent-energy',
                callback: ([inst]) => {
                    game.moveCard(target.energies, opponent.discard, inst);
                    game.log(`${game.topCard(target).name}の${game.cardName(inst)}をトラッシュした`);
                }
            });
        },
        cpuWants: (game, player) => (game.opponentOf(player).active?.energies.length ?? 0) > 0
    },
    'はがねのかけはし': {
        type: 'passive',
        hooks: {
            retreatCost: (game, source, pokemon) => (game.ownerOf(pokemon) === source.player && energiesOfType(game, pokemon, 'metal').length > 0 ? -99 : 0)
        }
    },
    'はしゃのほうこう': {
        type: 'onBench',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player, pokemon) => lookTop(game, player, {
            count: 4,
            filter: card => isBasicEnergy(card),
            min: 1,
            max: 1,
            title: 'このポケモンにつける基本エネルギーを選ぶ',
            purpose: 'look-top-energy',
            onSelected: selected => selected.forEach(inst => game.attachFromOutside(pokemon, inst))
        })
    },
    'バズブースト': {
        type: 'onActive',
        use: (game, player, pokemon) => searchThen(game, player, card => isBasicEnergy(card, 'grass'), 3, 'このポケモンにつける「基本草エネルギー」を3枚まで選ぶ',
            selected => selected.forEach(inst => game.attachFromOutside(pokemon, inst)))
    },
    'はっこうジュース': {
        type: 'activated',
        canUse: (game, player, pokemon) => energiesOfType(game, pokemon, 'grass').length > 0,
        use: (game, player) => choosePokemon(game, player, game.inPlay(player), 'HPを回復するポケモンを選ぶ', 'potion', target => game.heal(target, 30)),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => pokemon.damage > 0)
    },
    'ハッスルプレー': {
        type: 'passive',
        hooks: {
            attackCost: (game, source, pokemon, attack, cost) => (pokemon === source.pokemon
                ? withoutColorless(cost, game.opponentOf(source.player).bench.length)
                : undefined)
        }
    },
    'バッドアッパー': {
        type: 'activated',
        canUse: (game, player) => player.bench.length > 0,
        use: (game, player) => game.searchDeck({
            player,
            filter: card => isBasicEnergy(card),
            max: 1,
            title: 'ベンチポケモンにつける基本エネルギーを選ぶ',
            purpose: 'search-energy',
            onSelected: ([inst]) => {
                if (!inst) return;
                choosePokemon(game, player, player.bench, `${game.cardName(inst)}をつけるベンチポケモンを選ぶ`, 'attach-bench', target => {
                    game.attachFromOutside(target, inst);
                    game.putDamage(target, 20);
                    game.runNext(() => game.checkKnockouts());
                }, { cpuAnswer: (g, prompt) => bestIndices(prompt.pokemon, pk => remainingHp(game, pk), 1) });
            }
        }),
        cpuWants: (game, player) => hasIn(game, player.deck, card => isBasicEnergy(card)) && player.bench.some(pokemon => remainingHp(game, pokemon) > 50)
    },
    'はっぱヒール': {
        type: 'activated',
        canUse: (game, player) => Boolean(player.active),
        use: (game, player) => game.heal(player.active, 20),
        cpuWants: (game, player) => (player.active?.damage ?? 0) > 0
    },
    'ハッピースイッチ': {
        type: 'activated',
        canUse: (game, player) => game.inPlay(player).length >= 2 && game.inPlay(player).some(pokemon => hasIn(game, pokemon.energies, card => isBasicEnergy(card))),
        use: (game, player) => {
            const sources = game.inPlay(player).filter(pokemon => hasIn(game, pokemon.energies, card => isBasicEnergy(card)));
            choosePokemon(game, player, sources, 'つけ替える基本エネルギーがついているポケモンを選ぶ', 'energy-switch-source', from => {
                const moveTo = inst => choosePokemon(game, player, game.inPlay(player).filter(pokemon => pokemon !== from),
                    `${game.cardName(inst)}をつけ替えるポケモンを選ぶ`, 'energy-switch-target', to => game.moveEnergy(from, to, inst));
                const energies = cardsIn(game, from.energies, card => isBasicEnergy(card));
                if (new Set(energies.map(inst => inst.id)).size === 1) {
                    moveTo(energies[0]);
                    return;
                }
                game.promptCards({ player, cards: energies, min: 1, max: 1, title: 'つけ替える基本エネルギーを選ぶ', purpose: 'energy-switch-card', callback: ([inst]) => moveTo(inst) });
            });
        },
        // バトルポケモンがワザを使えず、ベンチに基本エネルギーがあるときだけ、バトルポケモンへ移す
        cpuWants: (game, player) => Boolean(player.active) && !canAttackNow(game, player.active)
            && player.bench.some(pokemon => hasIn(game, pokemon.energies, card => isBasicEnergy(card)))
    },
    'バディコール': {
        type: 'activated',
        canUse: (game, player) => player.hand.length === 0,
        use: (game, player) => searchToHand(game, player, { filter: card => card.trainerType === 'supporter', max: 1, title: '手札に加えるサポートを選ぶ' }),
        cpuWants: (game, player) => hasIn(game, player.deck, card => card.trainerType === 'supporter')
    },
    'バディブースト': {
        type: 'activated',
        canUse: (game, player) => game.inPlay(player).some(pokemon => ['エレキブル', 'ブーバーン'].includes(game.topCard(pokemon).name))
            && hasIn(game, player.hand, card => isBasicEnergy(card, 'fire') || isBasicEnergy(card, 'lightning')),
        use: (game, player) => {
            const candidates = ['fire', 'lightning']
                .map(type => player.hand.find(inst => isBasicEnergy(game.cardOf(inst), type)))
                .filter(Boolean);
            const isTarget = pokemon => ['エレキブル', 'ブーバーン'].includes(game.topCard(pokemon).name);
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: candidates.length,
                title: 'つける「基本炎エネルギー」と「基本雷エネルギー」を、それぞれ1枚まで選ぶ',
                purpose: 'hand-energy',
                cpuAnswer: (g, prompt) => allIndices(prompt.max),
                callback: selected => attachEachFromHand(game, player, selected, isTarget, 'attach-hand-energy')
            });
        },
        cpuWants: () => true
    },
    'はなのカーテン': {
        type: 'passive',
        hooks: {
            preventDamage: (game, source, ctx, target) => {
                const owner = game.ownerOf(target);
                return owner === source.player && owner.active !== target && !hasRule(game.topCard(target));
            }
        }
    },
    'パニックプリズン': {
        type: 'onEvolve',
        canUse: (game, player) => Boolean(game.opponentOf(player).active),
        use: (game, player) => game.addCondition(game.opponentOf(player).active, 'confused')
    },
    'ははのいざない': {
        type: 'activated',
        canUse: (game, player) => game.opponentOf(player).bench.length > 0,
        use: (game, player) => lureOpponent(game, player),
        cpuWants: (game, player) => hasWeakerBench(game, player)
    },
    'パワーセーバー': {
        type: 'passive',
        hooks: {
            blockAttack: (game, source, player, pokemon) => {
                if (pokemon !== source.pokemon) return null;
                const count = game.inPlay(source.player).filter(pk => nameStarts('ロケット団の')(game.topCard(pk))).length;
                return count >= 4 ? null : '自分の場の「ロケット団のポケモン」が4匹以上いないので、ワザが使えません';
            }
        }
    },
    'パンクアップ': {
        type: 'onEvolve',
        use: (game, player) => searchThen(game, player, card => isBasicEnergy(card, 'darkness'), 5, '「マリィのポケモン」につける「基本悪エネルギー」を5枚まで選ぶ',
            selected => game.attachAnyWay(player, selected, pokemon => nameStarts('マリィの')(game.topCard(pokemon)), 'attach-energy-target'))
    },
    'はんげき': { type: 'passive', hooks: counterAttack(3) },
    'はんげきトサカ': { type: 'passive', hooks: counterAttack(5) },
    'はんげきばり': { type: 'passive', hooks: counterAttack(3) },
    'ビクトリーエール': {
        type: 'passive',
        hooks: {
            damageDealt: (game, source, ctx, target) => {
                const attacker = game.topCard(ctx.attacker);
                return game.ownerOf(ctx.attacker) === source.player && attacker.type === 'fire' && attacker.stage > 0 && isActive(game, target) ? 10 : 0;
            }
        }
    },
    'ビッグネット': {
        type: 'passive',
        hooks: {
            retreatCost: (game, source, pokemon) => {
                const owner = game.ownerOf(pokemon);
                return owner && owner !== source.player && owner.active === pokemon && game.topCard(pokemon).stage > 0 ? 1 : 0;
            }
        }
    },
    'ひっさつしゅりけん': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.active === pokemon && hasIn(game, player.hand, card => isBasicEnergy(card, 'water')),
        use: (game, player) => chooseFromHand(game, player, card => isBasicEnergy(card, 'water'), 'トラッシュする「基本水エネルギー」を選ぶ', 'discard-hand', inst => {
            game.moveCard(player.hand, player.discard, inst);
            game.log(`${player.name}は手札の${game.cardName(inst)}をトラッシュした`);
            const opponent = game.opponentOf(player);
            choosePokemon(game, player, game.inPlay(opponent), 'ダメカンを6個のせる相手のポケモンを選ぶ', 'snipe-target', target => {
                game.putDamage(target, 60);
                game.runNext(() => game.checkKnockouts());
            }, { amount: 60 });
        }),
        cpuWants: () => true
    },
    'ひゃっかりょうらん': {
        type: 'activated',
        use: (game, player) => searchToHand(game, player, {
            filter: card => card.kind === 'pokemon' && nameStarts('エリカの')(card),
            max: 1,
            title: '手札に加える「エリカのポケモン」を選ぶ',
            purpose: 'search-pokemon'
        }),
        cpuWants: (game, player) => hasIn(game, player.deck, card => card.kind === 'pokemon' && nameStarts('エリカの')(card))
    },
    'ひょうしぬけ': {
        type: 'passive',
        hooks: {
            onDamaged: markAttackDamage,
            prizeModifier: (game, source, pokemon, player, { byAttack }) => {
                if (pokemon !== source.pokemon || !byAttack || !lastAttackDamage(game, pokemon)) return 0;
                return game.inPlay(source.player).some(pk => game.topCard(pk).name === 'モモワロウex') ? -1 : 0;
            }
        }
    },
    'ファーコート': { type: 'passive', hooks: reduceDamage(20) },
    'ファンコール': {
        type: 'activated',
        oncePerTurnByName: true,
        canUse: (game, player) => player.turnsTaken === 1,
        use: (game, player) => searchToHand(game, player, {
            filter: card => card.kind === 'pokemon' && card.type === 'colorless' && card.hp <= 100,
            max: 3,
            title: '手札に加える、HP100以下の無色ポケモンを3枚まで選ぶ',
            purpose: 'search-pokemon',
            cpuAnswer: (game, prompt) => bestIndices(prompt.cards, inst => game.cardOf(inst).hp, prompt.max)
        }),
        cpuWants: (game, player) => hasIn(game, player.deck, card => card.kind === 'pokemon' && card.type === 'colorless' && card.hp <= 100)
    },
    'ブーストしんか': {
        type: 'passive',
        hooks: {
            allowEarlyEvolve: (game, source, player, target) => target === source.pokemon && isActive(game, target)
        }
    },
    'ふえるまゆ': {
        type: 'onEvolve',
        canUse: (game, player) => player.bench.length < game.benchSize,
        use: (game, player) => game.benchFromDeck(player, card => card.kind === 'pokemon' && ['カラサリス', 'マユルド'].includes(card.name), 1, 'search-pokemon')
    },
    'フォトンコード': {
        type: 'passive',
        hooks: {
            onDamaged: markAttackDamage,
            onKnockout: (game, source, pokemon, player, { byAttack }) => {
                if (pokemon !== source.pokemon || !byAttack || !lastAttackDamage(game, pokemon)?.inActive) return;
                const energies = cardsIn(game, pokemon.energies, card => isBasicEnergy(card, 'lightning'));
                if (energies.length === 0 || player.bench.length === 0) return;
                moveEnergiesAfterKnockout(game, player, energies, [...player.bench], 2, 'ベンチポケモンにつけ替える「基本雷エネルギー」を2枚まで選ぶ');
            }
        }
    },
    'ふくがん': {
        type: 'passive',
        hooks: {
            damageDealt: (game, source, ctx, target) => (ctx.attacker === source.pokemon && isActive(game, target)
                && game.topCard(target).ability && !game.abilitySuppressed(target) ? 50 : 0)
        }
    },
    'ふとっぱら': {
        type: 'passive',
        hooks: {
            damageDealt: (game, source, ctx, target) => (game.ownerOf(ctx.attacker) === source.player && nameStarts('ホップの')(game.topCard(ctx.attacker))
                && isActive(game, target) && isFirstHolder(game, source) ? 30 : 0)
        }
    },
    'ふみん': { type: 'passive', hooks: immuneTo('asleep') },
    'フラッシュドロー': {
        type: 'activated',
        canUse: (game, player, pokemon) => hasIn(game, pokemon.energies, card => isBasicEnergy(card, 'lightning')),
        use: (game, player, pokemon) => {
            const inst = pokemon.energies.find(energy => isBasicEnergy(game.cardOf(energy), 'lightning'));
            game.moveCard(pokemon.energies, player.discard, inst);
            game.log(`${game.topCard(pokemon).name}の${game.cardName(inst)}をトラッシュした`);
            drawUntil(game, player, 6);
        },
        cpuWants: (game, player) => player.hand.length <= 2 && player.deck.length > 6
    },
    'フレアマジック': {
        type: 'activated',
        canUse: (game, player) => hasIn(game, player.hand, card => isBasicEnergy(card, 'fire')),
        use: (game, player) => chooseFromHand(game, player, card => isBasicEnergy(card, 'fire'), 'トラッシュする「基本炎エネルギー」を選ぶ', 'discard-hand', inst => {
            game.moveCard(player.hand, player.discard, inst);
            game.log(`${player.name}は手札の${game.cardName(inst)}をトラッシュした`);
            drawUntil(game, player, 7);
        }),
        cpuWants: (game, player) => player.hand.length <= 5 && player.deck.length > 7
    },
    'ふんどのつぼ': {
        type: 'passive',
        hooks: {
            damageDealt: (game, source, ctx, target) => (ctx.attacker === source.pokemon && source.pokemon.damage >= 20 && isActive(game, target) ? 120 : 0)
        }
    },
    'ふんばりボディ': {
        type: 'passive',
        hooks: {
            onDamaged: markAttackDamage,
            preventKnockout: (game, source, pokemon, player, { byAttack }) => {
                if (pokemon !== source.pokemon || !byAttack || !lastAttackDamage(game, pokemon)) return false;
                game.log(`${source.card.name}の特性「ふんばりボディ」`);
                if (!game.flipCoin()) return false;
                pokemon.damage = game.maxHp(pokemon) - 10;
                game.log(`${source.card.name}はきぜつせず、残りHP10で場に残った`);
                return true;
            }
        }
    },
    'ボコスカがえし': {
        type: 'passive',
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (target !== source.pokemon || !ctx.attacker || !game.ownerOf(ctx.attacker)) return;
                const counters = energiesOfType(game, target, 'metal').length * 2;
                if (counters === 0) return;
                game.log(`${source.card.name}の特性「ボコスカがえし」`);
                game.putDamage(ctx.attacker, counters * 10);
            }
        }
    },
    'ほりまくり': {
        type: 'onBench',
        use: (game, player) => searchThen(game, player, card => isBasicEnergy(card, 'fighting'), 3, 'トラッシュする「基本闘エネルギー」を3枚まで選ぶ', selected => {
            player.discard.push(...selected);
            if (selected.length) game.log(`${player.name}は山札の${names(game, selected)}をトラッシュした`);
        })
    },
    'マイティシェル': {
        type: 'passive',
        hooks: {
            preventDamage: (game, source, ctx, target) => target === source.pokemon && hasIn(game, ctx.attacker?.energies ?? [], isSpecialEnergy),
            preventEffects: (game, source, ctx, pokemon) => pokemon === source.pokemon && hasIn(game, ctx.attacker?.energies ?? [], isSpecialEnergy)
        }
    },
    'マスターアーツ': {
        type: 'passive',
        hooks: {
            maxHp: (game, source, pokemon) => (pokemon === source.pokemon ? energiesOfType(game, pokemon, 'fighting').length * 40 : 0)
        }
    },
    'マッドコート': { type: 'passive', hooks: reduceDamage(30) },
    'まぬけがお': { type: 'passive', hooks: immuneTo('confused') },
    'まんたんメロディ': {
        type: 'onEvolve',
        canUse: (game, player) => game.inPlay(player).some(pokemon => pokemon.damage > 0),
        use: (game, player) => choosePokemon(game, player, game.inPlay(player).filter(pokemon => pokemon.damage > 0), 'HPをすべて回復するポケモンを選ぶ', 'potion',
            target => game.heal(target, target.damage))
    },
    'まんぷくタイム': {
        type: 'onEvolve',
        canUse: (game, player) => game.inPlay(player).some(pokemon => game.topCard(pokemon).stage > 0 && pokemon.damage > 0),
        use: (game, player) => {
            const healed = game.inPlay(player).filter(pokemon => game.topCard(pokemon).stage > 0 && pokemon.damage > 0);
            healed.forEach(pokemon => game.heal(pokemon, pokemon.damage));
            healed.forEach(pokemon => game.discardEnergyFrom(pokemon, pokemon.energies.length));
        }
    },
    'マンモスキャリー': {
        type: 'activated',
        use: (game, player) => searchToHand(game, player, { filter: card => card.kind === 'pokemon', max: 1, title: '手札に加えるポケモンを選ぶ', purpose: 'search-pokemon' }),
        cpuWants: (game, player) => hasIn(game, player.deck, card => card.kind === 'pokemon')
    },
    'みがる': {
        type: 'passive',
        hooks: {
            retreatCost: (game, source, pokemon) => (pokemon === source.pokemon && pokemon.energies.length === 0 ? -99 : 0)
        }
    },
    'みつりんボディ': { type: 'passive', hooks: reduceDamage(30) },
    'みどりのまい': {
        type: 'activated',
        canUse: (game, player) => hasIn(game, player.hand, card => isBasicEnergy(card, 'grass')),
        use: (game, player, pokemon) => chooseFromHand(game, player, card => isBasicEnergy(card, 'grass'), 'つける「基本草エネルギー」を選ぶ', 'hand-energy', inst => {
            attachFromHand(game, player, pokemon, inst);
            game.draw(player, 1);
        }),
        cpuWants: () => true
    },
    'みわくのいざない': {
        type: 'activated',
        canUse: (game, player) => game.opponentOf(player).bench.length > 0,
        use: (game, player) => lureOpponent(game, player, target => game.addCondition(target, 'confused')),
        cpuWants: (game, player) => hasWeakerBench(game, player)
    },
    'むきりょくチャージ': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.bench.includes(pokemon) && Boolean(player.active)
            && nameStarts('アオキの')(game.topCard(player.active)) && hasIn(game, player.hand, card => card.kind === 'energy'),
        use: (game, player) => chooseFromHand(game, player, card => card.kind === 'energy', 'バトル場の「アオキのポケモン」につけるエネルギーを選ぶ', 'hand-energy',
            inst => attachFromHand(game, player, player.active, inst)),
        cpuWants: () => true
    },
    'むげんのかげ': {
        type: 'passive',
        hooks: {
            onDamaged: markAttackDamage,
            onKnockout: (game, source, pokemon, player, { byAttack }) => {
                if (pokemon !== source.pokemon || !byAttack || !lastAttackDamage(game, pokemon)) return;
                const cards = [...pokemon.cards];
                // きぜつしたポケモンのカードがトラッシュされた後に、ポケモンのカードだけを手札にもどす
                game.runNext(() => {
                    const back = cards.filter(inst => player.discard.includes(inst));
                    back.forEach(inst => game.moveCard(player.discard, player.hand, inst));
                    if (back.length) game.log(`${player.name}は特性「むげんのかげ」で、${names(game, back)}を手札にもどした`);
                });
            }
        }
    },
    'むしばむのろい': {
        type: 'passive',
        hooks: {
            onAttachEnergy: (game, source, player, pokemon) => {
                if (player === source.player || !game.ownerOf(pokemon)) return;
                game.log(`${source.card.name}の特性「むしばむのろい」`);
                game.putDamage(pokemon, 20);
                game.runNext(() => game.checkKnockouts());
            }
        }
    },
    'メタルシグナル': {
        type: 'activated',
        use: (game, player) => searchToHand(game, player, {
            filter: card => card.kind === 'pokemon' && card.type === 'metal' && card.stage > 0,
            max: 2,
            title: '手札に加える、鋼タイプの進化ポケモンを2枚まで選ぶ',
            purpose: 'search-pokemon',
            cpuAnswer: (game, prompt) => allIndices(prompt.max)
        }),
        cpuWants: (game, player) => hasIn(game, player.deck, card => card.kind === 'pokemon' && card.type === 'metal' && card.stage > 0)
    },
    'メタルメーカー': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => lookTop(game, player, {
            count: 4,
            filter: card => isBasicEnergy(card, 'metal'),
            min: 0,
            max: 4,
            title: '自分のポケモンにつける「基本鋼エネルギー」を好きなだけ選ぶ',
            purpose: 'look-top-energy',
            onSelected: selected => game.attachAnyWay(player, selected, () => true, 'attach-energy-target')
        }),
        cpuWants: () => true
    },
    'メタルロード': {
        type: 'onActive',
        canUse: (game, player, pokemon) => game.inPlay(player).some(other => other !== pokemon && energiesOfType(game, other, 'metal').length > 0),
        use: (game, player, pokemon) => {
            const owners = new Map();
            game.inPlay(player).filter(other => other !== pokemon)
                .forEach(other => energiesOfType(game, other, 'metal').forEach(inst => owners.set(inst, other)));
            const candidates = [...owners.keys()];
            if (candidates.length === 0) return;
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: candidates.length,
                title: 'このポケモンにつけ替える鋼エネルギーを好きなだけ選ぶ',
                purpose: 'move-energy',
                cpuAnswer: (g, prompt) => allIndices(prompt.max),
                callback: selected => selected.forEach(inst => game.moveEnergy(owners.get(inst), pokemon, inst))
            });
        }
    },
    'もろいぬけがら': {
        type: 'passive',
        hooks: {
            onDamaged: markAttackDamage,
            prizeModifier: (game, source, pokemon, player, { byAttack }) => (pokemon === source.pokemon && byAttack && lastAttackDamage(game, pokemon)?.byEx ? -99 : 0)
        }
    },
    'やけつくじょうき': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.active === pokemon && Boolean(game.opponentOf(player).active),
        use: (game, player) => game.addCondition(game.opponentOf(player).active, 'burned'),
        cpuWants: (game, player) => !game.hasCondition(game.opponentOf(player).active, 'burned')
    },
    'やさしいヒレ': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.active === pokemon && player.bench.length < game.benchSize
            && hasIn(game, player.discard, card => card.kind === 'pokemon' && card.stage === 0 && card.hp <= 70),
        use: (game, player) => {
            const candidates = cardsIn(game, player.discard, card => card.kind === 'pokemon' && card.stage === 0 && card.hp <= 70);
            game.promptCards({
                player,
                cards: candidates,
                min: 1,
                max: 1,
                title: 'ベンチに出す、HP70以下のたねポケモンを選ぶ',
                purpose: 'bench-basic',
                callback: ([inst]) => {
                    game.removeCard(player.discard, inst);
                    player.bench.push(game.createPokemon(inst));
                    game.log(`${player.name}はトラッシュの${game.cardName(inst)}をベンチに出した`);
                }
            });
        },
        cpuWants: () => true
    },
    'やすらぐひかり': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.active === pokemon && Boolean(game.opponentOf(player).active),
        use: (game, player) => game.addCondition(game.opponentOf(player).active, 'asleep'),
        cpuWants: (game, player) => !game.hasCondition(game.opponentOf(player).active, 'asleep')
    },
    'やわらかウール': { type: 'passive', hooks: reduceDamage(30) },
    'ゆきにしずめる': {
        type: 'onBench',
        canUse: game => Boolean(game.stadium),
        use: game => game.discardStadium()
    },
    'よくばりオーダー': {
        type: 'onEvolve',
        canUse: (game, player) => hasIn(game, player.discard, card => card.name === 'ペパーのサンドウィッチ'),
        use: (game, player) => {
            const candidates = cardsIn(game, player.discard, card => card.name === 'ペパーのサンドウィッチ');
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: Math.min(2, candidates.length),
                title: '手札に加える「ペパーのサンドウィッチ」を2枚まで選ぶ',
                purpose: 'discard-to-hand',
                cpuAnswer: (g, prompt) => allIndices(prompt.max),
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.discard, inst));
                    game.addToHand(player, selected, { reveal: true });
                }
            });
        }
    },
    'よりどりねんえき': {
        type: 'activated',
        canUse: (game, player) => Boolean(game.opponentOf(player).active),
        use: (game, player) => {
            if (!game.flipCoin()) return;
            const conditions = ['poisoned', 'burned', 'confused'];
            game.promptChoose({
                player,
                options: ['どく', 'やけど', 'こんらん'],
                title: '相手のバトルポケモンをする特殊状態を選ぶ',
                purpose: 'choose-condition',
                // CPU は、まだなっていない特殊状態を選ぶ
                cpuAnswer: g => {
                    const target = g.opponentOf(player).active;
                    const index = conditions.findIndex(condition => !g.hasCondition(target, condition));
                    return [Math.max(0, index)];
                },
                callback: ([index]) => game.addCondition(game.opponentOf(player).active, conditions[index])
            });
        },
        cpuWants: (game, player) => {
            const target = game.opponentOf(player).active;
            return Boolean(target) && !(target.poisoned && target.burned && target.rotation === 'confused');
        }
    },
    'よるこうさく': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.active === pokemon && player.deck.length > 0,
        use: (game, player) => game.promptCards({
            player,
            cards: player.deck,
            min: 1,
            max: 1,
            title: '山札の上にもどすカードを選ぶ',
            purpose: 'deck-top',
            callback: ([inst]) => {
                game.removeCard(player.deck, inst);
                game.shuffleDeck(player);
                player.deck.unshift(inst);
                game.log(`${player.name}は山札からカードを1枚選び、残りを切って、選んだカードを山札の上にもどした`);
            }
        }),
        cpuWants: () => false // どのカードを上に置くとよいかを、CPU は決められない
    },
    'よわごし': {
        type: 'passive',
        hooks: {
            retreatCost: (game, source, pokemon) => (pokemon === source.pokemon
                && game.inPlay(game.opponentOf(source.player)).some(pk => isPokemonEx(game.topCard(pk))) ? -99 : 0)
        }
    },
    'ラピッドバーニア': {
        type: 'onBench',
        canUse: (game, player) => Boolean(player.active),
        use: (game, player, pokemon) => {
            if (!player.bench.includes(pokemon)) return;
            game.switchActive(player, pokemon);
            const owners = new Map();
            game.inPlay(player).filter(other => other !== pokemon).forEach(other => other.energies.forEach(inst => owners.set(inst, other)));
            const candidates = [...owners.keys()];
            if (candidates.length === 0) return;
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: candidates.length,
                title: 'このポケモンにつけ替えるエネルギーを好きなだけ選ぶ',
                purpose: 'move-energy',
                cpuAnswer: (g, prompt) => allIndices(prompt.max),
                callback: selected => selected.forEach(inst => game.moveEnergy(owners.get(inst), pokemon, inst))
            });
        }
    },
    'ルナサイクル': {
        type: 'activated',
        oncePerTurnByName: true,
        canUse: (game, player) => game.inPlay(player).some(pokemon => game.topCard(pokemon).name === 'ソルロック')
            && hasIn(game, player.hand, card => isBasicEnergy(card, 'fighting')),
        use: (game, player) => chooseFromHand(game, player, card => isBasicEnergy(card, 'fighting'), 'トラッシュする「基本闘エネルギー」を選ぶ', 'discard-hand', inst => {
            game.moveCard(player.hand, player.discard, inst);
            game.log(`${player.name}は手札の${game.cardName(inst)}をトラッシュした`);
            game.draw(player, 3);
        }),
        cpuWants: (game, player) => player.deck.length > 5
    },
    'レジストヴェール': {
        type: 'passive',
        hooks: {
            preventEffects: (game, source, ctx, pokemon) => {
                const card = game.topCard(pokemon);
                return game.ownerOf(pokemon) === source.player && card.stage === 0 && nameStarts('ロケット団の')(card);
            }
        }
    },
    'れっからんぶ': {
        type: 'activated',
        unlimited: true,
        canUse: (game, player) => hasIn(game, player.hand, card => isBasicEnergy(card, 'fire')),
        use: (game, player) => chooseFromHand(game, player, card => isBasicEnergy(card, 'fire'), 'つける「基本炎エネルギー」を選ぶ', 'hand-energy',
            inst => attachEachFromHand(game, player, [inst], () => true, 'attach-hand-energy')),
        // バトルポケモンが、まだワザを使えないときだけつける
        cpuWants: (game, player) => Boolean(player.active) && !canAttackNow(game, player.active)
    },
    'ロイヤルエール': {
        type: 'passive',
        hooks: {
            damageDealt: (game, source, ctx, target) => (game.ownerOf(ctx.attacker) === source.player && isActive(game, target) ? 20 : 0)
        }
    },
    'ろうれんのわざ': {
        type: 'passive',
        hooks: {
            attackCost: (game, source, pokemon, attack, cost) => (pokemon === source.pokemon && attack.name === 'ブラッドムーン'
                ? withoutColorless(cost, game.prizesTaken(game.opponentOf(source.player)))
                : undefined)
        }
    },
    'ロケットブレイン': {
        type: 'activated',
        unlimited: true,
        canUse: (game, player) => game.inPlay(player).length >= 2
            && game.inPlay(player).some(pokemon => pokemon.damage >= 10 && nameStarts('ロケット団の')(game.topCard(pokemon))),
        use: (game, player) => {
            const sources = game.inPlay(player).filter(pokemon => pokemon.damage >= 10 && nameStarts('ロケット団の')(game.topCard(pokemon)));
            choosePokemon(game, player, sources, 'ダメカンを1個とる「ロケット団のポケモン」を選ぶ', 'counter-source', from => {
                choosePokemon(game, player, game.inPlay(player).filter(pokemon => pokemon !== from), 'ダメカンをのせるポケモンを選ぶ', 'counter-target', to => {
                    from.damage -= 10;
                    to.damage += 10;
                    game.log(`${game.topCard(from).name}のダメカンを1個、${game.topCard(to).name}にのせ替えた`);
                    game.runNext(() => game.checkKnockouts());
                });
            });
        },
        cpuWants: () => false // どこにのせ替えるとよいかを、CPU は決められない
    },
    'ワンダーキッス': {
        type: 'passive',
        hooks: {
            onKnockout: (game, source, pokemon, player) => {
                if (player === source.player || player.active !== pokemon || !isFirstHolder(game, source)) return;
                game.log(`${source.card.name}の特性「ワンダーキッス」`);
                if (!game.flipCoin()) return;
                const taken = source.player.prizes.splice(0, 1);
                if (taken.length === 0) return;
                source.player.hand.push(...taken);
                game.log(`${source.player.name}はサイドを1枚多く取った（残り${source.player.prizes.length}枚）`);
                game.log(`サイドから${names(game, taken)}を手札に加えた`, { to: source.player.id });
            }
        }
    },

    // ===== ほかのポケモンの特性をなくす =====
    'ねんちゃくしばり': {
        // このポケモンがベンチにいるかぎり、おたがいのベンチの2進化ポケモンの特性は、すべてなくなる
        type: 'passive',
        hooks: {
            suppressAbility: (game, source, pokemon) => isBenched(game, source.pokemon) && isBenched(game, pokemon) && game.topCard(pokemon).stage === 2
        }
    },

    // ===== 特殊状態・弱点 =====
    'マグマのはどう': {
        // 相手のやけどのポケモンは、やけどでのせるダメカンの数が3個多くなる
        type: 'passive',
        hooks: {
            burnDamage: (game, source, pokemon) => (game.ownerOf(pokemon) === game.opponentOf(source.player) ? 30 : 0)
        }
    },
    'もうどくしはい': {
        // このポケモンがバトル場にいるかぎり、相手のどくのポケモンは、どくでのせるダメカンの数が5個多くなる
        type: 'passive',
        hooks: {
            poisonDamage: (game, source, pokemon) => (isActive(game, source.pokemon) && game.ownerOf(pokemon) === game.opponentOf(source.player) ? 50 : 0)
        }
    },
    'ようがんちたい': {
        // 相手の番に、相手のバトルポケモンがベンチにもどるたび、新しく出てきたポケモンをやけどにする
        type: 'passive',
        hooks: {
            onSwitchOut: (game, source, player) => {
                if (player === source.player || game.current !== player.id || game.phase !== 'main' || !player.active) return;
                game.log(`${source.card.name}の特性「ようがんちたい」`);
                game.addCondition(player.active, 'burned');
            }
        }
    },
    'フェアリーゾーン': {
        // 相手の場の [N] ポケモン全員の弱点は、すべて [P] タイプになる
        type: 'passive',
        hooks: {
            weaknessOverride: (game, source, pokemon) => (game.ownerOf(pokemon) === game.opponentOf(source.player) && game.typesOf(pokemon).includes('dragon')
                ? 'psychic'
                : null)
        }
    },

    // ===== バトル場からベンチにもどったとき・ベンチからバトル場に出たとき =====
    'バックリロード': {
        // 自分の番に、このポケモンがバトル場からベンチに戻ったとき、1回使える。手札から「基本水エネルギー」を2枚まで選び、このポケモンにつける
        type: 'onToBench',
        canUse: (game, player) => hasIn(game, player.hand, card => isBasicEnergy(card, 'water')),
        use: (game, player, pokemon) => {
            const candidates = cardsIn(game, player.hand, card => isBasicEnergy(card, 'water'));
            if (candidates.length === 0) return;
            game.promptCards({
                player,
                cards: candidates,
                min: 1,
                max: Math.min(2, candidates.length),
                title: 'このポケモンにつける「基本水エネルギー」を2枚まで選ぶ',
                purpose: 'attach-from-hand',
                cpuAnswer: (g, prompt) => allIndices(prompt.max),
                callback: selected => selected.forEach(inst => attachFromHand(game, player, pokemon, inst))
            });
        }
    },
    'マイティチェンジ': {
        // 自分の番に、このポケモンがバトル場からベンチにもどったとき、1回使える。山札の「イルカマンex」とこのカードを入れ替える
        // （ついているカード・ダメカン・特殊状態・効果などは、すべて引きつぐ）。入れ替えたなら、このカードは山札にもどす。そして山札を切る
        type: 'onToBench',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player, pokemon) => searchThen(game, player, card => card.name === 'イルカマンex', 1, '入れ替える「イルカマンex」を選ぶ', ([inst]) => {
            if (!inst) return;
            if (!game.inPlay(player).includes(pokemon)) {
                player.deck.push(inst);
                return;
            }
            const old = pokemon.cards.pop();
            pokemon.cards.push(inst);
            player.deck.push(old);
            game.log(`${player.name}は${game.cardName(old)}を${game.cardName(inst)}と入れ替え、${game.cardName(old)}を山札にもどした`);
        }),
        cpuWants: (game, player) => hasIn(game, player.deck, card => card.name === 'イルカマンex')
    },
    'ラスターアシスト': {
        // 自分の番に、自分の「メガラティアスex」がベンチからバトル場に出たとき、1回使える。
        // 自分のベンチポケモンについているエネルギーを好きなだけ選び、バトルポケモンにつけ替える
        type: 'passive',
        hooks: {
            onPokemonToActive: (game, source, player, pokemon) => {
                if (player !== source.player || game.current !== player.id || game.phase !== 'main') return;
                if (game.topCard(pokemon).name !== 'メガラティアスex') return;
                if (!player.bench.some(benched => benched.energies.length > 0)) return;
                game.runNext(() => game.promptConfirm({
                    player,
                    title: `特性「ラスターアシスト」を使いますか？（${source.card.name}）`,
                    card: source.inst.id,
                    purpose: `ability-${source.card.id}`,
                    callback: yes => {
                        if (!yes || player.active !== pokemon || !game.inPlay(player).includes(source.pokemon)) return;
                        game.log(`${source.card.name}の特性「ラスターアシスト」`);
                        const from = new Map(player.bench.flatMap(benched => benched.energies.map(inst => [inst, benched])));
                        const energies = [...from.keys()];
                        if (energies.length === 0) return;
                        game.promptCards({
                            player,
                            cards: energies,
                            min: 0,
                            max: energies.length,
                            title: 'バトルポケモンにつけ替える、ベンチポケモンのエネルギーを選ぶ',
                            purpose: 'move-energy-to-active',
                            cpuAnswer: (g, prompt) => allIndices(prompt.max),
                            callback: selected => selected.forEach(inst => game.moveEnergy(from.get(inst), pokemon, inst))
                        });
                    }
                }));
            }
        }
    }
};
