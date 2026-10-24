/**
 * ポケモンのどうぐの効果（カードの名前で引く）。書き方は cards/HOOKS.md
 *
 * どうぐの hooks の source.pokemon が、どうぐをつけているポケモン。自分に関係あるときだけ値を返す
 * cpuWants：CPU が今つけたいか（つけ先は cpu-player.js の chooseToolTarget が選ぶ）
 *
 * まだ書いていないどうぐ（ゲームの本体に仕組みが要るもの）
 *   コアメモリ・メガレックウザキャップ・ワザマシン フローライト：どうぐに書かれているワザを、つけたポケモンが使う仕組みがない
 *     （カードのデータに、どうぐのワザもない）
 *   リトライバッジ：ワザのコインの結果をなくして、投げなおす仕組みがない
 *   ブーストエナジー 古代・ブーストエナジー 未来・きらめく結晶：カードのデータに「古代」「未来」「テラスタル」の印がない
 */

const isPokemonEx = card => card.rule === 'ex' || card.rule === 'mega';
const isMega = card => card.rule === 'mega';
const ownedBy = prefix => card => card.name.startsWith(prefix);

// そのポケモンが、持ち主のバトル場にいるか
function isActive(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active === pokemon;
}

// 場に条件に合うポケモンがいるか（CPU がつけたいかの目安）
const hasInPlay = (game, player, test) => game.inPlay(player).some(pokemon => test(game.topCard(pokemon), pokemon));

// ワザを使うためのエネルギーから、無色を1個減らす（無色がなければ変えない）
function withoutOneColorless(cost) {
    const index = cost.indexOf('colorless');
    if (index === -1) return undefined;
    return cost.filter((_, i) => i !== index);
}

// このどうぐをつけたポケモンが、バトル場で相手のワザのダメージを受けたか（onDamaged の中で使う）
const hitInActive = (game, source, target) => target === source.pokemon && isActive(game, target);

// ワザを使ったポケモンに、ダメカンをのせる（ワザを使ったポケモンが場にいれば）
function damageAttacker(game, ctx, counters) {
    if (ctx.attacker && game.ownerOf(ctx.attacker)) game.putDamage(ctx.attacker, counters * 10);
}

// 相手のタイプのポケモンから受けるワザのダメージを減らすどうぐ
function reduceFrom(test, amount) {
    return {
        damageTaken: (game, source, ctx, target) => (target === source.pokemon && test(game.topCard(ctx.attacker)) ? -amount : 0)
    };
}

// 相手のバトル場のポケモンへのダメージを増やすどうぐ
function boostToActive(test, amount) {
    return {
        damageDealt: (game, source, ctx, target) => (ctx.attacker === source.pokemon && isActive(game, target) && test(game, source, target) ? amount : 0)
    };
}

