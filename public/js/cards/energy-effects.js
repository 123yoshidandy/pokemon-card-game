/**
 * 特殊エネルギーの効果（カードの名前で引く）。書き方は cards/HOOKS.md
 *
 * provides：出すエネルギー（1個ずつの配列。'any' はどのタイプにもなる）
 * hooks：source.pokemon が、このエネルギーのついているポケモン（source.inst がこのエネルギー）
 * onAttach：手札からつけたとき
 *
 * まだ書いていない特殊エネルギー（文の意味が確かめられないもの）
 *   テレパス超エネルギー・ロック闘エネルギー：文の「エネルギー1個ぶん」「タイプのたねポケモン」はタイプの記号が抜けていて、
 *     どのタイプとしてはたらくか確かめられない（どの版も同じ文）
 *
 * 割り切ったところ
 *   ニトロ炎エネルギー・ブーメランエネルギー：「ワザのダメージや効果のあとに」は、番の終わり（ワザときぜつの確認の後、ポケモンチェックの前）に行う。
 *     ワザの間にトラッシュされたものは、ワザの効果によるものとみなす（ワザを使ったポケモンがきぜつしてトラッシュされたときはのぞく）
 */

function isActive(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active === pokemon;
}

// ついているポケモンのタイプが type のときだけ働く
const holderIs = (game, source, type) => game.topCard(source.pokemon).type === type;

export const ENERGY_EFFECTS = {
    'グロウ草エネルギー': {
        provides: () => ['grass'],
        hooks: {
            maxHp: (game, source, pokemon) => (pokemon === source.pokemon && holderIs(game, source, 'grass') ? 20 : 0)
        }
    },
    'マグネット鋼エネルギー': {
        provides: () => ['metal'],
        hooks: {
            retreatCost: (game, source, pokemon) => (pokemon === source.pokemon && holderIs(game, source, 'metal') ? -99 : 0)
        }
    },
    'ボルト雷エネルギー': {
        provides: () => ['lightning'],
        hooks: {
            damageDealt: (game, source, ctx, target) => (ctx.attacker === source.pokemon && holderIs(game, source, 'lightning') && isActive(game, target) ? 20 : 0)
        }
    },
    'シャドー悪エネルギー': {
        provides: () => ['darkness'],
        hooks: {
            preventDamage: (game, source, ctx, target) => target === source.pokemon && holderIs(game, source, 'darkness') && !isActive(game, target)
        }
    },
    'プリズムエネルギー': {
        provides: (game, pokemon) => (game.topCard(pokemon).stage === 0 ? ['any'] : ['colorless'])
    },
    'イグニッションエネルギー': {
        provides: (game, pokemon) => (game.topCard(pokemon).stage > 0 ? ['colorless', 'colorless', 'colorless'] : ['colorless']),
        hooks: {
            // 持ち主の番の終わりにトラッシュする
            onTurnEnd: (game, source, player) => {
                if (player !== source.player || !source.pokemon.energies.includes(source.inst)) return;
                game.moveCard(source.pokemon.energies, player.discard, source.inst);
                game.log(`${game.topCard(source.pokemon).name}の${game.cardName(source.inst)}をトラッシュした`);
            }
        }
    },
    'ネオアッパーエネルギー': {
        provides: (game, pokemon) => (game.topCard(pokemon).stage === 2 ? ['any', 'any'] : ['colorless'])
    },
    'ミストエネルギー': {
        provides: () => ['colorless'],
        hooks: {
            preventEffects: (game, source, ctx, target) => target === source.pokemon
        }
    },
    'レガシーエネルギー': {
        provides: () => ['any'],
        hooks: {
            // 対戦中に1回だけ。同じポケモンに2枚ついていても、1枚ぶんだけ働く
            prizeModifier: (game, source, pokemon, player, info) => (legacyApplies(game, source, pokemon, info) ? -1 : 0),
            onKnockout: (game, source, pokemon, player, info) => {
                if (legacyApplies(game, source, pokemon, info)) game.addPlayerEffect(source.player, 'legacyEnergyUsed', LEGACY_FOREVER);
            }
        }
    },
    'リッチエネルギー': {
        provides: () => ['colorless'],
        onAttach: (game, player) => game.draw(player, 4)
    },
    'スパイクエネルギー': {
        provides: () => ['colorless'],
        hooks: {
            onDamaged: (game, source, ctx, target) => {
                if (target !== source.pokemon || !isActive(game, target)) return;
                if (ctx.attacker && game.ownerOf(ctx.attacker)) game.putDamage(ctx.attacker, 20);
            }
        }
    },
    'バブル水エネルギー': {
        provides: () => ['water'],
        hooks: {
            // つけている [W] ポケモンは、特殊状態にならず、受けている特殊状態は回復する
            conditionImmune: (game, source, pokemon) => pokemon === source.pokemon && holderIs(game, source, 'water')
        }
    },
    'テレパス超エネルギー': {
        provides: () => ['psychic'],
        // 手札から [P] ポケモンにつけたとき、山札から [P] タイプのたねポケモンを2枚まで選び、ベンチに出す
        onAttach: (game, player, pokemon) => {
            if (!game.typesOf(pokemon).includes('psychic') || player.bench.length >= game.benchSize) return;
            game.benchFromDeck(player, card => card.kind === 'pokemon' && card.stage === 0 && card.type === 'psychic', 2, 'bench-basic');
        }
    },
    'ロック闘エネルギー': {
        provides: () => ['fighting'],
        hooks: {
            // つけている [F] ポケモンは、相手のポケモンが使うワザの効果を受けない
            preventEffects: (game, source, ctx, target) => target === source.pokemon && game.typesOf(target).includes('fighting')
        }
    },
    'ロケット団エネルギー': {
        // 「ロケット団のポケモン」にしかつけられない。[P][D] のどちらかのタイプのエネルギー2個ぶん
        // （手札からつけるときだけ確かめる。ほかの効果でロケット団のポケモン以外につけたときのトラッシュは、まだない）
        canAttachTo: (game, pokemon) => game.topCard(pokemon).name.startsWith('ロケット団の'),
        provides: () => ['psychic|darkness', 'psychic|darkness']
    },
    'ニトロ炎エネルギー': {
        // つけている [R] ポケモンが使うワザの効果でこのカードがトラッシュされたなら、ワザのダメージや効果のあとに、手札にもどす
        provides: () => ['fire'],
        hooks: afterOwnAttackDiscard({
            applies: (game, source) => game.typesOf(source.pokemon).includes('fire'),
            then: (game, player, inst) => {
                game.moveCard(player.discard, player.hand, inst);
                game.log(`${player.name}は${game.cardName(inst)}を手札にもどした`);
            }
        })
    },
    'ブーメランエネルギー': {
        // つけているポケモンが使うワザの効果でこのカードがトラッシュされたなら、ワザのダメージや効果のあとに、もとのポケモンにつけなおす
        provides: () => ['colorless'],
        hooks: afterOwnAttackDiscard({
            applies: () => true,
            then: (game, player, inst, pokemon) => {
                if (!game.inPlay(player).includes(pokemon)) return;
                game.moveCard(player.discard, pokemon.energies, inst);
                game.log(`${game.cardName(inst)}を${game.topCard(pokemon).name}につけなおした`);
            }
        })
    }
};

