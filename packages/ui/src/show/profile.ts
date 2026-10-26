import { type Profile, type StagePresence, profileFor } from '@vt/game-sdk/show';
import { useSyncExternalStore } from 'react';

// How much of the show this device plays. The profile comes from the room (a table screen paired
// or not); reduced motion from the system; low effects ("Battery saver") from a per-device switch,
// or by itself when the battery is low, the browser asks to save data, or the show keeps dropping
// frames over several moments (`judgeFrames`). Kept in localStorage per device (not per seat: it is
// about the hardware). When it goes on by itself the page says so (`ShowSettings.auto`), with a way
// back.

/** The device's battery-saver switch: `auto` decides from the battery and the frame rate. */
export type LowSetting = 'auto' | 'on' | 'off';

const KEY = 'vt.show.low';
const LOW_BATTERY = 0.2;
/**
 * A sampled second of a live moment is slow when more than this share of its frames are (a phone
 * that drops one frame in four can't keep up; a page settling drops the odd one).
 */
const SLOW_SHARE = 0.25;
const SLOW_FRAME_MS = 34;
/** Seconds sampled (one per live moment) before auto decides, and how many of them must be slow. */
export const FRAME_SAMPLES = 4;
export const SLOW_SAMPLES = 3;
/** Nothing is sampled this soon after the page loads: loading and decoding stall any device. */
export const SAMPLE_AFTER_MS = 10_000;
/** Samples are at least this far apart, so they come from different moments of the show. */
export const SAMPLE_GAP_MS = 4_000;

/** One sampled second: its frames and how many of them were slow. */
export interface FrameSample {
  frames: number;
  slow: number;
}

/**
 * What the frames say so far: `slow` once `SLOW_SAMPLES` sampled seconds dropped frames (real,
 * lasting jank, not one stall), `fine` once that can no longer happen, else `undecided`. A second
 * with too few frames to judge (a hidden or frozen page) counts for neither.
 */
export function judgeFrames(samples: readonly FrameSample[]): 'slow' | 'fine' | 'undecided' {
  const judged = samples.filter((s) => s.frames > 5);
  const slow = judged.filter((s) => s.slow / s.frames > SLOW_SHARE).length;
  if (slow >= SLOW_SAMPLES) return 'slow';
  if (judged.length - slow > FRAME_SAMPLES - SLOW_SAMPLES) return 'fine';
  return 'undecided';
}

interface State {
  setting: LowSetting;
  /** What `auto` found: a low battery, data saving or slow frames. */
  auto: boolean;
  reduced: boolean;
}

/** Turns `auto` on (the page then says so). */
const autoOn = () => update({ auto: true });

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
  if (nav.connection?.saveData) autoOn();
  void nav
    .getBattery?.()
    .then((b) => {
      const check = () => {
        if (b.level < LOW_BATTERY && !b.charging) autoOn();
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

/**
 * Whether the device plays low effects, from its switch and what `auto` found. A table screen
 * only when switched on: it runs on mains power and the show is its whole job, so slow frames
 * there never take its confetti away.
 */
export const lowOf = (s: Pick<State, 'setting' | 'auto'>, isStage = false) =>
  s.setting === 'on' || (!isStage && s.setting === 'auto' && s.auto);

const samples: FrameSample[] = [];
let sampling = false;
let decided = false;
let lastSample = -Infinity;

/**
 * Samples a second of frames while a live moment plays (at most one second per `SAMPLE_GAP_MS`,
 * none in the page's first `SAMPLE_AFTER_MS` or while it is hidden), until `judgeFrames` decides;
 * slow turns low effects on by themselves (for this page; the switch can still say otherwise).
 */
export function sampleFrames() {
  if (decided || sampling || typeof requestAnimationFrame === 'undefined') return;
  const start = performance.now();
  if (start < SAMPLE_AFTER_MS || start - lastSample < SAMPLE_GAP_MS) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  sampling = true;
  lastSample = start;
  let last = start;
  const sample: FrameSample = { frames: 0, slow: 0 };
  const step = (now: number) => {
    sample.frames++;
    if (now - last > SLOW_FRAME_MS) sample.slow++;
    last = now;
    if (now < start + 1000) {
      requestAnimationFrame(step);
      return;
    }
    sampling = false;
    // A page hidden meanwhile has no frames worth judging.
    if (typeof document !== 'undefined' && document.hidden) return;
    samples.push(sample);
    const verdict = judgeFrames(samples);
    if (verdict === 'undecided') return;
    decided = true;
    if (verdict === 'slow') autoOn();
  };
  requestAnimationFrame(step);
}

export interface ShowSettings {
  low: boolean;
  setting: LowSetting;
  reduced: boolean;
  /** Low effects are on by themselves (`auto`): the page should say so and offer a way back. */
  auto: boolean;
}

/** The device's show settings (reduced motion, battery saver), live. */
export function useShowSettings(): ShowSettings {
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return {
    low: lowOf(s),
    setting: s.setting,
    reduced: s.reduced,
    auto: s.setting === 'auto' && s.auto,
  };
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
