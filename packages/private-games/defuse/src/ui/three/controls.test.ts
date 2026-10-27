import { describe, expect, it } from 'vitest';
import {
  BOMB_MAX_ZOOM,
  HINTS,
  MODULE_MAX_ZOOM,
  anchorPan,
  clampPan,
  pinchRange,
  pinchZoom,
  zoomLimit,
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
    // The top edge settles at 80°, the bottom at 70° (the original's settle angles).
    expect(settleTouch({ yaw: 0, pitch: 70, settle: 0 }).settle).toBe(80);
    expect(settleTouch({ yaw: 0, pitch: -64, settle: 0 }).settle).toBe(-70);
    expect(settleTouch({ yaw: 180, pitch: -64, settle: 0 }).settle).toBe(-70);
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
    // ▴ rolls the bomb up: the bottom edge (negative pitch); ▾ the top.
    expect(quarter({ yaw: 0, pitch: 0, settle: 0 }, 'up').settle).toBe(-90);
    expect(quarter({ yaw: 0, pitch: 0, settle: -90 }, 'up').settle).toBe(-90);
    expect(quarter({ yaw: 0, pitch: 0, settle: 0 }, 'down').settle).toBe(90);
    expect(quarter({ yaw: 180, pitch: 0, settle: 0 }, 'up').settle).toBe(-90);
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

describe('zoom', () => {
  it('reaches at least the original MaxZoom, and on to 0.1 m from the surface looked at', () => {
    // The held bomb's front, 0.555 m away: on to 0.1 m from it.
    expect(zoomLimit('held', 0.555)).toBeCloseTo(0.455);
    // An edge already close: never less than the original's 0.15 m.
    expect(zoomLimit('held', 0.2)).toBe(BOMB_MAX_ZOOM);
    expect(zoomLimit('module', 0.35)).toBe(MODULE_MAX_ZOOM);
    expect(zoomLimit('module', 0.5)).toBeCloseTo(0.4);
    expect(zoomLimit('desk', 1)).toBe(0);
    // Upright the camera stands back by the fit: the limit is in the same units.
    expect(zoomLimit('held', 0.555 * 2, 2)).toBeCloseTo(0.455);
  });

  it('lets a held pinch overshoot a little, never into the bomb', () => {
    const [lo, hi] = pinchRange(0.455, 0.555);
    expect(lo).toBeCloseTo(-0.091);
    expect(hi).toBeCloseTo(0.495);
    // Close to an edge the overshoot stops 6 cm from it.
    expect(pinchRange(0.15, 0.2)[1]).toBeCloseTo(0.15);
    expect(pinchZoom(0, 4000, 0.455, [lo, hi])).toBe(hi);
    expect(pinchZoom(0.2, -4000, 0.455, [lo, hi])).toBe(lo);
    expect(pinchZoom(0, 200, 0.455, [lo, hi])).toBeCloseTo(0.2275);
  });

  it('keeps the aimed point under the fingers', () => {
    const p = anchorPan({ x: 0.1, y: -0.05 }, { x: 0.5, y: -0.5 }, 0.2, 60, 2);
    const t = Math.tan(Math.PI / 6) * 0.2;
    // Projected back: the point lands on the same screen spot.
    expect((0.1 - p.x) / (t * 2)).toBeCloseTo(0.5);
    expect((-0.05 - p.y) / t).toBeCloseTo(-0.5);
  });

  it('pans only as far as the zoom allows, and recentres at no zoom', () => {
    const box = { minX: -0.3, maxX: 0.3, minY: -0.1, maxY: 0.1 };
    expect(clampPan({ x: 1, y: 1 }, box, 0.4, 0.4)).toEqual({ x: 0.3, y: 0.1 });
    expect(clampPan({ x: 1, y: -1 }, box, 0.2, 0.4)).toEqual({ x: 0.15, y: -0.05 });
    expect(clampPan({ x: 1, y: 1 }, box, 0, 0.4)).toEqual({ x: 0, y: 0 });
    // A box off to one side: still home at no zoom, its far edge at the limit.
    const side = { minX: 0.05, maxX: 0.25, minY: -0.1, maxY: 0.1 };
    expect(clampPan({ x: 0.03, y: 0 }, side, 0, 0.4)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: 1, y: 0 }, side, 0.4, 0.4)).toEqual({ x: 0.25, y: 0 });
  });
});
