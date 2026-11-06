import { describe, expect, it } from 'vitest';
import { clone } from './clone.ts';

describe('clone', () => {
  it('copies nested objects and arrays deeply, as structuredClone does', () => {
    const value = {
      a: 1,
      b: 'x',
      c: null,
      d: [1, { e: [true, false] }],
      f: { g: { h: [] } },
      u: undefined,
    };
    const copy = clone(value);
    expect(copy).toStrictEqual(structuredClone(value));
    expect('u' in copy).toBe(true);
    copy.d.push(2);
    (copy.d[1] as { e: boolean[] }).e[0] = false;
    copy.f.g.h = [];
    expect(value).toStrictEqual({
      a: 1,
      b: 'x',
      c: null,
      d: [1, { e: [true, false] }],
      f: { g: { h: [] } },
      u: undefined,
    });
  });

  it('copies primitives as they are', () => {
    expect(clone(3)).toBe(3);
    expect(clone('s')).toBe('s');
    expect(clone(null)).toBeNull();
    expect(clone(undefined)).toBeUndefined();
  });

  it('keeps a `__proto__` key as a plain key, never as the prototype', () => {
    const value = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as Record<
      string,
      unknown
    >;
    const copy = clone(value);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(Object.keys(copy)).toEqual(['__proto__', 'a']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(copy)).toBe(JSON.stringify(value));
  });
});
