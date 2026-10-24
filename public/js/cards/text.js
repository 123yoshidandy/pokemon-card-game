/**
 * カードの文の揺れをそろえる（全角・半角、空白、＋・－・×の書き方）
 * 再録をまとめるときと、効果の文を読み替えるときに使う
 */

export function normalizeText(text) {
    return String(text)
        .normalize('NFKC')
        .replace(/\s+/g, '')
        .replace(/[−–—]/g, '-')
        .replace(/(\d)x/g, '$1×');
}
