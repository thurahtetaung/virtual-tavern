import { describe, expect, it } from 'vitest';
import { BAND_HALF, type Band, bandOf, inBand } from './wire-band.ts';

const W = 160;
const H = 160;
/** Terminal rows (module units), left 1–3 and right A–C, as Wire Sequence's renders place them. */
const ROW = [0.34, 0.5, 0.66];

/** A full-module mask with one wire drawn from left row `from` to right row `to`, slightly bowed. */
function wire(from: number, to: number): Uint8Array {
  const a = new Uint8Array(W * H);
  const [x0, x1] = [0.26, 0.58];
  for (let i = 0; i <= 400; i++) {
    const t = i / 400;
    const x = x0 + (x1 - x0) * t;
    const y = ROW[from]! + (ROW[to]! - ROW[from]!) * t + Math.sin(Math.PI * t) * 0.01;
    for (let dy = -2; dy <= 2; dy++) {
      const px = Math.round(x * W);
      const py = Math.round(y * H) + dy;
      a[py * W + px] = 255;
    }
  }
  return a;
}

/** The share of points along each wire (from 15 % to 85 % of its length) only it would take. */
function reachable(bands: Band[], i: number) {
  const { line } = bands[i]!;
  let mine = 0;
  let n = 0;
  for (let k = Math.floor(line.length * 0.15); k < line.length * 0.85; k++) {
    const [x, y] = line[k]!;
    n++;
    // Later wires are drawn on top, so a point a later band also covers goes to that wire.
    if (inBand(bands[i]!, x, y) && !bands.slice(i + 1).some((b) => inBand(b, x, y))) mine++;
  }
  return mine / n;
}

describe('Wire Sequence hit areas', () => {
  it('follow each wire, so crossing wires stay reachable', () => {
    // Every panel the module can show: three wires, each from its own row to any letter.
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        for (let c = 0; c < 3; c++) {
          const bands = [wire(0, a), wire(1, b), wire(2, c)].map((m) => bandOf(m, W, H)!);
          bands.forEach((_, i) => {
            expect(reachable(bands, i), `panel ${a}${b}${c}, wire ${i + 1}`).toBeGreaterThan(0.5);
          });
        }
  });

  it('takes the wire’s midpoint unless another wire crosses right there', () => {
    // The live check's case: a straight wire under a diagonal one that crosses it.
    const straight = bandOf(wire(1, 1), W, H)!;
    const diagonal = bandOf(wire(0, 2), W, H)!;
    const mid = (b: Band) => b.line[Math.floor(b.line.length / 2)]!;
    expect(inBand(straight, ...mid(straight))).toBe(true);
    expect(inBand(diagonal, ...mid(diagonal))).toBe(true);
    // A point on the straight wire away from the crossing is the straight wire's alone.
    const [x, y] = straight.line[Math.floor(straight.line.length * 0.2)]!;
    expect(inBand(diagonal, x, y)).toBe(false);
    // Before, the diagonal's hit area was its whole box squeezed onto the middle row.
    const [, , , h] = diagonal.box;
    expect(h).toBeGreaterThan(0.3);
  });

  it('is thick enough for a finger and stays in the module', () => {
    const b = bandOf(wire(0, 0), W, H)!;
    expect(b.box[3]).toBeGreaterThanOrEqual(BAND_HALF * 2);
    expect(b.clip.startsWith('polygon(')).toBe(true);
    expect(bandOf(new Uint8Array(W * H), W, H)).toBeNull();
  });
});
