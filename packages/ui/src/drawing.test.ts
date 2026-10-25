import { DEFAULT_DRAWING_LIMITS, decodeDrawing } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { packDrawing, strokePath } from './drawing.tsx';

describe('strokePath', () => {
  it('draws a dot, a line and a smoothed curve', () => {
    expect(strokePath([])).toBe('');
    expect(strokePath([10, 20])).toBe('M10 20l0 0');
    expect(strokePath([10, 20, 30, 40])).toBe('M10 20L30 40');
    expect(strokePath([0, 0, 10, 10, 20, 0])).toBe('M0 0Q10 10 15 5L20 0');
  });
});

describe('packDrawing', () => {
  const wiggle = (n: number, k = 0) =>
    Array.from({ length: n }, (_, i) => [10 + ((i * 7) % 780), 10 + ((i * 13 + k) % 980)]).flat();

  it('packs an ordinary drawing as is', () => {
    const d = packDrawing([{ c: 1, w: 0, points: [10, 10, 400, 500] }]);
    expect(d && decodeDrawing(d)).toEqual([{ c: 1, w: 0, points: [10, 10, 400, 500] }]);
  });

  it('simplifies harder until a long scribble fits, rather than refusing it', () => {
    const strokes = Array.from({ length: 6 }, (_, k) => ({ c: 0, w: 1, points: wiggle(600, k) }));
    const limits = { ...DEFAULT_DRAWING_LIMITS, points: 3000, bytes: 30_000 };
    expect(packDrawing(strokes, limits)).not.toBeNull();
  });

  it('gives up on nothing and on too many lines', () => {
    expect(packDrawing([])).toBeNull();
    const many = Array.from({ length: 5 }, () => ({ c: 0, w: 0, points: [1, 1] }));
    expect(packDrawing(many, { ...DEFAULT_DRAWING_LIMITS, strokes: 4 })).toBeNull();
  });
});
