import { useCallback, useEffect, useRef, useState } from 'react';
import type { NightfallView } from '../logic/types.ts';
import { type Manifest, assetUrl } from './assets.ts';
import {
  CROSSFADE_MS,
  type Cue,
  DEFAULT_MUSIC_VOLUME,
  DUCK_FADE_MS,
  type QueuedClip,
  clipsFor,
  cuesFor,
  devicePlaysMusic,
  deviceSpeaks,
  dueCues,
  enqueueClips,
  musicChange,
  musicPhaseFor,
  musicTarget,
  nextClip,
  ramp,
  trackFor,
} from './audio.ts';

// ---- This device's own music switch and volume (a per-device convenience) ----

const DEVICE_KEY = 'vt.nightfall.sound';

export interface DeviceSound {
  music: boolean;
  volume: number;
}

function loadDevice(): DeviceSound {
  try {
    const raw = JSON.parse(
      localStorage.getItem(DEVICE_KEY) ?? 'null',
    ) as Partial<DeviceSound> | null;
    return {
      music: raw?.music !== false,
      volume:
        typeof raw?.volume === 'number' && raw.volume >= 0 && raw.volume <= 1
          ? raw.volume
          : DEFAULT_MUSIC_VOLUME,
    };
  } catch {
    return { music: true, volume: DEFAULT_MUSIC_VOLUME };
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

// ---- Audio unlock: nothing plays before the player has touched the page ----

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

// ---- Music: two players for crossfades, with ducking under the narration ----

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
    const change = musicChange(this.current?.src ?? null, src);
    if (change.fadeOut && this.current) this.fade(this.current.el, 0, CROSSFADE_MS, true);
    if (change.fadeOut || change.fadeIn) this.current = null;
    if (change.fadeIn) {
      const el = new Audio(assetUrl(change.fadeIn));
      el.loop = true;
      el.volume = 0;
      void el.play().catch(() => {});
      this.current = { src: change.fadeIn, el };
      this.target = level;
      this.fade(el, level, CROSSFADE_MS, false);
    }
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
      const v = ramp(f.from, f.to, now - f.start, f.ms);
      f.el.volume = Math.max(0, Math.min(1, v));
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

/**
 * Plays the narration (and background music) for this device, as the host chose, and returns the
 * narration lines in progress so every screen can show them as text.
 */
export function useSound({
  view,
  manifest,
  isHost,
  clockOffset,
  device,
}: {
  view: NightfallView;
  manifest: Manifest | null;
  isHost: boolean;
  clockOffset: number;
  device: DeviceSound;
}): { lines: string[] } {
  const unlocked = useGesture();
  const speaks = deviceSpeaks(view.settings.narration, isHost);
  const [lines, setLines] = useState<string[]>([]);
  const [narrating, setNarrating] = useState(false);
  const played = useRef(new Set<string>());
  const queue = useRef<QueuedClip[]>([]);
  const voice = useRef<HTMLAudioElement | null>(null);
  const mixer = useRef<Mixer | null>(null);
  const cues = cuesFor(view);
  const cueKey = JSON.stringify(cues);

  // The narration: due cues show as text everywhere, and play where this device speaks.
  useEffect(() => {
    const list = JSON.parse(cueKey) as Cue[];
    const playNext = () => {
      // Clips whose moment has passed (a long clip ran over) are dropped, not played late.
      const { clip, rest } = nextClip(queue.current, Date.now() + clockOffset);
      queue.current = rest;
      if (!clip) {
        setNarrating(false);
        return;
      }
      voice.current ??= new Audio();
      const el = voice.current;
      el.src = assetUrl(clip.src);
      el.onended = playNext;
      el.onerror = playNext;
      setNarrating(true);
      void el.play().catch(playNext);
    };
    const check = () => {
      const now = Date.now() + clockOffset;
      for (const cue of dueCues(list, now, played.current)) {
        played.current.add(cue.id);
        setLines(cue.lines);
        if (!speaks || !unlocked) continue;
        const clips = clipsFor(manifest?.narration, cue.lines);
        const idle = voice.current?.paused ?? true;
        // A new cue replaces clips still waiting from an older one.
        queue.current = enqueueClips(clips, cue.at);
        if (idle) playNext();
      }
    };
    check();
    const id = setInterval(check, 200);
    return () => {
      clearInterval(id);
    };
  }, [cueKey, clockOffset, speaks, unlocked, manifest]);

  // Text from an earlier phase shouldn't linger.
  useEffect(() => {
    if (view.phase === 'lobby' || view.phase === 'ready' || view.phase === 'reveal') setLines([]);
  }, [view.phase]);

  // Music: the phase's track, crossfaded, ducked under the narration.
  const wanted =
    unlocked &&
    devicePlaysMusic({
      mode: view.settings.narration,
      isHost,
      gameMusic: view.settings.music,
      deviceMusic: device.music,
    })
      ? trackFor(manifest?.music, musicPhaseFor(view.phase), Math.max(1, view.gamesPlayed))
      : null;
  const level = musicTarget(device.volume, narrating);
  // A track change starts at the current level; level changes alone go through the effect below.
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
      voice.current?.pause();
    };
  }, []);

  return { lines };
}
