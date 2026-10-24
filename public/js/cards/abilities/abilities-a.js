/**
 * 特性の効果（そのa：名前を日本語の順に並べたときの 0〜87 番目）。書き方は cards/HOOKS.md
 *
 * 文の記号（[D] など）が抜けている版は、同じカードの別の版の文に合わせた
 *   （アドレナパワー・アドレナフェロモン・アドレナブレイン・うらみのうず・エレキストリーマー・エレキダイナモ・
 *     カーリーウォール・かえんぶとう・かるがるヒール・ギアコーティング・けいけんそく・ごうきんビルド）
 * あついしぼう：文の「相手のまたはポケモン」はタイプの記号が抜けている。昔からの同じ名前の特性と同じく、炎・水とした
 * からぬけ：テッカニン（M1S-065）の文は「手札から選び…そして山札を切る」で食い違っている。M1S-008 と同じく山札から選ぶ
 *
 * まだ書いていない特性（ゲームの本体に仕組みが要るもの・文の意味が確かめられないもの）
 *   イニシャライズ：カードのデータに「未来」の印がない
 *   エキサイトターボ・エキサイトパワー・エキサイトヒール：文の「タイプの『メガシンカex』」のタイプの記号が抜けていて、どのタイプか確かめられない
 *   エキサイトダイブ・きんきゅうかいてん：手札にあるポケモンの特性を使う仕組みがない
 *   おいしげる：基本エネルギーが出すエネルギーを変えるフックがない（energyUnits は基本エネルギーのタイプをそのまま使う）
 *   おまつりおんど：ワザを2回続けて使う仕組みがない
 *   かんしのめ：ダメカンののせ替えを止めるフックがない（のせ替える効果の側が確かめない）
 *   きおくにもぐる：進化前のワザを使う仕組みがない
 *   きらめくウロコ：カードのデータに「テラスタル」の印がない
 *   きんちょうかん：相手のグッズ・サポートの効果を受けない、を確かめる仕組みがない（トレーナーズの効果の側が確かめない）
 */

const isPokemon = card => card.kind === 'pokemon';
const isBasicPokemon = card => isPokemon(card) && card.stage === 0;
const isBasicEnergy = (card, type) => card.kind === 'energy' && card.basic && (!type || card.energyType === type);
const isPokemonEx = card => card.rule === 'ex' || card.rule === 'mega';
const isMega = card => card.rule === 'mega';

const remainingHp = (game, pokemon) => game.maxHp(pokemon) - pokemon.damage;
const cardsIn = (game, list, filter) => list.filter(inst => filter(game.cardOf(inst)));
const hasIn = (game, list, filter) => list.some(inst => filter(game.cardOf(inst)));
const allIndices = count => Array.from({ length: count }, (_, index) => index);

// player の特性の効果を、そのポケモンに与えられるか（kind は game.canAffect と同じ）
//   canUse は効果の出どころなしで呼ばれるので、出どころを入れて確かめる
const canAffectFrom = (game, player, pokemon, kind) => Boolean(pokemon)
    && game.withSource({ player, kind: 'ability' }, () => game.canAffect(pokemon, kind));

// そのポケモンが、持ち主のバトル場にいるか
function isActive(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active === pokemon;
}

// そのタイプのエネルギーがついているか（どのタイプにもなるエネルギーもふくむ）
function hasEnergyOf(game, pokemon, type) {
    return game.energyUnits(pokemon).some(unit => unit === type || unit === 'any');
}

// 場に条件に合うポケモンがいるか
const hasInPlay = (game, player, test) => game.inPlay(player).some(pokemon => test(game.topCard(pokemon), pokemon));

// その特性が働いている、持ち主の場の最初のポケモン（「この効果は重ならない」に使う）
function firstWithAbility(game, player, abilityName) {
    return game.inPlay(player).find(pokemon => game.topCard(pokemon).ability?.name === abilityName && !game.abilitySuppressed(pokemon)) ?? null;
}

