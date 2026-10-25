import { describe, expect, it } from 'vitest';
import { fitBoard } from './fit.ts';

describe('fitBoard', () => {
  it('keeps the whole board within the room it is given', () => {
    for (const [w, h] of [
      [860, 540],
      [880, 640],
      [700, 900],
      [1200, 400],
    ] as const) {
      const f = fitBoard(w, h);
      const height = 20 + f.rows * f.tile + (f.rows - 1) * 8;
      const width =
        (4 * f.cols + f.colourCols) * f.tile + 48 + (4 * (f.cols - 1) + f.colourCols - 1) * 6;
      expect(height, `${w}×${h}`).toBeLessThanOrEqual(h);
      expect(width, `${w}×${h}`).toBeLessThanOrEqual(w);
      // Every colour fits in the rows the other groups use.
      expect(f.rows * f.colourCols).toBeGreaterThanOrEqual(12);
      expect(f.rows * f.cols).toBeGreaterThanOrEqual(28);
    }
  });

  it('picks more tiles across when the room is wide and short', () => {
    expect(fitBoard(1200, 400).cols).toBeGreaterThan(fitBoard(600, 1000).cols);
  });
});
