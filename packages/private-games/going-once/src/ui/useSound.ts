import { useCallback, useEffect, useRef, useState } from 'react';
import type { GoingOnceView } from '../logic/types.ts';
import { type ManifestState, assetUrl } from './assets.ts';
import {
  type AudioManifest,
  CROSSFADE_MS,
  CUT_MS,
  type Cue,
  DEFAULT_VOLUME,
  DUCK_FADE_MS,
  clipOf,
  cuePlays,
  deviceSounds,
  dueCues,
  effectCues,
  musicFor,
  musicLevel,
  ownCues,
  ramp,
  voiceCues,
} from './audio.ts';

// ---- This device's own switch and volume (a per-device convenience) ----

const DEVICE_KEY = 'vt.going-once.sound';

export interface DeviceSound {
  /** Muted on this device, whatever the room's setting. */
  muted: boolean;
  volume: number;
}

function loadDevice(): DeviceSound {
  try {
    const raw = JSON.parse(
      localStorage.getItem(DEVICE_KEY) ?? 'null',
    ) as Partial<DeviceSound> | null;
    return {
      muted: raw?.muted === true,
      volume:
        typeof raw?.volume === 'number' && raw.volume >= 0 && raw.volume <= 1
          ? raw.volume
          : DEFAULT_VOLUME,
    };
  } catch {
    return { muted: false, volume: DEFAULT_VOLUME };
  }
}

export function useDeviceSound(): [DeviceSound, (next: Partial<DeviceSound>) => void] {
  const [sound, setSound] = useState(loadDevice);
  const update = useCallback((next: Partial<DeviceSound>) => {
    setSound((prev) => {
      const merged = { ...prev, ...next };
      try {
        localStorage.setItem(DEVICE_KEY, JSON.stringify(merged));
      } catch {
        // Private mode: the choice lasts for this visit only.
      }
      return merged;
    });
  }, []);
  return [sound, update];
}

// ---- Nothing plays before the player has touched the page ----

function useGesture(): boolean {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    if (unlocked) return;
    const on = () => {
      setUnlocked(true);
    };
    window.addEventListener('pointerdown', on, { once: true });
    window.addEventListener('keydown', on, { once: true });
    return () => {
      window.removeEventListener('pointerdown', on);
      window.removeEventListener('keydown', on);
    };
  }, [unlocked]);
  return unlocked;
}

// ---- Music: two players for crossfades, ducked under the voice ----

interface Fade {
  el: HTMLAudioElement;
  from: number;
  to: number;
  start: number;
  ms: number;
  stopAfter: boolean;
}

