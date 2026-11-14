import { describe, expect, it } from 'vitest';
import {
  FIT_OSCILLATION_MS,
  FIT_SHAKE_MS,
  type FitBrake,
  type FitHistory,
  brakeFit,
  fitSize,
  fitsOver,
  settleFit,
} from './fit-size.ts';

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

describe('fitsOver', () => {
  it('fits while nothing overflows, the usual case', () => {
    expect(fitsOver([0, 0], [-40, 0])).toBe(true);
    expect(fitsOver([3, 0], [-40, 0])).toBe(false);
  });

  it('allows what overflows anyway at the smallest size, and nothing more', () => {
    // Tools beside the drawing are 22 px taller than the window on their own.
    expect(fitsOver([22], [22])).toBe(true);
    expect(fitsOver([23], [22])).toBe(false);
    // A sheet whose height only counts past the tools' 450 px keeps that height, not the minimum.
    const page = (px: number) => [Math.max(450, px) - 428];
    expect(fitSize((px) => fitsOver(page(px), page(120)), { ...RANGE, max: 600 })).toBe(450);
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

describe('brakeFit', () => {
  /** Applies each wanted size in turn, `gap` ms apart, as the part's fit would. */
  function run(wanted: number[], gap: number, width = 390) {
    const brake: FitBrake = { changes: [] };
    let had: number | undefined;
    const sizes: number[] = [];
    wanted.forEach((next, i) => {
      had = brakeFit(brake, { width, next, had, now: i * gap });
      sizes.push(had);
    });
    return { brake, sizes };
  }

  it('stops a part that keeps turning between two sizes, at the smaller, slower than settleFit sees', () => {
    // A toolbar sliding in and out every 300 ms: each re-fit starts afresh, so settleFit lets it go.
    const { sizes } = run([421, 380, 421, 380, 421, 380, 421], 300);
    expect(sizes).toEqual([421, 380, 421, 380, 380, 380, 380]);
  });

  it('follows a part that only grows or only shrinks, however often', () => {
    const { sizes } = run([200, 220, 240, 260, 250, 240, 230], FRAME);
    expect(sizes).toEqual([200, 220, 240, 260, 250, 240, 230]);
  });

  it('follows turns spread wider apart than a shake', () => {
    const { sizes } = run([421, 380, 421, 380, 421], FIT_SHAKE_MS / 2 + 1);
    expect(sizes).toEqual([421, 380, 421, 380, 421]);
  });

  it('holds only lower until the width changes, then follows the fit again', () => {
    const { brake, sizes } = run([421, 380, 421, 380, 421], FRAME);
    expect(sizes.at(-1)).toBe(380);
    expect(brakeFit(brake, { width: 390, next: 421, had: 380, now: 1000 })).toBe(380);
    expect(brakeFit(brake, { width: 390, next: 360, had: 380, now: 1100 })).toBe(360);
    expect(brakeFit(brake, { width: 390, next: 421, had: 360, now: 1200 })).toBe(360);
    expect(brakeFit(brake, { width: 844, next: 300, had: 360, now: 1300 })).toBe(300);
    expect(brakeFit(brake, { width: 844, next: 320, had: 300, now: 1400 })).toBe(320);
  });
});
