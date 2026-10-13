import { useEffect } from 'react';

// Haptics and sound. Sound effects are synthesised (no files) and off by default; haptics buzz
// only the viewer's own phone, for their own turn or a nudge.

/** Buzzes once each time `key` changes to a new non-null value (your turn, a nudge). */
export function useBuzz(key: string | null) {
  useEffect(() => {
    if (key === null) return;
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  }, [key]);
}

export type Sfx = 'turn' | 'nope' | 'boom' | 'snip' | 'card';

let audio: AudioContext | null = null;

/** A short synthesised effect. Silently does nothing where audio is unavailable. */
export function playSfx(kind: Sfx) {
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
      g.gain.exponentialRampToValueAtTime(vol, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
      o.connect(g).connect(ctx.destination);
      o.start(t + at);
      o.stop(t + at + len + 0.02);
    };
    switch (kind) {
      case 'turn':
        tone(660, 0, 0.12, 'sine', 0.1);
        tone(880, 0.13, 0.18, 'sine', 0.1);
        break;
      case 'nope':
        tone(160, 0, 0.22, 'square', 0.12, 70);
        break;
      case 'boom':
        for (let i = 0; i < 5; i++) tone(120 - i * 12, i * 0.05, 0.3, 'sawtooth', 0.09, 30);
        break;
      case 'snip':
        tone(2200, 0, 0.05, 'triangle', 0.08, 1200);
        tone(1800, 0.07, 0.05, 'triangle', 0.08, 900);
        break;
      case 'card':
        tone(600, 0, 0.08, 'triangle', 0.08, 300);
        break;
    }
  } catch {
    // No audio: nothing to do.
  }
}
