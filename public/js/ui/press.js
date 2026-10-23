/**
 * タップと長押しを分ける（カードゲームは「タップで操作、長押しで説明」）
 * root の中で selector に合う要素を押したとき、すぐ離せば onTap、押し続ければ onLongPress を呼ぶ
 * 指が動いたら（手札の横スクロールなど）どちらも呼ばない
 */

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

export function bindPress(root, selector, { onTap, onLongPress }) {
    let pressed = null;

    root.addEventListener('pointerdown', event => {
        const element = event.target.closest(selector);
        if (!element || !root.contains(element) || event.button > 0) return;
        const state = { element, x: event.clientX, y: event.clientY, long: false };
        state.timer = setTimeout(() => {
            state.long = true;
            onLongPress?.(element);
        }, LONG_PRESS_MS);
        pressed = state;
    });

    root.addEventListener('pointermove', event => {
        if (!pressed) return;
        if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > MOVE_TOLERANCE_PX) cancel();
    });

    root.addEventListener('pointerup', () => {
        if (!pressed) return;
        const { element, long } = pressed;
        cancel();
        if (!long) onTap?.(element);
    });

    root.addEventListener('pointercancel', cancel);
    root.addEventListener('contextmenu', event => {
        if (event.target.closest(selector)) event.preventDefault();
    });

    function cancel() {
        if (pressed) clearTimeout(pressed.timer);
        pressed = null;
    }
}