class Mixer {
  private current: { src: string; el: HTMLAudioElement } | null = null;
  private fades: Fade[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private target = 0;

  setTrack(src: string | null, level: number) {
    if ((this.current?.src ?? null) === src) return;
    if (this.current) this.fade(this.current.el, 0, CROSSFADE_MS, true);
    this.current = null;
    if (!src) return;
    const el = new Audio(assetUrl(src));
    el.loop = true;
    el.volume = 0;
    void el.play().catch(() => {});
    this.current = { src, el };
    this.target = level;
    this.fade(el, level, CROSSFADE_MS, false);
  }

  setLevel(level: number) {
    if (!this.current || Math.abs(level - this.target) < 0.001) return;
    this.target = level;
    this.fade(this.current.el, level, DUCK_FADE_MS, false);
  }

  private fade(el: HTMLAudioElement, to: number, ms: number, stopAfter: boolean) {
    this.fades = this.fades.filter((f) => f.el !== el);
    this.fades.push({ el, from: el.volume, to, start: Date.now(), ms, stopAfter });
    this.timer ??= setInterval(() => this.tick(), 50);
  }

  private tick() {
    const now = Date.now();
    this.fades = this.fades.filter((f) => {
      f.el.volume = Math.max(0, Math.min(1, ramp(f.from, f.to, now - f.start, f.ms)));
      if (now - f.start < f.ms) return true;
      if (f.stopAfter) {
        f.el.pause();
        f.el.removeAttribute('src');
      }
      return false;
    });
    if (!this.fades.length && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  stop() {
    if (this.current) this.fade(this.current.el, 0, CROSSFADE_MS, true);
    this.current = null;
  }
}

/** Plays one effect clip at `volume`, cut off after `maxMs` when set. */
function playEffect(src: string, volume: number, maxMs?: number) {
  const el = new Audio(assetUrl(src));
  el.volume = Math.max(0, Math.min(1, volume));
  void el.play().catch(() => {});
  if (maxMs) {
    setTimeout(() => {
      el.pause();
      el.removeAttribute('src');
    }, maxMs);
  }
}

/** Fades a voice clip out over `CUT_MS`, stops it, then goes on with `then`. */
function cutVoice(el: HTMLAudioElement, then: () => void) {
  const from = el.volume;
  const start = Date.now();
  const id = setInterval(() => {
    const t = Date.now() - start;
    el.volume = Math.max(0, ramp(from, 0, t, CUT_MS));
    if (t < CUT_MS) return;
    clearInterval(id);
    el.pause();
    el.removeAttribute('src');
    el.volume = from;
    then();
  }, 40);
}

/**
 * The room's sound on this device, as the host set it: music per phase, an effect on every beat
 * (and this player's own hint rings and actions), and the auctioneer's voice when it is on.
 * Everything waits for a first tap or key press; reduced motion leaves the sound alone.
 */
export function useSound({
  view,
  manifest,
  you,
  isHost,
  clockOffset,
  device,
}: {
  view: GoingOnceView;
  manifest: ManifestState;
  you: string | null;
  isHost: boolean;
  clockOffset: number;
  device: DeviceSound;
}): void {
  const unlocked = useGesture();
  const audio: AudioManifest | undefined =
    manifest && manifest !== 'unavailable' ? manifest.audio : undefined;
  const { sound: mode, music, effects, voice } = view.settings;
  const on = unlocked && !device.muted && mode !== 'off' && !!audio;
  const played = useRef(new Set<string>());
  const voiceQueue = useRef<Cue[]>([]);
  const voiceEl = useRef<HTMLAudioElement | null>(null);
  const voiceHost = useRef('');
  const [speaking, setSpeaking] = useState(false);
  const mixer = useRef<Mixer | null>(null);
  const prev = useRef<GoingOnceView | null>(null);
  const own = useRef<Cue[]>([]);

  // This player's own actions, from the change between views.
  useEffect(() => {
    own.current = [
      ...own.current.filter((c) => c.at > Date.now() + clockOffset - 5000),
      ...ownCues(prev.current, view, Date.now() + clockOffset),
    ];
    prev.current = view;
  }, [view, clockOffset]);

  // Effects and the voice: due cues play once, where this device plays them.
  useEffect(() => {
    if (!on) return;
    const opts = { mode, isHost, effects, voice };
    const playVoice = () => {
      const el = (voiceEl.current ??= new Audio());
      if (!el.paused && !el.ended && el.src) return;
      const now = Date.now() + clockOffset;
      // A newer line drops what is left of an older one; a line too late for its moment is skipped.
      const queue = voiceQueue.current.filter((c) => now <= (c.until ?? c.at));
      const next = queue.shift();
      voiceQueue.current = queue;
      const src = next ? clipOf(audio?.voice, next.key, next.pick ?? 0) : null;
      if (!next || !src) {
        setSpeaking(false);
        if (next) playVoice();
        return;
      }
      el.src = assetUrl(src);
      voiceHost.current = next.id.split(':')[0]!;
      el.volume = Math.max(0, Math.min(1, device.volume));
      el.onended = () => playVoice();
      el.onerror = () => playVoice();
      setSpeaking(true);
      void el.play().catch(() => playVoice());
    };
    const check = () => {
      const now = Date.now() + clockOffset;
      const cues = [...effectCues(view, you), ...voiceCues(view), ...own.current];
      for (const cue of dueCues(cues, now, played.current)) {
        played.current.add(cue.id);
        if (!cuePlays(cue, opts)) continue;
        if (cue.kind === 'voice') {
          const host = cue.id.split(':')[0];
          // Lines from an older host moment give way to the new one: a chant a new bid cuts off
          // fades out quickly first.
          voiceQueue.current = [
            ...voiceQueue.current.filter((c) => c.id.split(':')[0] === host),
            cue,
          ];
          const el = voiceEl.current;
          if (el && !el.paused && voiceHost.current !== host) cutVoice(el, playVoice);
          else playVoice();
        } else {
          const src = clipOf(audio?.sfx, cue.key, cue.pick ?? cue.at);
          if (src) playEffect(src, device.volume, cue.maxMs);
        }
      }
      if (played.current.size > 2000) played.current = new Set([...played.current].slice(-500));
    };
    check();
    const id = setInterval(check, 100);
    return () => {
      clearInterval(id);
    };
  }, [on, view, you, clockOffset, audio, mode, isHost, effects, voice, device.volume]);

  // A device that goes quiet stops talking at once.
  useEffect(() => {
    if (on && voice) return;
    voiceQueue.current = [];
    voiceEl.current?.pause();
    setSpeaking(false);
  }, [on, voice]);

  // Music: the moment's track, crossfaded, ducked under the voice.
  // At the end the music follows the rack-up's beats, so it needs the time.
  const ending = view.game?.stage === 'done';
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!ending) return;
    const id = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(id);
  }, [ending]);
  const choice = musicFor(view, clock + clockOffset);
  const wanted =
    on && music && deviceSounds(mode, isHost) && choice
      ? clipOf(audio?.music, choice.key, choice.pick)
      : null;
  const level = musicLevel(device.volume, speaking);
  const levelNow = useRef(level);
  useEffect(() => {
    levelNow.current = level;
  });
  useEffect(() => {
    mixer.current ??= new Mixer();
    mixer.current.setTrack(wanted, levelNow.current);
  }, [wanted]);
  useEffect(() => {
    mixer.current?.setLevel(level);
  }, [level]);
  useEffect(() => {
    return () => {
      mixer.current?.stop();
      voiceEl.current?.pause();
    };
  }, []);
}
