import { type RefObject, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * The height from the top of `ref`'s element (as laid out at the top of the page) down to the bars
 * fixed at the screen's foot (the sticky bar and the phone tab bar, `reserve.ts`, plus the room
 * frame's gutter under them), so a hand, a
 * drawing or a card can grow into the empty band above Play instead of leaving it blank. `null`
 * until measured or while `on` is false. It measures again when the window or the page resizes.
 */
export function useFreeHeight(ref: RefObject<HTMLElement | null>, on = true): number | null {
  const [free, setFree] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) {
      setFree(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      const root = getComputedStyle(document.documentElement);
      const bar = (name: string) => parseFloat(root.getPropertyValue(name)) || 0;
      // The room's frame pads its foot by the bars plus its own gutter (`.vt-room-main`), all of
      // which the page needs under the element; elsewhere only the bars count.
      const room = el.closest('.vt-room-main');
      const foot = room
        ? parseFloat(getComputedStyle(room).paddingBottom) || 0
        : bar('--vt-sticky-h') + bar('--vt-tabbar-h');
      const top = el.getBoundingClientRect().top + window.scrollY;
      const next = Math.floor(window.innerHeight - foot - top);
      setFree((f) => (f === next ? f : next));
    };
    // A new height is applied before the frame is painted: set from the frame callback without
    // it, React drew it a frame or two later (a column too tall for two frames as the window
    // crossed into the wide layout, and everything fitted round it moving twice).
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        flushSync(measure);
      });
    };
    measure();
    // And again once the layout round it has settled: switched on by a resize (the window crossing
    // into the wide layout), what is above it may still move before this frame is painted.
    later();
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    sizes?.observe(document.body);
    const bars = new MutationObserver(later);
    bars.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      sizes?.disconnect();
      bars.disconnect();
      window.removeEventListener('resize', later);
    };
  }, [ref, on]);
  return free;
}
