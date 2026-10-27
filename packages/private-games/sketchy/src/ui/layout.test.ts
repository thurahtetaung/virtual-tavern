import { describe, expect, it } from 'vitest';
import {
  CAPTION_W,
  NAME_W,
  PAPER_W,
  REVEAL_POSE,
  ROWS_BOTTOM,
  ROWS_TOP,
  SUBTITLE_TOP,
  captionSize,
  choiceCentre,
  drawRows,
  pencilAt,
} from './layout.ts';

// The original's row places (made-up numbers in the same shape: the real ones are private).
const row = (y: number) => [2.147, 0, 0, 2.147, -20, y];
const PLACES = {
  'drawIn.at': [1, 0, 0, 1, 4.8, -6.4],
  ...Object.fromEntries(
    [3, 4, 5, 6, 7, 8].map((n) => [
      `drawIn.Players${n}`,
      Array.from({ length: 8 }, (_, i) => row(80 + ((i * 7) % 8) * 85)),
    ]),
  ),
  'choices.at': [1, 0, 0, 1, 39, 194],
  'choices.ThreeChoices': [[0.007, 0, 0, 0.02, 431, -37]],
};

describe('drawing time on the table screen', () => {
  for (const places of [PLACES, undefined]) {
    for (let n = 3; n <= 8; n++) {
      it(`keeps ${n} pencils and their names on the paper (${places ? 'rig' : 'no rig'})`, () => {
        const rows = drawRows(places, n);
        expect(rows).toHaveLength(n);
        for (const r of rows) {
          expect(r.y).toBeGreaterThanOrEqual(ROWS_TOP);
          expect(r.y).toBeLessThanOrEqual(ROWS_BOTTOM);
          for (const share of [0, 0.25, 0.5, 0.75, 1]) {
            const p = pencilAt(r, share);
            expect(p.left).toBeGreaterThanOrEqual(0);
            expect(p.right).toBeLessThanOrEqual(PAPER_W);
            // The name rides over the pencil, all of it on the paper.
            expect(p.mid - NAME_W / 2).toBeGreaterThanOrEqual(0);
            expect(p.mid + NAME_W / 2).toBeLessThanOrEqual(PAPER_W);
            expect(p.mid).toBeGreaterThan(p.left - NAME_W / 2);
            expect(p.mid).toBeLessThan(p.right + NAME_W / 2);
            expect(p.lineFrom).toBeLessThanOrEqual(p.lineTo);
            expect(p.lineFrom).toBeGreaterThanOrEqual(0);
            expect(p.lineTo).toBeLessThanOrEqual(PAPER_W);
          }
        }
      });
    }
  }

  it('runs the rows the original’s ways, with distinct heights', () => {
    expect(drawRows(PLACES, 3).map((r) => r.leftward)).toEqual([true, true, true]);
    expect(drawRows(PLACES, 6).map((r) => r.leftward)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    const ys = drawRows(PLACES, 8).map((r) => r.y);
    expect(new Set(ys).size).toBe(8);
  });

  it('starts each pencil at its own end and moves it across', () => {
    const [left] = drawRows(PLACES, 6);
    const right = drawRows(PLACES, 6)[5]!;
    expect(pencilAt(left!, 1).x).toBeLessThan(pencilAt(left!, 0).x);
    expect(pencilAt(right, 1).x).toBeGreaterThan(pencilAt(right, 0).x);
    // Nothing drawn yet at the start.
    expect(pencilAt(left!, 0).lineTo - pencilAt(left!, 0).lineFrom).toBe(0);
  });
});

describe('the reveal on the table screen', () => {
  it('keeps the drawing clear of the subtitle band', () => {
    const [k, , , , , y] = REVEAL_POSE.slice(7, -1).split(',').map(Number);
    expect(y! + 320 * k!).toBeLessThan(SUBTITLE_TOP);
  });

  it('turns answers over at the original’s centre, above the drawing', () => {
    const [, , , , x, y] = choiceCentre(PLACES);
    expect([x, y]).toEqual([470, 157]);
    expect(choiceCentre(undefined)).toHaveLength(6);
  });
});

describe('the scoreboard on the table screen', () => {
  it('keeps the real title on the paper, smaller as it gets longer', () => {
    // Centred 160 units into the board's caption place, which sits about 30 units in.
    expect(30 + 160 - CAPTION_W / 2).toBeGreaterThanOrEqual(0);
    expect(captionSize('purple elephant')).toBe(30);
    expect(captionSize('tire swinging from the intl space station')).toBeLessThan(30);
    expect(captionSize('x'.repeat(80))).toBeLessThan(captionSize('x'.repeat(40)));
  });
});
