/**
 * デッキ構築の「詳しい条件」（公式のカード検索の絞り込みにならう）
 * 同じ項目の中は、どれかに合えばよい（または）。項目どうしは、すべてに合うものだけ（かつ）
 * filters は { 項目の id: [選んだ選択肢の id, ...] }。空の項目は条件にしない
 */

import { TYPE_NAMES } from './card-data.js';

const TYPES = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal', 'dragon', 'colorless'];
const typeOptions = (key, list = TYPES) => [
    ...list.map(type => ({ id: type, label: TYPE_NAMES[type], icon: type, test: card => card[key] === type })),
    { id: 'none', label: 'なし', test: card => !card[key] }
];
const hpRange = (min, max) => ({
    id: `${min}-${max ?? ''}`,
    label: max ? `${min}〜${max}` : `${min}〜`,
    test: card => card.hp >= min && (max === undefined || card.hp <= max)
});
const MARKS = ['H', 'I', 'J'];
// withNone：マークのないカード（基本エネルギー）がある種類だけ「なし」を出す
const markGroup = (withNone = false) => ({
    id: 'mark',
    label: 'レギュレーションマーク',
    options: [
        ...MARKS.map(mark => ({ id: mark, label: mark, test: card => card.regulation === mark })),
        ...(withNone ? [{ id: 'none', label: 'なし', test: card => !card.regulation }] : [])
    ]
});
const aceSpecGroup = {
    id: 'aceSpec',
    label: 'ACE SPEC',
    options: [
        { id: 'yes', label: 'ACE SPEC', test: card => Boolean(card.aceSpec) },
        { id: 'no', label: 'ACE SPEC 以外', test: card => !card.aceSpec }
    ]
};
const tagGroup = {
    id: 'tag',
    label: '古代・未来',
    options: [
        { id: 'ancient', label: '古代', test: card => Boolean(card.ancient) },
        { id: 'future', label: '未来', test: card => Boolean(card.future) }
    ]
};

export const FILTER_GROUPS = {
    pokemon: [
        { id: 'type', label: 'タイプ', options: TYPES.map(type => ({ id: type, label: TYPE_NAMES[type], icon: type, test: card => card.type === type })) },
        {
            id: 'stage',
            label: '進化',
            options: [
                { id: '0', label: 'たね', test: card => card.stage === 0 },
                { id: '1', label: '1進化', test: card => card.stage === 1 },
                { id: '2', label: '2進化', test: card => card.stage === 2 }
            ]
        },
        {
            id: 'rule',
            label: '特別なルール',
            options: [
                { id: 'ex', label: 'ポケモンex', test: card => card.rule === 'ex' },
                { id: 'mega', label: 'メガシンカex', test: card => card.rule === 'mega' },
                { id: 'tera', label: 'テラスタル', test: card => Boolean(card.tera) },
                { id: 'none', label: 'ルールなし', test: card => !card.rule }
            ]
        },
        tagGroup,
        {
            id: 'ability',
            label: '特性',
            options: [
                { id: 'yes', label: 'あり', test: card => Boolean(card.ability) },
                { id: 'no', label: 'なし', test: card => !card.ability }
            ]
        },
        {
            id: 'hp',
            label: 'HP',
            options: [hpRange(30, 60), hpRange(70, 100), hpRange(110, 150), hpRange(160, 200), hpRange(210, 250), hpRange(260, 300), hpRange(310)]
        },
        { id: 'weakness', label: '弱点', options: typeOptions('weakness', TYPES.filter(type => type !== 'dragon' && type !== 'colorless')) },
        { id: 'resistance', label: '抵抗力', options: typeOptions('resistance', TYPES.filter(type => type !== 'dragon' && type !== 'colorless')) },
        {
            id: 'retreat',
            label: 'にげる',
            options: [0, 1, 2, 3, 4].map(n => ({ id: String(n), label: n === 4 ? '4以上' : String(n), test: card => (n === 4 ? card.retreat >= 4 : card.retreat === n) }))
        },
        markGroup()
    ],
    trainer: [
        {
            id: 'trainerType',
            label: 'トレーナーズの種類',
            options: [
                { id: 'supporter', label: 'サポート', test: card => card.trainerType === 'supporter' },
                { id: 'item', label: 'グッズ', test: card => card.trainerType === 'item' },
                { id: 'tool', label: 'ポケモンのどうぐ', test: card => card.trainerType === 'tool' },
                { id: 'stadium', label: 'スタジアム', test: card => card.trainerType === 'stadium' }
            ]
        },
        aceSpecGroup,
        tagGroup,
        markGroup()
    ],
    energy: [
        {
            id: 'energyKind',
            label: 'エネルギーの種類',
            options: [
                { id: 'basic', label: '基本エネルギー', test: card => Boolean(card.basic) },
                { id: 'special', label: '特殊エネルギー', test: card => !card.basic }
            ]
        },
        aceSpecGroup,
        markGroup(true)
    ]
};

// 画面の上の小さなタブで切り替える項目（タブは、この項目の選択肢を1つだけ選ぶ近道）
export const QUICK_GROUP = { pokemon: 'type', trainer: 'trainerType', energy: 'energyKind' };

export function matchesFilters(card, filters) {
    for (const group of FILTER_GROUPS[card.kind] ?? []) {
        const chosen = filters[group.id];
        if (!chosen?.length) continue;
        if (!group.options.some(option => chosen.includes(option.id) && option.test(card))) return false;
    }
    return true;
}

// 選んでいる条件の数（ボタンに出す）
export function filterCount(kind, filters) {
    return (FILTER_GROUPS[kind] ?? []).reduce((sum, group) => sum + (filters[group.id]?.length ?? 0), 0);
}

// 選択肢を1つ切り替えた、新しい filters を返す
export function toggleFilter(filters, groupId, optionId) {
    const chosen = filters[groupId] ?? [];
    const next = chosen.includes(optionId) ? chosen.filter(id => id !== optionId) : [...chosen, optionId];
    return { ...filters, [groupId]: next };
}
