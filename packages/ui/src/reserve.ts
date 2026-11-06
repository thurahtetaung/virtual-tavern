import { type RefObject, useLayoutEffect } from 'react';

/**
 * What the page keeps free at its foot for the fixed bars there: the sticky bar (`--vt-sticky-h`)
 * and the phone tab bar (`--vt-tabbar-h`). The room's page pads its foot by both, so neither ever
 * covers the last of the content. Several bars of a kind (two games' tabs mid-switch) count as the
 * tallest one.
 */
export type ReservedBar = '--vt-sticky-h' | '--vt-tabbar-h';

const heights = new Map<ReservedBar, Map<object, number>>();

function publish(bar: ReservedBar) {
  const max = Math.max(0, ...(heights.get(bar)?.values() ?? []));
  const root = document.documentElement.style;
  if (max > 0) root.setProperty(bar, `${max}px`);
  else root.removeProperty(bar);
}

/** Keeps `bar` at the element's height while `on` (0 while it is hidden with `display: none`). */
export function useReservedHeight(
  bar: ReservedBar,
  ref: RefObject<HTMLElement | null>,
  on: boolean,
) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    const key = {};
    const own = heights.get(bar) ?? new Map<object, number>();
    heights.set(bar, own);
    const measure = () => {
      own.set(key, el.offsetHeight);
      publish(bar);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      own.delete(key);
      publish(bar);
    };
  }, [bar, ref, on]);
}
