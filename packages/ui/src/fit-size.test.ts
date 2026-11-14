import { describe, expect, it } from 'vitest';
import { FIT_OSCILLATION_MS, type FitHistory, fitSize, settleFit } from './fit-size.ts';

const RANGE = { min: 120, max: 360, step: 1 };
const FRAME = 16;

/**
 * A drawing inside a phone's `FitArea`, as measured on a 375 × 667 phone: uncapped, the page lets
 * a sheet of 212 px by (one pixel over, within the fit's tolerance); capped, the area scrolls at
 * 212, so only 211 fits. The area caps itself whenever the page is over by any pixel.
 */
function phone() {
  let capped = false;
  const fits = (px: number) => px <= (capped ? 211 : 212);
  const area = (px: number) => {
    capped = px > 211;
  };
  return { fits, area };
}

/**
 * The fit and the area answering each other's resizes, frame after frame, as the observers do;
 * `settle` off applies every fresh fit as it is (the old fit).
 */
function frames(n: number, settle: boolean) {
  const { fits, area } = phone();
  const history: FitHistory = {};
  const sizes: number[] = [];
  let px: number | undefined;
  for (let i = 0; i < n; i++) {
    const best = fitSize(fits, RANGE);
    px = settle ? settleFit(history, { best, current: px, now: i * FRAME, stillFits: fits }) : best;
    sizes.push(px);
    area(px);
  }
  return sizes;
}

describe('fitSize', () => {
  it('finds the largest size that fits, to the step', () => {
    expect(fitSize((px) => px <= 250, RANGE)).toBe(250);
    expect(fitSize((px) => px <= 250, { ...RANGE, step: 4 })).toBeGreaterThan(246);
    expect(fitSize(() => true, RANGE)).toBe(360);
    expect(fitSize(() => false, RANGE)).toBe(120);
  });
});

describe('settleFit', () => {
  it('shook against a FitArea when every re-fit applied the fresh fit', () => {
    expect(new Set(frames(20, false).slice(-10))).toEqual(new Set([211, 212]));
  });

  it('comes to rest against a FitArea, on the smaller size', () => {
    const sizes = frames(20, true);
    expect(sizes.slice(0, 2)).toEqual([212, 211]);
    expect(new Set(sizes.slice(2))).toEqual(new Set([211]));
  });

  it('follows the content exactly when it changes in the same window', () => {
    // Text grows and shrinks by a pixel or a few (a new text size, a caption), frame by frame:
    // every re-fit takes the fresh best, larger or smaller.
    const history: FitHistory = {};
    let px: number | undefined;
    const bests = [300, 297, 299, 302, 301, 360, 240, 243];
    bests.forEach((best, i) => {
      px = settleFit(history, { best, current: px, now: i * FRAME, stillFits: () => true });
      expect(px).toBe(best);
    });
  });

  it('follows a size that comes back after a while, and starts afresh in a new window', () => {
    const history: FitHistory = {};
    const fit = (best: number, current: number | undefined, now: number) =>
      settleFit(history, { best, current, now, stillFits: () => true });
    expect(fit(300, undefined, 0)).toBe(300);
    expect(fit(280, 300, 1000)).toBe(280);
    // Back to 300 long after the change to 280: real room again, not an oscillation.
    expect(fit(300, 280, 1000 + FIT_OSCILLATION_MS + 1)).toBe(300);
    // A settled pair is let go when the fit asks for a third size, or the window changes.
    expect(fit(280, 300, 2000)).toBe(280);
    expect(fit(300, 280, 2000 + FRAME)).toBe(280);
    expect(fit(305, 280, 3000)).toBe(305);
    expect(fit(280, 305, 4000)).toBe(280);
    expect(fit(305, 280, 4000 + FRAME)).toBe(280);
    expect(fit(305, undefined, 4000 + 2 * FRAME)).toBe(305);
  });

  it('lets a settled size go when it no longer fits', () => {
    const history: FitHistory = {};
    let fitsSmall = true;
    const fit = (best: number, current: number | undefined, now: number) =>
      settleFit(history, { best, current, now, stillFits: () => fitsSmall });
    fit(212, undefined, 0);
    expect(fit(211, 212, FRAME)).toBe(211);
    expect(fit(212, 211, 2 * FRAME)).toBe(211);
    fitsSmall = false;
    expect(fit(212, 211, 3 * FRAME)).toBe(212);
  });
});
