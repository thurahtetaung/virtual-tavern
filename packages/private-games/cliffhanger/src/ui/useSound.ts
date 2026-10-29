import {
  FULL_VOLUMES,
  type Volumes,
  gainOf,
  soundEngineFor,
  tableVolumes,
  useVolumes,
} from '@vt/ui/sound';
import { useEffect, useRef, useState } from 'react';
import type { CliffhangerView } from '../logic/types.ts';
import type { Manifest } from '../logic/manifest.ts';
import { GAME_ID } from './assets.ts';
import {
  type Cue,
  canPlayType,
  clockCues,
  eventCues,
  fileOf,
  gainFor,
  soundModeOf,
} from './audio.ts';

// Cliffhanger's sound on this device: the clock and the stings from `audio.ts`, each played once,
// where the host's choice puts them, plus the describer's own Got it / switch on their phone.
// Nothing plays before the first tap or key press. Polled: the clock's cues are scheduled a little
// ahead on the audio clock, so they land on the beat whatever React is doing.

const engine = () => soundEngineFor(GAME_ID);
/** How often the schedule is looked at, and how far ahead it is put on the audio clock. */
const POLL_MS = 100;
const AHEAD_MS = 400;
/** A sting seen this long after it was due isn't worth playing. */
const LATE_MS = 1500;

export const VOLUME_DEFAULTS: Volumes = { ...FULL_VOLUMES };
export const TABLE_DEFAULTS: Volumes = { ...FULL_VOLUMES };

export const useCliffhangerVolumes = () => useVolumes(GAME_ID, VOLUME_DEFAULTS);

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

/** The files a cue id plays on this browser. */
const filesOf = (audio: Manifest['audio'], cues: readonly Cue['cue'][]) =>
  cues.map((c) => fileOf(audio, c, canPlayType)).filter((f): f is string => !!f);

/** A short buzz on this phone, where the browser allows it. */
export function buzz(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // Not allowed before a tap: nothing to do.
  }
}

/** Plays the game's sound on this device. `personal(cue)` plays a describer's own cue at once. */
export function useSound({
  view,
  manifest,
  isHost,
  isStage,
  stagePresent,
  clockOffset,
  volumes,
}: {
  view: CliffhangerView;
  manifest: Manifest | null;
  isHost: boolean;
  isStage: boolean;
  stagePresent: boolean;
  clockOffset: number;
  volumes: Volumes;
}): (cue: string) => void {
  const unlocked = useUnlocked(isStage);
  const audio = manifest?.audio;
  const mode = soundModeOf(view.settings, stagePresent);
  const levels = isStage ? tableVolumes(view.settings.tableVolumes, TABLE_DEFAULTS) : volumes;
  const effects = gainOf(levels, 'effects');
  const on = unlocked && mode !== 'off' && !!audio && effects > 0;
  const describing = view.round?.turn?.describer === view.me?.id && view.round?.stage === 'turn';
  const latest = useRef({ view, audio, mode, effects, clockOffset, describing, on });
  useEffect(() => {
    latest.current = { view, audio, mode, effects, clockOffset, describing, on };
  });
  // Keys played (or past when first seen); reset in the lobby.
  const seen = useRef<Set<string> | null>(null);
  const scheduledTo = useRef(0);

  const play = (cue: Cue, now: number) => {
    const l = latest.current;
    const g = gainFor(cue, { mode: l.mode, isHost, isStage, describing: l.describing });
    if (g <= 0 || !l.on) return;
    const file = fileOf(l.audio, cue.cue, canPlayType);
    if (!file) return;
    const localAt = cue.at === null ? Date.now() : cue.at - l.clockOffset;
    void engine().effect(
      file,
      localAt,
      Math.min(1, g * l.effects),
      Math.max(localAt, now) + LATE_MS,
      cue.maxMs,
    );
  };

  useEffect(() => {
    const tick = () => {
      const { view: v, clockOffset: off } = latest.current;
      const server = Date.now() + off;
      if (v.phase === 'lobby') {
        seen.current = new Set();
        scheduledTo.current = server;
        return;
      }
      const first = seen.current === null;
      if (first) seen.current = new Set();
      const keys = seen.current!;
      for (const c of eventCues(v)) {
        if (keys.has(c.key)) continue;
        keys.add(c.key);
        if (!first) play(c, Date.now());
      }
      const from = Math.max(scheduledTo.current, server);
      const to = server + AHEAD_MS;
      if (to > from) {
        for (const c of clockCues(v, from, to)) {
          if (keys.has(c.key)) continue;
          keys.add(c.key);
          play(c, Date.now());
        }
        scheduledTo.current = to;
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      clearInterval(id);
    };
    // `play` reads everything through `latest`.
  }, [isHost, isStage]);

  // Fetch the clips once a game is on, and keep the clock's decoded.
  const playing = view.phase === 'playing';
  useEffect(() => {
    if (!on || !playing) return;
    engine().prefetch(filesOf(audio, Object.keys(audio ?? {}) as Cue['cue'][]));
    engine().pin(filesOf(audio, ['tick', 'hurry', 'hurry2', 'hurry3', 'buzzer', 'press', 'got']));
  }, [on, playing, audio]);

  return (cue) => {
    if (cue === 'pass' || cue === 'press')
      play({ key: `now:${cue}`, cue, at: null, personal: true }, Date.now());
  };
}
