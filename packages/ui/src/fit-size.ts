import { type RefObject, useLayoutEffect } from 'react';

/** The custom property `useFitSize` sets on its element, in px. */
export const FIT_SIZE_VAR = '--vt-fit';

export interface FitSizeOptions {
  /** Fit only while this is true (a wide screen, a stage). Off, the property is removed. */
  on?: boolean;
  /** The smallest size, in px: below it the page scrolls instead. */
  min: number;
  /** The largest size, in px: on a tall window the part grows to this. */
  max: number;
  /**
   * Fit only so far that this element's foot (Play again) sits inside the window from the page's
   * top, whatever else scrolls: for a part inside areas that fit themselves, as the end's columns.
   */
  inView?: () => Element | null;
  /** How close to the largest size that fits the search gets, in px (default 4). */
  step?: number;
}

/**
 * Whether the page fits the window (nothing under its foot), and no capped area around `el` (a
 * phone's `FitArea`) has to scroll to show it all; with `inView`, whether that element's foot is
 * inside the window.
 */
function fits(el: HTMLElement, inView?: () => Element | null): boolean {
  const page = document.scrollingElement ?? document.documentElement;
  const keep = inView?.();
  if (keep) return keep.getBoundingClientRect().bottom + window.scrollY <= page.clientHeight - 8;
  if (page.scrollHeight > page.clientHeight + 1) return false;
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement)
    if (n.style.maxHeight && n.scrollHeight > n.clientHeight + 1) return false;
  return true;
}

/**
 * Sizes a part (a table of cards, a drawing) so the whole screen fits the window: the largest
 * size between `min` and `max` px at which the page doesn't scroll, set as `--vt-fit` on the
 * element for its styles to use (a card's width, a drawing's height). On a tall window the part
 * grows into the room; on a short one it shrinks, so the result under it and the action keep their
 * place in view and the sticky tray never has to cover them. Inside a phone's `FitArea` it also
 * shrinks until the area needn't scroll. Past `min` the page (or the area) scrolls.
 *
 * It measures again after every render, when the window or anything on the page resizes, and
 * when the bars at the foot change.
 */
export function useFitSize(
  part: RefObject<HTMLElement | null>,
  { on = true, min, max, inView, step = 4 }: FitSizeOptions,
) {
  useLayoutEffect(() => {
    const el = part.current;
    if (!el) return;
    if (!on) {
      el.style.removeProperty(FIT_SIZE_VAR);
      return;
    }
    const set = (px: number) => {
      el.style.setProperty(FIT_SIZE_VAR, `${px}px`);
    };
    const fit = () => {
      // Largest size that fits, by halving (a few layouts in one frame, nothing painted between).
      let lo = min;
      let hi = max;
      set(hi);
      if (!fits(el, inView)) {
        set(lo);
        if (fits(el, inView)) {
          while (hi - lo > step) {
            const mid = Math.floor((lo + hi) / 2);
            set(mid);
            if (fits(el, inView)) lo = mid;
            else hi = mid;
          }
        }
        hi = lo;
      }
      set(hi);
    };
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    // The body keeps the window's height while the page grows, so watch the part's own boxes.
    sizes?.observe(document.body);
    for (let n: HTMLElement | null = el; n && n !== document.body; n = n.parentElement)
      sizes?.observe(n);
    const bars = new MutationObserver(later);
    bars.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      sizes?.disconnect();
      bars.disconnect();
      window.removeEventListener('resize', later);
    };
    // No dependencies: it measures afresh after every render (new cards, a result under them).
  });
}
