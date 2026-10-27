import { FULL_VOLUMES, type Volumes, gainOf, useVolumes } from '@vt/ui/sound';
import { useEffect, useRef, useState } from 'react';
import type { NightfallView } from '../logic/types.ts';
import { type Manifest, assetUrl } from './assets.ts';
import {
  CROSSFADE_MS,
  type Cue,
  DEFAULT_MUSIC_VOLUME,
  DUCK_FADE_MS,
  type QueuedClip,
  type Shown,
  afterClip,
  clipsFor,
  cuesFor,
  devicePlaysMusic,
  deviceSpeaks,
  dueCues,
  endShown,
  enqueueClips,
  fitCues,
  limitShown,
  musicChange,
  musicPhaseFor,
  musicTarget,
  nextClip,
  pendingShown,
  ramp,
  scheduleShown,
  shownAt,
  startShown,
  trackFor,
} from './audio.ts';

// ---- This player's own volumes (per device) ----

/** The music plays at its slider × this share, as before the sliders. */
export const MUSIC_SHARE = DEFAULT_MUSIC_VOLUME;

/**
 * This player's volumes: master, music and narration. A phone's own `{ music, volume }` switch from
 * before becomes the music slider (its volume was the music's, out of the 35 % share).
 */
export const useNightfallVolumes = () =>
  useVolumes('nightfall', FULL_VOLUMES, () => {
    try {
      const raw = JSON.parse(localStorage.getItem('vt.nightfall.sound') ?? 'null') as {
        music?: unknown;
        volume?: unknown;
      } | null;
      if (!raw) return null;
      if (raw.music === false) return { music: 0 };
      return typeof raw.volume === 'number'
        ? { music: Math.max(0, Math.min(1, raw.volume / MUSIC_SHARE)) }
        : null;
    } catch {
      return null;
    }
  });

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

// ---- Clip lengths: learned from the files, so closes can be timed to end with their step ----

/** Narration clip lengths in ms, by clip path, for this visit. */
const LENGTHS = new Map<string, number>();
const MEASURING = new Set<string>();

/** Starts reading the lengths of clips not known yet (only the files' headers are fetched). */
function measure(clips: readonly string[]) {
  for (const src of clips) {
    if (LENGTHS.has(src) || MEASURING.has(src)) continue;
    MEASURING.add(src);
    const el = new Audio();
    el.preload = 'metadata';
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) LENGTHS.set(src, el.duration * 1000);
      el.removeAttribute('src');
    };
    el.onerror = () => {
      MEASURING.delete(src);
    };
    el.src = assetUrl(src);
  }
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
 * Plays the narration (and background music) for this device, as the host chose, and returns
 * what the narrator is saying so every screen can show it as text.
 */
