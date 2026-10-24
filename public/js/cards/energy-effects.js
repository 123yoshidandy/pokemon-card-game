/**
 * 特殊エネルギーの効果（カードの名前で引く）。書き方は cards/HOOKS.md
 *
 * provides：出すエネルギー（1個ずつの配列。'any' はどのタイプにもなる）
 * hooks：source.pokemon が、このエネルギーのついているポケモン（source.inst がこのエネルギー）
 * onAttach：手札からつけたとき
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
    }
};

// 対戦が終わるまで残るプレイヤーの効果（untilTurn を十分大きくする）
const LEGACY_FOREVER = 1e9;

function legacyApplies(game, source, pokemon, { byAttack }) {
    if (pokemon !== source.pokemon || !byAttack) return false;
    if (game.hasPlayerEffect(source.player, 'legacyEnergyUsed')) return false;
    const first = pokemon.energies.find(inst => game.cardName(inst) === 'レガシーエネルギー');
    return first === source.inst;
}
