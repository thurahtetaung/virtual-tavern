import { type RefObject, useLayoutEffect } from 'react';

const PHONE = '(max-width: 639px)';

/**
 * Phones only: caps the element's height by however much the page would otherwise scroll, so the
 * page fits the screen and the element (the scene's tiles, a dense choice) scrolls inside instead.
 * It re-measures when the screen, the element's content or the bars at the foot change.
 */
export function useFitOnPhone(ref: RefObject<HTMLElement | null>, on = true) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !on || typeof window.matchMedia !== 'function') return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        el.style.maxHeight = '';
        if (!window.matchMedia(PHONE).matches || el.offsetParent === null) return;
        const page = document.scrollingElement ?? document.documentElement;
        const over = page.scrollHeight - page.clientHeight;
        if (over > 0) el.style.maxHeight = `${Math.max(160, el.offsetHeight - over)}px`;
      });
    };
    fit();
    const content = new ResizeObserver(fit);
    for (const child of el.children) content.observe(child);
    // The bars publish their heights on the root's style.
    const bars = new MutationObserver(fit);
    bars.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(frame);
      content.disconnect();
      bars.disconnect();
      window.removeEventListener('resize', fit);
      el.style.maxHeight = '';
    };
  });
}
