import { describe, expect, it } from 'vitest';
import { awayFor } from './presence.ts';

describe('awayFor', () => {
  const now = 10 * 60 * 60_000;
  it('says plain "away" when it is new or unknown', () => {
    expect(awayFor(undefined, now)).toBe('away');
    expect(awayFor(now - 59_000, now)).toBe('away');
  });

  it('counts minutes, then hours', () => {
    expect(awayFor(now - 5 * 60_000, now)).toBe('away 5 min');
    expect(awayFor(now - 59 * 60_000, now)).toBe('away 59 min');
    expect(awayFor(now - 125 * 60_000, now)).toBe('away 2 h');
  });
});
