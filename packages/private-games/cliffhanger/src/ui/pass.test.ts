import { describe, expect, it } from 'vitest';
import { passTarget } from './pass.ts';

describe('Pass', () => {
  it('moves to the next card not yet got, in square order', () => {
    expect(passTarget(['a', 'b', 'c'], 'a')).toBe('b');
    expect(passTarget(['a', 'b', 'c'], 'b')).toBe('c');
  });

  it('wraps round from the last card to the first', () => {
    expect(passTarget(['a', 'b', 'c'], 'c')).toBe('a');
    expect(passTarget(['b', 'c'], 'c')).toBe('b');
  });

  it('has nowhere to go with one card or none', () => {
    expect(passTarget(['a'], 'a')).toBeNull();
    expect(passTarget([], undefined)).toBeNull();
  });

  it('starts from the first card when none is in focus', () => {
    expect(passTarget(['a', 'b'], undefined)).toBe('a');
  });
});