export const TRAINER_EFFECTS = {
    '逆境ほけん': {
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (!hitInActive(game, source, target)) return;
                const opponentActive = game.opponentOf(source.player).active;
                const weakness = game.topCard(target).weakness;
                if (weakness && opponentActive && game.topCard(opponentActive).type === weakness) game.draw(source.player, 3);
            }
        },
        cpuWants: () => true
    },
    'せいなるおまもり': {
        hooks: reduceFrom(card => Boolean(card.ability), 30),
        cpuWants: () => true
    },
    'パンクメット': {
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (hitInActive(game, source, target)) damageAttacker(game, ctx, 4);
            }
        },
        cpuWants: () => true
    },
    'でんきだま': {
        hooks: boostToActive((game, source, target) => game.topCard(source.pokemon).name === 'ピカチュウex' && isPokemonEx(game.topCard(target)), 50),
        cpuWants: (game, player) => hasInPlay(game, player, card => card.name === 'ピカチュウex')
    },
    'ぶあついうろこ': {
        hooks: {
            damageTaken: (game, source, ctx, target) => {
                if (target !== source.pokemon || game.topCard(target).type !== 'dragon') return 0;
                return ['grass', 'fire', 'water', 'lightning'].includes(game.topCard(ctx.attacker).type) ? -50 : 0;
            }
        },
        cpuWants: (game, player) => hasInPlay(game, player, card => card.type === 'dragon')
    },
    'ごうかいボム': {
        hooks: {
            onDamaged: (game, source, ctx, target, damage) => {
                if (!hitInActive(game, source, target) || isMega(game.topCard(target))) return;
                if (!isMega(game.topCard(ctx.attacker)) || damage < 240) return;
                damageAttacker(game, ctx, 12);
                game.discardTool(target, source.inst);
            }
        },
        cpuWants: (game, player) => hasInPlay(game, player, card => !isMega(card))
    },
    'とくちゅうチョッキ': {
        hooks: {
            damageTaken: (game, source, ctx, target) => (target === source.pokemon && !isMega(game.topCard(target)) && isMega(game.topCard(ctx.attacker)) ? -60 : 0)
        },
        cpuWants: (game, player) => hasInPlay(game, player, card => !isMega(card))
    },
    'ロケット団のさいみん装置': {
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (!hitInActive(game, source, target) || !ownedBy('ロケット団の')(game.topCard(target))) return;
                if (ctx.attacker && game.ownerOf(ctx.attacker)) game.addCondition(ctx.attacker, 'asleep');
            }
        },
        cpuWants: (game, player) => hasInPlay(game, player, ownedBy('ロケット団の'))
    },
    'サバイブギプス': {
        hooks: {
            // HP がまんたんのときにワザのダメージを受けたら、この番の終わりまで覚えておく
            onDamaged: (game, source, ctx, target, damage) => {
                if (target === source.pokemon && target.damage === damage) game.addEffect(target, 'survivalCastFullHp', game.turn);
            },
            preventKnockout: (game, source, pokemon, player, { byAttack }) => {
                if (pokemon !== source.pokemon || !byAttack || !game.hasEffect(pokemon, 'survivalCastFullHp')) return false;
                pokemon.damage = game.maxHp(pokemon) - 10;
                game.log(`${game.topCard(pokemon).name}はサバイブギプスで、残りHP10で場に残った`);
                game.discardTool(pokemon, source.inst);
                return true;
            }
        },
        cpuWants: () => true
    },
    'ラッキーメット': {
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (hitInActive(game, source, target)) game.draw(source.player, 2);
            }
        },
        cpuWants: () => true
    },
    '緊急ボード': {
        retreatReduction: 1, // CPU がつけ先を選ぶときの目安
        hooks: {
            retreatCost: (game, source, pokemon) => {
                if (pokemon !== source.pokemon) return 0;
                return game.maxHp(pokemon) - pokemon.damage <= 30 ? -99 : -1;
            }
        },
        cpuWants: (game, player) => hasInPlay(game, player, card => card.retreat >= 1)
    },
    'マキシマムベルト': {
        hooks: boostToActive((game, source, target) => isPokemonEx(game.topCard(target)), 50),
        cpuWants: () => true
    },
    'ヒーローマント': {
        hooks: {
            maxHp: (game, source, pokemon) => (pokemon === source.pokemon ? 100 : 0)
        },
        cpuWants: () => true
    },
    'ヘビーバトン': {
        hooks: {
            onKnockout: (game, source, pokemon, player, { byAttack }) => {
                if (pokemon !== source.pokemon || !byAttack || player.active !== pokemon || game.retreatCost(pokemon) !== 4) return;
                const energies = pokemon.energies.filter(inst => game.cardOf(inst).basic);
                const bench = [...player.bench];
                if (energies.length === 0 || bench.length === 0) return;
                // きぜつしたポケモンのカードがトラッシュされた後に選ぶ。つけ先は、きぜつしたときにベンチにいたポケモン
                game.runNext(() => {
                    const candidates = energies.filter(inst => player.discard.includes(inst));
                    const targets = bench.filter(pk => game.inPlay(player).includes(pk));
                    if (candidates.length === 0 || targets.length === 0) return;
                    game.promptCards({
                        player,
                        cards: candidates,
                        min: 0,
                        max: Math.min(3, candidates.length),
                        title: 'ベンチポケモンにつけ替える基本エネルギーを3枚まで選ぶ',
                        purpose: 'heavy-baton',
                        callback: selected => {
                            selected.forEach(inst => game.removeCard(player.discard, inst));
                            game.attachAnyWay(player, selected, pk => targets.includes(pk) && game.inPlay(player).includes(pk), 'heavy-baton-target');
                        }
                    });
                });
            }
        },
        cpuWants: (game, player) => hasInPlay(game, player, card => card.retreat === 4)
    },
    'ハンディサーキュレーター': {
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (!hitInActive(game, source, target)) return;
                const attacker = ctx.attacker;
                const attackerOwner = attacker && game.ownerOf(attacker);
                if (!attackerOwner || attacker.energies.length === 0 || attackerOwner.bench.length === 0) return;
                game.runNext(() => {
                    if (!game.ownerOf(attacker) || attacker.energies.length === 0 || attackerOwner.bench.length === 0) return;
                    // ワザを使ったポケモンが、このどうぐの効果を受けないなら、つけ替えない
                    if (!game.canAffect(attacker, 'energy')) return;
                    game.promptCards({
                        player: source.player,
                        cards: attacker.energies,
                        min: 1,
                        max: 1,
                        title: 'ワザを使ったポケモンからつけ替えるエネルギーを選ぶ',
                        purpose: 'handy-fan-energy',
                        callback: ([inst]) => game.promptPokemon({
                            player: source.player,
                            pokemon: attackerOwner.bench,
                            min: 1,
                            max: 1,
                            title: 'エネルギーをつけ替える相手のベンチポケモンを選ぶ',
                            purpose: 'handy-fan-target',
                            callback: ([benchTarget]) => game.moveEnergy(attacker, benchTarget, inst)
                        })
                    });
                });
            }
        },
        cpuWants: () => true
    },
    'くさりもち': {
        hooks: boostToActive((game, source) => game.hasCondition(source.pokemon, 'poisoned'), 40),
        cpuWants: (game, player) => Boolean(player.active && game.hasCondition(player.active, 'poisoned'))
    },
    '力の砂時計': {
        hooks: {
            onTurnEnd: (game, source, player) => {
                if (player !== source.player || player.active !== source.pokemon) return;
                const energies = player.discard.filter(inst => game.cardOf(inst).basic && game.cardOf(inst).kind === 'energy');
                if (energies.length === 0) return;
                // ほかの番の終わりの効果と選択が重ならないよう、次の手順にする
                game.runNext(() => game.promptCards({
                    player,
                    cards: energies,
                    min: 0,
                    max: 1,
                    title: 'バトルポケモンにつける基本エネルギーを選ぶ（つけないなら選ばない）',
                    purpose: 'power-hourglass',
                    cpuAnswer: () => [0],
                    callback: ([inst]) => {
                        if (!inst || !game.inPlay(player).includes(source.pokemon)) return;
                        game.removeCard(player.discard, inst);
                        game.attachFromOutside(source.pokemon, inst);
                    }
                }));
            }
        },
        cpuWants: () => true
    },
    '重力玉': {
        hooks: {
            retreatCost: (game, source, pokemon) => (source.player.active === source.pokemon && isActive(game, pokemon) ? 1 : 0)
        },
        cpuWants: () => true
    },
    'デラックスボム': {
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (!hitInActive(game, source, target)) return;
                damageAttacker(game, ctx, 12);
                game.discardTool(target, source.inst);
            }
        },
        cpuWants: () => true
    },
    'カウンターゲイン': {
        hooks: {
            attackCost: (game, source, pokemon, attack, cost) => {
                if (pokemon !== source.pokemon) return undefined;
                if (source.player.prizes.length <= game.opponentOf(source.player).prizes.length) return undefined;
                return withoutOneColorless(cost);
            }
        },
        cpuWants: () => true
    },
    '希望のアミュレット': {
        hooks: {
            onKnockout: (game, source, pokemon, player, { byAttack }) => {
                if (pokemon !== source.pokemon || !byAttack) return;
                game.runNext(() => game.searchDeck({
                    player,
                    filter: () => true,
                    max: 3,
                    title: '手札に加えるカードを3枚まで選ぶ',
                    purpose: 'hope-amulet',
                    onSelected: found => game.addToHand(player, found)
                }));
            }
        },
        cpuWants: () => true
    },
    'ホップのこだわりハチマキ': {
        hooks: {
            attackCost: (game, source, pokemon, attack, cost) => {
                if (pokemon !== source.pokemon || !ownedBy('ホップの')(game.topCard(pokemon))) return undefined;
                return withoutOneColorless(cost);
            },
            ...boostToActive((game, source) => ownedBy('ホップの')(game.topCard(source.pokemon)), 30)
        },
        cpuWants: (game, player) => hasInPlay(game, player, ownedBy('ホップの'))
    },
    'リーリエのしんじゅ': {
        hooks: {
            prizeModifier: (game, source, pokemon, player, { byAttack }) => (pokemon === source.pokemon && byAttack && ownedBy('リーリエの')(game.topCard(pokemon)) ? -1 : 0)
        },
        cpuWants: (game, player) => hasInPlay(game, player, ownedBy('リーリエの'))
    },
    'シロナのパワーウエイト': {
        hooks: {
            maxHp: (game, source, pokemon) => (pokemon === source.pokemon && ownedBy('シロナの')(game.topCard(pokemon)) ? 70 : 0)
        },
        cpuWants: (game, player) => hasInPlay(game, player, ownedBy('シロナの'))
    }
};