// 点数の高い順に count 個のインデックス（答えは小さい順）
function bestIndices(items, score, count) {
    return items
        .map((item, index) => ({ index, score: score(item) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, count)
        .map(entry => entry.index)
        .sort((a, b) => a - b);
}

// そのポケモンが、今ついているエネルギーでワザを使えるか（CPU の目安）
function canAttackWith(game, pokemon) {
    if (!pokemon) return false;
    return game.topCard(pokemon).attacks.some(attack => game.canPayCost(pokemon, game.attackCost(pokemon, attack)));
}

// 手放してよいカードほど高い点（CPU が手札を選んで手放すとき）
function discardScore(game, player, inst) {
    const card = game.cardOf(inst);
    const same = player.hand.filter(other => other.id === inst.id).length;
    if (isBasicEnergy(card)) return 70 + same * 5;
    if (isPokemon(card)) return 40 - card.stage * 10 - (card.rule ? 20 : 0);
    if (card.trainerType === 'stadium') return 90;
    return 60 + same * 5;
}

// エネルギーをつけると得なポケモンほど高い点（CPU がつけ先を選ぶとき）
function attachScore(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return (owner?.active === pokemon ? 30 : 0) + (canAttackWith(game, pokemon) ? 0 : 50) - pokemon.energies.length;
}

// ワザを使ったポケモンに、ダメカンをのせる（ワザを使ったポケモンが場にいれば）
function damageAttacker(game, ctx, counters) {
    if (ctx.attacker && game.ownerOf(ctx.attacker)) game.putDamage(ctx.attacker, counters * 10);
}

// このポケモンをきぜつさせる（「使ったなら、このポケモンをきぜつさせる」）
function knockOutSelf(game, pokemon) {
    pokemon.damage = Math.max(pokemon.damage, game.maxHp(pokemon));
    game.log(`${game.topCard(pokemon).name}は特性の効果できぜつする`);
    game.runNext(() => game.checkKnockouts());
}

/**
 * エネルギーを1枚ずつ、条件に合う自分のポケモンにつける（つけ先が1匹だけなら自動）。最後に then を呼ぶ
 *   insts は、もとの置き場（手札・山札・トラッシュ）から取り除いてから渡す
 *   fromHand なら、手札からつけたとき（フック onAttachEnergy）を知らせる
 */
function attachEach(game, player, insts, filter, { purpose, fromHand = false, then } = {}) {
    const steps = insts.map(inst => () => {
        const targets = game.inPlay(player).filter(filter);
        const attach = target => {
            target.energies.push(inst);
            game.log(`${game.topCard(target).name}に${game.cardName(inst)}をつけた`);
            if (fromHand) game.hookAll('onAttachEnergy', player, target, inst);
        };
        if (targets.length === 0) {
            (fromHand ? player.hand : player.discard).push(inst);
            return;
        }
        if (targets.length === 1) {
            attach(targets[0]);
            return;
        }
        game.promptPokemon({
            player,
            pokemon: targets,
            min: 1,
            max: 1,
            title: `${game.cardName(inst)}をつけるポケモンを選ぶ`,
            purpose,
            cpuAnswer: (g, prompt) => bestIndices(prompt.pokemon, pokemon => attachScore(game, pokemon), 1),
            callback: ([target]) => attach(target)
        });
    });
    game.runNext(...steps, ...(then ? [then] : []));
}

/**
 * 1つの置き場から、条件ごとに順に選ばせ（それぞれ0枚から）、最後に onDone(選んだカード) を呼ぶ
 *   groups：[{ filter(card), max, title }]。選んだカードは置き場に残したまま渡す
 */
function pickGroups(game, player, { from, groups, purpose, onDone }) {
    const chosen = [];
    const step = index => {
        if (index >= groups.length) {
            onDone(chosen);
            return;
        }
        const group = groups[index];
        const candidates = from.filter(inst => !chosen.includes(inst) && group.filter(game.cardOf(inst)));
        const max = Math.min(group.max, candidates.length);
        if (max <= 0) {
            step(index + 1);
            return;
        }
        game.promptCards({
            player,
            cards: candidates,
            min: 0,
            max,
            title: group.title,
            purpose,
            cpuAnswer: (g, prompt) => allIndices(prompt.max),
            callback: selected => {
                chosen.push(...selected);
                step(index + 1);
            }
        });
    };
    step(0);
}

// 手札から条件ごとにエネルギーを選び、条件に合うポケモンにつける
function attachFromHand(game, player, groups, targetFilter, purpose) {
    pickGroups(game, player, {
        from: player.hand,
        groups,
        purpose,
        onDone: chosen => {
            chosen.forEach(inst => game.removeCard(player.hand, inst));
            attachEach(game, player, chosen, targetFilter, { purpose: `${purpose}-target`, fromHand: true });
        }
    });
}

// 山札から条件ごとにエネルギーを選び、条件に合うポケモンにつけて、山札を切る
function attachFromDeck(game, player, groups, targetFilter, purpose) {
    pickGroups(game, player, {
        from: player.deck,
        groups,
        purpose,
        onDone: chosen => {
            chosen.forEach(inst => game.removeCard(player.deck, inst));
            if (chosen.length === 0) game.log(`${player.name}は山札を見たが、カードを選ばなかった`);
            attachEach(game, player, chosen, targetFilter, { purpose: `${purpose}-target`, then: () => game.shuffleDeck(player) });
        }
    });
}

// トラッシュから基本エネルギーを max 枚まで選び、条件に合うポケモンにつける
function attachFromDiscard(game, player, energyFilter, max, targetFilter, title, purpose) {
    const candidates = cardsIn(game, player.discard, energyFilter);
    if (candidates.length === 0) return;
    game.promptCards({
        player,
        cards: candidates,
        min: 0,
        max: Math.min(max, candidates.length),
        title,
        purpose,
        cpuAnswer: (g, prompt) => allIndices(prompt.max),
        callback: selected => {
            selected.forEach(inst => game.removeCard(player.discard, inst));
            attachEach(game, player, selected, targetFilter, { purpose: `${purpose}-target` });
        }
    });
}

// 山札から条件に合うカードを max 枚まで選び、相手に見せて手札に加える（最後に山札を切る）
function searchToHand(game, player, filter, max, title, purpose = 'search-card') {
    game.searchDeck({ player, filter, max, title, purpose, onSelected: found => game.addToHand(player, found, { reveal: true }) });
}

// 山札の上から count 枚を見て、条件に合うものを max 枚まで選び、相手に見せて手札に加え、残りを山札にもどして切る
function lookTopAndTake(game, player, count, filter, max, title) {
    const looked = player.deck.slice(0, count);
    game.log(`${player.name}は山札を上から${looked.length}枚見た`);
    game.log(`見たカード：${looked.map(inst => game.cardName(inst)).join('・') || 'なし'}`, { to: player.id });
    const candidates = cardsIn(game, looked, filter);
    const finish = selected => {
        selected.forEach(inst => game.removeCard(player.deck, inst));
        game.addToHand(player, selected, { reveal: true });
        game.shuffleDeck(player);
    };
    if (candidates.length === 0) {
        finish([]);
        return;
    }
    game.promptCards({
        player,
        cards: candidates,
        min: 0,
        max: Math.min(max, candidates.length),
        title,
        purpose: 'look-and-take',
        cpuAnswer: (g, prompt) => allIndices(prompt.max),
        callback: finish
    });
}

// 相手の手札のたねポケモンを、相手のベンチに出す
function benchFromOpponentHand(game, player, filter, { min, max, title, purpose }) {
    const opponent = game.opponentOf(player);
    const room = game.benchSize - opponent.bench.length;
    const candidates = cardsIn(game, opponent.hand, card => isBasicPokemon(card) && filter(card));
    const count = Math.min(max, room, candidates.length);
    if (count <= 0) return;
    game.promptCards({
        player,
        cards: candidates,
        min: Math.min(min, count),
        max: count,
        title,
        purpose,
        // HP の低いポケモンから（呼び出して倒しやすい）
        cpuAnswer: (g, prompt) => bestIndices(prompt.cards, inst => -game.cardOf(inst).hp, Math.max(prompt.min, Math.min(prompt.max, 1))),
        callback: selected => selected.forEach(inst => {
            game.removeCard(opponent.hand, inst);
            opponent.bench.push(game.createPokemon(inst));
            game.log(`${opponent.name}のベンチに${game.cardName(inst)}を出した`);
        })
    });
}

// 受けるワザのダメージを減らす（condition(game, source, ctx, target) が満たされるとき、このポケモンだけ）
const reduceSelf = (amount, condition = () => true) => ({
    type: 'passive',
    hooks: {
        damageTaken: (game, source, ctx, target) => (target === source.pokemon && condition(game, source, ctx, target) ? -amount : 0)
    }
});

// ワザのダメージを受けるとき、コインを投げ、オモテならそのダメージを受けない
// （preventDamage はワザのダメージを与えるときにだけ呼ばれるので、コインはダメージ1回につき1回投げる）
const coinPreventSelf = (condition = () => true) => ({
    type: 'passive',
    hooks: {
        preventDamage: (game, source, ctx, target) => {
            if (target !== source.pokemon || !condition(game, source)) return false;
            return game.flipCoin();
        }
    }
});

// HP がまんたんの状態でワザのダメージを受けてきぜつするとき、きぜつせず残りHP10で残る
const enduranceAtFullHp = (name, mark) => ({
    type: 'passive',
    hooks: {
        // HP がまんたんのときにワザのダメージを受けたら、この番の終わりまで覚えておく
        onDamaged: (game, source, ctx, target, damage) => {
            if (target === source.pokemon && target.damage === damage) game.addEffect(target, mark, game.turn);
        },
        preventKnockout: (game, source, pokemon, player, { byAttack }) => {
            if (pokemon !== source.pokemon || !byAttack || !game.hasEffect(pokemon, mark)) return false;
            pokemon.damage = game.maxHp(pokemon) - 10;
            game.log(`${game.topCard(pokemon).name}は${name}で、残りHP10で場に残った`);
            return true;
        }
    }
});

// 相手の手札からグッズなどを出して使えなくする（このポケモンがバトル場にいるかぎり）
const blockOpponentTrainers = (test, reason) => ({
    type: 'passive',
    hooks: {
        blockTrainer: (game, source, player, card) => (player !== source.player && isActive(game, source.pokemon) && test(card) ? reason : null)
    }
});

// 自分と相手のプレイヤーが、それぞれ山札を1枚引く
const bothDraw = (game, player) => {
    game.draw(player, 1);
    game.draw(game.opponentOf(player), 1);
};

// 相手のポケモンに、ダメカンをのせる（ポケモンを選ぶ）
function placeCountersOnOpponent(game, player, { counters, count, title, purpose, then }) {
    // ダメカンの効果を受けないポケモン（ばけがくれ・バトルコロシアムのベンチなど）は選べない
    const targets = game.inPlay(game.opponentOf(player)).filter(target => canAffectFrom(game, player, target, 'counters'));
    if (targets.length === 0) return;
    const n = Math.min(count, targets.length);
    game.promptPokemon({
        player,
        pokemon: targets,
        min: n,
        max: n,
        title,
        purpose,
        amount: counters * 10,
        callback: selected => {
            selected.forEach(target => game.putDamage(target, counters * 10));
            then?.();
            game.runNext(() => game.checkKnockouts());
        }
    });
}

// カースドボム：CPU が使いたいか（相手のポケモンをきぜつさせられ、取られるサイドで負けないとき）
function cpuWantsCursedBomb(game, player, pokemon, counters) {
    const opponent = game.opponentOf(player);
    if (game.inPlay(player).length < 2) return false;
    if (opponent.prizes.length <= game.prizeValue(game.topCard(pokemon))) return false;
    return game.inPlay(opponent).some(target => remainingHp(game, target) <= counters * 10);
}

const cursedBomb = counters => ({
    type: 'activated',
    use: (game, player, pokemon) => placeCountersOnOpponent(game, player, {
        counters,
        count: 1,
        title: `ダメカンを${counters}個のせる相手のポケモンを選ぶ`,
        purpose: 'snipe-target',
        then: () => knockOutSelf(game, pokemon)
    }),
    cpuWants: (game, player, pokemon) => cpuWantsCursedBomb(game, player, pokemon, counters)
});

// 自分のバトルポケモンとベンチポケモンを入れ替える（ベンチのこのポケモンと）
function switchSelfIn(game, player, pokemon) {
    if (player.bench.includes(pokemon)) game.switchActive(player, pokemon);
}

// player の特性で、そのポケモンを退化させて、はがしたカードを手札にもどせるか（効果を受けない・手札にもどせない（なぎのきょうち）ものはのぞく）
const canDevolveToHand = (game, player, pokemon) => pokemon.cards.length > 1 && game.topCard(pokemon).stage > 0
    && canAffectFrom(game, player, pokemon, 'devolve') && !game.hookAny('blockReturnToHand', pokemon);

// 進化しているポケモンから、進化カードを1枚はがして持ち主の手札にもどす（退化。本体の game.devolve が、効果を受けないポケモンを見る）
function devolveOne(game, owner, target) {
    if (game.devolve(target, 1, 'hand').length > 0) target.evolvedFrom = null;
    game.runNext(() => game.checkKnockouts());
}

const SWIRL_NAMES = ['トルネロス', 'ボルトロス', 'ランドロス', 'ラブトロス'];

export const ABILITY_EFFECTS = {
    // ===== 受けるダメージを減らす・受けない =====
    'あついしぼう': reduceSelf(30, (game, source, ctx) => ['fire', 'water'].includes(game.topCard(ctx.attacker).type)),
    'アフロガード': reduceSelf(30),
    'かたいからだ': reduceSelf(20),
    'かたいこうら': reduceSelf(20),
    'がっちりボディ': reduceSelf(30),
    'がんせきアーマー': reduceSelf(30, (game, source) => source.pokemon.energies.length > 0),
    'こうみつどアーマー': reduceSelf(60, (game, source) => source.pokemon.damage === 0),
    'ギアコーティング': {
        type: 'passive',
        hooks: {
            damageTaken: (game, source, ctx, target) => (game.ownerOf(target) === source.player && hasEnergyOf(game, target, 'metal') ? -20 : 0)
        }
    },
    'カーリーウォール': {
        type: 'passive',
        hooks: {
            damageTaken: (game, source, ctx, target) => {
                if (game.ownerOf(target) !== source.player) return 0;
                const card = game.topCard(target);
                if (card.type !== 'colorless' || card.stage !== 0) return 0;
                // 自分の別の「バッフロン」がいるか。何匹いても重ならないので、最初の1匹だけが働く
                if (game.inPlay(source.player).filter(pokemon => game.topCard(pokemon).name === 'バッフロン').length < 2) return 0;
                return firstWithAbility(game, source.player, 'カーリーウォール') === source.pokemon ? -60 : 0;
            }
        }
    },
    'いかくのキバ': {
        type: 'passive',
        hooks: {
            // 相手のバトルポケモンが使うワザのダメージ（弱点・抵抗力の前）を減らす
            damageDealt: (game, source, ctx) => {
                if (!isActive(game, source.pokemon)) return 0;
                return ctx.attacker === game.opponentOf(source.player).active ? -30 : 0;
            }
        }
    },
    'いしずえのかまえ': {
        type: 'passive',
        hooks: {
            preventDamage: (game, source, ctx, target) => target === source.pokemon
                && Boolean(game.topCard(ctx.attacker).ability) && !game.abilitySuppressed(ctx.attacker)
        }
    },
    'くらがくれ': {
        type: 'passive',
        hooks: {
            preventDamage: (game, source, ctx, target) => target === source.pokemon && !isActive(game, target),
            preventEffects: (game, source, ctx, pokemon) => pokemon === source.pokemon && !isActive(game, pokemon)
        }
    },
    'こうていのかまえ': {
        type: 'passive',
        hooks: {
            preventEffects: (game, source, ctx, pokemon) => pokemon === source.pokemon
        }
    },
    'かくれじょうず': coinPreventSelf(),
    'アドレナフェロモン': coinPreventSelf((game, source) => hasEnergyOf(game, source.pokemon, 'darkness')),
    'がんじょう': enduranceAtFullHp('がんじょう', 'sturdyFullHp'),
    'がんばりハート': enduranceAtFullHp('がんばりハート', 'braveHeartFullHp'),
    'くちないからだ': {
        type: 'passive',
        hooks: {
            preventKnockout: (game, source, pokemon, player, { byAttack }) => {
                if (pokemon !== source.pokemon || !byAttack || !game.flipCoin()) return false;
                pokemon.damage = game.maxHp(pokemon) - 10;
                game.log(`${game.topCard(pokemon).name}はくちないからだで、残りHP10で場に残った`);
                return true;
            }
        }
    },
    'かげかくし': {
        type: 'passive',
        hooks: {
            // 自分の悪ポケモンが、相手のポケモンexからワザのダメージを受けたら、この番の終わりまで覚えておく
            onDamaged: (game, source, ctx, target) => {
                if (game.ownerOf(target) !== source.player || game.topCard(target).type !== 'darkness') return;
                if (ctx.attacker && isPokemonEx(game.topCard(ctx.attacker))) game.addEffect(target, 'shadowHideHit', game.turn);
            },
            // 重ならないので、最初の1匹だけが働く
            prizeModifier: (game, source, pokemon, player, { byAttack }) => {
                if (player !== source.player || !byAttack || !game.hasEffect(pokemon, 'shadowHideHit')) return 0;
                return firstWithAbility(game, source.player, 'かげかくし') === source.pokemon ? -1 : 0;
            }
        }
    },

    // ===== 与えるダメージ・最大HP・ワザのエネルギー =====
    'アドレナパワー': {
        type: 'passive',
        hooks: {
            maxHp: (game, source, pokemon) => (pokemon === source.pokemon && hasEnergyOf(game, pokemon, 'darkness') ? 100 : 0),
            damageDealt: (game, source, ctx, target) => (ctx.attacker === source.pokemon && isActive(game, target)
                && hasEnergyOf(game, source.pokemon, 'darkness') ? 100 : 0)
        }
    },
    'グローリーエール': {
        type: 'passive',
        hooks: {
            damageDealt: (game, source, ctx, target) => (game.ownerOf(ctx.attacker) === source.player && isActive(game, target)
                && game.topCard(ctx.attacker).name.startsWith('シロナの') ? 30 : 0)
        }
    },
    'げんしのこころえ': {
        type: 'passive',
        hooks: {
            damageDealt: (game, source, ctx, target) => (game.ownerOf(ctx.attacker) === source.player && isActive(game, target)
                && game.topCard(target).stage > 0 ? 30 : 0)
        }
    },
    'グリードイーター': {
        type: 'passive',
        hooks: {
            // このポケモンのワザのダメージを受けたポケモンを、この番の終わりまで覚えておく
            onDamaged: (game, source, ctx, target) => {
                // 効果ではなく、ダメージを与えた記録なので、相手の効果を受けないポケモンにも直接残す（addEffect は守りで止まる）
                if (ctx.attacker === source.pokemon) target.effects.push({ kind: 'greedEaterHit', untilTurn: game.turn, by: source.pokemon.id });
            },
            prizeModifier: (game, source, pokemon, player, { byAttack }) => {
                if (player === source.player || !byAttack || game.topCard(pokemon).stage !== 0) return 0;
                return game.effectsOf(pokemon, 'greedEaterHit').some(effect => effect.by === source.pokemon.id) ? 1 : 0;
            }
        }
    },
    'アンチプラズマ': {
        type: 'passive',
        hooks: {
            attackCost: (game, source, pokemon, attack) => {
                if (pokemon !== source.pokemon || attack.name !== 'トライフロスト') return undefined;
                const discard = game.opponentOf(source.player).discard;
                return hasIn(game, discard, card => card.name.includes('アクロマ')) ? ['colorless'] : undefined;
            }
        }
    },
    'けしんだんけつ': {
        type: 'passive',
        hooks: {
            attackCost: (game, source, pokemon, attack, cost) => {
                if (pokemon !== source.pokemon) return undefined;
                const names = game.inPlay(source.player).map(pk => game.topCard(pk).name);
                if (!SWIRL_NAMES.every(name => names.includes(name))) return undefined;
                return cost.filter(type => type !== 'colorless');
            }
        }
    },
    'きどうせいげん': {
        type: 'passive',
        hooks: {
            blockAttack: (game, source, player, pokemon) => (pokemon === source.pokemon && player.hand.length < 10
                ? '手札が10枚以上のときにしか、このポケモンはワザを使えません' : null)
        }
    },

    // ===== ダメージを受けたとき・番の終わり・エネルギーをつけたとき =====
    'オートマーシャル': {
        type: 'passive',
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (target === source.pokemon && isActive(game, target)) damageAttacker(game, ctx, 3);
            }
        }
    },
    'うらみのうず': {
        type: 'passive',
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (source.player.active !== target || game.topCard(target).type !== 'darkness') return;
                damageAttacker(game, ctx, 1);
            }
        }
    },
    'アラートスモッグ': {
        type: 'passive',
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (target !== source.pokemon || !isActive(game, target)) return;
                const player = source.player;
                game.runNext(() => game.benchFromDeck(player, card => isBasicPokemon(card) && card.name.includes('ドガース'), 2, 'bench-basic'));
            }
        }
    },
    'いてつくとばり': {
        type: 'passive',
        hooks: {
            // ポケモンチェックは番の終わりに行うので、その直前（onTurnEnd）にのせる
            onTurnEnd: (game, source) => {
                game.players.forEach(player => game.inPlay(player).forEach(pokemon => {
                    const card = game.topCard(pokemon);
                    if (!card.ability || card.name === 'ユキメノコ' || game.abilitySuppressed(pokemon)) return;
                    game.putDamage(pokemon, 10);
                }));
            }
        }
    },
    'オートヒール': {
        type: 'passive',
        hooks: {
            onAttachEnergy: (game, source, player, pokemon) => {
                if (player !== source.player || !isActive(game, source.pokemon) || pokemon.damage === 0) return;
                game.heal(pokemon, 90);
            }
        }
    },

    // ===== 相手のトレーナーズを止める =====
    'いあつのがんこう': blockOpponentTrainers(card => card.trainerType === 'item', 'バンギラスの特性で、グッズを使えません'),
    'うみののろい': blockOpponentTrainers(card => card.trainerType === 'item' || card.trainerType === 'tool', 'ブルンゲルexの特性で、グッズとポケモンのどうぐを使えません'),
    'エースキャンセラー': {
        type: 'passive',
        hooks: {
            blockTrainer: (game, source, player, card) => (player !== source.player && source.pokemon.tool && card.aceSpec
                ? 'ゲノセクトの特性で、ACE SPECのカードを使えません' : null)
        }
    },

    // ===== 引く =====
    'いそぎあし': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => game.draw(player, 1),
        cpuWants: (game, player) => player.deck.length > 5
    },
    'いざなうあかり': {
        type: 'activated',
        use: bothDraw,
        cpuWants: (game, player) => player.deck.length > 5
    },
    'いざなうはね': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.active === pokemon,
        use: bothDraw,
        cpuWants: (game, player) => player.deck.length > 5
    },
    'おつかいダッシュ': {
        type: 'activated',
        oncePerTurnByName: true,
        canUse: (game, player, pokemon) => player.active === pokemon && player.deck.length > 0,
        use: (game, player) => game.draw(player, 2),
        cpuWants: (game, player) => player.deck.length > 6
    },
    'アップテンポ': {
        type: 'activated',
        canUse: (game, player) => player.hand.length > 0,
        use: (game, player) => game.promptCards({
            player,
            cards: player.hand,
            min: 1,
            max: 1,
            title: '山札の下にもどす手札を1枚選ぶ',
            purpose: 'uptempo-bottom',
            cpuAnswer: (g, prompt) => bestIndices(prompt.cards, inst => discardScore(game, player, inst), 1),
            callback: ([inst]) => {
                game.moveCard(player.hand, player.deck, inst);
                game.log(`${player.name}は手札を1枚山札の下にもどした`);
                const count = 5 - player.hand.length;
                if (count > 0) game.draw(player, count);
            }
        }),
        cpuWants: (game, player) => player.hand.length <= 3 && player.deck.length > 6
    },
    'かげのつかい': {
        type: 'activated',
        canUse: (game, player) => game.turnState.supporterNames.includes('アンズの秘技') && player.hand.length < 8 && player.deck.length > 0,
        use: (game, player) => game.draw(player, 8 - player.hand.length),
        cpuWants: (game, player) => player.deck.length > 8 - player.hand.length + 3
    },
    'おおきなはね': {
        type: 'activated',
        use: (game, player) => {
            const opponent = game.opponentOf(player);
            game.putHandOnDeckBottom(opponent);
            game.draw(opponent, 4);
        },
        cpuWants: (game, player) => game.opponentOf(player).hand.length >= 6
    },

    // ===== 山札から探す =====
    'おうじゃのよびごえ': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => searchToHand(game, player, card => isPokemon(card) && card.name.startsWith('シロナの'), 1, '手札に加える「シロナのポケモン」を選ぶ', 'search-pokemon'),
        cpuWants: (game, player) => hasIn(game, player.deck, card => isPokemon(card) && card.name.startsWith('シロナの'))
    },
    'かおりあつめ': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => searchToHand(game, player, card => isBasicEnergy(card), 2, '手札に加える基本エネルギーを2枚まで選ぶ'),
        cpuWants: (game, player) => hasIn(game, player.deck, card => isBasicEnergy(card)) && player.hand.filter(inst => game.cardOf(inst).kind === 'energy').length < 2
    },
    'きゃくよせ': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.active === pokemon && player.deck.length > 0,
        use: (game, player) => lookTopAndTake(game, player, 6, card => card.trainerType === 'supporter', 1, '手札に加えるサポートを選ぶ'),
        cpuWants: (game, player) => player.deck.length > 6
    },
    'おくのてキャッチ': {
        type: 'onBench',
        canUse: (game, player) => player.deck.length > 0 && !game.turnState.abilityNamesUsed.some(name => name.includes('おくのて')),
        use: (game, player) => searchToHand(game, player, card => card.trainerType === 'supporter', 1, '手札に加えるサポートを選ぶ')
    },
    'からぬけ': {
        type: 'onEvolve',
        canUse: (game, player) => player.deck.length > 0 && player.bench.length < game.benchSize,
        use: (game, player) => game.benchFromDeck(player, card => isBasicPokemon(card) && card.name === 'ヌケニン', 1, 'bench-basic')
    },
    'きんきゅうしんか': {
        type: 'activated',
        canUse: (game, player, pokemon) => remainingHp(game, pokemon) <= 30
            && hasIn(game, player.deck, card => isPokemon(card) && (card.name === 'ケンホロウ' || card.name === 'ケンホロウex')),
        use: (game, player, pokemon) => game.searchDeck({
            player,
            filter: card => isPokemon(card) && (card.name === 'ケンホロウ' || card.name === 'ケンホロウex'),
            max: 1,
            title: '進化させる「ケンホロウ」を選ぶ',
            purpose: 'search-evolution',
            onSelected: ([inst]) => { if (inst) game.evolveFromOutside(player, pokemon, inst); }
        })
    },

    // ===== エネルギーをつける・つけ替える =====
    'エレキストリーマー': {
        type: 'activated',
        unlimited: true,
        canUse: (game, player) => hasIn(game, player.hand, card => isBasicEnergy(card, 'lightning'))
            && hasInPlay(game, player, card => card.name.startsWith('ナンジャモの')),
        use: (game, player) => attachFromHand(game, player,
            [{ filter: card => isBasicEnergy(card, 'lightning'), max: 1, title: 'つける基本雷エネルギーを選ぶ' }],
            pokemon => game.topCard(pokemon).name.startsWith('ナンジャモの'), 'electric-streamer'),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => game.topCard(pokemon).name.startsWith('ナンジャモの') && !canAttackWith(game, pokemon))
    },
    'かえんぶとう': {
        type: 'activated',
        canUse: (game, player) => hasIn(game, player.hand, card => isBasicEnergy(card, 'fire') || isBasicEnergy(card, 'fighting')),
        use: (game, player) => attachFromHand(game, player, [
            { filter: card => isBasicEnergy(card, 'fire'), max: 1, title: 'つける基本炎エネルギーを選ぶ（つけないなら選ばない）' },
            { filter: card => isBasicEnergy(card, 'fighting'), max: 1, title: 'つける基本闘エネルギーを選ぶ（つけないなら選ばない）' }
        ], () => true, 'flame-dance'),
        cpuWants: (game, player) => game.inPlay(player).some(pokemon => !canAttackWith(game, pokemon))
    },
    'けいけんそく': {
        type: 'onBench',
        canUse: (game, player) => hasIn(game, player.hand, card => isBasicEnergy(card, 'fighting')),
        use: (game, player, pokemon) => attachFromHand(game, player,
            [{ filter: card => isBasicEnergy(card, 'fighting'), max: 2, title: 'このポケモンにつける基本闘エネルギーを2枚まで選ぶ' }],
            pk => pk === pokemon, 'experienced-step')
    },
    'エリマキはつでん': {
        type: 'activated',
        canUse: (game, player) => game.turnState.supporterNames.includes('カナリィ') && player.deck.length > 0,
        use: (game, player, pokemon) => attachFromDeck(game, player,
            [{ filter: card => isBasicEnergy(card, 'lightning'), max: 2, title: 'このポケモンにつける基本雷エネルギーを2枚まで選ぶ' }],
            pk => pk === pokemon, 'frill-generator'),
        cpuWants: (game, player) => hasIn(game, player.deck, card => isBasicEnergy(card, 'lightning'))
    },
    'エクスブート': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0 && hasInPlay(game, player, card => card.type === 'psychic' || card.type === 'metal'),
        use: (game, player) => attachFromDeck(game, player, [
            { filter: card => isBasicEnergy(card, 'psychic'), max: 1, title: 'つける基本超エネルギーを選ぶ' },
            { filter: card => isBasicEnergy(card, 'metal'), max: 1, title: 'つける基本鋼エネルギーを選ぶ' }
        ], pokemon => ['psychic', 'metal'].includes(game.topCard(pokemon).type), 'ex-boot'),
        cpuWants: (game, player) => hasIn(game, player.deck, card => isBasicEnergy(card, 'psychic') || isBasicEnergy(card, 'metal'))
    },
    'エナジーステップ': {
        type: 'onEvolve',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => {
            const looked = player.deck.slice(0, 4);
            game.log(`${player.name}は山札を上から${looked.length}枚見た`);
            game.log(`見たカード：${looked.map(inst => game.cardName(inst)).join('・') || 'なし'}`, { to: player.id });
            const candidates = cardsIn(game, looked, card => isBasicEnergy(card));
            if (candidates.length === 0) {
                game.shuffleDeck(player);
                return;
            }
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: candidates.length,
                title: '自分のポケモンにつける基本エネルギーを選ぶ',
                purpose: 'energy-step',
                cpuAnswer: (g, prompt) => allIndices(prompt.max),
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.deck, inst));
                    attachEach(game, player, selected, () => true, { purpose: 'energy-step-target', then: () => game.shuffleDeck(player) });
                }
            });
        }
    },
    'エレキダイナモ': {
        type: 'activated',
        canUse: (game, player) => player.bench.length > 0 && hasIn(game, player.discard, card => isBasicEnergy(card, 'lightning')),
        use: (game, player) => attachFromDiscard(game, player, card => isBasicEnergy(card, 'lightning'), 1,
            pokemon => player.bench.includes(pokemon), 'ベンチポケモンにつける基本雷エネルギーを選ぶ', 'electric-dynamo')
    },
    'ごうきんビルド': {
        type: 'onEvolve',
        canUse: (game, player) => hasIn(game, player.discard, card => isBasicEnergy(card, 'metal')),
        use: (game, player) => attachFromDiscard(game, player, card => isBasicEnergy(card, 'metal'), 2,
            pokemon => game.topCard(pokemon).type === 'metal', '鋼ポケモンにつける基本鋼エネルギーを2枚まで選ぶ', 'alloy-build')
    },
    'かじょうほうでん': {
        type: 'activated',
        // つけた後にこのポケモンはきぜつするので、つけ先はこのポケモンをのぞく雷ポケモン
        canUse: (game, player, pokemon) => hasIn(game, player.discard, card => isBasicEnergy(card))
            && game.inPlay(player).some(pk => pk !== pokemon && game.topCard(pk).type === 'lightning'),
        use: (game, player, pokemon) => {
            const candidates = cardsIn(game, player.discard, card => isBasicEnergy(card));
            game.promptCards({
                player,
                cards: candidates,
                min: 0,
                max: Math.min(3, candidates.length),
                title: '雷ポケモンにつける基本エネルギーを3枚まで選ぶ',
                purpose: 'overvolt-discharge',
                cpuAnswer: (g, prompt) => allIndices(prompt.max),
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.discard, inst));
                    attachEach(game, player, selected, pk => pk !== pokemon && game.topCard(pk).type === 'lightning', {
                        purpose: 'overvolt-discharge-target',
                        then: () => knockOutSelf(game, pokemon)
                    });
                }
            });
        },
        cpuWants: (game, player, pokemon) => cardsIn(game, player.discard, card => isBasicEnergy(card)).length >= 2
            && game.inPlay(player).length >= 3
            && game.opponentOf(player).prizes.length > game.prizeValue(game.topCard(pokemon))
    },
    'おしながす': {
        type: 'activated',
        unlimited: true,
        canUse: (game, player) => Boolean(player.active) && player.bench.some(pokemon => pokemon.energies.length > 0),
        use: (game, player) => {
            const sources = player.bench.filter(pokemon => pokemon.energies.length > 0);
            const moveFrom = source => {
                const finish = inst => game.moveEnergy(source, player.active, inst);
                if (new Set(source.energies.map(inst => inst.id)).size === 1) {
                    finish(source.energies[0]);
                    return;
                }
                game.promptCards({
                    player,
                    cards: source.energies,
                    min: 1,
                    max: 1,
                    title: 'バトルポケモンにつけ替えるエネルギーを選ぶ',
                    purpose: 'wash-away-energy',
                    callback: ([inst]) => finish(inst)
                });
            };
            game.promptPokemon({
                player,
                pokemon: sources,
                min: 1,
                max: 1,
                title: 'エネルギーをはがすベンチポケモンを選ぶ',
                purpose: 'wash-away-source',
                cpuAnswer: (g, prompt) => bestIndices(prompt.pokemon, pokemon => pokemon.energies.length - (canAttackWith(game, pokemon) ? 10 : 0), 1),
                callback: ([source]) => moveFrom(source)
            });
        },
        cpuWants: (game, player) => !canAttackWith(game, player.active)
    },

    // ===== 回復 =====
    'うるわしのかおり': {
        type: 'activated',
        canUse: (game, player) => game.inPlay(player).some(pokemon => pokemon.damage > 0),
        use: (game, player) => game.inPlay(player).forEach(pokemon => { if (pokemon.damage > 0) game.heal(pokemon, 30); })
    },
    'オーシャンゲイン': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.active === pokemon && pokemon.damage > 0,
        use: (game, player, pokemon) => game.heal(pokemon, 50)
    },
    'かるがるヒール': {
        type: 'onEvolve',
        canUse: (game, player) => Boolean(player.active) && game.topCard(player.active).type === 'grass' && player.active.damage > 0,
        use: (game, player) => {
            const active = player.active;
            game.heal(active, active.damage);
            game.discardEnergyFrom(active, active.energies.length);
        }
    },

    // ===== ダメカンをのせる・のせ替える =====
    'サマヨール/カースドボム': cursedBomb(5),
    'ヨノワール/カースドボム': cursedBomb(13),
    'かみつきまわる': {
        type: 'onEvolve',
        use: (game, player) => placeCountersOnOpponent(game, player, {
            counters: 2,
            count: 2,
            title: 'ダメカンを2個ずつのせる相手のポケモンを2匹選ぶ',
            purpose: 'snipe-target'
        })
    },
    'アドレナブレイン': {
        type: 'activated',
        canUse: (game, player, pokemon) => hasEnergyOf(game, pokemon, 'darkness')
            && game.inPlay(player).some(pk => pk.damage > 0)
            && game.inPlay(game.opponentOf(player)).some(pk => canAffectFrom(game, player, pk, 'moveCounters')),
        use: (game, player) => {
            const opponent = game.opponentOf(player);
            const moveTo = (from, counters) => game.promptPokemon({
                player,
                // のせ替えの効果を受けないポケモンは選べない
                pokemon: game.inPlay(opponent).filter(pk => game.canAffect(pk, 'moveCounters')),
                min: 1,
                max: 1,
                title: `ダメカンを${counters}個のせ替える相手のポケモンを選ぶ`,
                purpose: 'snipe-target',
                amount: counters * 10,
                callback: ([to]) => {
                    game.moveCounters(from, to, counters * 10);
                    game.runNext(() => game.checkKnockouts());
                }
            });
            game.promptPokemon({
                player,
                pokemon: game.inPlay(player).filter(pk => pk.damage > 0),
                min: 1,
                max: 1,
                title: 'ダメカンをのせ替える自分のポケモンを選ぶ',
                purpose: 'adrena-brain-source',
                cpuAnswer: (g, prompt) => bestIndices(prompt.pokemon, pk => pk.damage, 1),
                callback: ([from]) => {
                    const max = Math.min(3, Math.floor(from.damage / 10));
                    if (max === 1) {
                        moveTo(from, 1);
                        return;
                    }
                    game.promptChoose({
                        player,
                        options: Array.from({ length: max }, (_, index) => `${index + 1}個`),
                        title: 'のせ替えるダメカンの数を選ぶ',
                        purpose: 'adrena-brain-count',
                        cpuAnswer: () => [max - 1],
                        callback: ([index]) => moveTo(from, index + 1)
                    });
                }
            });
        }
    },
    'うらみしんか': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.turnsTaken > 1
            && hasIn(game, player.hand, card => isPokemon(card) && card.evolvesFrom === game.topCard(pokemon).name),
        use: (game, player, pokemon) => game.promptCards({
            player,
            cards: cardsIn(game, player.hand, card => isPokemon(card) && card.evolvesFrom === game.topCard(pokemon).name),
            min: 1,
            max: 1,
            title: '進化させるカードを選ぶ',
            purpose: 'grudge-evolution',
            callback: ([inst]) => {
                game.evolveInto(player, pokemon, inst);
                game.putDamage(pokemon, 20);
                game.runNext(() => game.checkKnockouts());
            }
        })
    },

    // ===== 相手の山札・手札・場 =====
    'いきなりけずる': {
        type: 'onBench',
        canUse: (game, player) => game.opponentOf(player).deck.length > 0,
        use: (game, player) => game.millDeck(game.opponentOf(player), 1)
    },
    'いけずなしっぽ': {
        type: 'onEvolve',
        canUse: (game, player) => game.opponentOf(player).hand.length > 0,
        use: (game, player) => {
            const opponent = game.opponentOf(player);
            const heads = [game.flipCoin(), game.flipCoin()].filter(Boolean).length;
            const returned = [];
            for (let i = 0; i < heads && opponent.hand.length > 0; i++) {
                const inst = opponent.hand[Math.floor(game.random() * opponent.hand.length)];
                game.moveCard(opponent.hand, opponent.deck, inst);
                returned.push(inst);
            }
            if (returned.length === 0) return;
            game.log(`${opponent.name}の手札の${returned.map(inst => game.cardName(inst)).join('と')}を山札にもどした`);
            game.shuffleDeck(opponent);
        }
    },
    'えものをねらう': {
        type: 'activated',
        canUse: (game, player) => game.opponentOf(player).hand.length > 0 && game.opponentOf(player).bench.length < game.benchSize,
        use: (game, player) => {
            const opponent = game.opponentOf(player);
            game.revealHand(opponent, player);
            benchFromOpponentHand(game, player, card => card.hp <= 70, {
                min: 1,
                max: 1,
                title: '相手のベンチに出すHP70以下のたねポケモンを選ぶ',
                purpose: 'hunt-prey'
            });
        }
    },
    'おさそいウインク': {
        type: 'onEvolve',
        canUse: (game, player) => game.opponentOf(player).hand.length > 0 && game.opponentOf(player).bench.length < game.benchSize,
        use: (game, player) => {
            const opponent = game.opponentOf(player);
            game.revealHand(opponent, player);
            benchFromOpponentHand(game, player, () => true, {
                min: 0,
                max: game.benchSize,
                title: '相手のベンチに出すたねポケモンを選ぶ（好きなだけ）',
                purpose: 'inviting-wink'
            });
        }
    },
    'きらぼしもよう': {
        type: 'onEvolve',
        canUse: (game, player) => canAffectFrom(game, player, game.opponentOf(player).active, 'switch')
            && game.opponentOf(player).bench.some(pokemon => remainingHp(game, pokemon) <= 90 && canAffectFrom(game, player, pokemon, 'switch')),
        use: (game, player) => {
            const opponent = game.opponentOf(player);
            game.promptPokemon({
                player,
                // 入れ替えの効果を受けないポケモンは選べない
                pokemon: opponent.bench.filter(pokemon => remainingHp(game, pokemon) <= 90 && game.canAffect(pokemon, 'switch')),
                min: 1,
                max: 1,
                title: 'バトル場に呼び出す相手のポケモンを選ぶ',
                purpose: 'boss-target',
                callback: ([target]) => game.switchActive(opponent, target)
            });
        }
    },
    'げんしのつばさ': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.active === pokemon
            && game.inPlay(game.opponentOf(player)).some(pk => canDevolveToHand(game, player, pk)),
        use: (game, player) => {
            const opponent = game.opponentOf(player);
            game.promptPokemon({
                player,
                pokemon: game.inPlay(opponent).filter(pk => canDevolveToHand(game, player, pk)),
                min: 1,
                max: 1,
                title: '退化させる相手のポケモンを選ぶ',
                purpose: 'primal-wing',
                // 退化させるときぜつするもの → 進化の段階が高いもの
                cpuAnswer: (g, prompt) => bestIndices(prompt.pokemon, pk => {
                    const lower = game.cardOf(pk.cards[pk.cards.length - 2]);
                    return (pk.damage >= lower.hp ? 1000 : 0) + game.topCard(pk).stage * 100 + pk.damage;
                }, 1),
                callback: ([target]) => devolveOne(game, opponent, target)
            });
        }
    },
    'げきりゅうのうず': {
        type: 'activated',
        canUse: (game, player) => Boolean(player.active) && player.bench.length > 0,
        use: (game, player) => {
            const opponent = game.opponentOf(player);
            game.runNext(
                () => game.promptSwitchOwnActive(player, 'switch'),
                () => {
                    // 入れ替えの効果を受けないポケモンは、相手がバトル場に出す候補にしない
                    const bench = opponent.bench.filter(pk => game.canAffect(pk, 'switch'));
                    if (bench.length === 0 || !game.canAffect(opponent.active, 'switch')) return;
                    game.promptPokemon({
                        player: opponent,
                        pokemon: bench,
                        min: 1,
                        max: 1,
                        title: 'バトル場に出すベンチポケモンを選ぶ',
                        purpose: 'forced-switch',
                        callback: ([target]) => { if (target) game.switchActive(opponent, target); }
                    });
                }
            );
        },
        cpuWants: (game, player) => !canAttackWith(game, player.active) && player.bench.some(pokemon => canAttackWith(game, pokemon))
    },
    'おやつさがし': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => {
            const inst = player.deck[0];
            const card = game.cardOf(inst);
            game.log(`${player.name}は山札を上から1枚見た`);
            game.log(`見たカード：${card.name}`, { to: player.id });
            game.promptConfirm({
                player,
                title: `山札の上の「${card.name}」をトラッシュしますか？`,
                card: inst.id,
                purpose: 'snack-search',
                // 手札にエネルギーが足りているときのエネルギーと、スタジアムはトラッシュする
                cpuAnswer: () => card.trainerType === 'stadium'
                    || (isBasicEnergy(card) && player.hand.filter(other => game.cardOf(other).kind === 'energy').length >= 2),
                callback: yes => {
                    if (!yes) return;
                    game.moveCard(player.deck, player.discard, inst);
                    game.log(`${player.name}は山札の上の${card.name}をトラッシュした`);
                }
            });
        },
        cpuWants: (game, player) => player.deck.length > 5
    },

    // ===== 入れ替える =====
    'エキサイトダッシュ': {
        type: 'activated',
        canUse: (game, player, pokemon) => player.bench.includes(pokemon) && hasInPlay(game, player, card => isMega(card)),
        use: switchSelfIn,
        cpuWants: (game, player, pokemon) => !canAttackWith(game, player.active) && canAttackWith(game, pokemon)
    },

    // ===== 相手のバトルポケモンがベンチにもどったとき =====
    'あなぼこ': {
        // 相手の番に、相手のバトルポケモンがベンチにもどるたび、そのポケモンにダメカンを2個のせる
        type: 'passive',
        hooks: {
            onSwitchOut: (game, source, player, pokemon) => {
                if (player === source.player || game.current !== player.id || game.phase !== 'main') return;
                game.log(`${source.card.name}の特性「あなぼこ」`);
                game.putDamage(pokemon, 20);
                game.runNext(() => game.checkKnockouts());
            }
        }
    },
    'うずまくことだま': {
        // このポケモンがバトル場にいるかぎり、相手の番に、相手のバトルポケモンがベンチにもどるたび、新しく出てきたポケモンをこんらんにする
        type: 'passive',
        hooks: {
            onSwitchOut: (game, source, player) => {
                if (player === source.player || game.current !== player.id || game.phase !== 'main') return;
                if (!isActive(game, source.pokemon) || !player.active) return;
                game.log(`${source.card.name}の特性「うずまくことだま」`);
                game.addCondition(player.active, 'confused');
            }
        }
    },

    // ===== ほかのポケモンの特性をなくす =====
    'あんやのはばたき': {
        // このポケモンがバトル場にいるかぎり、相手のバトルポケモンの特性（「あんやのはばたき」をのぞく）は、すべてなくなる
        type: 'passive',
        hooks: {
            suppressAbility: (game, source, pokemon) => isActive(game, source.pokemon)
                && game.opponentOf(source.player).active === pokemon
                && game.topCard(pokemon).ability?.name !== 'あんやのはばたき'
        }
    }
};
