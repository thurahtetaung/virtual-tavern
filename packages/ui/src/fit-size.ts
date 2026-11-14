import { type RefObject, useLayoutEffect, useRef } from 'react';

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
 * How far a re-fit in the same window may grow a part that still fits, in px, before it bothers:
 * none. Two fits that watch each other (a phone's `FitArea` capping the area round the part, which
 * changes whether the part fits) can each undo the other's last pixel or two on every frame, so the
 * part shook; holding a size that still fits ends that. A new window size always fits afresh.
 */
export const FIT_SLACK_PX = 3;

/**
 * The size a fit settles on: the largest between `min` and `max` px (to within `step`) at which
 * `fits` holds (`min` when none does). `fits` sets the size and measures, so the last size it was
 * asked about is not the answer; set the result. With `current` (the size the part has, in the
 * same window), a size that still fits is kept unless the search finds room for more than
 * `FIT_SLACK_PX` beyond it, so a fit that resizes what it measures always comes to rest.
 */
export function fitSize(
  fits: (px: number) => boolean,
  { min, max, step, current }: { min: number; max: number; step: number; current?: number },
): number {
  // Largest size that fits, by halving (a few layouts in one frame, nothing painted between).
  let best = max;
  if (!fits(max)) {
    let lo = min;
    let hi = max;
    if (fits(lo)) {
      while (hi - lo > step) {
        const mid = Math.floor((lo + hi) / 2);
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
    }
    best = lo;
  }
  if (
    current !== undefined &&
    current >= min &&
    best > current &&
    best - current <= FIT_SLACK_PX &&
    fits(current)
  )
    return current;
  return best;
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
 * when the bars at the foot change. In the same window it keeps a size that still fits rather
 * than grow it by a pixel or two (`fitSize`), so it never shakes against a `FitArea` round it.
 */
export function useFitSize(
  part: RefObject<HTMLElement | null>,
  { on = true, min, max, inView, step = 4 }: FitSizeOptions,
) {
  // The window the part was last fitted in: a new size starts afresh, with no size to keep.
  const fittedIn = useRef('');
  useLayoutEffect(() => {
    const el = part.current;
    if (!el) return;
    if (!on) {
      el.style.removeProperty(FIT_SIZE_VAR);
      fittedIn.current = '';
      return;
    }
    const set = (px: number) => {
      el.style.setProperty(FIT_SIZE_VAR, `${px}px`);
    };
    const fit = () => {
      const size = `${window.innerWidth}x${window.innerHeight}`;
      const had = Number.parseFloat(el.style.getPropertyValue(FIT_SIZE_VAR));
      const current = fittedIn.current === size && Number.isFinite(had) ? had : undefined;
      fittedIn.current = size;
      set(
        fitSize(
          (px) => {
            set(px);
            return fits(el, inView);
          },
          { min, max, step, current },
        ),
      );
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
