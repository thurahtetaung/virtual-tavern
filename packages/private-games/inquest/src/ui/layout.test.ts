import { describe, expect, it } from 'vitest';
import { LOCATION_TILES } from '../logic/content.ts';
import type { Bullet } from '../logic/types.ts';
import { contentFor } from './assets.ts';
import { bulletNumbers } from './bullets.ts';
import { bulletLine, locationLabel } from './Scene.tsx';
import { fitSuspects } from './TableScreen.tsx';

const b = (seq: number, slot: number, item: number, movedFrom?: number): Bullet => ({
  seq,
  slot,
  tile: 10 + slot,
  item,
  round: 1,
  at: seq * 1000,
  gapMs: 1000,
  ...(movedFrom === undefined ? {} : { movedFrom }),
});

describe('bulletNumbers', () => {
  it('a moved bullet keeps its number, and the next placed bullet carries on', () => {
    const bullets = [b(1, 0, 0), b(2, 1, 3), b(3, 2, 1), b(4, 1, 5, 3), b(5, 3, 2)];
    const nos = bulletNumbers(bullets);
    expect([...nos.values()].map((n) => n.no)).toEqual([1, 2, 3, 2, 4]);
    expect(nos.get(2)).toEqual({ no: 2, moved: false, movedLater: true });
    expect(nos.get(4)).toEqual({ no: 2, moved: true, movedLater: false });
  });

  it('the end timeline reads well, in order only (no timings)', () => {
    const content = contentFor(null);
    const bullets = [b(1, 0, 0), b(2, 0, 4, 0)];
    const nos = bulletNumbers(bullets);
    expect(bulletLine(bullets[0]!, content, nos.get(1)!)).toBe(
      '1st · Tile 10: Tile 10 · item 1 (moved later)',
    );
    expect(bulletLine(bullets[1]!, content, nos.get(2)!)).toBe(
      '1st moved · Tile 10: Tile 10 · item 1 → Tile 10 · item 5',
    );
  });
});

describe('the Location picker', () => {
  it('letters the look-alike Location tiles so each tile and its confirm differ', () => {
    const labels = LOCATION_TILES.map(locationLabel);
    expect(labels).toEqual(['Location A', 'Location B', 'Location C', 'Location D']);
    expect(new Set(labels).size).toBe(LOCATION_TILES.length);
  });
});

describe('fitSuspects (the table screen)', () => {
  it('fits every hand on a 1080p screen, as big as it can', () => {
    for (const n of [3, 5, 6, 8, 11]) {
      const fit = fitSuspects(1250, 960, n, 8);
      const rows = Math.ceil(n / fit.cols);
      const handRows = 8 / fit.perRow;
      const hand = (handRows * fit.card * 510) / 315 + (handRows - 1) * 6;
      const height = rows * (hand + 16 + 30) + (rows - 1) * 12;
      const width =
        fit.cols * (fit.perRow * fit.card + (fit.perRow - 1) * 6 + 16) + (fit.cols - 1) * 12;
      expect(height, `${n} suspects`).toBeLessThanOrEqual(960 + 1);
      expect(width, `${n} suspects`).toBeLessThanOrEqual(1250 + 1);
      expect(fit.card, `${n} suspects`).toBeGreaterThan(50);
    }
  });
});

describe('art URLs', () => {
  it('carry the art version, so re-cut art reaches browsers that cached the old files', () => {
    expect(contentFor({}).cardArt('clue', 12)).toBe(
      '/api/backroom/assets/inquest/clue/12.webp?v=2',
    );
    expect(contentFor({ artVersion: 3, roleBack: 'roles/back.webp' }).roleBack).toBe(
      '/api/backroom/assets/inquest/roles/back.webp?v=3',
    );
    expect(contentFor(null).cardArt('clue', 12)).toBeNull();
  });
});
