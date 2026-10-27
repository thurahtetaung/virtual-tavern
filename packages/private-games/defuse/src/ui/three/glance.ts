// Looking around the room (pure): the original's camera glance on a computer
// (`MouseControls.HandleViewRotation`, `CameraGlance.CalculateAxis`, `FixedCameraRig.Rotate`), and
// ours on touch, a one-finger drag that starts off the bomb.

/** `FixedCameraRig.MaxRotationDegrees`: the view turns up to 45° each way. */
export const GLANCE_MAX_DEG = 45;
/** `MouseControls.BaseViewRotateSpeed`. */
export const GLANCE_SPEED = 5;
/** `MouseControls.SCREEN_BOUNDARY_PERCENT` of the screen's height is the edge… */
export const EDGE_PERCENT = 0.038;
/** …and 2.5 times that its outer band, where the arrows show at half strength. */
export const EDGE_BAND = 2.5;
/** `CameraGlance.snapThreshold`. */
const SNAP = 0.0001;

const clamp1 = (n: number) => Math.min(1, Math.max(-1, n));

/** `CameraGlance.CalculateAxis`: one frame of easing toward the target (−1…1). */
export function glanceAxis(old: number, target: number, dt: number, speed = GLANCE_SPEED): number {
  const to = clamp1(target);
  const v = clamp1(old + (to - old) * Math.min(1, Math.max(0, speed * dt)));
  return Math.abs(to - v) < SNAP ? to : v;
}

export interface EdgeArrows {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The edge arrows and bars for a cursor (CSS px from the top left): 0, ½ in the band, 1 on the edge. */
export function edgeArrows(x: number, y: number, w: number, h: number): EdgeArrows {
  const e = EDGE_PERCENT * h;
  const band = e * EDGE_BAND;
  const at = (d: number) => (d < e ? 1 : d < band ? 0.5 : 0);
  const a = { left: 0, right: 0, top: 0, bottom: 0 };
  if (x < band) a.left = at(x);
  else if (x > w - band) a.right = at(w - x);
  if (y > h - band) a.bottom = at(h - y);
  else if (y < band) a.top = at(y);
  return a;
}

/** `MouseControls.IsOnEdge`: a press here starts a glance. */
export function onEdge(x: number, y: number, w: number, h: number): boolean {
  const e = EDGE_PERCENT * h;
  return x < e || x > w - e || y < e || y > h - e;
}

/**
 * Where a held glance looks (`HandleViewRotation`): −1…1 across the screen from its middle;
 * right and down are positive.
 */
export function cursorTarget(x: number, y: number, w: number, h: number): [number, number] {
  return [clamp1((x - w / 2) / (w / 2)), clamp1((y - h / 2) / (h / 2))];
}

/** Ours on touch: the finger's way from where it went down, half the screen for the whole turn. */
export function dragTarget(dx: number, dy: number, w: number, h: number): [number, number] {
  return [clamp1(dx / (w / 2)), clamp1(dy / (h / 2))];
}

/**
 * Whether a one-finger touch drag looks around: only one that starts off the bomb (and off the
 * briefcase and the clock), while everything is on the desk. Held or zoomed in, a drag turns the
 * bomb instead (a computer's edge glance still works there).
 */
export function dragGlances(startedOnSomething: boolean, pose: string): boolean {
  return !startedOnSomething && pose === 'desk';
}

/** The camera's turn for a glance, in degrees: right and down are positive. */
export function glanceDegrees(h: number, v: number): { yaw: number; pitch: number } {
  return { yaw: GLANCE_MAX_DEG * h, pitch: GLANCE_MAX_DEG * v };
}
