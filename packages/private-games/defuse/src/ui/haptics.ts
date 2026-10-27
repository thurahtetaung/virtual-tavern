// The defuser's vibration, from the original's haptics (`AbstractHapticUtil.HapticType`,
// `GeneralHapticUtil`): every interaction punch vibrates for 0.15 s at 5 × the part's punch
// modifier, clamped to 0…1 (`GamepadControls.AddInteractionPunch`), so a release (−0.35) gives
// none; the explosion is 0.7 s at full strength. The original buzzes highlight changes only on VR
// controllers; ours ticks on touch (below), never for a mouse. A phone can't set a strength, so the strength scales the length.
//
// Only through the Vibration API, where the browser has it (Android browsers; not iOS Safari).
// Strikes and the needy warnings are ours (the original doesn't buzz for them).
import { storageKey } from '@vt/game-sdk';

export type HapticType =
  | 'Interaction'
  | 'ButtonHold'
  | 'ButtonRelease'
  | 'KeypadButton'
  | 'SimonButton'
  | 'WireSnip'
  | 'SpringedSwitch'
  | 'ToggleSwitch'
  | 'Explosion'
  | 'Strike'
  | 'NeedyWarning'
  | 'Selection';

/** `GeneralHapticUtil.GetDuration`: 0.15 s, the explosion 0.7 s. */
export const INTERACTION_MS = 150;
export const EXPLOSION_MS = 700;
/** A strength above 0 is never shorter than this: shorter buzzes go unfelt on many phones. */
export const FLOOR_MS = 30;
/**
 * Ours: a light tick when the touch highlight moves to another module or part, so a finger
 * sliding over the bomb feels each one; never closer together than `SELECTION_GAP_MS`.
 */
export const SELECTION_MS = 22;
export const SELECTION_GAP_MS = 60;

/** What one haptic event vibrates: a length or an on/off pattern (ms); empty is nothing. */
export function hapticPattern(type: HapticType, modifier = 1): number[] {
  if (type === 'Explosion') return [EXPLOSION_MS];
  if (type === 'Strike') return [INTERACTION_MS, 90, INTERACTION_MS];
  if (type === 'NeedyWarning') return [INTERACTION_MS];
  if (type === 'Selection') return [SELECTION_MS];
  // `AddInteractionPunch` passes 5 × the modifier, which `Vibrate` clamps to 0…1.
  const strength = Math.min(1, Math.max(0, 5 * modifier));
  if (strength <= 0) return [];
  return [Math.max(FLOOR_MS, Math.round(INTERACTION_MS * strength))];
}

/** The part's `HapticType`, from what touching it does. */
export function hapticOf(
  sound: string | undefined,
  op: { op: string },
  release = false,
): HapticType {
  if (release) return 'ButtonRelease';
  if (op.op === 'cut') return 'WireSnip';
  if (sound === 'tone') return 'SimonButton';
  if (sound === 'bb-press-in') return 'ButtonHold';
  if (sound === 'switch') return op.op === 'turn' ? 'ToggleSwitch' : 'SpringedSwitch';
  if (op.op === 'press') return 'KeypadButton';
  return 'Interaction';
}

export const VIBRATION_KEY = 'vt.defuse.vibration';

export interface HapticCall {
  at: number;
  type: HapticType;
  pattern: number[];
  route: 'vibrate' | 'none' | 'off';
  /** What `navigator.vibrate` returned (false: the browser refused it). */
  ok: boolean;
}

/** The device's vibration: on unless the player switched it off; every call is logged. */
class Haptics {
  log: HapticCall[] = [];
  private on: boolean | null = null;
  private lastAt = -Infinity;

  get enabled(): boolean {
    if (this.on === null) {
      try {
        this.on = localStorage.getItem(storageKey(VIBRATION_KEY)) !== '0';
      } catch {
        this.on = true;
      }
    }
    return this.on;
  }

  set enabled(on: boolean) {
    this.on = on;
    try {
      localStorage.setItem(storageKey(VIBRATION_KEY), on ? '1' : '0');
    } catch {
      // a private window: the switch lasts for this page
    }
  }

  /** Whether this browser can vibrate at all. */
  get supported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  buzz(type: HapticType, modifier = 1) {
    const pattern = hapticPattern(type, modifier);
    if (!pattern.length) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    // A tick never cuts into another buzz, nor follows one too soon.
    if (type === 'Selection' && now - this.lastAt < SELECTION_GAP_MS) return;
    this.lastAt = now + (type === 'Selection' ? 0 : pattern.reduce((a, b) => a + b, 0));
    const route = !this.enabled ? 'off' : this.supported ? 'vibrate' : 'none';
    let ok = false;
    if (route === 'vibrate') {
      try {
        ok = navigator.vibrate(pattern.length === 1 ? pattern[0]! : pattern);
      } catch {
        ok = false;
      }
    }
    this.log.push({ at: Date.now(), type, pattern, route, ok });
    if (this.log.length > 200) this.log.shift();
  }
}

export const haptics = new Haptics();