/**
 * 「このカードをつけているポケモンが使うワザの効果で、このカードがトラッシュされたなら、ワザのダメージや効果のあとに〜」
 *   ワザの前（beforeAttack）に、このカードを見張るプレイヤーの効果を残す（トラッシュされたカードのフックは働かないため）
 *   番の終わり（onTurnEnd：ワザのダメージ・効果・きぜつの確認の後、ポケモンチェックの前）に、このカードがトラッシュにあれば then を呼ぶ
 *   ワザを使ったポケモンがきぜつして、このカードがいっしょにトラッシュされたときは、ワザの効果でトラッシュされたのではないので働かない
 */
function afterOwnAttackDiscard({ applies, then }) {
    const findWatch = (game, source) => source.player.effects.find(effect => effect.kind === 'watchOwnAttackDiscard' && effect.watch.inst === source.inst && effect.untilTurn >= game.turn);
    return {
        beforeAttack: (game, source, ctx) => {
            if (ctx.attacker !== source.pokemon || !applies(game, source) || findWatch(game, source)) return;
            const watch = { inst: source.inst, pokemon: source.pokemon, done: false };
            game.addPlayerEffect(source.player, 'watchOwnAttackDiscard', game.turn, {
                watch,
                hooks: {
                    onTurnEnd: (g, effectSource) => {
                        if (watch.done || !effectSource.player.discard.includes(watch.inst)) return;
                        watch.done = true; // 1回だけ働く
                        then(g, effectSource.player, watch.inst, watch.pokemon);
                    }
                }
            });
        },
        onKnockout: (game, source, pokemon) => {
            if (pokemon !== source.pokemon) return;
            const watch = findWatch(game, source);
            if (watch) watch.watch.done = true; // きぜつでトラッシュされたなら働かない
        }
    };
}

// 対戦が終わるまで残るプレイヤーの効果（untilTurn を十分大きくする）
const LEGACY_FOREVER = 1e9;

function legacyApplies(game, source, pokemon, { byAttack }) {
    if (pokemon !== source.pokemon || !byAttack) return false;
    if (game.hasPlayerEffect(source.player, 'legacyEnergyUsed')) return false;
    const first = pokemon.energies.find(inst => game.cardName(inst) === 'レガシーエネルギー');
    return first === source.inst;
}
