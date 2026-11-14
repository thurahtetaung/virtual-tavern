import { type RefObject, useLayoutEffect, useRef } from 'react';
import { FIT_AREA_CAPPED } from './fit-area.tsx';

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
 * How far past its limit each thing that must fit is, in px (0 or less: it fits): with `inView`,
 * that element's foot against the window from the page's top; otherwise the page against the
 * window, then every capped area around `el` (a phone's `FitArea`) against its own height.
 */
function overshoots(el: HTMLElement, inView?: () => Element | null): number[] {
  const page = document.scrollingElement ?? document.documentElement;
  const keep = inView?.();
  if (keep) return [keep.getBoundingClientRect().bottom + window.scrollY - (page.clientHeight - 8)];
  const over = [page.scrollHeight - page.clientHeight - 1];
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement)
    over.push(n.style.maxHeight ? n.scrollHeight - n.clientHeight - 1 : 0);
  return over;
}

/**
 * Whether a size fits: nothing is further past its limit than it already was at the smallest size
 * (`floor`). The part never takes the blame for what the rest of the page overflows by: when the
 * tools beside a drawing are taller than a short window on their own, the drawing keeps the
 * height beside them instead of dropping to its smallest size.
 */
export function fitsOver(over: number[], floor: number[]): boolean {
  return over.every((px, i) => px <= Math.max(0, floor[i] ?? 0));
}

/**
 * How soon after a change a fit that goes straight back to the size before it counts as an
 * oscillation, in ms: a few frames.
 */
export const FIT_OSCILLATION_MS = 200;

/**
 * The largest size between `min` and `max` px (to within `step`) at which `fits` holds (`min`
 * when none does). `fits` sets the size and measures, so the last size it was asked about is not
 * the answer; set the result.
 */
export function fitSize(
  fits: (px: number) => boolean,
  { min, max, step }: { min: number; max: number; step: number },
): number {
  // Largest size that fits, by halving (a few layouts in one frame, nothing painted between).
  if (fits(max)) return max;
  let lo = min;
  let hi = max;
  if (fits(lo)) {
    while (hi - lo > step) {
      const mid = Math.floor((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
  }
  return lo;
}

/** What a part's fit remembers between re-fits: its last change, and a pair it settled. */
export interface FitHistory {
  /** The last change: from which size, to which, and when (ms). */
  last?: { from: number; to: number; at: number };
  /** An oscillation it settled: it stays at `lo` while the fit keeps asking for `hi`. */
  held?: { lo: number; hi: number };
}

/**
 * The size a re-fit applies, given the fresh `best` fit and the part's `current` size (none in a
 * new window or on a new part). Normally `best`, exactly. Two fits that watch each other (a
 * phone's `FitArea` capping the area round the part, which changes whether the part fits) can
 * undo each other on every frame: a re-fit that goes straight back to the size the last change
 * came from, within `FIT_OSCILLATION_MS`, is that, and the part settles on the smaller of the two
 * (if it still fits) until the fit asks for anything else.
 */
export function settleFit(
  history: FitHistory,
  {
    best,
    current,
    now,
    stillFits,
  }: {
    best: number;
    current: number | undefined;
    now: number;
    /** Whether the smaller size of a settled pair still fits (sets it and measures). */
    stillFits: (px: number) => boolean;
  },
): number {
  if (current === undefined) {
    history.last = undefined;
    history.held = undefined;
    return best;
  }
  const held = history.held;
  if (held && best === held.hi && current === held.lo && stillFits(held.lo)) return held.lo;
  history.held = undefined;
  if (best === current) return best;
  const last = history.last;
  if (last && last.to === current && last.from === best && now - last.at <= FIT_OSCILLATION_MS) {
    const lo = Math.min(best, current);
    history.held = { lo, hi: Math.max(best, current) };
    if (lo === current) {
      if (stillFits(lo)) return lo;
      history.held = undefined;
    }
  }
  history.last = { from: current, to: best, at: now };
  return best;
}

/**
 * Sizes a part (a table of cards, a drawing) so the whole screen fits the window: the largest
 * size between `min` and `max` px at which the page doesn't scroll, set as `--vt-fit` on the
 * element for its styles to use (a card's width, a drawing's height). On a tall window the part
 * grows into the room; on a short one it shrinks, so the result under it and the action keep their
 * place in view and the sticky tray never has to cover them. Inside a phone's `FitArea` it also
 * shrinks until the area needn't scroll. Past `min` the page (or the area) scrolls. When the page
 * is too tall even with the part at `min` (the rest is taller than the window), the part takes the
 * largest size that makes it no taller, so a window dragged past that point never snaps it small.
 *
 * It measures again after every render, when the window or anything on the page resizes, and
 * when the bars at the foot change. A fit that would only undo its last change a few frames later
 * settles instead (`settleFit`), so it never shakes against a `FitArea` round it.
 */
export function useFitSize(
  part: RefObject<HTMLElement | null>,
  { on = true, min, max, inView, step = 4 }: FitSizeOptions,
) {
  // The window the part was last fitted in (a new size starts afresh) and its recent changes.
  const fittedIn = useRef('');
  const history = useRef<FitHistory>({});
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
      // What overflows anyway, with the part at its smallest.
      set(min);
      const floor = overshoots(el, inView);
      const fitsAt = (px: number) => {
        set(px);
        return fitsOver(overshoots(el, inView), floor);
      };
      const best = fitSize(fitsAt, { min, max, step });
      set(settleFit(history.current, { best, current, now: performance.now(), stillFits: fitsAt }));
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
    // A `FitArea` round the part has just capped itself: fit to it now, in the same frame.
    const capped = (e: Event) => {
      if (e.target instanceof Node && e.target.contains(el)) fit();
    };
    document.addEventListener(FIT_AREA_CAPPED, capped);
    return () => {
      cancelAnimationFrame(frame);
      sizes?.disconnect();
      bars.disconnect();
      window.removeEventListener('resize', later);
      document.removeEventListener(FIT_AREA_CAPPED, capped);
    };
    // No dependencies: it measures afresh after every render (new cards, a result under them).
  });
}
