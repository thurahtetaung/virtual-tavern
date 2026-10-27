import { storageKey } from '@vt/game-sdk';
import { FULL_VOLUMES, type Volumes, gainOf, useVolumes } from '@vt/ui/sound';
import { useEffect, useRef } from 'react';
import { leftAt } from '../logic/bomb.ts';
import { isNeedy } from '../logic/types.ts';
import type { BombView } from '../logic/view.ts';
import type { Art } from './assets.ts';
import { endCues, musicSection, stingerDue } from './music.ts';
import { roomCues } from './three/room.ts';
import { serverNow } from './time.ts';
import { haptics } from './haptics.ts';

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
  | 'wiresequence'
  | 'bomb-defused'
  | 'gameover-fanfare'
  | 'explode'
  | 'switch'
  | 'light-buzz'
  | 'light-buzz-short'
  | 'alarm-clock-beep'
  | 'alarm-clock-snooze'
  | 'emergencyalarm'
  | 'stamp';

/** Simon's notes (`SimonComponent.tones`) and its tone generator's gain. */
export const SIMON_TONES = [554.37, 659.25, 783.99, 987.77];
const GAIN = 0.2;

const MUTE_KEY = 'vt.defuse.mute';

/** The music element's own level under the music slider. */
export const MUSIC_LEVEL = 0.5;

class Player {
  ctx: AudioContext | null = null;
  /** This device's volumes (the table screen's: the host's sliders), master included. */
  gains = { music: 1, effects: 1 };
  private cache = new Map<string, HTMLAudioElement>();
  private music: HTMLAudioElement | null = null;
  private musicSrc = '';
  private pending: string | null = null;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
      return;
    }
    if (typeof AudioContext === 'undefined') return;
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
  }

  play(src: string | null, volume = 1) {
    if (!src || !this.gains.effects || !this.ctx) return;
    let a = this.cache.get(src);
    if (!a) {
      a = new Audio(src);
      a.preload = 'auto';
      this.cache.set(src, a);
    }
    const clip = a.paused ? a : (a.cloneNode() as HTMLAudioElement);
    clip.currentTime = 0;
    clip.volume = Math.max(0, Math.min(1, volume * this.gains.effects));
    void clip.play().catch(() => {});
  }

  tone(freq: number, ms: number, gain = GAIN) {
    const ctx = this.ctx;
    if (!ctx || !this.gains.effects) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.value = gain * this.gains.effects;
    g.gain.setTargetAtTime(0, ctx.currentTime + ms / 1000 - 0.05, 0.02);
    osc.connect(g).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  }

  /**
   * Plays `src` as the music, looping. `queue` lets the clip that is playing finish its
   * play-through first (the original queues its sections); otherwise it cuts in at once.
   */
  setMusic(src: string | null, queue = false) {
    if (!this.gains.music || !this.ctx) src = null;
    const want = src ?? '';
    if (want === this.musicSrc) {
      this.pending = null;
      if (this.music) this.music.loop = true;
      return;
    }
    if (queue && want && this.music && !this.music.paused) {
      if (this.pending === want) return;
      this.pending = want;
      this.music.loop = false;
      this.music.onended = () => {
        const next = this.pending;
        this.pending = null;
        if (next) this.start(next);
      };
      return;
    }
    this.start(want);
  }

  private start(src: string) {
    this.pending = null;
    if (this.music) {
      this.music.onended = null;
      this.music.pause();
    }
    this.music = null;
    this.musicSrc = src;
    if (!src) return;
    const a = new Audio(src);
    a.loop = true;
    a.volume = MUSIC_LEVEL * this.gains.music;
    this.music = a;
    void a.play().catch(() => {});
  }

  /** New volumes, applied at once to the music playing. */
  setGains(gains: { music: number; effects: number }) {
    this.gains = gains;
    if (this.music) this.music.volume = MUSIC_LEVEL * gains.music;
    if (!gains.music) this.setMusic(null);
  }
}

export const player = new Player();

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];

/**
 * Starts the audio on a tap or key press (inside the event, as phones require), and again if the
 * device suspended it. `auto`: the table screen, which was started with a tap on its pairing page,
 * may play from the start.
 */
export function useUnlock(auto: boolean) {
  useEffect(() => {
    if (auto) player.unlock();
    const on = () => player.unlock();
    for (const e of GESTURES) window.addEventListener(e, on, { capture: true });
    return () => {
      for (const e of GESTURES) window.removeEventListener(e, on, { capture: true });
    };
  }, [auto]);
}

/** This player's volumes for the bomb (a mute from before, kept per seat, becomes the master at 0). */
export const useDefuseVolumes = () =>
  useVolumes('defuse', FULL_VOLUMES, () => {
    try {
      return localStorage.getItem(storageKey(MUTE_KEY)) === '1' ? { master: 0 } : null;
    } catch {
      return null;
    }
  });

/** Plays the bomb at these volumes on this device (and starts the audio on a tap). */
export function usePlayerVolumes(v: Volumes, auto = false) {
  const music = gainOf(v, 'music');
  const effects = gainOf(v, 'effects');
  useEffect(() => {
    player.setGains({ music, effects });
  }, [music, effects]);
  useUnlock(auto);
}

const cutCount = (b: BombView) =>
  b.modules.reduce((n, m) => n + ('wires' in m ? m.wires.filter((w) => w.cut).length : 0), 0) +
  b.modules.reduce((n, m) => n + ('panels' in m ? m.panels.filter((w) => w.cut).length : 0), 0);

