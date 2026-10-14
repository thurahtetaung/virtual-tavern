import { describe, expect, it } from 'vitest';
import { secondsUntil, shownSeconds } from './countdown.tsx';

describe('countdown clock', () => {
  it('rounds up to whole seconds and stops at zero', () => {
    expect(secondsUntil(120_000, 0)).toBe(120);
    expect(secondsUntil(120_000, 500)).toBe(120);
    expect(secondsUntil(120_000, 121_000)).toBe(0);
  });

  it('never climbs back up for the same deadline', () => {
    // A 2:00 timer showed 2:00, then a laggier snapshot moved the offset back by 3 s.
    let shown = { deadline: 120_000, left: secondsUntil(120_000, 200) };
    expect(shown.left).toBe(120);
    const later = secondsUntil(120_000, 1_000 - 3_000);
    expect(later).toBe(122);
    shown = { deadline: 120_000, left: shownSeconds(shown, 120_000, later) };
    expect(shown.left).toBe(120);
    expect(shownSeconds(shown, 120_000, 117)).toBe(117);
  });

  it('starts over with a new deadline', () => {
    expect(shownSeconds({ deadline: 120_000, left: 5 }, 300_000, 180)).toBe(180);
    expect(shownSeconds(null, 300_000, 180)).toBe(180);
  });
});
