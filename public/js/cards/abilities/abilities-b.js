/**
 * 特性の効果（そのb：特性名を日本語の順に並べたときの 88〜175 番目）。書き方は cards/HOOKS.md
 *
 * 同じ名前で、どのカードでも効果が同じなら「特性名」、カードによって効果が違うなら「カード名/特性名」で書く
 * TCGdex のデータは、版によってエネルギーの記号（[R] など）が抜けていることがある
 *   （例：ヒビキのホウオウex SV9a-090「基本エネルギー」は、SV-P-254 では「基本[R]エネルギー」）。
 *   記号の抜けた文は、記号のある版と同じ効果として、記号のとおりに書いた
 *   （こんじきのほのお・したごしらえ・しはいのくさり・じゅくせいチャージ・ちからのしお・ねっぱりんぷん）
 *
 * まだ書いていない特性（ゲームの本体に仕組みが要るもの・文の意味が確かめられないもの）
 *   コバルトコマンド：カードのデータに「未来」の印がない
 *   しゅんぱつりょく：対戦準備で、たねポケモン以外をウラでバトル場に出す仕組みがない
 *   どっきりおとし：カードが山札からトラッシュされたときのフックがない
 *   なぎのきょうち：blockReturnToHand は game.returnToHand（ポケモンとついているカードをまとめてもどす）だけが見る。
 *     ついているエネルギーや進化カードだけを手札にもどす効果（items.js・supporters.js・abilities-a/b.js）は確かめないので、
 *     「そのポケモンについているすべてのカードは、手札にもどせない」が守れない
 *   にじいろDNA：進化元の名前と違うポケモンにのせて進化する仕組みがない
 *   ぬめぬめスリップ：にげるときにコインを投げて、にげるのを失敗させる仕組みがない（blockRetreat は何度も呼ばれるのでコインを投げられない）
 *
 * フックが足されてから書いた特性で、割り切ったところ
 *   こんぺきはとう：ワザの前に ctx.ignoreEffects を立てる。本体は、ctx.ignoreEffects のとき、ベンチのポケモンにかかっている効果も計算しない
 *   ダブルタイプ・デュアルコア：タイプが増えるのは弱点・抵抗力など game.typesOf を使うところだけ（「[P]ポケモン」の判定に card.type を見る効果は、増えたタイプを見ない）
 *   デュアルコア：つけている「ブーストエナジー 未来」の名前だけを見る（「未来」の印はいらない）
 *
 * 割り切ったところ
 *   さかてにとる：本体はワザでのきぜつだけを記録する。ワザ以外のきぜつは、キチキギスexが場にいたときだけ、この特性が自分で記録する
 *   なめらかコート：preventDamage のフックの中でコインを投げる（preventDamage は、ワザのダメージを与えるときだけ呼ばれる）
 *   ダイバーキャッチ：使うかどうかは聞かずに、いつも手札にもどす（損にならないため）
 */

const isPokemonEx = card => card.rule === 'ex' || card.rule === 'mega';
const isBasicEnergy = type => card => card.kind === 'energy' && card.basic && (!type || card.energyType === type);
const isSpecialEnergy = card => card.kind === 'energy' && !card.basic;

const remainingHp = (game, pokemon) => game.maxHp(pokemon) - pokemon.damage;
const cardsIn = (game, list, filter) => list.filter(inst => filter(game.cardOf(inst)));
const hasIn = (game, list, filter) => list.some(inst => filter(game.cardOf(inst)));
const allIndices = count => Array.from({ length: count }, (_, index) => index);

