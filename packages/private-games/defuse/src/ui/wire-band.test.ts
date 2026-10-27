import { describe, expect, it } from 'vitest';
import { BAND_HALF, type Band, bandOf, inBand, shows, wireAt } from './wire-band.ts';

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

/** Every pixel of panel wire `i` the player sees: its render shows there and no later wire's does. */
function visible(masks: Uint8Array[], i: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      if (masks[i]![k]! >= 96 && !masks.slice(i + 1).some((m) => m[k]! >= 96))
        out.push([(x + 0.5) / W, (y + 0.5) / H]);
    }
  return out;
}

describe('Wire Sequence hit areas', () => {
  it('give every tap on a wire the player sees to that wire, on all 27 panels', () => {
    // Every panel the module can show: three wires, each from its own row to any letter, drawn in
    // row order (the later on top where they cross).
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        for (let c = 0; c < 3; c++) {
          const masks = [wire(0, a), wire(1, b), wire(2, c)];
          const bands = masks.map((m) => bandOf(m, W, H)!);
          masks.forEach((_, i) => {
            const seen = visible(masks, i);
            expect(seen.length, `panel ${a}${b}${c}, wire ${i + 1}`).toBeGreaterThan(50);
            const wrong = seen.filter(([x, y]) => wireAt(bands, x, y) !== i);
            expect(wrong, `panel ${a}${b}${c}, wire ${i + 1}`).toEqual([]);
          });
        }
  });

  it('gives a crossing to the wire on top and a near miss to the nearest wire', () => {
    // The live check's case: a straight wire 2 under a diagonal wire 3 crossing its midpoint.
    const masks = [wire(0, 0), wire(1, 1), wire(2, 0)];
    const bands = masks.map((m) => bandOf(m, W, H)!);
    const [straight, diagonal] = [bands[1]!, bands[2]!];
    const k = straight.line.findIndex(([x, y]) => shows(diagonal, x, y));
    expect(k).toBeGreaterThan(0);
    // On the crossing itself, wire 3 is drawn on top.
    expect(wireAt(bands, ...straight.line[k]!)).toBe(2);
    // Just along wire 2 from it, inside wire 3's band but on wire 2's own pixels: wire 2.
    const [x, y] = straight.line.find(
      ([lx, ly]) =>
        lx < straight.line[k]![0] && inBand(diagonal, lx, ly) && !shows(diagonal, lx, ly),
    )!;
    expect(wireAt(bands, x, y)).toBe(1);
    // Between the wires, off both: the nearer centre line.
    expect(wireAt(bands, x, y + 0.004)).toBe(1);
    // Nowhere near a wire: nobody.
    expect(wireAt(bands, 0.05, 0.05)).toBeNull();
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
