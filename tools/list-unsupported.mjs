/**
 * まだ動かないカードを、理由ごとに出す（効果を足す作業の一覧に使う）
 *
 *   node tools/list-unsupported.mjs attacks [始め] [終わり]   # 読み替えられないワザ（番号で区切れる）
 *   node tools/list-unsupported.mjs abilities                # 効果のない特性
 *   node tools/list-unsupported.mjs trainers                 # 効果のないトレーナーズ・特殊エネルギー
 */

import { CATALOG } from '../public/js/cards/catalog.js';
import { CARDS } from '../public/js/card-data.js';

const [kind = 'attacks', start = '0', end = 'Infinity'] = process.argv.slice(2);

if (kind === 'attacks') {
    // 動かないポケモンの、読み替えられないワザ（特性がないか、特性は動くもの）
    const rows = [];
    CATALOG.filter(card => card.kind === 'pokemon').forEach(data => {
        const card = CARDS[data.id];
        if (card.supported || (card.ability && card.ability.type === 'unknown')) return;
        card.attacks.forEach(attack => {
            if (!attack.supported) rows.push(`${data.id}\t${data.name}\t${attack.name}\t[${attack.cost.join(',')}] ${attack.damageText}\t${attack.text}`);
        });
    });
    console.log(`読み替えられないワザ ${rows.length} 件（ID・カード名・ワザ名・コストとダメージ・文）`);
    rows.slice(Number(start), Number(end)).forEach((row, index) => console.log(`${Number(start) + index}\t${row}`));
} else if (kind === 'abilities') {
    const rows = CATALOG.filter(card => card.kind === 'pokemon' && CARDS[card.id].ability?.type === 'unknown')
        .map(card => `${card.id}\t${card.name}\t${card.abilities[0].name}\t${card.abilities[0].text}`);
    console.log(`効果のない特性 ${rows.length} 件`);
    rows.forEach(row => console.log(row));
} else {
    const rows = CATALOG.filter(card => card.kind !== 'pokemon' && !CARDS[card.id].supported)
        .map(card => `${card.id}\t${card.trainerType ?? 'energy'}\t${card.name}\t${card.text}`);
    console.log(`効果のないトレーナーズ・特殊エネルギー ${rows.length} 件`);
    rows.forEach(row => console.log(row));
}
