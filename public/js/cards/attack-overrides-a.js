/**
 * 決まった形に読み替えられないワザの効果（そのa）。「カード名/ワザ名」で引く（同じ名前で文の違う版があるなら「カードのID/ワザ名」）
 * { before(ctx), after(ctx), expected(ctx), canUse(game, player, pokemon), firstTurnOk }。ctx は attack-effects.js と同じ。書き方は cards/HOOKS.md
 */

export const ATTACK_OVERRIDES = {};
