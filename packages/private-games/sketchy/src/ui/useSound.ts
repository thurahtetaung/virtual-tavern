import type { ShowAudio } from '@vt/ui/show';
import { soundEngineFor } from '@vt/ui/sound';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SketchyView } from '../logic/types.ts';
import { GAME_ID, type ManifestState, manifestOf } from './assets.ts';
import {
  DEFAULT_VOLUME,
  DUCK_RATIO,
  type Device,
  MUSIC_SHARE,
  deviceSounds,
  fileOf,
  musicFor,
  plays,
  soundModeIn,
} from './audio.ts';
import { revealEndOf } from './show.ts';

// Sketchy's sound on this device: the show's sound steps routed here (`plays` decides which device
// makes the room's sound and which hears only its own cues), the music for each part of the game,
// and the narrator's lines one after another. Nothing plays before the first tap or key press.

const engine = () => soundEngineFor(GAME_ID);
const DEVICE_KEY = 'vt.sketchy.sound';
/** A narrator line still waiting this long after its moment is dropped. */
const VOICE_WAIT_MS = 2500;
/** Effects the show fires at a moment's notice, kept decoded once a game starts. */
const INSTANT = ['reveal.hit', 'reveal.drumroll', 'write.break', 'vote.tick', 'likes.thumb'];

export interface DeviceSound {
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

/** This device's own mute and volume (a per-device convenience). */
export function useDeviceSound(): [DeviceSound, (next: Partial<DeviceSound>) => void] {
  const [sound, setSound] = useState(loadDevice);
  const update = useCallback((next: Partial<DeviceSound>) => {
    setSound((prev) => {
      const merged = { ...prev, ...next };
      try {
        localStorage.setItem(DEVICE_KEY, JSON.stringify(merged));
      } catch {
        // Private mode: the choice lasts for this visit.
      }
      return merged;
    });
  }, []);
  return [sound, update];
}

/** The first tap or key press starts the audio (the table screen was started by a tap already). */
function useUnlocked(auto: boolean): boolean {
  const [unlocked, setUnlocked] = useState(() => engine().ready);
  useEffect(() => {
    const on = () => {
      engine().unlock();
      setUnlocked(engine().ready);
    };
    if (auto) on();
    const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
    for (const e of events) window.addEventListener(e, on, { capture: true });
    return () => {
      for (const e of events) window.removeEventListener(e, on, { capture: true });
    };
  }, [auto]);
  return unlocked;
}

interface Line {
  file: string;
  at: number;
  words: string;
}

/**
 * The sound for the show on this device: returns the `ShowAudio` the show's player hands every
 * sound step to, and plays the music. `onWords` shows what the narrator is saying.
 */
export function useSound({
  view,
  manifest,
  isHost,
  isStage,
  stagePresent,
  clockOffset,
  device,
  slot,
  onWords,
}: {
  view: SketchyView;
  manifest: ManifestState;
  isHost: boolean;
  isStage: boolean;
  stagePresent: boolean;
  clockOffset: number;
  device: DeviceSound;
  /** This player's seat slot: a phone fetches only its own yelp. */
  slot?: number;
  onWords?: (words: string) => void;
}): ShowAudio | null {
  const unlocked = useUnlocked(isStage);
  const audio = manifestOf(manifest)?.audio;
  const s = view.settings;
  const mode = soundModeIn(s, stagePresent);
  const on = unlocked && !device.muted && mode !== 'off' && !!audio;
  const d: Device = { mode, isHost, isStage, music: s.music, effects: s.effects, voice: s.voice };
  const dev = useRef(d);
  const latest = useRef({ audio, volume: device.volume, clockOffset, onWords });
  useEffect(() => {
    dev.current = d;
    latest.current = { audio, volume: device.volume, clockOffset, onWords };
  });
  const [speaking, setSpeaking] = useState(false);
  const queue = useRef<Line[]>([]);
  const busy = useRef(false);

  const say = useCallback(() => {
    if (busy.current) return;
    const now = Date.now();
    queue.current = queue.current.filter((l) => now - l.at < VOICE_WAIT_MS);
    const line = queue.current.shift();
    if (!line) {
      setSpeaking(false);
      return;
    }
    busy.current = true;
    setSpeaking(true);
    const done = () => {
      busy.current = false;
      latest.current.onWords?.('');
      say();
    };
    void engine()
      .load(line.file)
      .then((buffer) => {
        if (!buffer) return done();
        latest.current.onWords?.(line.words);
        if (!engine().say(buffer, Date.now(), latest.current.volume, done)) done();
      });
  }, []);

  const showAudio = useMemo<ShowAudio | null>(() => {
    if (!on) return null;
    return {
      play(clip, offsetMs, gain, ms) {
        const a = latest.current.audio;
        if (!plays(clip, dev.current)) return;
        const file = fileOf(a, clip);
        if (!file) return;
        if (clip.startsWith('voice:') || clip.startsWith('joke:')) {
          queue.current.push({ file, at: Date.now() - offsetMs, words: a?.text?.[file] ?? '' });
          say();
          return;
        }
        const volume = latest.current.volume * (gain ?? 1);
        // Late by `offsetMs`: an effect is short, so it plays at once (or is cut at its end).
        const left = ms ? ms - offsetMs : undefined;
        if (left !== undefined && left <= 0) return;
        void engine().effect(file, Date.now(), volume, Date.now() + 1500, left);
      },
    };
  }, [on, say]);

  // Fetch ahead once a game is on: every effect (small), and keep the instant ones decoded.
  const playing = view.phase === 'playing';
  useEffect(() => {
    if (!on || !playing || !audio?.sfx) return;
    const room = deviceSounds(mode, isHost, isStage);
    const keys = Object.keys(audio.sfx).filter((k) => room || k.startsWith('me.'));
    // Of the personal yelps, only this player's own.
    const own = (k: string) =>
      k === 'me.yelp'
        ? slot === undefined
          ? []
          : [fileOf(audio, `me:yelp#${slot}`) ?? '']
        : (audio.sfx![k] ?? []);
    engine().prefetch(keys.flatMap(own).filter(Boolean));
    if (room && s.effects) engine().pin(INSTANT.flatMap((k) => audio.sfx![k] ?? []));
  }, [on, playing, audio, mode, isHost, isStage, s.effects, slot]);

  // Music: the part of the game's track, crossfaded, ducked under the narrator.
  const turn = view.game?.turn ?? null;
  const end = turn ? revealEndOf(turn) : null;
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (end === null) return;
    const wait = end - (Date.now() + clockOffset);
    if (wait <= 0) return;
    const id = setTimeout(() => setClock(Date.now()), wait + 50);
    return () => {
      clearTimeout(id);
    };
  }, [end, clockOffset]);
  const key = musicFor(view, clock + clockOffset, end);
  const track =
    on && s.music && deviceSounds(mode, isHost, isStage) && key
      ? (audio?.music?.[key]?.[0] ?? null)
      : null;
  const level = device.volume * MUSIC_SHARE * (speaking ? DUCK_RATIO : 1);
  const levelNow = useRef(level);
  useEffect(() => {
    levelNow.current = level;
  });
  useEffect(() => {
    engine().setMusic(track, levelNow.current);
  }, [track, unlocked]);
  useEffect(() => {
    engine().setMusicLevel(level);
  }, [level]);
  useEffect(() => {
    return () => {
      engine().setMusic(null, 0);
      queue.current = [];
    };
  }, []);
  return showAudio;
}
