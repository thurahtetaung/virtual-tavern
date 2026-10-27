import { describe, expect, it } from 'vitest';
import {
  HINTS,
  doneBy,
  emergencyOn,
  endOf,
  faceAt,
  hintFor,
  punchCurve,
  quarter,
  settleMouse,
  settleTouch,
  dragTurn,
  yawFor,
} from './controls.ts';

describe('turning the held bomb', () => {
  it('settles a touch drag on the nearer face, a side past 70°, an edge past 63°', () => {
    expect(settleTouch({ yaw: 40, pitch: 10, settle: 0 })).toEqual({
      yaw: 0,
      pitch: 10,
      settle: 0,
    });
    expect(settleTouch({ yaw: 75, pitch: 0, settle: 0 }).yaw).toBe(90);
    expect(settleTouch({ yaw: 150, pitch: 0, settle: 0 }).yaw).toBe(180);
    expect(settleTouch({ yaw: -80, pitch: 0, settle: 0 }).yaw).toBe(-90);
    expect(settleTouch({ yaw: 0, pitch: 70, settle: 0 }).settle).toBe(80);
    expect(settleTouch({ yaw: 0, pitch: -64, settle: 0 }).settle).toBe(-80);
  });

  it('springs the mouse pitch back level and snaps the yaw to a quarter', () => {
    expect(settleMouse({ yaw: 100, pitch: 40, settle: 80 })).toEqual({
      yaw: 90,
      pitch: 40,
      settle: 0,
    });
  });

  it('limits the tilt to 95° and turns about 240° across the short side', () => {
    const t = dragTurn({ yaw: 0, pitch: 0, settle: 0 }, 390, 2000, 390, 844);
    expect(t.yaw).toBeCloseTo(240);
    expect(t.pitch).toBe(95);
  });

  it('quarter turns step the yaw and the tilt', () => {
    expect(quarter({ yaw: 10, pitch: 0, settle: 0 }, 'right').yaw).toBe(90);
    expect(quarter({ yaw: 0, pitch: 0, settle: 0 }, 'up').settle).toBe(90);
    expect(quarter({ yaw: 0, pitch: 0, settle: 90 }, 'up').settle).toBe(90);
  });

  it('knows which face a yaw shows and the nearest yaw for a face', () => {
    expect(faceAt(0)).toBe(0);
    expect(faceAt(170)).toBe(1);
    expect(faceAt(-190)).toBe(1);
    expect(faceAt(360)).toBe(0);
    expect(yawFor(1, 350)).toBe(180);
    expect(yawFor(0, 350)).toBe(360);
    expect(yawFor(1, -100)).toBe(-180);
  });
});

describe('gestures and feedback', () => {
  it('a short right click backs out, a long or moved one turns', () => {
    expect(endOf(5, 200, 'right')).toBe('back');
    expect(endOf(5, 400, 'right')).toBe('turn');
    expect(endOf(40, 100, 'right')).toBe('turn');
    expect(endOf(10, 100, 'left')).toBe('tap');
    expect(endOf(31, 100, 'left')).toBe('turn');
  });

  it("the punch follows LeanTween's curve and comes to rest", () => {
    expect(punchCurve(0)).toBe(0);
    expect(punchCurve(0.112586)).toBeCloseTo(0.9976, 3);
    expect(punchCurve(0.3120486)).toBeCloseTo(-0.172, 3);
    expect(punchCurve(1)).toBe(0);
  });

  it('the emergency light is on a second, then off for 2 s shortening to 0.75 s', () => {
    expect(emergencyOn(60_000, 500)).toBe(true);
    expect(emergencyOn(60_000, 2000)).toBe(false);
    expect(emergencyOn(60_000, 3800)).toBe(true);
    expect(emergencyOn(0, 1500)).toBe(false);
    expect(emergencyOn(0, 1800)).toBe(true);
  });
});

describe('hints', () => {
  it('shows one line per pose, worded per device, until its step is done', () => {
    expect(HINTS.touch.desk).toMatch(/^Tap/);
    expect(HINTS.mouse.desk).toMatch(/^Click/);
    const done = new Set(doneBy('picked'));
    expect(hintFor('desk', done)).toBe(null);
    expect(hintFor('held', done)).toBe('held');
    for (const s of doneBy('turned')) done.add(s);
    expect(hintFor('held', done)).toBe(null);
    expect(hintFor('module', done)).toBe('module');
  });
});