// そのポケモンが、持ち主のバトル場にいるか / ベンチにいるか
function isActive(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active === pokemon;
}
function isBenched(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active !== pokemon;
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

// 手放してよいカードほど高い点（CPU がトラッシュする手札を選ぶとき）
function discardScore(game, player, inst) {
    const card = game.cardOf(inst);
    const same = player.hand.filter(other => other.id === inst.id).length;
    if (card.kind === 'energy' && card.basic) return 70 + same * 5;
    if (card.kind === 'pokemon') return 40 - card.stage * 10 - (card.rule ? 20 : 0);
    if (card.trainerType === 'stadium') return 90;
    return 60 + same * 5;
}

// そのポケモンが、今ワザを使えるだけのエネルギーを持っているか（CPU の目安）
function canPayAnyAttack(game, pokemon) {
    return Boolean(pokemon) && game.topCard(pokemon).attacks.some(attack => game.canPayCost(pokemon, game.attackCost(pokemon, attack)));
}

// 一番最後の（たいていは一番強い）ワザのエネルギーが足りているか（CPU がエネルギーを集めるのをやめる目安）
function canPayLastAttack(game, pokemon) {
    const attacks = game.topCard(pokemon).attacks;
    if (attacks.length === 0) return true;
    return game.canPayCost(pokemon, game.attackCost(pokemon, attacks[attacks.length - 1]));
}

// ワザのダメージを受けたとき（onDamaged）、このポケモンがバトル場にいたか
const hitInActive = (game, source, target) => target === source.pokemon && isActive(game, target);

// ワザを使ったポケモンが、まだ場にいるか
const attackerInPlay = (game, ctx) => Boolean(ctx.attacker) && Boolean(game.ownerOf(ctx.attacker));

// このポケモンが使うワザの、相手のバトルポケモンへのダメージを増やす
function boostOwnAttack(amount) {
    return {
        damageDealt: (game, source, ctx, target) => {
            if (ctx.attacker !== source.pokemon || game.opponentOf(source.player).active !== target) return 0;
            return amount(game, source, ctx, target);
        }
    };
}

// 相手の場のポケモン（ワザを使ったポケモン）が「〜」なら、このポケモンはワザのダメージを受けない
function preventFrom(test) {
    return {
        preventDamage: (game, source, ctx, target) => target === source.pokemon && test(game.topCard(ctx.attacker))
    };
}

// 山札から条件に合うカードを1枚選び、手札に加える（reveal なら相手に見せる）
function searchToHand(game, player, { filter, title, purpose = 'search-card', reveal = false }) {
    game.searchDeck({
        player,
        filter,
        max: 1,
        title,
        purpose,
        onSelected: found => game.addToHand(player, found, { reveal })
    });
}

// 手札から条件に合うカードを count 枚トラッシュしてから then を呼ぶ
function discardFromHand(game, player, { count, filter = () => true, title, then }) {
    const cards = cardsIn(game, player.hand, filter);
    if (cards.length < count) return;
    game.promptCards({
        player,
        cards,
        min: count,
        max: count,
        title,
        purpose: 'ability-discard',
        cpuAnswer: (g, prompt) => bestIndices(prompt.cards, inst => discardScore(g, player, inst), count),
        callback: selected => {
            selected.forEach(inst => game.moveCard(player.hand, player.discard, inst));
            game.log(`${player.name}は手札の${selected.map(inst => game.cardName(inst)).join('と')}をトラッシュした`);
            then();
        }
    });
}

// 手札のエネルギーを、ポケモンにつける（手札から出すつけ方だが、1番に1回の「エネルギーをつける」は使わない）
function attachFromHand(game, player, inst, target) {
    game.removeCard(player.hand, inst);
    target.energies.push(inst);
    game.log(`${game.topCard(target).name}に${game.cardName(inst)}をつけた`);
}

// 手札から条件に合うエネルギーを1枚選び、targets の中から選んだポケモンにつける。つけた後 after(つけたポケモン)
function attachOneFromHand(game, player, { filter, targets, after = () => {} }) {
    const cards = cardsIn(game, player.hand, filter);
    const list = targets();
    if (cards.length === 0 || list.length === 0) return;
    game.promptCards({
        player,
        cards,
        min: 1,
        max: 1,
        title: 'つけるエネルギーを選ぶ',
        purpose: 'ability-energy',
        cpuAnswer: () => [0],
        callback: ([inst]) => {
            const attach = target => {
                attachFromHand(game, player, inst, target);
                after(target);
            };
            if (list.length === 1) {
                attach(list[0]);
                return;
            }
            game.promptPokemon({
                player,
                pokemon: list,
                min: 1,
                max: 1,
                title: `${game.cardName(inst)}をつけるポケモンを選ぶ`,
                purpose: 'energy-switch-target',
                callback: ([target]) => attach(target)
            });
        }
    });
}

// 相手のベンチポケモンを1匹選び、バトルポケモンと入れ替える
function gustOpponent(game, player) {
    const opponent = game.opponentOf(player);
    if (opponent.bench.length === 0) return;
    game.promptPokemon({
        player,
        pokemon: opponent.bench,
        min: 1,
        max: 1,
        title: 'バトル場に出す相手のベンチポケモンを選ぶ',
        purpose: 'boss-target',
        callback: ([target]) => game.switchActive(opponent, target)
    });
}

// ポケモンについているエネルギーを1個選び、then(選んだエネルギー) を呼ぶ（選ぶのは player）
function chooseEnergyOn(game, player, pokemon, { title, purpose, then }) {
    if (!pokemon || pokemon.energies.length === 0) return;
    game.promptCards({
        player,
        cards: pokemon.energies,
        min: 1,
        max: 1,
        title,
        purpose,
        callback: ([inst]) => then(inst)
    });
}

// ポケモンと、ついているすべてのカードを、山札にもどして切る（バトル場が空いたら、ベンチから出す）
function shuffleIntoDeck(game, player, pokemon) {
    if (!game.inPlay(player).includes(pokemon)) return;
    const name = game.topCard(pokemon).name;
    if (player.active === pokemon) player.active = null;
    else game.removeCard(player.bench, pokemon);
    player.deck.push(...pokemon.cards, ...pokemon.energies, ...(pokemon.tool ? [pokemon.tool] : []));
    game.shuffleDeck(player);
    game.log(`${player.name}は${name}と、ついているカードを山札にもどして切った`);
    game.runNext(() => game.checkKnockouts());
}

// ダメカンをのせた後、HP がなくなったポケモンをきぜつさせる
function putCounters(game, pokemon, count) {
    game.putDamage(pokemon, count * 10);
    game.runNext(() => game.checkKnockouts());
}

// 「このポケモンがいるかぎり、自分のたねポケモン全員は、にげるためのエネルギーが、すべてなくなる」
const freeRetreatForBasics = {
    retreatCost: (game, source, pokemon) => (game.ownerOf(pokemon) === source.player && game.topCard(pokemon).stage === 0 ? -99 : 0)
};

// 「ワザを使ったポケモンを〜にする」（バトル場でワザのダメージを受けたとき）
function conditionOnAttacker(condition) {
    return {
        onDamaged: (game, source, ctx, target) => {
            if (hitInActive(game, source, target) && attackerInPlay(game, ctx)) game.addCondition(ctx.attacker, condition);
        }
    };
}

// 相手のポケモン1匹に、ダメカンを count 個のせる
function snipeCounters(game, player, count) {
    const targets = game.inPlay(game.opponentOf(player));
    if (targets.length === 0) return;
    game.promptPokemon({
        player,
        pokemon: targets,
        min: 1,
        max: 1,
        title: `ダメカンを${count}個のせる相手のポケモンを選ぶ`,
        purpose: 'snipe-target',
        amount: count * 10,
        callback: ([target]) => putCounters(game, target, count)
    });
}

// 「自分の番に、このカードを手札から出して進化させたとき、1回使える。相手のベンチポケモンを1匹選び、バトルポケモンと入れ替える」
const gustOnEvolve = {
    type: 'onEvolve',
    canUse: (game, player) => game.opponentOf(player).bench.length > 0,
    use: (game, player) => gustOpponent(game, player)
};

// 進化させたとき、山札を count 枚引く
const drawOnEvolve = count => ({
    type: 'onEvolve',
    canUse: (game, player) => player.deck.length > 0,
    use: (game, player) => game.draw(player, count)
});

// 自分の場の「name」がいるなら、このポケモンは、最初の自分の番や、出したばかりの番でも進化できる
const earlyEvolveWith = name => ({
    type: 'passive',
    hooks: {
        allowEarlyEvolve: (game, source, player, target) => target === source.pokemon
            && game.inPlay(source.player).some(pokemon => game.topCard(pokemon).name === name)
    }
});

// そのポケモンの特殊状態を1つ回復する（2つ以上なら選ぶ）
function cureOneCondition(game, player, pokemon) {
    const conditions = ['poisoned', 'burned', 'asleep', 'paralyzed', 'confused'].filter(condition => game.hasCondition(pokemon, condition));
    const cure = condition => {
        if (condition === 'poisoned') {
            pokemon.poisoned = false;
            pokemon.poisonDamage = null;
        } else if (condition === 'burned') pokemon.burned = false;
        else pokemon.rotation = null;
        game.log(`${game.topCard(pokemon).name}の特殊状態が回復した`);
    };
    if (conditions.length === 0) return;
    if (conditions.length === 1) {
        cure(conditions[0]);
        return;
    }
    const names = { poisoned: 'どく', burned: 'やけど', asleep: 'ねむり', paralyzed: 'マヒ', confused: 'こんらん' };
    game.promptChoose({
        player,
        options: conditions.map(condition => names[condition]),
        title: '回復する特殊状態を選ぶ',
        purpose: 'ability-cure',
        callback: ([index]) => cure(conditions[index])
    });
}

// ワザを使えるポケモンにする入れ替え（CPU の目安）：今のバトルポケモンがワザを使えず、candidate が使えるとき
const betterAttacker = (game, player, candidate) => !game.turnState.attacked
    && !canPayAnyAttack(game, player.active) && canPayAnyAttack(game, candidate);

export const ABILITY_EFFECTS = {
    // ===== ワザのダメージを受けたとき・きぜつしたとき =====

    'こうらのトゲ': {
        type: 'passive',
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (!hitInActive(game, source, target) || !attackerInPlay(game, ctx) || ctx.attacker.energies.length === 0) return;
                const attacker = ctx.attacker;
                game.runNext(() => {
                    if (!game.ownerOf(attacker)) return;
                    chooseEnergyOn(game, source.player, attacker, {
                        title: 'トラッシュする、ワザを使ったポケモンのエネルギーを選ぶ',
                        purpose: 'discard-opponent-energy',
                        then: inst => {
                            game.moveCard(attacker.energies, game.ownerOf(attacker).discard, inst);
                            game.log(`${game.topCard(attacker).name}の${game.cardName(inst)}をトラッシュした`);
                        }
                    });
                });
            }
        }
    },
    'しゃくねつボディ': { type: 'passive', hooks: conditionOnAttacker('burned') },
    'どくのトゲ': { type: 'passive', hooks: conditionOnAttacker('poisoned') },
    'ニードルアーマー': {
        type: 'passive',
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (!hitInActive(game, source, target) || !attackerInPlay(game, ctx)) return;
                const grass = game.energyUnits(source.pokemon).filter(type => type === 'grass' || type === 'any').length;
                if (grass > 0) game.putDamage(ctx.attacker, grass * 3 * 10);
            }
        }
    },
    'さいごのくさり': {
        type: 'passive',
        hooks: {
            onKnockout: (game, source, pokemon, player, { byAttack }) => {
                if (pokemon !== source.pokemon || !byAttack || game.current === player.id) return;
                game.runNext(() => searchToHand(game, player, { filter: () => true, title: '手札に加えるカードを1枚選ぶ' }));
            }
        }
    },
    'さくれつばり': {
        type: 'passive',
        hooks: {
            // ワザを使ったポケモンを、ダメージを受けたときに覚えておく（きぜつしたときには ctx がないため）
            onDamaged: (game, source, ctx, target) => {
                if (hitInActive(game, source, target) && ctx.attacker) source.pokemon.lastAttackedBy = { id: ctx.attacker.id, turn: game.turn };
            },
            onKnockout: (game, source, pokemon, player, { byAttack }) => {
                const hit = pokemon.lastAttackedBy;
                if (pokemon !== source.pokemon || !byAttack || player.active !== pokemon || !hit || hit.turn !== game.turn) return;
                const attacker = game.inPlay(game.opponentOf(player)).find(pk => pk.id === hit.id);
                if (attacker) game.putDamage(attacker, 60);
            }
        }
    },
    'ダイバーキャッチ': {
        type: 'passive',
        hooks: {
            onKnockout: (game, source, pokemon, player, { byAttack }) => {
                if (player !== source.player || !byAttack || game.current === player.id || game.topCard(pokemon).type !== 'water') return;
                const energies = cardsIn(game, pokemon.energies, isBasicEnergy('water'));
                if (energies.length === 0) return;
                energies.forEach(inst => game.removeCard(pokemon.energies, inst));
                game.addToHand(player, energies, { reveal: true });
            }
        }
    },
    'すなのはばたき': {
        type: 'onEvolve',
        canUse: (game, player) => game.opponentOf(player).deck.length > 0,
        use: (game, player) => game.millDeck(game.opponentOf(player), 2),
        hooks: {
            onKnockout: (game, source, pokemon, player, { byAttack }) => {
                if (pokemon !== source.pokemon || !byAttack || player.active !== pokemon || game.current === player.id) return;
                const opponent = game.opponentOf(player);
                game.runNext(() => {
                    if (opponent.deck.length === 0) return;
                    game.promptConfirm({
                        player,
                        title: '特性「すなのはばたき」を使いますか？',
                        card: pokemon.cards[pokemon.cards.length - 1].id,
                        purpose: 'ability-sand-flap',
                        callback: yes => {
                            if (!yes) return;
                            game.log(`${game.topCard(pokemon).name}の特性「すなのはばたき」`);
                            game.millDeck(opponent, 2);
                        }
                    });
                });
            }
        }
    },

    // ===== ワザのダメージ・効果を受けない、減らす =====

    'しんぴのいしやど': { type: 'passive', hooks: preventFrom(isPokemonEx) },
    'しんぴのまもり': { type: 'passive', hooks: preventFrom(isPokemonEx) },
    'テイルアーマー': { type: 'passive', hooks: preventFrom(card => card.stage === 0 && isPokemonEx(card)) },
    'すごいもぐる': {
        type: 'passive',
        hooks: {
            preventDamage: (game, source, ctx, target) => target === source.pokemon && isBenched(game, target),
            preventEffects: (game, source, ctx, pokemon) => pokemon === source.pokemon && isBenched(game, pokemon)
        }
    },
    'スフィアシールド': {
        type: 'passive',
        hooks: {
            preventDamage: (game, source, ctx, target) => game.ownerOf(target) === source.player && isBenched(game, target),
            preventEffects: (game, source, ctx, pokemon) => game.ownerOf(pokemon) === source.player && isBenched(game, pokemon)
        }
    },
    'たいこのぼうへき': {
        type: 'passive',
        hooks: {
            preventDamage: (game, source, ctx, target) => isBenched(game, source.pokemon)
                && game.ownerOf(target) === source.player && Boolean(ctx.attacker) && ctx.attacker.energies.length <= 2
        }
    },
    'てんねん': {
        type: 'passive',
        hooks: { preventEffects: (game, source, ctx, pokemon) => pokemon === source.pokemon }
    },
    'ダイヤコート': {
        type: 'passive',
        hooks: { damageTaken: (game, source, ctx, target) => (target === source.pokemon ? -30 : 0) }
    },
    'ツンドラウォール': {
        type: 'passive',
        hooks: {
            damageTaken: (game, source, ctx, target) => {
                if (game.ownerOf(target) !== source.player || target.energies.length === 0) return 0;
                // 効果は重ならない：場の「ツンドラウォール」のうち、最初の1匹だけが働く
                const first = game.inPlay(source.player).find(pokemon => game.topCard(pokemon).ability?.name === 'ツンドラウォール' && !game.abilitySuppressed(pokemon));
                return first === source.pokemon ? -50 : 0;
            }
        }
    },
    'なめらかコート': {
        type: 'passive',
        hooks: {
            // preventDamage は、ワザのダメージを与えるときだけ呼ばれるので、ここでコインを投げる
            preventDamage: (game, source, ctx, target) => target === source.pokemon && game.flipCoin()
        }
    },
    'ゴミダウナー': {
        type: 'passive',
        hooks: {
            damageDealt: (game, source, ctx) => {
                const attacker = ctx.attacker;
                const owner = attacker && game.ownerOf(attacker);
                if (!owner || owner === source.player || owner.active !== attacker || !attacker.tool) return 0;
                return -20;
            }
        }
    },

    // ===== ワザのダメージを増やす =====

    'シンクロパルス': {
        type: 'passive',
        hooks: boostOwnAttack((game, source) => (source.player.hand.length === game.opponentOf(source.player).hand.length ? 80 : 0))
    },
    'そうだいしょう': {
        type: 'passive',
        hooks: boostOwnAttack((game, source) => 30 * game.prizesTaken(game.opponentOf(source.player)))
    },
    'ちからのしお': {
        type: 'passive',
        hooks: {
            damageDealt: (game, source, ctx, target) => {
                if (game.ownerOf(ctx.attacker) !== source.player || game.opponentOf(source.player).active !== target) return 0;
                return game.topCard(ctx.attacker).type === 'fighting' ? 30 : 0;
            }
        }
    },
    'トレントハート': {
        type: 'activated',
        use: (game, player, pokemon) => {
            putCounters(game, pokemon, 5);
            game.addEffect(pokemon, 'attackDamageModifier', game.turn, { amount: 120 });
            game.log(`この番、${game.topCard(pokemon).name}のワザのダメージは+120される`);
        },
        // バトル場でワザを使えて、ダメカン5個をのせても HP がじゅうぶん残るとき
        cpuWants: (game, player, pokemon) => pokemon === player.active && !game.turnState.attacked
            && canPayAnyAttack(game, pokemon) && remainingHp(game, pokemon) > 100
    },

    // ===== 最大HP・にげる・ワザのエネルギー =====

    'ざっそうだましい': {
        type: 'passive',
        hooks: { maxHp: (game, source, pokemon) => (pokemon === source.pokemon ? 50 * game.prizesTaken(game.opponentOf(source.player)) : 0) }
    },
    'ティラノガッツ': {
        type: 'passive',
        hooks: { maxHp: (game, source, pokemon) => (pokemon === source.pokemon && hasIn(game, pokemon.energies, isSpecialEnergy) ? 150 : 0) }
    },
    'コットンキャリー': { type: 'passive', hooks: freeRetreatForBasics },
    'スカイライン': { type: 'passive', hooks: freeRetreatForBasics },
    'じゅばくのほのお': {
        type: 'passive',
        hooks: { retreatCost: (game, source, pokemon) => (game.opponentOf(source.player).active === pokemon ? 1 : 0) }
    },
    'とけてながれる': {
        type: 'passive',
        hooks: { retreatCost: (game, source, pokemon) => (pokemon === source.pokemon && pokemon.energies.length === 0 ? -99 : 0) }
    },
    'したごしらえ': {
        type: 'passive',
        hooks: {
            attackCost: (game, source, pokemon, attack, cost) => {
                if (pokemon !== source.pokemon) return undefined;
                let count = cardsIn(game, source.player.discard, card => card.name === 'ハイダイ').length;
                if (count === 0) return undefined;
                return cost.filter(type => type !== 'colorless' || count-- <= 0);
            }
        }
    },
    'スナイパーアイ': {
        type: 'passive',
        hooks: {
            attackCost: (game, source, pokemon) => (pokemon === source.pokemon && game.opponentOf(source.player).hand.length === 4 ? [] : undefined)
        }
    },
    'チューニングエコー': {
        type: 'passive',
        hooks: {
            attackCost: (game, source, pokemon, attack) => (pokemon === source.pokemon && attack.name === 'パニックハウル'
                && source.player.hand.length === game.opponentOf(source.player).hand.length ? [] : undefined)
        }
    },
    'さぼりたいしつ': {
        type: 'passive',
        hooks: {
            blockAttack: (game, source, player, pokemon) => {
                if (pokemon !== source.pokemon) return null;
                const hasEx = game.inPlay(game.opponentOf(source.player)).some(pk => isPokemonEx(game.topCard(pk)));
                return hasEx ? null : '相手の場に「ポケモンex・V」がいないので、ワザが使えません';
            }
        }
    },

    // ===== 進化 =====

    'カブルモ/しげきしんか': earlyEvolveWith('チョボマキ'),
    'チョボマキ/しげきしんか': earlyEvolveWith('カブルモ'),
    'とうしのおたけび': {
        type: 'passive',
        hooks: {
            allowEarlyEvolve: (game, source, player, target) => {
                const opponentActive = game.opponentOf(source.player).active;
                return target === source.pokemon && Boolean(opponentActive) && isPokemonEx(game.topCard(opponentActive));
            }
        }
    },

    // ===== 相手の番に働く・相手の行動を止める =====

    'すなおこし': {
        type: 'passive',
        hooks: {
            // ポケモンチェックの直前（番の終わり）に、毎回のせる
            onTurnEnd: (game, source) => {
                if (!isActive(game, source.pokemon)) return;
                game.inPlay(game.opponentOf(source.player))
                    .filter(pokemon => game.topCard(pokemon).stage === 0)
                    .forEach(pokemon => game.putDamage(pokemon, 20));
            }
        }
    },
    'どでかいからだ': {
        type: 'passive',
        hooks: {
            blockTrainer: (game, source, player, card) => (player !== source.player && card.trainerType === 'stadium' && isActive(game, source.pokemon)
                ? 'ダイオウドウの特性で、手札からスタジアムを出せません' : null)
        }
    },

    // ===== 進化させたとき・ベンチに出したとき =====

    'こっそりかみつく': {
        type: 'onEvolve',
        canUse: (game, player) => game.inPlay(game.opponentOf(player)).length > 0,
        use: (game, player) => snipeCounters(game, player, 2)
    },
    'ユンゲラー/サイコドロー': drawOnEvolve(2),
    'フーディン/サイコドロー': drawOnEvolve(3),
    'チャレンジホーン': gustOnEvolve,
    'どすこいキャッチャー': gustOnEvolve,
    'でたとこハンマー': {
        type: 'onEvolve',
        canUse: (game, player) => (game.opponentOf(player).active?.energies.length ?? 0) > 0,
        use: (game, player) => {
            if (!game.flipCoin()) return;
            const target = game.opponentOf(player).active;
            chooseEnergyOn(game, player, target, {
                title: 'トラッシュする、相手のバトルポケモンのエネルギーを選ぶ',
                purpose: 'discard-opponent-energy',
                then: inst => {
                    game.moveCard(target.energies, game.opponentOf(player).discard, inst);
                    game.log(`${game.topCard(target).name}の${game.cardName(inst)}をトラッシュした`);
                }
            });
        }
    },
    'とげをまとう': {
        type: 'onEvolve',
        canUse: (game, player) => hasIn(game, player.discard, card => card.name === 'スパイクエネルギー'),
        use: (game, player, pokemon) => {
            const cards = cardsIn(game, player.discard, card => card.name === 'スパイクエネルギー');
            game.promptCards({
                player,
                cards,
                min: 1,
                max: Math.min(2, cards.length),
                title: 'つける「スパイクエネルギー」を2枚まで選ぶ',
                purpose: 'ability-energy',
                cpuAnswer: (g, prompt) => allIndices(prompt.max),
                callback: selected => selected.forEach(inst => {
                    game.removeCard(player.discard, inst);
                    game.attachFromOutside(pokemon, inst);
                })
            });
        }
    },
    'せわやきヒール': {
        type: 'onBench',
        canUse: (game, player) => Boolean(player.active) && (player.active.damage > 0 || game.hasAnyCondition(player.active)),
        use: (game, player) => {
            const active = player.active;
            game.heal(active, 30);
            cureOneCondition(game, player, active);
        }
    },
    'でたとこせおい': {
        type: 'onBench',
        canUse: (game, player, pokemon) => !pokemon.tool && player.deck.length > 0,
        use: (game, player, pokemon) => game.searchDeck({
            player,
            filter: card => card.trainerType === 'tool',
            max: 1,
            title: 'このポケモンにつける「ポケモンのどうぐ」を選ぶ',
            purpose: 'search-card',
            onSelected: ([inst]) => {
                if (!inst) return;
                pokemon.tool = inst;
                game.log(`${game.topCard(pokemon).name}に${game.cardName(inst)}をつけた`);
            }
        })
    },

    // ===== 自分の番に使う：山札を引く・探す =====

    'スカイドロー': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => game.draw(player, 1),
        cpuWants: (game, player) => player.deck.length > 5
    },
    'しんかいドロー': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => {
            game.draw(player, 1);
            if (player.hand.length === 0) return;
            game.promptCards({
                player,
                cards: player.hand,
                min: 0,
                max: 1,
                title: '山札の下にもどす手札を選ぶ（もどさないなら選ばない）',
                purpose: 'ability-deck-bottom',
                cpuAnswer: () => [],
                callback: ([inst]) => {
                    if (!inst) return;
                    game.moveCard(player.hand, player.deck, inst);
                    game.log(`${player.name}は手札を1枚、山札の下にもどした`);
                }
            });
        },
        cpuWants: (game, player) => player.deck.length > 5
    },
    'にげあしドロー': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player, pokemon) => {
            game.draw(player, 3);
            shuffleIntoDeck(game, player, pokemon);
        },
        // ベンチにいて、手札が少ないとき（場のポケモンが減るので、ほかにポケモンがいるときだけ）
        cpuWants: (game, player, pokemon) => pokemon !== player.active && player.hand.length <= 4 && player.deck.length > 6
    },
    'とりひき': {
        type: 'activated',
        canUse: (game, player) => player.hand.length > 0,
        use: (game, player) => discardFromHand(game, player, {
            count: 1,
            title: 'トラッシュする手札を1枚選ぶ',
            then: () => game.draw(player, 2)
        }),
        cpuWants: (game, player) => player.deck.length > 5
    },
    'さいこうちく': {
        type: 'activated',
        canUse: (game, player) => player.hand.length >= 2,
        use: (game, player) => discardFromHand(game, player, {
            count: 2,
            title: 'トラッシュする手札を2枚選ぶ',
            then: () => game.draw(player, 1)
        }),
        // 手札が2枚減って1枚増えるので、手札があふれているときだけ
        cpuWants: (game, player) => player.hand.length >= 8 && player.deck.length > 5
    },
    'さかてにとる': {
        type: 'activated',
        oncePerTurnByName: true,
        // 前の相手の番に、自分のポケモンがきぜつしていた（ワザでのきぜつは本体が、それ以外はこの特性が記録する）
        canUse: (game, player) => player.deck.length > 0
            && (player.knockedOutByAttackTurn === game.turn - 1 || player.knockedOutOnOpponentTurn === game.turn - 1),
        use: (game, player) => game.draw(player, 3),
        hooks: {
            onKnockout: (game, source, pokemon, player) => {
                if (player === source.player && game.current !== player.id) player.knockedOutOnOpponentTurn = game.turn;
            }
        }
    },
    'ていさつしれい': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => {
            const top = player.deck.slice(0, 2);
            game.promptCards({
                player,
                cards: top,
                min: 1,
                max: 1,
                title: '手札に加えるカードを選ぶ（残りは山札の下にもどす）',
                purpose: 'ability-look-top',
                callback: ([inst]) => {
                    game.removeCard(player.deck, inst);
                    game.addToHand(player, [inst]);
                    top.filter(other => other !== inst).forEach(other => game.moveCard(player.deck, player.deck, other));
                }
            });
        }
    },
    'しきのうつろい': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => searchToHand(game, player, { filter: card => card.trainerType === 'stadium', title: '手札に加えるスタジアムを選ぶ', reveal: true }),
        cpuWants: (game, player) => !hasIn(game, player.hand, card => card.trainerType === 'stadium')
    },
    'しんかのみちびき': {
        type: 'activated',
        canUse: (game, player, pokemon) => pokemon.energies.length > 0 && player.deck.length > 0,
        use: (game, player) => searchToHand(game, player, {
            filter: card => card.kind === 'pokemon' && card.stage > 0,
            title: '手札に加える進化ポケモンを選ぶ',
            purpose: 'search-evolution',
            reveal: true
        })
    },
    'たびのきずな': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => searchToHand(game, player, { filter: card => card.name === 'ヒビキの冒険', title: '手札に加える「ヒビキの冒険」を選ぶ', reveal: true }),
        cpuWants: (game, player) => !hasIn(game, player.hand, card => card.name === 'ヒビキの冒険')
    },
    'ドンドンだいこ': {
        type: 'activated',
        canUse: (game, player) => Boolean(player.active) && game.topCard(player.active).ability?.name === 'おまつりおんど'
            && !game.abilitySuppressed(player.active) && player.deck.length > 0,
        use: (game, player) => searchToHand(game, player, { filter: () => true, title: '手札に加えるカードを1枚選ぶ' })
    },
    'しょうこあつめ': {
        type: 'activated',
        canUse: (game, player) => player.hand.length > 0 && player.deck.length > 0,
        use: (game, player) => game.promptCards({
            player,
            cards: player.hand,
            min: 1,
            max: 1,
            title: '山札の上のカードと入れ替える手札を選ぶ',
            purpose: 'ability-swap-top',
            callback: ([inst]) => {
                const top = player.deck.shift();
                game.removeCard(player.hand, inst);
                player.deck.unshift(inst);
                player.hand.push(top);
                game.log(`${player.name}は手札を1枚、山札の上のカードと入れ替えた`);
            }
        }),
        cpuWants: () => false
    },

    // ===== 自分の番に使う：エネルギー =====

    'ヒビキのホウオウex/こんじきのほのお': {
        type: 'activated',
        canUse: (game, player) => hasIn(game, player.hand, isBasicEnergy('fire')) && player.bench.some(pokemon => game.topCard(pokemon).name.startsWith('ヒビキの')),
        use: (game, player) => {
            const cards = cardsIn(game, player.hand, isBasicEnergy('fire'));
            game.promptCards({
                player,
                cards,
                min: 1,
                max: Math.min(2, cards.length),
                title: 'つける「基本炎エネルギー」を2枚まで選ぶ',
                purpose: 'ability-energy',
                cpuAnswer: (g, prompt) => allIndices(prompt.max),
                callback: selected => game.promptPokemon({
                    player,
                    pokemon: player.bench.filter(pokemon => game.topCard(pokemon).name.startsWith('ヒビキの')),
                    min: 1,
                    max: 1,
                    title: 'エネルギーをつける「ヒビキのポケモン」を選ぶ',
                    purpose: 'energy-switch-target',
                    callback: ([target]) => selected.forEach(inst => attachFromHand(game, player, inst, target))
                })
            });
        }
    },
    'じゅくせいチャージ': {
        type: 'activated',
        canUse: (game, player) => hasIn(game, player.hand, isBasicEnergy('grass')),
        use: (game, player) => attachOneFromHand(game, player, {
            filter: isBasicEnergy('grass'),
            targets: () => game.inPlay(player),
            after: target => game.heal(target, 30)
        })
    },
    'ストーンアームズ': {
        type: 'activated',
        canUse: (game, player) => hasIn(game, player.hand, isBasicEnergy()),
        use: (game, player) => attachOneFromHand(game, player, { filter: isBasicEnergy(), targets: () => game.inPlay(player) })
    },
    'チャージアップ': {
        type: 'activated',
        canUse: (game, player) => hasIn(game, player.discard, isBasicEnergy()),
        use: (game, player, pokemon) => game.promptCards({
            player,
            cards: cardsIn(game, player.discard, isBasicEnergy()),
            min: 1,
            max: 1,
            title: 'このポケモンにつける基本エネルギーを選ぶ',
            purpose: 'ability-energy',
            callback: ([inst]) => {
                game.removeCard(player.discard, inst);
                game.attachFromOutside(pokemon, inst);
            }
        })
    },
    'スケイルビート': {
        type: 'activated',
        canUse: (game, player) => player.deck.length > 0,
        use: (game, player) => {
            const top = player.deck.slice(0, 6);
            const energies = cardsIn(game, top, isBasicEnergy());
            if (energies.length === 0) {
                game.log(`${player.name}は山札を上から${top.length}枚見たが、基本エネルギーはなかった`);
                game.shuffleDeck(player);
                return;
            }
            game.promptCards({
                player,
                cards: energies,
                min: 0,
                max: energies.length,
                title: '自分のドラゴンポケモンにつける基本エネルギーを選ぶ',
                purpose: 'ability-energy',
                cpuAnswer: (g, prompt) => allIndices(prompt.max),
                callback: selected => {
                    selected.forEach(inst => game.removeCard(player.deck, inst));
                    game.runNext(
                        () => game.attachAnyWay(player, selected, pokemon => game.topCard(pokemon).type === 'dragon', 'energy-switch-target'),
                        () => game.shuffleDeck(player)
                    );
                }
            });
        }
    },
    'シャボンあつめ': {
        type: 'activated',
        unlimited: true,
        canUse: (game, player, pokemon) => game.inPlay(player).some(pk => pk !== pokemon && pk.energies.length > 0),
        use: (game, player, pokemon) => game.promptPokemon({
            player,
            pokemon: game.inPlay(player).filter(pk => pk !== pokemon && pk.energies.length > 0),
            min: 1,
            max: 1,
            title: 'エネルギーをつけ替える元のポケモンを選ぶ',
            purpose: 'energy-switch-source',
            callback: ([from]) => chooseEnergyOn(game, player, from, {
                title: 'このポケモンにつけ替えるエネルギーを選ぶ',
                purpose: 'ability-energy',
                then: inst => game.moveEnergy(from, pokemon, inst)
            })
        }),
        // バトル場にいて、一番重いワザのエネルギーが足りないときだけ、ベンチから集める
        cpuWants: (game, player, pokemon) => pokemon === player.active && !game.turnState.attacked && !canPayLastAttack(game, pokemon)
            && player.bench.some(pk => pk.energies.length > 0)
    },
    'ソーラートランス': {
        type: 'activated',
        unlimited: true,
        canUse: (game, player) => game.inPlay(player).length >= 2 && game.inPlay(player).some(pk => hasIn(game, pk.energies, isBasicEnergy())),
        use: (game, player) => game.promptPokemon({
            player,
            pokemon: game.inPlay(player).filter(pk => hasIn(game, pk.energies, isBasicEnergy())),
            min: 1,
            max: 1,
            title: '基本エネルギーをつけ替える元のポケモンを選ぶ',
            purpose: 'energy-switch-source',
            callback: ([from]) => game.promptCards({
                player,
                cards: cardsIn(game, from.energies, isBasicEnergy()),
                min: 1,
                max: 1,
                title: 'つけ替える基本エネルギーを選ぶ',
                purpose: 'ability-energy',
                callback: ([inst]) => game.promptPokemon({
                    player,
                    pokemon: game.inPlay(player).filter(pk => pk !== from),
                    min: 1,
                    max: 1,
                    title: `${game.cardName(inst)}をつけ替える先のポケモンを選ぶ`,
                    purpose: 'energy-switch-target',
                    callback: ([to]) => game.moveEnergy(from, to, inst)
                })
            })
        }),
        // バトルポケモンの一番重いワザのエネルギーが足りず、ベンチに基本エネルギーがあるときだけ、バトル場へ集める
        cpuWants: (game, player) => Boolean(player.active) && !game.turnState.attacked && !canPayLastAttack(game, player.active)
            && player.bench.some(pk => hasIn(game, pk.energies, isBasicEnergy()))
    },

    // ===== 自分の番に使う：入れ替え・場 =====

    'ショータイム': {
        type: 'activated',
        canUse: (game, player, pokemon) => isBenched(game, pokemon),
        use: (game, player, pokemon) => game.switchActive(player, pokemon),
        cpuWants: (game, player, pokemon) => betterAttacker(game, player, pokemon)
    },
    'スカイキャリー': {
        type: 'activated',
        canUse: (game, player) => Boolean(player.active) && player.bench.length > 0,
        use: (game, player) => game.promptSwitchOwnActive(player, 'switch'),
        cpuWants: (game, player) => player.bench.some(pokemon => betterAttacker(game, player, pokemon))
    },
    'しはいのくさり': {
        type: 'activated',
        oncePerTurnByName: true,
        canUse: (game, player) => player.bench.some(pokemon => {
            const card = game.topCard(pokemon);
            return card.type === 'darkness' && card.name !== 'モモワロウex';
        }),
        use: (game, player) => game.promptPokemon({
            player,
            pokemon: player.bench.filter(pokemon => {
                const card = game.topCard(pokemon);
                return card.type === 'darkness' && card.name !== 'モモワロウex';
            }),
            min: 1,
            max: 1,
            title: 'バトル場に出すベンチの悪ポケモンを選ぶ',
            purpose: 'switch',
            callback: ([target]) => {
                game.switchActive(player, target);
                game.addCondition(target, 'poisoned');
            }
        }),
        cpuWants: (game, player) => player.bench.some(pokemon => {
            const card = game.topCard(pokemon);
            return card.type === 'darkness' && card.name !== 'モモワロウex' && betterAttacker(game, player, pokemon);
        })
    },
    'テレポーター': {
        type: 'activated',
        canUse: (game, player, pokemon) => isActive(game, pokemon),
        use: (game, player, pokemon) => shuffleIntoDeck(game, player, pokemon),
        cpuWants: () => false
    },
    'どたばたジャンプ': {
        type: 'activated',
        canUse: (game, player, pokemon) => isBenched(game, pokemon),
        use: (game, player, pokemon) => {
            const bottom = player.deck.pop();
            if (bottom) {
                player.discard.push(bottom);
                game.log(`${player.name}は山札を下から1枚トラッシュした（${game.cardName(bottom)}）`);
            }
            const attached = [...pokemon.energies, ...(pokemon.tool ? [pokemon.tool] : [])];
            player.discard.push(...attached);
            pokemon.energies = [];
            pokemon.tool = null;
            const name = game.topCard(pokemon).name;
            game.removeCard(player.bench, pokemon);
            player.deck.unshift(...pokemon.cards);
            game.log(`${player.name}は${name}を山札の上にもどした`);
        },
        cpuWants: () => false
    },

    // ===== 自分の番に使う：相手に =====

    'さざめくかぜ': {
        type: 'activated',
        canUse: (game, player) => (game.opponentOf(player).active?.energies.length ?? 0) > 0,
        use: (game, player) => {
            if (!game.flipCoin()) return;
            const opponent = game.opponentOf(player);
            const target = opponent.active;
            chooseEnergyOn(game, player, target, {
                title: '相手の手札にもどす、相手のバトルポケモンのエネルギーを選ぶ',
                purpose: 'discard-opponent-energy',
                then: inst => {
                    game.moveCard(target.energies, opponent.hand, inst);
                    game.log(`${game.topCard(target).name}の${game.cardName(inst)}を${opponent.name}の手札にもどした`);
                }
            });
        }
    },
    'スカイハント': {
        type: 'activated',
        canUse: (game, player) => game.opponentOf(player).hand.length > 0,
        use: (game, player) => {
            if (game.flipCoin()) game.discardRandomFromHand(game.opponentOf(player), 1);
        }
    },
    'さそうしっぽ': {
        type: 'activated',
        canUse: (game, player) => hasIn(game, player.hand, card => card.name === 'のんびりじゃらし') && game.opponentOf(player).bench.length > 0,
        use: (game, player) => discardFromHand(game, player, {
            count: 1,
            filter: card => card.name === 'のんびりじゃらし',
            title: 'トラッシュする「のんびりじゃらし」を選ぶ',
            then: () => gustOpponent(game, player)
        }),
        cpuWants: (game, player) => !game.turnState.attacked && canPayAnyAttack(game, player.active)
    },
    'ねじれたみらい': {
        type: 'activated',
        canUse: (game, player, pokemon) => isActive(game, pokemon),
        use: (game, player) => {
            const opponent = game.opponentOf(player);
            game.shuffleHandIntoDeck(opponent);
            game.draw(opponent, 3);
        },
        cpuWants: (game, player) => game.opponentOf(player).hand.length >= 5
    },
    'ねっぱりんぷん': {
        type: 'activated',
        canUse: (game, player) => hasIn(game, player.hand, isBasicEnergy('fire')) && Boolean(game.opponentOf(player).active),
        use: (game, player) => discardFromHand(game, player, {
            count: 1,
            filter: isBasicEnergy('fire'),
            title: 'トラッシュする「基本炎エネルギー」を選ぶ',
            then: () => game.addCondition(game.opponentOf(player).active, 'burned')
        }),
        cpuWants: (game, player) => !game.opponentOf(player).active?.burned
    },

    // ===== ワザ・ダメージ =====
    'こんぺきはとう': {
        // このポケモンが使うワザのダメージは、相手のバトルポケモンにかかっている効果を計算しない
        type: 'passive',
        hooks: {
            beforeAttack: (game, source, ctx) => {
                if (ctx.attacker === source.pokemon) ctx.ignoreEffects = true;
            }
        }
    },
    'てっぺきシェル': {
        // 相手のポケモンから「200」以上のワザのダメージを受けない（弱点・抵抗力などを計算し終えたダメージで決める）
        type: 'passive',
        hooks: {
            preventFinalDamage: (game, source, ctx, target, damage) => target === source.pokemon && damage >= 200
        }
    },
    'デビューライブ': {
        // このポケモンは、先攻プレイヤーの最初の番でも、ワザが使える
        type: 'passive',
        hooks: {
            allowFirstTurnAttack: (game, source, player, pokemon) => pokemon === source.pokemon
        }
    },

    // ===== タイプ =====
    'メレシー/ダブルタイプ': {
        // 場にいるかぎり [F] と [P] の2つのタイプになる
        type: 'passive',
        hooks: {
            extraTypes: (game, source, pokemon) => (pokemon === source.pokemon ? ['fighting', 'psychic'] : [])
        }
    },
    'スコヴィランex/ダブルタイプ': {
        // 場にいるかぎり [G] と [R] の2つのタイプになる
        type: 'passive',
        hooks: {
            extraTypes: (game, source, pokemon) => (pokemon === source.pokemon ? ['grass', 'fire'] : [])
        }
    },
    'デュアルコア': {
        // 「ブーストエナジー 未来」がついているかぎり、[F] と [M] の2つのタイプになる（どうぐの名前だけを見る）
        type: 'passive',
        hooks: {
            extraTypes: (game, source, pokemon) => (pokemon === source.pokemon && pokemon.tool && game.cardName(pokemon.tool) === 'ブーストエナジー 未来'
                ? ['fighting', 'metal']
                : [])
        }
    },

    // ===== ほかのポケモン・相手の手札から出すポケモン =====
    'しめりけ': {
        // おたがいのポケモン全員は、そのポケモン自身をきぜつさせる効果の特性（「使ったなら、このポケモンをきぜつさせる」）が、すべてなくなる
        type: 'passive',
        hooks: {
            suppressAbility: (game, source, pokemon) => /このポケモンをきぜつさせる/.test(game.topCard(pokemon).ability?.text ?? '')
        }
    },
    'ダークインパルス': {
        // 相手が手札からポケモンを出して進化させるたび、そのポケモンにダメカンを4個のせる。何匹いても重ならない
        type: 'passive',
        hooks: {
            onEvolved: (game, source, player, pokemon, { fromHand }) => {
                if (!fromHand || player === source.player) return;
                const first = game.inPlay(source.player).find(holder => game.topCard(holder).ability?.name === 'ダークインパルス' && !game.abilitySuppressed(holder));
                if (first !== source.pokemon) return;
                game.log(`${source.card.name}の特性「ダークインパルス」`);
                putCounters(game, pokemon, 4);
            }
        }
    },
    'にらみをきかす': {
        // このポケモンがバトル場にいるかぎり、相手は手札から特性を持つポケモン（「ロケット団のポケモン」をのぞく）を場に出せない
        type: 'passive',
        hooks: {
            blockPlayPokemon: (game, source, player, card) => (player !== source.player && isActive(game, source.pokemon)
                && card.ability && !card.name.startsWith('ロケット団の')
                ? `${source.card.name}の特性「にらみをきかす」で、特性を持つポケモンを場に出せません`
                : null)
        }
    }
};