export function useSound({
  view,
  manifest,
  isHost,
  clockOffset,
  volumes,
}: {
  view: NightfallView;
  manifest: Manifest | null;
  isHost: boolean;
  clockOffset: number;
  /** This player's own volumes. */
  volumes: Volumes;
}): { said: Shown | null } {
  const unlocked = useGesture();
  const voiceGain = gainOf(volumes, 'voice');
  const musicGain = gainOf(volumes, 'music');
  // A narration slider at 0 keeps the words on screen and the device quiet.
  const speaks = deviceSpeaks(view.settings.narration, isHost) && voiceGain > 0;
  const narrated = view.settings.narration !== 'off';
  const [said, setSaid] = useState<Shown | null>(null);
  // Each cue's words on screen, timed by when it is said; and the cues with clips still to play.
  const shown = useRef<Shown[]>([]);
  const speaking = useRef(new Set<string>());
  const [narrating, setNarrating] = useState(false);
  const played = useRef(new Set<string>());
  const queue = useRef<QueuedClip[]>([]);
  const turns = useRef(0);
  const voice = useRef<HTMLAudioElement | null>(null);
  // The narration's volume applies live to the clip being said.
  const voiceLevel = useRef(voiceGain);
  useEffect(() => {
    voiceLevel.current = voiceGain;
    if (voice.current) voice.current.volume = voiceGain;
  });
  const mixer = useRef<Mixer | null>(null);
  const cues = cuesFor(view);
  const cueKey = JSON.stringify(cues);

  // The narration: due cues show as text everywhere, and play where this device speaks.
  useEffect(() => {
    const narration = manifest?.narration;
    const parsed = JSON.parse(cueKey) as Cue[];
    // The manifest's own clip lengths come first; any it lacks are read from the files.
    for (const [src, ms] of Object.entries(manifest?.durations ?? {}))
      if (!LENGTHS.has(src) && typeof ms === 'number' && ms > 0) LENGTHS.set(src, ms);
    if (speaks) measure(parsed.flatMap((c) => clipsFor(narration, c.lines)));
    const mark = (cue: string, change: (s: Shown) => Shown) => {
      shown.current = shown.current.map((s) => (s.cue === cue ? change(s) : s));
    };
    const playNext = () => {
      // Clips whose moment has passed (the device was away), or that would run too far into the
      // next step, are dropped, not played late.
      const now = Date.now() + clockOffset;
      const { clip, rest } = nextClip(queue.current, now, { lengths: LENGTHS });
      queue.current = rest;
      // A cue's words show from its first clip, and stay once its last ends (or the rest is dropped).
      if (clip) mark(clip.cue, (s) => startShown(s, now));
      const left = new Set([...rest.map((c) => c.cue), ...(clip ? [clip.cue] : [])]);
      for (const cue of speaking.current)
        if (!left.has(cue)) {
          speaking.current.delete(cue);
          mark(cue, (s) => endShown(s, now));
        }
      if (!clip) {
        setNarrating(false);
        return;
      }
      voice.current ??= new Audio();
      const el = voice.current;
      el.volume = voiceLevel.current;
      el.src = assetUrl(clip.src);
      // The cue's next clip is due once this one has had its length (none if it never played).
      // Only the clip playing now moves the queue on: a replaced clip's play() rejects late.
      const turn = ++turns.current;
      const finish = (lengthMs: number) => {
        if (turn !== turns.current) return;
        turns.current++;
        queue.current = afterClip(queue.current, clip, lengthMs);
        playNext();
      };
      el.onended = () => {
        const length = Number.isFinite(el.duration) ? el.duration * 1000 : 0;
        if (length) LENGTHS.set(clip.src, length);
        finish(length);
      };
      el.onerror = () => {
        finish(0);
      };
      setNarrating(true);
      void el.play().catch(() => {
        finish(0);
      });
    };
    const check = () => {
      const now = Date.now() + clockOffset;
      // Closes move earlier once their clips' lengths are known.
      const list = fitCues(parsed, narration, LENGTHS);
      // Words cued before their step began learn when it ends.
      shown.current = shown.current.map((s) => {
        const c = list.find((x) => x.id === s.cue);
        return c ? limitShown(s, c) : s;
      });
      for (const cue of dueCues(list, now, played.current)) {
        played.current.add(cue.id);
        const planned = scheduleShown(cue, shown.current, {
          narrated,
          narration,
          lengths: LENGTHS,
        });
        const clips = speaks && unlocked ? clipsFor(narration, cue.lines) : [];
        // Words this device says itself wait for their first clip; elsewhere they follow the plan.
        // Either way they stay until the next cue's replace them or their step ends.
        shown.current = [
          ...shown.current.filter((s) => s.end > now - 60_000),
          clips.length ? pendingShown(planned) : planned,
        ];
        if (!clips.length) continue;
        speaking.current.add(cue.id);
        const idle = voice.current?.paused ?? true;
        // A new cue waits behind clips still due from an older one (nextClip drops what won't fit).
        queue.current = enqueueClips(clips, cue, queue.current);
        if (idle) playNext();
      }
      const on = shownAt(shown.current, now);
      setSaid((prev) => ((prev?.cue ?? null) === (on?.cue ?? null) ? prev : on));
    };
    check();
    const id = setInterval(check, 200);
    return () => {
      clearInterval(id);
    };
  }, [cueKey, clockOffset, speaks, unlocked, manifest, narrated]);

  // Text from an earlier game shouldn't linger.
  useEffect(() => {
    if (view.phase === 'lobby' || view.phase === 'ready' || view.phase === 'reveal') {
      shown.current = [];
      setSaid(null);
    }
  }, [view.phase]);

  // Music: the phase's track, crossfaded, ducked under the narration.
  const wanted =
    unlocked &&
    devicePlaysMusic({
      mode: view.settings.narration,
      isHost,
      gameMusic: view.settings.music,
      deviceMusic: musicGain > 0,
    })
      ? trackFor(manifest?.music, musicPhaseFor(view.phase), Math.max(1, view.gamesPlayed))
      : null;
  const level = musicTarget(musicGain * MUSIC_SHARE, narrating);
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

  return { said };
}
