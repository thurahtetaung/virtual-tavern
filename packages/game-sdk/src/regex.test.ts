import { describe, expect, it } from 'vitest';
import { escapeRegExp } from './regex.ts';

describe('escapeRegExp', () => {
  it('matches every special character literally', () => {
    const s = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o/p';
    expect(new RegExp(`^${escapeRegExp(s)}$`).test(s)).toBe(true);
    expect(new RegExp(`^${escapeRegExp('a.b')}$`).test('axb')).toBe(false);
  });

  it('works with the unicode flags', () => {
    const s = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o/p';
    expect(new RegExp(`^${escapeRegExp(s)}$`, 'u').test(s)).toBe(true);
    expect(new RegExp(`^${escapeRegExp(s)}$`, 'v').test(s)).toBe(true);
  });
});
