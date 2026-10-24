/**
 * 特性の効果（「テラスタル」「古代」「未来」の印を使うもの。印は tools/data/limitless-tags.json から補っている）。書き方は cards/HOOKS.md
 */

function isActive(game, pokemon) {
    const owner = game.ownerOf(pokemon);
    return Boolean(owner) && owner.active === pokemon;
}

export const ABILITY_EFFECTS = {
    'ほうせきさがし': {
        type: 'onEvolve',
        canUse: (game, player) => player.deck.length > 0 && game.inPlay(player).some(pokemon => game.topCard(pokemon).tera),
        use: (game, player) => game.searchDeck({
            player,
            filter: card => card.kind === 'trainer',
            max: 2,
            title: '手札に加えるトレーナーズを2枚まで選ぶ',
            purpose: 'search-card',
            onSelected: found => game.addToHand(player, found, { reveal: true })
        })
    },
    'イニシャライズ': {
        type: 'passive',
        hooks: {
            // このポケモンがバトル場にいるかぎり、おたがいの場の「ルールを持つポケモン」（「未来」のポケモンをのぞく）の特性は、すべてなくなる
            suppressAbility: (game, source, pokemon) => {
                const card = game.topCard(pokemon);
                return isActive(game, source.pokemon) && Boolean(card.rule) && !card.future;
            }
        }
    },
    'コバルトコマンド': {
        type: 'passive',
        hooks: {
            damageDealt: (game, source, ctx, target) => {
                if (ctx.player !== source.player) return 0;
                const attacker = game.topCard(ctx.attacker);
                if (!attacker.future || attacker.name === 'テツノカシラex') return 0;
                return game.ownerOf(target) !== source.player && isActive(game, target) ? 20 : 0;
            }
        }
    },
    'きらめくウロコ': {
        type: 'passive',
        hooks: {
            preventDamage: (game, source, ctx, target) => target === source.pokemon && Boolean(game.topCard(ctx.attacker).tera),
            preventEffects: (game, source, ctx, target) => target === source.pokemon && Boolean(game.topCard(ctx.attacker).tera)
        }
    }
};
