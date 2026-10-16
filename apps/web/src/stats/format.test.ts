import { beforeAll, describe, expect, it } from 'vitest';
import { bucketLabel, clock, dateOf, localDay, spansDays, zoneName, zoneOffset } from './format.ts';

// 2026-10-11 18:55 UTC is 01:55 the next morning in Bangkok (UTC+7).
const LATE = Date.UTC(2026, 9, 11, 18, 55);

describe('times in the viewer’s time zone', () => {
  beforeAll(() => {
    // The browser's own zone, as the app uses it (no `timeZone` passed).
    process.env.TZ = 'Asia/Bangkok';
  });

  it('shows moments in the browser’s zone by default', () => {
    expect(clock(LATE)).toBe('01:55');
    expect(localDay(LATE)).toBe('2026-10-12');
    expect(dateOf(LATE)).toBe('Oct 12, 2026');
    expect(zoneName(LATE)).toBe('GMT+7');
    expect(zoneOffset(LATE)).toBe(7 * 60);
  });

  it('labels UTC hour buckets with the local time, and the local day once they span days', () => {
    expect(bucketLabel('2026-10-11T14', 'hour')).toBe('21:00');
    expect(bucketLabel('2026-10-11T18', 'hour', true)).toBe('Oct 12 01:00');
    // One UTC day of hours spans two Bangkok days.
    expect(spansDays(['2026-10-11T00', '2026-10-11T23'], 'hour')).toBe(true);
    expect(spansDays(['2026-10-11T00', '2026-10-11T16'], 'hour')).toBe(false);
  });

  it('keeps day buckets as their UTC days', () => {
    expect(bucketLabel('2026-10-11', 'day')).toBe('Oct 11');
    expect(spansDays(['2026-10-11', '2026-10-11'], 'day')).toBe(false);
  });

  it('takes an explicit zone', () => {
    expect(clock(LATE, 'UTC')).toBe('18:55');
    expect(dateOf(LATE, 'UTC')).toBe('Oct 11, 2026');
    expect(zoneName(LATE, 'UTC')).toBe('UTC');
    expect(zoneOffset(LATE, 'UTC')).toBe(0);
    expect(zoneOffset(LATE, 'Asia/Kolkata')).toBe(330);
    expect(zoneOffset(LATE, 'America/Los_Angeles')).toBe(-7 * 60);
  });
});
