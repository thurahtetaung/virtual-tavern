import { useEffect, useRef, useState } from 'react';

// Haptics, sound and the "phone lying flat" check. Sound effects are synthesised (no files), off
// by default; haptics buzz only the viewer's own phone, for their own turn.

/** Buzzes once each time `key` changes to a new non-null value (your turn, a nudge). */
export function useBuzz(key: string | null) {
  useEffect(() => {
    if (key === null) return;
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  }, [key]);
}

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export type Sfx = 'flip' | 'stamp' | 'chaos' | 'turn' | 'card' | 'shot';

let audio: AudioContext | null = null;
/** This player's effects volume (their slider), 0 to 1: 0 plays nothing. */
let level = 0;
export function setSfxLevel(gain: number) {
  level = Math.max(0, Math.min(1, gain));
}

/**
 * A short synthesised effect (no assets), at the player's volume or `gain`. Silently does
 * nothing where audio is unavailable.
 */
export function playSfx(kind: Sfx, gain = level) {
  if (gain <= 0) return;
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const ctx = audio;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    const tone = (
      freq: number,
      at: number,
      len: number,
      type: OscillatorType,
      vol: number,
      to?: number,
    ) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t + at);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t + at + len);
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol * gain), t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
      o.connect(g).connect(ctx.destination);
      o.start(t + at);
      o.stop(t + at + len + 0.02);
    };
    switch (kind) {
      case 'flip':
        tone(900, 0, 0.05, 'triangle', 0.08, 500);
        break;
      case 'card':
        tone(600, 0, 0.08, 'triangle', 0.1, 300);
        tone(300, 0.06, 0.1, 'sine', 0.08);
        break;
      case 'stamp':
        tone(140, 0, 0.25, 'square', 0.12, 60);
        tone(80, 0.02, 0.3, 'sine', 0.2, 40);
        break;
      case 'chaos':
        for (let i = 0; i < 6; i++) tone(90 + i * 7, i * 0.08, 0.12, 'sawtooth', 0.05, 60);
        break;
      case 'shot':
        tone(1200, 0, 0.12, 'square', 0.12, 80);
        break;
      case 'turn':
        tone(660, 0, 0.12, 'sine', 0.1);
        tone(880, 0.13, 0.18, 'sine', 0.1);
        break;
    }
  } catch {
    // No audio: nothing to do.
  }
}

/**
 * Whether the phone is lying flat (face up on a table), where neighbours could glance at it:
 * secret cards hide then. False wherever there are no orientation sensors.
 */
export function useLyingFlat(active: boolean): boolean {
  const [flat, setFlat] = useState(false);
  const last = useRef(false);
  useEffect(() => {
    if (!active || typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) return;
    const on = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      const now = Math.abs(e.beta) < 12 && Math.abs(e.gamma) < 12;
      if (now !== last.current) {
        last.current = now;
        setFlat(now);
      }
    };
    window.addEventListener('deviceorientation', on);
    return () => {
      window.removeEventListener('deviceorientation', on);
      last.current = false;
      setFlat(false);
    };
  }, [active]);
  return active && flat;
}
