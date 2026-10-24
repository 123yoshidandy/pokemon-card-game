/**
 * どれだけのカードが動くかを数える（次に読み替える文を選ぶため）
 *
 *   node tools/card-coverage.mjs        # 数と、読み替えられない文の多い順（上位40）
 *   node tools/card-coverage.mjs 100    # 上位100まで出す
 */

import { CATALOG } from '../public/js/cards/catalog.js';
import { CARDS } from '../public/js/card-data.js';
import { unsupportedSentences } from '../public/js/cards/attack-effects.js';

const limit = Number(process.argv[2] ?? 40);
const cards = Object.values(CARDS);
const count = (kind, filter = () => true) => cards.filter(card => card.kind === kind && filter(card)).length;
const supported = card => card.supported;
console.log(`カード ${cards.length} 種類のうち、動くもの ${cards.filter(supported).length}`);
console.log(`  ポケモン ${count('pokemon', supported)} / ${count('pokemon')}`);
console.log(`  トレーナーズ ${count('trainer', supported)} / ${count('trainer')}`);
console.log(`  エネルギー ${count('energy', supported)} / ${count('energy')}`);

const attacks = CATALOG.flatMap(card => card.attacks ?? []).filter(attack => attack.text);
const sentences = new Map();
let ok = 0;
for (const attack of attacks) {
    const rest = unsupportedSentences(attack.text);
    if (rest.length === 0) ok++;
    rest.forEach(sentence => {
        const key = sentence.replace(/\d+/g, 'N');
        sentences.set(key, (sentences.get(key) ?? 0) + 1);
    });
}
console.log(`効果のあるワザ ${attacks.length} のうち、読み替えられるもの ${ok}`);
const abilityless = CATALOG.filter(card => card.kind === 'pokemon' && !card.abilities);
console.log(`特性のないポケモン ${abilityless.length} のうち、動くもの ${abilityless.filter(card => CARDS[card.id].supported).length}`);
console.log(`\n読み替えられない文（多い順）`);
[...sentences].sort((a, b) => b[1] - a[1]).slice(0, limit).forEach(([sentence, n]) => console.log(n, sentence));
