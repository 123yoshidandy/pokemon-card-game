/**
 * 特性の効果（「カード名/特性名」で引く。効果の文は catalog.js のものを使う）
 *
 * { type: 'activated'（自分の番に使う）| 'onEvolve'（手札から進化させたとき）| 'passive'（いるだけで働く）, canUse, use }
 * ここにない特性を持つポケモンは、まだ動かないのでデッキに入れられない
 */

export const ABILITY_EFFECTS = {};
