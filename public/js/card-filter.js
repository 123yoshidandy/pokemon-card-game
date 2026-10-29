/**
 * デッキ構築の「詳しい条件」（公式のカード検索の絞り込みにならう）
 * 同じ項目の中は、どれかに合えばよい（または）。項目どうしは、すべてに合うものだけ（かつ）
 * filters は { 項目の id: [選んだ選択肢の id, ...] }。空の項目は条件にしない（画面のプルダウンでは、1つの項目に1つだけ選ぶ）
 * 項目の short はプルダウンに出す短い名前、prefix は選んだ値の前に項目名を付けるか（「HP 70〜100」「にげる 1」）
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
    short: 'マーク',
    prefix: true,
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
            prefix: true,
            options: [
                { id: 'yes', label: 'あり', test: card => Boolean(card.ability) },
                { id: 'no', label: 'なし', test: card => !card.ability }
            ]
        },
        {
            id: 'hp',
            label: 'HP',
            prefix: true,
            options: [hpRange(30, 60), hpRange(70, 100), hpRange(110, 150), hpRange(160, 200), hpRange(210, 250), hpRange(260, 300), hpRange(310)]
        },
        { id: 'weakness', label: '弱点', prefix: true, options: typeOptions('weakness', TYPES.filter(type => type !== 'dragon' && type !== 'colorless')) },
        { id: 'resistance', label: '抵抗力', prefix: true, options: typeOptions('resistance', TYPES.filter(type => type !== 'dragon' && type !== 'colorless')) },
        {
            id: 'retreat',
            label: 'にげる',
            prefix: true,
            options: [0, 1, 2, 3, 4].map(n => ({ id: String(n), label: n === 4 ? '4以上' : String(n), test: card => (n === 4 ? card.retreat >= 4 : card.retreat === n) }))
        },
        markGroup()
    ],
    trainer: [
        {
            id: 'trainerType',
            label: 'トレーナーズの種類',
            short: '種類',
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
            short: '種類',
            options: [
                { id: 'basic', label: '基本エネルギー', test: card => Boolean(card.basic) },
                { id: 'special', label: '特殊エネルギー', test: card => !card.basic }
            ]
        },
        aceSpecGroup,
        markGroup(true)
    ]
};

export function matchesFilters(card, filters) {
    for (const group of FILTER_GROUPS[card.kind] ?? []) {
        const chosen = filters[group.id];
        if (!chosen?.length) continue;
        if (!group.options.some(option => chosen.includes(option.id) && option.test(card))) return false;
    }
    return true;
}

// 選んでいる条件の数
export function filterCount(kind, filters) {
    return (FILTER_GROUPS[kind] ?? []).reduce((sum, group) => sum + (filters[group.id]?.length ?? 0), 0);
}

// 項目の選択肢を1つだけ選んだ（optionId が空なら、その項目の条件を外した）、新しい filters を返す
export function setFilter(filters, groupId, optionId) {
    return { ...filters, [groupId]: optionId ? [optionId] : [] };
}

// プルダウンに出す文字（選んでいなければ項目の名前、選んでいれば選んだ値）
export function filterLabel(group, filters) {
    const option = group.options.find(item => filters[group.id]?.includes(item.id));
    const name = group.short ?? group.label;
    if (!option) return name;
    return group.prefix ? `${name} ${option.label}` : option.label;
}
