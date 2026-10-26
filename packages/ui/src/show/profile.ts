import { type Profile, type StagePresence, profileFor } from '@vt/game-sdk/show';
import { useSyncExternalStore } from 'react';

// How much of the show this device plays. The profile comes from the room (a table screen paired
// or not); reduced motion from the system; low effects ("Battery saver") from a per-device switch,
// or by itself when the battery is low, the browser asks to save data, or the first second of a
// show drops frames. Kept in localStorage per device (not per seat: it is about the hardware).

/** The device's battery-saver switch: `auto` decides from the battery and the frame rate. */
export type LowSetting = 'auto' | 'on' | 'off';

const KEY = 'vt.show.low';
const LOW_BATTERY = 0.2;
/** More than this share of slow frames in the first second of a show turns low effects on. */
const SLOW_SHARE = 0.1;
const SLOW_FRAME_MS = 34;

interface State {
  setting: LowSetting;
  /** What `auto` found: a low battery, data saving or slow frames. */
  auto: boolean;
  reduced: boolean;
}

const listeners = new Set<() => void>();
let state: State = {
  setting: readSetting(),
  auto: false,
  reduced: false,
};
let started = false;

function readSetting(): LowSetting {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return v === 'on' || v === 'off' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function update(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

/** Starts listening to the system once, on the first device that shows anything. */
function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (mq) {
    update({ reduced: mq.matches });
    mq.addEventListener?.('change', () => update({ reduced: mq.matches }));
  }
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
    getBattery?: () => Promise<{
      level: number;
      charging: boolean;
      addEventListener: (type: string, cb: () => void) => void;
    }>;
  };
  if (nav.connection?.saveData) update({ auto: true });
  void nav
    .getBattery?.()
    .then((b) => {
      const check = () => {
        if (b.level < LOW_BATTERY && !b.charging) update({ auto: true });
      };
      check();
      b.addEventListener('levelchange', check);
      b.addEventListener('chargingchange', check);
    })
    .catch(() => {});
}

function subscribe(l: () => void) {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
}
const snapshot = () => state;
const serverSnapshot = () => state;

/** Sets the device's battery-saver switch. */
export function setLowEffects(setting: LowSetting) {
  try {
    if (setting === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, setting);
  } catch {
    // Private windows may refuse storage: the switch still holds for this page.
  }
  update({ setting });
}

/** Whether the device plays low effects, from its switch and what `auto` found. */
export const lowOf = (s: Pick<State, 'setting' | 'auto'>) =>
  s.setting === 'on' || (s.setting === 'auto' && s.auto);

let sampled = false;
/**
 * Watches the first second of the first show on this page: if more than one frame in ten is slow,
 * low effects go on by themselves (for this page; the switch can still say otherwise).
 */
export function sampleFrames() {
  if (sampled || typeof requestAnimationFrame === 'undefined') return;
  sampled = true;
  let last = performance.now();
  const end = last + 1000;
  let frames = 0;
  let slow = 0;
  const step = (now: number) => {
    frames++;
    if (now - last > SLOW_FRAME_MS) slow++;
    last = now;
    if (now < end) requestAnimationFrame(step);
    else if (frames > 5 && slow / frames > SLOW_SHARE) update({ auto: true });
  };
  requestAnimationFrame(step);
}

export interface ShowSettings {
  low: boolean;
  setting: LowSetting;
  reduced: boolean;
}

/** The device's show settings (reduced motion, battery saver), live. */
export function useShowSettings(): ShowSettings {
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return { low: lowOf(s), setting: s.setting, reduced: s.reduced };
}

/**
 * This device's profile from the room's table-screen field (`stage.present`; without it a phone
 * plays the fuller show), plus its reduced-motion and low-effects settings.
 */
export function useShowProfile(
  stage?: StagePresence | null,
  isStage = false,
): ShowSettings & { profile: Profile } {
  return { ...useShowSettings(), profile: profileFor(stage, isStage) };
}
