/**
 * レギュレーション
 * カードは名前と効果で1種類として持ち、regulation には、その効果のカードのうち一番新しい版のマークを入れる
 * （同じ名前・同じ効果の再録がスタンダードにあれば、古いマークの版も使える、という公式の扱いに合わせる）
 * 基本エネルギーはマークがなく、どのレギュレーションでも使える
 */

// 今のスタンダードで使えるマーク。レギュレーションが変わったら、ここを直す
export const STANDARD_MARKS = ['H', 'I', 'J'];

export function isStandardLegal(card) {
    if (card.kind === 'energy' && card.basic) return true;
    return STANDARD_MARKS.includes(card.regulation);
}
