import { describe, expect, it } from 'vitest';
import {
  GLANCE_MAX_DEG,
  cursorTarget,
  dragGlances,
  dragTarget,
  edgeArrows,
  glanceAxis,
  glanceDegrees,
  onEdge,
} from './glance.ts';

describe('looking around', () => {
  it('turns at most 45° each way', () => {
    expect(GLANCE_MAX_DEG).toBe(45);
    expect(glanceDegrees(1, -1)).toEqual({ yaw: 45, pitch: -45 });
    expect(cursorTarget(-50, 2000, 1000, 500)).toEqual([-1, 1]);
    expect(dragTarget(5000, -5000, 800, 400)).toEqual([1, -1]);
    expect(glanceAxis(0.9, 7, 1)).toBe(1);
  });

  it('eases as `CameraGlance.CalculateAxis`: speed 5 a second, snapping at the end', () => {
    // One 60 fps frame moves 5/60 of the way.
    expect(glanceAxis(0, 1, 1 / 60)).toBeCloseTo(5 / 60, 6);
    let v = 0;
    for (let i = 0; i < 30; i++) v = glanceAxis(v, 1, 1 / 60);
    expect(v).toBeGreaterThan(0.9);
    expect(v).toBeLessThan(1);
    // Back to the middle once let go, exactly there in the end.
    for (let i = 0; i < 600; i++) v = glanceAxis(v, 0, 1 / 60);
    expect(v).toBe(0);
  });

  it('starts on the edge; the arrows show at half strength in the band beside it', () => {
    const [w, h] = [1000, 500]; // the edge is 3.8 % of the height: 19 px, the band 47.5 px
    expect(onEdge(10, 250, w, h)).toBe(true);
    expect(onEdge(30, 250, w, h)).toBe(false);
    expect(onEdge(500, 495, w, h)).toBe(true);
    expect(edgeArrows(10, 250, w, h)).toEqual({ left: 1, right: 0, top: 0, bottom: 0 });
    expect(edgeArrows(30, 250, w, h)).toEqual({ left: 0.5, right: 0, top: 0, bottom: 0 });
    expect(edgeArrows(500, 250, w, h)).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(edgeArrows(990, 5, w, h)).toEqual({ left: 0, right: 1, top: 1, bottom: 0 });
  });

  it('on touch only a drag that starts off the bomb looks around, and only at the desk', () => {
    expect(dragGlances(false, 'desk')).toBe(true);
    expect(dragGlances(true, 'desk')).toBe(false);
    expect(dragGlances(false, 'held')).toBe(false);
    expect(dragGlances(false, 'module')).toBe(false);
    expect(dragGlances(false, 'clock')).toBe(false);
  });
});
