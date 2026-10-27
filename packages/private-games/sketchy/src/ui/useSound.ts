import type { ShowAudio } from '@vt/ui/show';
import {
  FULL_VOLUMES,
  type Volumes,
  gainOf,
  legacyDevice,
  soundEngineFor,
  tableVolumes,
  useVolumes,
} from '@vt/ui/sound';
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
/**
 * A phone starts music from silence only once the track has been wanted this long: the room's
 * sound moves to a table screen being paired (or one coming back) within moments, and a phone
 * must not fetch a track it will never play. Switching tracks while one plays is immediate.
 */
export const MUSIC_SETTLE_MS = 3000;
/** Effects the show fires at a moment's notice, kept decoded once a game starts. */
const INSTANT = ['reveal.hit', 'reveal.drumroll', 'write.break', 'vote.tick', 'likes.thumb'];

/** Sketchy's sound types: everyone's own sliders, master 80 % and the narrator off out of the box. */
export const VOLUME_DEFAULTS: Volumes = { ...FULL_VOLUMES, master: DEFAULT_VOLUME, voice: 0 };
/** The table screen's out of the box: the narrator off too, until the host turns it up. */
export const TABLE_DEFAULTS: Volumes = { ...FULL_VOLUMES, voice: 0 };

/** This player's volumes (a phone's own `{ muted, volume }` switch from before becomes the master). */
export const useSketchyVolumes = () =>
  useVolumes(GAME_ID, VOLUME_DEFAULTS, () => legacyDevice(DEVICE_KEY));

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
  volumes,
  slot,
  onWords,
}: {
  view: SketchyView;
  manifest: ManifestState;
  isHost: boolean;
  isStage: boolean;
  stagePresent: boolean;
  clockOffset: number;
  /** This player's own volumes (the table screen plays at the host's table volumes instead). */
  volumes: Volumes;
  /** This player's seat slot: a phone fetches only its own yelp. */
  slot?: number;
  onWords?: (words: string) => void;
}): ShowAudio | null {
  const unlocked = useUnlocked(isStage);
  const audio = manifestOf(manifest)?.audio;
  const s = view.settings;
  const mode = soundModeIn(s, stagePresent);
  const on = unlocked && mode !== 'off' && !!audio;
  // Each type plays at this device's volume for it (the table screen's: the host's); 0 is off.
  const levels = isStage ? tableVolumes(s.tableVolumes, TABLE_DEFAULTS) : volumes;
  const gains = {
    music: gainOf(levels, 'music'),
    effects: gainOf(levels, 'effects'),
    voice: gainOf(levels, 'voice'),
  };
  const d: Device = {
    mode,
    isHost,
    isStage,
    music: gains.music > 0,
    effects: gains.effects > 0,
    voice: gains.voice > 0,
  };
  const dev = useRef(d);
  const latest = useRef({ audio, gains, clockOffset, onWords });
  useEffect(() => {
    dev.current = d;
    latest.current = { audio, gains, clockOffset, onWords };
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
        if (!engine().say(buffer, Date.now(), latest.current.gains.voice, done)) done();
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
        const volume = latest.current.gains.effects * (gain ?? 1);
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
    if (room && d.effects) engine().pin(INSTANT.flatMap((k) => audio.sfx![k] ?? []));
  }, [on, playing, audio, mode, isHost, isStage, d.effects, slot]);

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
    on && d.music && deviceSounds(mode, isHost, isStage) && key
      ? (audio?.music?.[key]?.[0] ?? null)
      : null;
  const settled = useSettled(track, isStage ? 0 : MUSIC_SETTLE_MS);
  const level = gains.music * MUSIC_SHARE * (speaking ? DUCK_RATIO : 1);
  const levelNow = useRef(level);
  useEffect(() => {
    levelNow.current = level;
  });
  useEffect(() => {
    engine().setMusic(settled, levelNow.current);
  }, [settled, unlocked]);
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

/**
 * The track to play: a change to another track or to silence at once, a start from silence once
 * it has been wanted for `wait` ms.
 */
function useSettled(track: string | null, wait: number): string | null {
  const [settled, setSettled] = useState<string | null>(track && wait > 0 ? null : track);
  const fromSilence = settled === null;
  useEffect(() => {
    if (!track || !fromSilence || wait <= 0) {
      setSettled(track);
      return;
    }
    const id = setTimeout(() => setSettled(track), wait);
    return () => {
      clearTimeout(id);
    };
  }, [track, fromSilence, wait]);
  return settled;
}
