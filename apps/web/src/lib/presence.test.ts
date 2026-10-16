import { describe, expect, it } from 'vitest';
import { offlineFor } from './presence.ts';

describe('offlineFor', () => {
  const now = 10 * 60 * 60_000;
  it('says plain "offline" when it is new or unknown', () => {
    expect(offlineFor(undefined, now)).toBe('offline');
    expect(offlineFor(now - 59_000, now)).toBe('offline');
  });

  it('counts minutes, then hours', () => {
    expect(offlineFor(now - 5 * 60_000, now)).toBe('offline 5 min');
    expect(offlineFor(now - 59 * 60_000, now)).toBe('offline 59 min');
    expect(offlineFor(now - 125 * 60_000, now)).toBe('offline 2 h');
  });
});
