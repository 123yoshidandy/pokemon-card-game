/**
 * 決まった形に読み替えられないワザの効果（「カード名/ワザ名」で引く）
 * { before(ctx), after(ctx), expected(ctx) }。ctx は attack-effects.js と同じ
 */

export const ATTACK_OVERRIDES = {
    'メガリザードンYex/プロージョンY': {
        after: ctx => {
            const { game, opponent, attacker } = ctx;
            game.discardEnergyFrom(attacker, 3);
            game.promptPokemon({
                player: ctx.player,
                pokemon: game.inPlay(opponent),
                min: 1,
                max: 1,
                title: 'プロージョンY：280ダメージを与えるポケモンを選ぶ',
                purpose: 'snipe-target',
                amount: 280,
                callback: ([target]) => game.dealAttackDamage(ctx, target, 280)
            });
        },
        expected: () => 280
    }
};
