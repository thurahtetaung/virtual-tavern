import { describe, expect, it } from 'vitest';
import { createRng } from './rng.ts';

describe('createRng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(
      Array.from({ length: 5 }, () => b.next()),
    );
  });

  it('produces values in range', () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const n = rng.int(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
    }
  });

  it('shuffles without losing or mutating items', () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = createRng(7).shuffle(input);
    expect([...out].sort()).toEqual([...input]);
    expect(out).not.toEqual(input);
  });
});
