import { describe, expect, it } from 'vitest';
import { FIT_SLACK_PX, fitSize } from './fit-size.ts';

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

/** The fit and the area answering each other's resizes, frame after frame, as the observers do. */
function frames(n: number, keep: boolean) {
  const { fits, area } = phone();
  const sizes: number[] = [];
  let px: number | undefined;
  for (let i = 0; i < n; i++) {
    px = fitSize(fits, { min: 120, max: 360, step: 1, current: keep ? px : undefined });
    sizes.push(px);
    area(px);
  }
  return sizes;
}

describe('fitSize', () => {
  it('finds the largest size that fits, to the step', () => {
    expect(fitSize((px) => px <= 250, { min: 120, max: 360, step: 1 })).toBe(250);
    expect(fitSize((px) => px <= 250, { min: 120, max: 360, step: 4 })).toBeGreaterThan(246);
    expect(fitSize(() => true, { min: 120, max: 360, step: 1 })).toBe(360);
    expect(fitSize(() => false, { min: 120, max: 360, step: 1 })).toBe(120);
  });

  it('shook against a FitArea when every re-fit started afresh', () => {
    expect(new Set(frames(20, false).slice(-10))).toEqual(new Set([211, 212]));
  });

  it('comes to rest against a FitArea, keeping a size that still fits', () => {
    const sizes = frames(20, true);
    expect(sizes.slice(0, 2)).toEqual([212, 211]);
    expect(new Set(sizes.slice(2))).toEqual(new Set([211]));
  });

  it('still grows when there is real room, and shrinks when the size no longer fits', () => {
    const grow = 250 + FIT_SLACK_PX + 1;
    expect(fitSize((px) => px <= grow, { min: 120, max: 360, step: 1, current: 250 })).toBe(grow);
    expect(fitSize((px) => px <= 240, { min: 120, max: 360, step: 1, current: 250 })).toBe(240);
    expect(fitSize((px) => px <= 360, { min: 120, max: 360, step: 1, current: 359 })).toBe(359);
  });
});
