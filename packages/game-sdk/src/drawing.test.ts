import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRAWING_LIMITS,
  DRAW_H,
  DRAW_W,
  decodeDrawing,
  decodePoints,
  drawingPoints,
  encodeDrawing,
  encodePoints,
  simplifyPoints,
  validateDrawing,
} from './drawing.ts';

describe('simplifyPoints', () => {
  it('drops points on a straight line and keeps the ends', () => {
    const line = [0, 0, 10, 10, 20, 20, 30, 30, 40, 40];
    expect(simplifyPoints(line)).toEqual([0, 0, 40, 40]);
  });

  it('keeps corners', () => {
    const corner = [0, 0, 50, 0, 100, 0, 100, 50, 100, 100];
    expect(simplifyPoints(corner)).toEqual([0, 0, 100, 0, 100, 100]);
  });

  it('keeps a wobble bigger than the tolerance and drops a smaller one', () => {
    expect(simplifyPoints([0, 0, 50, 2, 100, 0], 2.5)).toEqual([0, 0, 100, 0]);
    expect(simplifyPoints([0, 0, 50, 10, 100, 0], 2.5)).toEqual([0, 0, 50, 10, 100, 0]);
  });

  it('leaves dots and two-point strokes alone, and ignores a dangling coordinate', () => {
    expect(simplifyPoints([5, 5])).toEqual([5, 5]);
    expect(simplifyPoints([5, 5, 9, 9])).toEqual([5, 5, 9, 9]);
    expect(simplifyPoints([5, 5, 9])).toEqual([5, 5]);
  });
});

describe('encodePoints / decodePoints', () => {
  it('round-trips points on the grid', () => {
    const pts = [0, 0, 800, 1000, 400, 500, 402, 498, 2, 1000];
    expect(decodePoints(encodePoints(pts))).toEqual(pts);
  });

  it('snaps to the grid and clamps to the page', () => {
    expect(decodePoints(encodePoints([3.4, 7.9, -50, 2000, 900, -1]))).toEqual([
      4, 8, 0, 1000, 800, 0,
    ]);
  });

  it('is compact for small steps', () => {
    const pts: number[] = [];
    for (let i = 0; i < 100; i++) pts.push(100 + i * 4, 100 + i * 2);
    // Two characters per point for steps under 16 grid units, after the first.
    expect(encodePoints(pts).length).toBeLessThanOrEqual(4 + 99 * 2);
  });

  it('refuses strings that are not strokes', () => {
    expect(decodePoints('')).toBeNull();
    expect(decodePoints('A')).toBeNull(); // one number: half a point
    expect(decodePoints('g')).toBeNull(); // a "more follows" with nothing after
    expect(decodePoints('A A')).toBeNull(); // not in the alphabet
    expect(decodePoints('B')).toBeNull();
    // A step off the page.
    expect(decodePoints(encodePoints([0, 0]) + 'BA')).toBeNull();
    expect(decodePoints('______A')).toBeNull(); // an absurdly long number
  });
});

describe('encodeDrawing / decodeDrawing', () => {
  it('simplifies, keeps pens and widths, and drops empty strokes', () => {
    const d = encodeDrawing([
      { c: 1, w: 2, points: [0, 0, 10, 10, 20, 20] },
      { c: 0, w: 0, points: [] },
      { c: 3, w: 1, points: [100, 100] },
    ]);
    expect(d).toHaveLength(2);
    expect(decodeDrawing(d)).toEqual([
      { c: 1, w: 2, points: [0, 0, 20, 20] },
      { c: 3, w: 1, points: [100, 100] },
    ]);
    expect(drawingPoints(decodeDrawing(d))).toBe(3);
  });

  it('skips strokes that fail to decode', () => {
    expect(decodeDrawing([{ c: 0, w: 0, p: '!' }])).toEqual([]);
  });
});

describe('validateDrawing', () => {
  const ok = encodeDrawing([{ c: 0, w: 1, points: [10, 10, 200, 300, 400, 100] }]);

  it('accepts a normal drawing and returns a clean copy', () => {
    const raw = ok.map((s) => ({ ...s, extra: 'x' }));
    const r = validateDrawing(raw);
    expect(r).toEqual({ ok: true, drawing: ok });
  });

  it('refuses an empty drawing', () => {
    expect(validateDrawing([])).toMatchObject({ ok: false, code: 'drawing-empty' });
  });

  it('refuses the wrong shape, bad pens and widths, and undecodable points', () => {
    expect(validateDrawing('nope')).toMatchObject({ ok: false, code: 'drawing-invalid' });
    expect(validateDrawing([{ c: 4, w: 0, p: 'AA' }])).toMatchObject({ ok: false });
    expect(validateDrawing([{ c: 0, w: 3, p: 'AA' }])).toMatchObject({ ok: false });
    expect(validateDrawing([{ c: 0, w: 0, p: 'A' }])).toMatchObject({
      ok: false,
      code: 'drawing-invalid',
    });
  });

  it('refuses drawings over the limits', () => {
    const many = Array.from({ length: 11 }, () => ok[0]!);
    expect(validateDrawing(many, { ...DEFAULT_DRAWING_LIMITS, strokes: 10 })).toMatchObject({
      ok: false,
      code: 'drawing-too-big',
    });
    expect(validateDrawing(ok, { ...DEFAULT_DRAWING_LIMITS, points: 2 })).toMatchObject({
      ok: false,
      code: 'drawing-too-big',
    });
    expect(validateDrawing(ok, { ...DEFAULT_DRAWING_LIMITS, bytes: 3 })).toMatchObject({
      ok: false,
      code: 'drawing-too-big',
    });
  });

  it('fits a busy scribble within the default limits', () => {
    // A zig-zag across the whole page: 40 strokes of 50 points each.
    const strokes = Array.from({ length: 40 }, (_, k) => ({
      c: k % 4,
      w: k % 3,
      points: Array.from({ length: 50 }, (_, i) => [
        (i * 37 + k * 11) % DRAW_W,
        (i * 53 + k * 29) % DRAW_H,
      ]).flat(),
    }));
    const r = validateDrawing(encodeDrawing(strokes));
    expect(r.ok).toBe(true);
  });
});
