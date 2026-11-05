/**
 * デッキごとの戦績（localStorage）
 * { デッキID: { win, loss, draw } } の形で保存する
 */

const STORAGE_KEY = 'pokemon-card-game:stats';

const browserStorage = () => (typeof localStorage === 'undefined' ? null : localStorage);

export function createDeckStats(storage = browserStorage()) {
    let stats = load();

    function load() {
        try {
            const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '{}');
            return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
        } catch {
            return {};
        }
    }

    return {
        // まだ1度も遊んでいなければ null
        get: deckId => stats[deckId] ?? null,

        // result：'win' / 'loss' / 'draw'
        record(deckId, result) {
            const current = { win: 0, loss: 0, draw: 0, ...stats[deckId] };
            current[result] = (Number(current[result]) || 0) + 1;
            stats = { ...stats, [deckId]: current };
            try {
                storage?.setItem(STORAGE_KEY, JSON.stringify(stats));
            } catch {
                // 保存できない環境でも遊べるようにする
            }
        }
    };
}

// 「3勝2敗」（引き分けがあれば「1分」もつける）
export function statsText(stats) {
    if (!stats) return '';
    return `${stats.win}勝${stats.loss}敗${stats.draw ? `${stats.draw}分` : ''}`;
}
