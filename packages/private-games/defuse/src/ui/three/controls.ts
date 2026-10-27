// The held bomb's controls as plain numbers, from the original's input code: pick-up and focus
// timings (`FloatingHoldable`), turning and settling (`MouseRotation`, `TouchRotation`), the
// interaction punch (`AddInteractionPunch` on LeanTween's punch curve), the tap/drag/back
// thresholds (`MouseControls`, `TouchControls`), the idle light sweep (`InteractionHint`) and
// the one-line hints. Pure, so it is tested without a renderer.

/** `FloatingHoldable.PickupTime` / `ReturnToPositionTime` / `FocusTime`, seconds. */
export const PICKUP_S = 0.3;
export const PUTDOWN_S = 0.3;
export const FOCUS_S = 0.2;
/** `FloatingHoldable.FocusDistance`: the held bomb sits 0.63 m from the eye. */
export const HOLD_DISTANCE = 0.63;
/** `MouseRotation.TiltLimitDegrees`. */
export const TILT_LIMIT = 95;
/** A drag turns the bomb once it has moved this far (px). */
export const DRAG_PX = 30;
/** A short right click (< 0.3 s, < 30 px) backs out. */
export const BACK_CLICK_MS = 300;
/** A two-finger tap backs out if the fingers lift this soon without pinching. */
export const TWO_FINGER_TAP_MS = 450;
/** `InteractionHint`: the idle sweep after 10 s untouched, lasting 1.5 s. */
export const IDLE_MS = 10_000;
export const SWEEP_MS = 1500;
/** The interaction punch: 5° times the part's modifier, 0.75 s. */
export const PUNCH_DEG = 5;
export const PUNCH_MS = 750;
/** Wires and other thin parts are picked within this many px on screen. */
export const NEAR_PX = 22;

export const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

/** LeanTween's punch curve (key, value) pairs, eased between keys. */
const PUNCH = [
  [0, 0],
  [0.112586, 0.9976035],
  [0.3120486, -0.1720615],
  [0.4316337, 0.07030682],
  [0.5524869, -0.03141804],
  [0.6549395, 0.003909959],
  [0.770987, -0.009817753],
  [0.8838775, 0.001939224],
  [1, 0],
] as const;

export function punchCurve(x: number): number {
  if (x <= 0 || x >= 1) return 0;
  for (let i = 1; i < PUNCH.length; i++)
    if (x <= PUNCH[i]![0]) {
      const [a, va] = PUNCH[i - 1]!;
      const [b, vb] = PUNCH[i]!;
      const t = (x - a) / (b - a);
      return va + (vb - va) * (0.5 - Math.cos(Math.PI * t) / 2);
    }
  return 0;
}

/** Degrees of turn per px of drag: a drag across the short side of the screen is about 240°. */
export const turnPerPx = (w: number, h: number) => 240 / Math.max(1, Math.min(w, h));

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The turn the player has asked for: yaw is free, pitch to the tilt limit. */
export interface Turn {
  yaw: number;
  pitch: number;
  /** Where the pitch springs back to when nothing holds it. */
  settle: number;
}

export function dragTurn(t: Turn, dx: number, dy: number, w: number, h: number): Turn {
  const k = turnPerPx(w, h);
  return { ...t, yaw: t.yaw + dx * k, pitch: clamp(t.pitch + dy * k, -TILT_LIMIT, TILT_LIMIT) };
}

/**
 * `TouchRotation.SettleTouchRotation`: yaw to the nearer face, or a side when more than 70° off;
 * pitch level under 63°, else 80° up or down (the top or bottom edge).
 */
export function settleTouch(t: Turn): Turn {
  const n = Math.round(t.yaw / 180) * 180;
  const f = t.yaw - n;
  const yaw = n + (Math.abs(f) < 70 ? 0 : 90 * Math.sign(f));
  const settle = Math.abs(t.pitch) < 63 ? 0 : 80 * Math.sign(t.pitch);
  return { yaw, pitch: t.pitch, settle };
}

/** `MouseRotation.SettleMouseRotation`: the pitch springs back level, the yaw snaps to the nearer face. */
export function settleMouse(t: Turn): Turn {
  return { yaw: Math.round(t.yaw / 90) * 90, pitch: t.pitch, settle: 0 };
}

/** A quarter turn from the rotate arrows or the keys; pitch steps between level and the edges. */
export function quarter(t: Turn, dir: 'up' | 'down' | 'left' | 'right'): Turn {
  if (dir === 'left') return { ...t, yaw: Math.round(t.yaw / 90) * 90 - 90 };
  if (dir === 'right') return { ...t, yaw: Math.round(t.yaw / 90) * 90 + 90 };
  const settle = clamp(t.settle + (dir === 'up' ? 90 : -90), -90, 90);
  return { ...t, settle };
}

/** Which face (0 front, 1 rear) a yaw shows most of. */
export const faceAt = (yaw: number): 0 | 1 => (((Math.round(yaw / 180) % 2) + 2) % 2 === 1 ? 1 : 0);

/** The yaw nearest `from` that shows `face` square on. */
export function yawFor(face: 0 | 1, from: number): number {
  const base = face === 0 ? 0 : 180;
  return base + Math.round((from - base) / 360) * 360;
}

export type Gesture = 'tap' | 'turn' | 'back' | 'none';

/** What a one-finger or left-button press became when it ended. */
export function endOf(moved: number, ms: number, button: 'left' | 'right'): Gesture {
  if (button === 'right') return moved < DRAG_PX && ms < BACK_CLICK_MS ? 'back' : 'turn';
  return moved > DRAG_PX ? 'turn' : 'tap';
}

// ---- Hints ----

export type Device = 'touch' | 'mouse';
export type HintStep = 'desk' | 'held' | 'module';

/** One line of yellow text at a time, as the original's controls tutorial, worded per device. */
export const HINTS: Record<Device, Record<HintStep, string>> = {
  touch: {
    desk: 'Tap the bomb to pick it up.',
    held: 'Drag to turn it, pinch to zoom, tap a module.',
    module: 'Tap a part to use it. ‹ steps back.',
  },
  mouse: {
    desk: 'Click the bomb to pick it up.',
    held: 'Right-drag to turn it, the wheel zooms, click a module.',
    module: 'Click a part to use it. Right-click or Esc steps back.',
  },
};

/** What the player has done, for the hints. */
export type HintEvent = 'picked' | 'turned' | 'zoomed' | 'module' | 'acted';

/** Each hint's line goes for good once its step is done. */
export const HINT_DONE: Record<HintStep, HintEvent[]> = {
  desk: ['picked'],
  held: ['turned', 'zoomed', 'module'],
  module: ['acted'],
};

/** The hint to show in a pose, given the steps already done (none once all are). */
export function hintFor(
  pose: 'desk' | 'held' | 'module',
  done: ReadonlySet<HintStep>,
): HintStep | null {
  const step: HintStep = pose;
  return done.has(step) ? null : step;
}

/** The steps an event completes. */
export const doneBy = (e: HintEvent): HintStep[] =>
  (Object.keys(HINT_DONE) as HintStep[]).filter((s) => HINT_DONE[s].includes(e));

/** `EmergencyLight`: on for 1 s, then off for 2 s shortening to 0.75 s as the last minute runs out. */
export function emergencyOn(leftMs: number, t: number): boolean {
  const period = 1 + 0.75 + (2 - 0.75) * clamp(leftMs / 60_000, 0, 1);
  return (t / 1000) % period < 1;
}
