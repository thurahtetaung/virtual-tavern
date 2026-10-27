import { storageKey } from '@vt/game-sdk';
import { useEffect, useRef, useState } from 'react';
import { leftAt } from '../logic/bomb.ts';
import { isNeedy } from '../logic/types.ts';
import type { BombView } from '../logic/view.ts';
import type { Art } from './assets.ts';
import { serverNow } from './time.ts';

/**
 * The bomb's sounds, as the original plays them, on the defuser's device and the table screen:
 * the timer's beep each second (faster beeps after strikes), strikes, cuts, needy alarms, the
 * defuse and the explosion, the music, and the tones Simon and the capacitor make (the original
 * makes those with a tone generator too). Silent without the manifest's sounds; nothing plays
 * before a first tap, and each device can mute itself.
 */

/** Our names for the effects, as the manifest's `audio.effects` keys them. */
export type Effect =
  | 'doublebeep'
  | 'doublebeep-1-25'
  | 'singlebeep'
  | 'strike'
  | 'snip'
  | 'press-in'
  | 'press-release'
  | 'bb-press-in'
  | 'bb-press-release'
  | 'needy-activated'
  | 'needy-warning'
  | 'capacitorpop'
  | 'bomb-defused'
  | 'explode';

/** Simon's notes (`SimonComponent.tones`) and its tone generator's gain. */
export const SIMON_TONES = [554.37, 659.25, 783.99, 987.77];
const GAIN = 0.2;

const MUTE_KEY = 'vt.defuse.mute';

class Player {
  ctx: AudioContext | null = null;
  muted = false;
  private cache = new Map<string, HTMLAudioElement>();
  private music: HTMLAudioElement | null = null;
  private musicSrc = '';

  unlock() {
    if (this.ctx || typeof AudioContext === 'undefined') return;
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
  }

  play(src: string | null) {
    if (!src || this.muted || !this.ctx) return;
    let a = this.cache.get(src);
    if (!a) {
      a = new Audio(src);
      a.preload = 'auto';
      this.cache.set(src, a);
    }
    const clip = a.paused ? a : (a.cloneNode() as HTMLAudioElement);
    clip.currentTime = 0;
    void clip.play().catch(() => {});
  }

  tone(freq: number, ms: number, gain = GAIN) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.value = gain;
    g.gain.setTargetAtTime(0, ctx.currentTime + ms / 1000 - 0.05, 0.02);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  }

  setMusic(src: string | null) {
    if (this.muted || !this.ctx) src = null;
    if ((src ?? '') === this.musicSrc) return;
    this.music?.pause();
    this.music = null;
    this.musicSrc = src ?? '';
    if (!src) return;
    const a = new Audio(src);
    a.loop = true;
    a.volume = 0.5;
    this.music = a;
    void a.play().catch(() => {});
  }
}

export const player = new Player();

/** The device's own mute switch, kept per seat. */
export function useMute(): [boolean, (on: boolean) => void] {
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(storageKey(MUTE_KEY)) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    player.muted = muted;
    if (muted) player.setMusic(null);
  }, [muted]);
  useEffect(() => {
    const unlock = () => player.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
    };
  }, []);
  return [
    muted,
    (on) => {
      setMuted(on);
      try {
        localStorage.setItem(storageKey(MUTE_KEY), on ? '1' : '0');
      } catch {
        // private window: the switch still works for this page
      }
    },
  ];
}

const cutCount = (b: BombView) =>
  b.modules.reduce((n, m) => n + ('wires' in m ? m.wires.filter((w) => w.cut).length : 0), 0) +
  b.modules.reduce(
    (n, m) => n + ('panels' in m ? m.panels.filter((w) => w.cut).length : 0),
    0,
  );

/** Plays the bomb's sounds from the view on the server clock. */
export function useBombSound(b: BombView | null, art: Art, offset: number) {
  const seen = useRef<{ no: number; log: number; cuts: number; end: boolean } | null>(null);
  useEffect(() => {
    if (!b) {
      seen.current = null;
      return;
    }
    const prev = seen.current?.no === b.no ? seen.current : null;
    const fresh = b.log.slice(prev?.log ?? b.log.length);
    for (const e of fresh) {
      if (e.what === 'strike') {
        player.play(art.effect(e.kind === 'capacitor' ? 'capacitorpop' : 'strike'));
        if (e.kind === 'capacitor') player.play(art.effect('strike'));
      }
      if (e.what === 'needy') player.play(art.effect('needy-activated'));
    }
    const cuts = cutCount(b);
    if (prev && cuts > prev.cuts) player.play(art.effect('snip'));
    if (b.end && !prev?.end && prev) player.play(art.effect(b.end.how === 'defused' ? 'bomb-defused' : 'explode'));
    seen.current = { no: b.no, log: b.log.length, cuts, end: !!b.end };
  }, [b, art]);

  // The timer's beep on every second it shows, and the needy warnings.
  useEffect(() => {
    if (!b || b.end) return;
    let last = -1;
    const warned = new Set<string>();
    const id = setInterval(() => {
      const now = serverNow(offset);
      if (now < b.clockAt) return;
      const sec = Math.floor(leftAt(b, now) / 1000);
      if (sec !== last) {
        if (last >= 0) player.play(art.effect(b.rate > 1.25 ? 'singlebeep' : b.rate > 1 ? 'doublebeep-1-25' : 'doublebeep'));
        last = sec;
      }
      for (const m of b.modules) {
        if (!isNeedy(m.kind) || !('state' in m) || m.state !== 'running') continue;
        const left = m.kind === 'capacitor' && m.heldAt !== null ? m.left : m.left - (now - m.leftAt);
        const key = `${m.id}:${m.leftAt}`;
        const warn = m.kind === 'venting-gas' ? 3000 : 5000;
        if (left <= warn && left > 0 && !warned.has(key) && m.kind !== 'capacitor') {
          warned.add(key);
          player.play(art.effect('needy-warning'));
        }
      }
    }, 50);
    return () => {
      clearInterval(id);
    };
  }, [b, art, offset]);

  // Music: one playlist a bomb; its section rises as time runs out, the last for the final 30 s
  // (`GameplayMusicController`).
  useEffect(() => {
    if (!b) {
      player.setMusic(null);
      return;
    }
    const lists = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((k) => art.music(`game-${k}`)).filter((l) => l.length);
    if (!lists.length || b.end) {
      player.setMusic(b?.end ? (art.music(b.end.how === 'defused' ? 'gameover-win' : 'gameover-lose')[0] ?? null) : null);
      return;
    }
    const list = lists[(b.no - 1) % lists.length]!;
    const id = setInterval(() => {
      const now = serverNow(offset);
      const left = leftAt(b, now);
      const i = left <= 30_000 ? list.length - 1 : Math.min(list.length - 2, Math.floor((1 - left / b.total) * (list.length - 1)));
      player.setMusic(list[Math.max(0, i)] ?? null);
    }, 500);
    return () => {
      clearInterval(id);
    };
  }, [b, art, offset]);
}