/** When each Wire Sequence last turned its page, to hear it turn. */
const pageTurns = (b: BombView) =>
  b.modules.map((m) => ('turningUntil' in m ? m.turningUntil : '')).join(',');

/** The end's sounds play only on a device that sees the end this soon after it. */
const END_LATE_MS = 3000;

/**
 * Plays the bomb's sounds from the view on the server clock: pass the bomb while it is live and
 * at its result, on the devices that play it (the defuser's and the table screen).
 */
/** `buzz`: the device vibrates with the bomb; `room`: it shows the 3D room, so its sounds play too. */
export function useBombSound(
  b: BombView | null,
  art: Art,
  offset: number,
  { buzz = false, room = false }: { buzz?: boolean; room?: boolean } = {},
) {
  const seen = useRef<{
    no: number;
    log: number;
    cuts: number;
    pages: string;
    end: boolean;
  } | null>(null);
  useEffect(() => {
    if (!b) {
      seen.current = null;
      return;
    }
    const prev = seen.current?.no === b.no ? seen.current : null;
    const fresh = b.end && !prev ? [] : b.log.slice(prev?.log ?? b.log.length);
    for (const e of fresh) {
      if (e.what === 'strike') {
        player.play(art.effect(e.kind === 'capacitor' ? 'capacitorpop' : 'strike'));
        if (e.kind === 'capacitor') player.play(art.effect('strike'));
        if (buzz) haptics.buzz('Strike');
      }
      if (e.what === 'needy') player.play(art.effect('needy-activated'));
    }
    const cuts = cutCount(b);
    if (prev && cuts > prev.cuts) player.play(art.effect('snip'));
    // `WireSequenceComponent.ChangePage`: the panel's whirr as it goes down and comes back.
    const pages = pageTurns(b);
    if (prev && pages !== prev.pages) player.play(art.effect('wiresequence'));
    if (b.end && !prev?.end && serverNow(offset) - b.end.at < END_LATE_MS) {
      for (const e of endCues(b.end).effects) player.play(art.effect(e));
      // `Bomb.Detonate` → `AddExplosionVibration`.
      if (buzz && b.end.how !== 'defused') haptics.buzz('Explosion');
    }
    seen.current = { no: b.no, log: b.log.length, cuts, pages, end: !!b.end };
  }, [b, art, offset, buzz]);

  // The timer's beep on every second it shows, and the needy warnings.
  useEffect(() => {
    if (!b || b.end) return;
    let last = -1;
    const warned = new Set<string>();
    let heard = serverNow(offset);
    const id = setInterval(() => {
      const now = serverNow(offset);
      // The room: the lights, lights out, the alarm clock, the emergency light.
      if (room) for (const e of roomCues(b, heard, now)) player.play(art.effect(e));
      heard = now;
      if (now < b.clockAt) return;
      const sec = Math.floor(leftAt(b, now) / 1000);
      if (sec !== last) {
        if (last >= 0)
          player.play(
            art.effect(
              b.rate > 1.25 ? 'singlebeep' : b.rate > 1 ? 'doublebeep-1-25' : 'doublebeep',
            ),
          );
        last = sec;
      }
      for (const m of b.modules) {
        if (!isNeedy(m.kind) || !('state' in m) || m.state !== 'running') continue;
        const left =
          m.kind === 'capacitor' && m.heldAt !== null ? m.left : m.left - (now - m.leftAt);
        const key = `${m.id}:${m.leftAt}`;
        const warn = m.kind === 'venting-gas' ? 3000 : 5000;
        if (left <= warn && left > 0 && !warned.has(key) && m.kind !== 'capacitor') {
          warned.add(key);
          player.play(art.effect('needy-warning'));
          if (buzz) haptics.buzz('NeedyWarning');
        }
      }
    }, 50);
    return () => {
      clearInterval(id);
    };
  }, [b, art, offset, buzz, room]);

  // Music (`GameplayMusicController`): one playlist a bomb, its sections queued one after another
  // as the time left falls, the stinger 7 s (bomb time) before the last 30 s, which cut straight
  // to the last section. At the end the music stops for the bomb's own sound, then the win or
  // lose music starts after the original's fades.
  const stung = useRef<number | null>(null);
  const opened = useRef<number | null>(null);
  useEffect(() => {
    if (!b) {
      player.setMusic(null);
      return;
    }
    if (b.end) {
      const cue = endCues(b.end);
      const start = () => {
        player.setMusic(art.music(cue.music)[0] ?? null);
      };
      const wait = cue.musicAt - serverNow(offset);
      if (wait <= 0) {
        start();
        return;
      }
      player.setMusic(null);
      const id = setTimeout(start, wait);
      return () => {
        clearTimeout(id);
      };
    }
    const lists = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
      .map((k) => art.music(`game-${k}`))
      .filter((l) => l.length);
    if (!lists.length) {
      player.setMusic(null);
      return;
    }
    const list = lists[(b.no - 1) % lists.length]!;
    const tick = () => {
      const now = serverNow(offset);
      if (now < b.clockAt) return;
      const left = leftAt(b, now);
      const section = musicSection(left, b.total, list.length);
      // The playlist starts from its first clip; the section the clock asks for queues behind it.
      if (opened.current !== b.no) {
        opened.current = b.no;
        player.setMusic(list[0] ?? null);
      }
      player.setMusic(list[section.index] ?? null, !section.now);
      if (stung.current !== b.no && stingerDue(left, b.rate)) {
        stung.current = b.no;
        player.play(art.music('stinger')[0] ?? null);
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => {
      clearInterval(id);
    };
  }, [b, art, offset]);
}
