/**
 * TCGdex（https://tcgdex.dev）から日本のカードのデータを取り、tools/data/tcgdex-ja/<セット>.json に保存する
 * スカーレット・バイオレット（SV）とメガシンカ（M）のシリーズのセットから、スタンダードのマークのカードと基本エネルギーだけを残す
 *
 *   node tools/fetch-cards.mjs            # まだ保存していないセットだけ取る
 *   node tools/fetch-cards.mjs --refresh  # すべて取り直す
 *   node tools/fetch-cards.mjs M6 MC      # 指定したセットだけ取り直す
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDARD_MARKS } from '../public/js/regulation.js';

const API = 'https://api.tcgdex.net/v2/ja';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data', 'tcgdex-ja');
const SET_PATTERN = /^(SV|M)/i;
const CONCURRENCY = 6;

// 保存するキー（値段・絵・図鑑の説明などは使わないので捨てる）
const KEEP = ['id', 'localId', 'name', 'category', 'rarity', 'hp', 'types', 'stage', 'evolveFrom', 'suffix', 'abilities', 'attacks',
    'weaknesses', 'resistances', 'retreat', 'regulationMark', 'legal', 'effect', 'trainerType', 'energyType', 'item'];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(path) {
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await fetch(`${API}${path}`);
            if (response.status === 404) return null;
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            if (attempt >= 4) throw new Error(`${path}: ${error.message}`);
            await sleep(500 * 3 ** (attempt - 1));
        }
    }
}

// 並べて取る（同時に CONCURRENCY 件まで）
async function mapLimited(items, fn) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    }));
    return results;
}

const isBasicEnergy = card => card.category === 'Energy' && card.energyType === 'Normal';
const isStandard = card => STANDARD_MARKS.includes(card.regulationMark) || isBasicEnergy(card);

function trim(card) {
    const kept = Object.fromEntries(KEEP.filter(key => card[key] !== undefined).map(key => [key, card[key]]));
    kept.set = { id: card.set.id, name: card.set.name };
    return kept;
}

async function fetchSet(setId) {
    const set = await getJson(`/sets/${encodeURIComponent(setId)}`);
    if (!set) return null;
    const cards = await mapLimited(set.cards ?? [], brief => getJson(`/cards/${encodeURIComponent(brief.id)}`));
    const kept = cards.filter(card => card && isStandard(card)).map(trim);
    const file = { id: set.id, name: set.name, releaseDate: set.releaseDate ?? null, total: set.cards?.length ?? 0, cards: kept };
    await writeFile(join(OUT_DIR, `${set.id}.json`), JSON.stringify(file, null, 1) + '\n');
    return file;
}

async function main() {
    const args = process.argv.slice(2);
    const refresh = args.includes('--refresh');
    const only = args.filter(arg => !arg.startsWith('--'));
    await mkdir(OUT_DIR, { recursive: true });
    const saved = new Set((await readdir(OUT_DIR)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)));

    const sets = (await getJson('/sets')).map(set => set.id).filter(id => SET_PATTERN.test(id));
    const targets = only.length ? only : sets.filter(id => refresh || !saved.has(id));
    console.log(`セット ${sets.length} 件のうち、${targets.length} 件を取ります`);

    let failed = 0;
    for (const id of targets) {
        try {
            const file = await fetchSet(id);
            console.log(file ? `${id} ${file.name}：${file.total} 枚中 ${file.cards.length} 枚を保存` : `${id}：見つからない`);
        } catch (error) {
            failed++;
            console.log(`${id}：失敗（${error.message}）。もう一度実行すると、続きから取ります`);
        }
    }
    console.log(failed ? `${failed} 件失敗しました` : '終わりました');
    process.exitCode = failed ? 1 : 0;
}

await main();
