import { describe, expect, it } from 'vitest';
import { keepUnchanged } from './unchanged.ts';

describe('keepUnchanged', () => {
  it('keeps the parts that did not change', () => {
    const prev = { a: { x: 1 }, b: [{ y: 2 }, { y: 3 }], c: 'z' };
    const next = JSON.parse('{"a":{"x":1},"b":[{"y":2},{"y":4}],"c":"z"}') as typeof prev;
    const out = keepUnchanged(prev, next);
    expect(out).toEqual(next);
    expect(out.a).toBe(prev.a);
    expect(out.b).not.toBe(prev.b);
    expect(out.b[0]).toBe(prev.b[0]);
    expect(out.b[1]).toBe(next.b[1]);
  });

  it('returns the old object when nothing changed', () => {
    const prev = { a: [1, 2], b: null };
    expect(keepUnchanged(prev, JSON.parse(JSON.stringify(prev)) as typeof prev)).toBe(prev);
  });

  it('notices added, removed and retyped fields', () => {
    expect(keepUnchanged({ a: 1 }, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(keepUnchanged({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    expect(keepUnchanged({ a: undefined }, { b: undefined })).toEqual({ b: undefined });
    expect(keepUnchanged([1, 2], { 0: 1, 1: 2 })).toEqual({ 0: 1, 1: 2 });
    expect(keepUnchanged([1, 2], [1])).toEqual([1]);
  });
});
