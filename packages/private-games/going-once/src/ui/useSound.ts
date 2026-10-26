import { useCallback, useEffect, useRef, useState } from 'react';
import type { GoingOnceView } from '../logic/types.ts';
import type { ManifestState } from './assets.ts';
import {
  type AudioManifest,
  CUT_MS,
  type Cue,
  DEFAULT_VOLUME,
  LOOKAHEAD_MS,
  STALE_MS,
  type VoiceClip,
  clipOf,
  cuePlays,
  INSTANT_EFFECTS,
  chantClips,
  cutsOff,
  deviceSounds,
  dueCues,
  loadedTooLate,
  effectCues,
  callStart,
  clipSkip,
  enqueueLine,
  musicClips,
  musicFor,
  musicLevel,
  nextVoice,
  ownCues,
  ringClips,
  shiftLine,
  soundModeIn,
  startupClips,
  voiceBusy,
  voiceClipOf,
  voiceLate,
  voiceLine,
} from './audio.ts';
import { type Saying, soundEngine } from './engine.ts';

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

/**
 * The first tap or key press starts the audio (inside the event, as phones require); later ones
 * restart it if the phone suspended it.
 */
function useGesture(auto: boolean): boolean {
  const [unlocked, setUnlocked] = useState(() => soundEngine().ready);
  useEffect(() => {
    // The table screen was started with a tap on its pairing page: the page may play from now on.
    if (auto) {
      soundEngine().unlock();
      setUnlocked(soundEngine().ready);
    }
    const on = () => {
      soundEngine().unlock();
      setUnlocked(soundEngine().ready);
    };
    const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
    for (const e of events) window.addEventListener(e, on, { capture: true });
    return () => {
      for (const e of events) window.removeEventListener(e, on, { capture: true });
    };
  }, [auto]);
  return unlocked;
}

/** Clips decoded ahead: the voice's next few, and effects due this soon. */
const DECODE_AHEAD = 2;
const DECODE_AHEAD_MS = 3000;

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
  colours,
  stagePresent = false,
  isStage = false,
}: {
  view: GoingOnceView;
  manifest: ManifestState;
  you: string | null;
  isHost: boolean;
  clockOffset: number;
  device: DeviceSound;
  /** The room's player colours: lines said to a player are fetched only for these. */
  colours: readonly string[];
  /** A table screen is paired in the room. */
  stagePresent?: boolean;
  /** This device is the table screen. */
  isStage?: boolean;
}): void {
  const unlocked = useGesture(isStage);
  const audio: AudioManifest | undefined =
    manifest && manifest !== 'unavailable' ? manifest.audio : undefined;
  const { music, effects, voice } = view.settings;
  const mode = soundModeIn(view.settings, stagePresent);
  const on = unlocked && !device.muted && mode !== 'off' && !!audio;
  const played = useRef(new Set<string>());
  const [speaking, setSpeaking] = useState(false);
  const prev = useRef<GoingOnceView | null>(null);
  const own = useRef<Cue[]>([]);
  // The voice: clips waiting their turn, the one being said, and since when the voice is free.
  const queue = useRef<VoiceClip[]>([]);
  const saying = useRef<{ clip: VoiceClip; handle: Saying | null } | null>(null);
  const freeSince = useRef(0);
  // When the last chant actually ended here (a call waits a second after it, `callStart`).
  const chantEnded = useRef<number | null>(null);
  const lines = useRef(new Set<string>());
  // The latest of what the voice needs, for callbacks that run after a render.
  const latest = useRef({ audio, clockOffset, volume: device.volume });
  useEffect(() => {
    latest.current = { audio, clockOffset, volume: device.volume };
  });

  // This player's own actions, from the change between views.
  useEffect(() => {
    own.current = [
      ...own.current.filter((c) => c.at > Date.now() + clockOffset - 5000),
      ...ownCues(prev.current, view, Date.now() + clockOffset),
    ];
    prev.current = view;
  }, [view, clockOffset]);

  // Once a game starts (the host has set the sound by then), a device that plays the room's sound
  // fetches what the game will say in the background (a device that only rings, its rings), and
  // keeps the instant effects decoded.
  const shared = on && deviceSounds(mode, isHost, isStage);
  const seated = colours.join(',');
  const playing = view.phase !== 'lobby';
  const contact = view.mine?.contact;
  useEffect(() => {
    if (!on || !playing) return;
    const engine = soundEngine();
    if (!shared) {
      if (effects) engine.prefetch(ringClips(audio, contact));
      return;
    }
    engine.prefetch(startupClips(audio, seated.split(','), { effects, voice }));
    if (effects) engine.pin(INSTANT_EFFECTS.flatMap((k) => audio?.sfx?.[k] ?? []));
  }, [on, playing, shared, effects, voice, audio, seated, contact]);

  // The chants for the next likely bids, and the music now and next.
  useEffect(() => {
    if (!shared) return;
    const engine = soundEngine();
    if (voice) engine.prefetch(chantClips(audio, view));
    if (music) engine.prefetch(musicClips(audio, view));
  }, [shared, voice, music, audio, view]);

  // The voice's next few clips decode while the one before is said.
  const decodeAhead = useCallback(() => {
    const voiceClips = latest.current.audio?.voice;
    for (const c of queue.current.slice(0, DECODE_AHEAD)) {
      const src = clipOf(voiceClips, c.key, c.pick);
      if (src) void soundEngine().load(src);
    }
  }, []);

  // Says the next clip once the voice is free: each clip to its end, a late start moving the
  // rest of its line back (a chant keeps its time, skipping its head so going once follows it on
  // time), and only clips too late for their moment dropped.
  const pump = useCallback(() => {
    if (saying.current) return;
    const { audio: a, clockOffset: offset } = latest.current;
    const now = Date.now() + offset;
    const { clip, rest } = nextVoice(queue.current, now, freeSince.current, LOOKAHEAD_MS);
    queue.current = rest;
    setSpeaking(voiceBusy(!!clip, rest, now));
    if (!clip) return;
    const src = clipOf(a?.voice, clip.key, clip.pick);
    if (!src) {
      pump();
      return;
    }
    const engine = soundEngine();
    const said = { clip, handle: null as Saying | null };
    saying.current = said;
    const done = () => {
      if (saying.current !== said) return;
      saying.current = null;
      freeSince.current = Date.now() + latest.current.clockOffset;
      chantEnded.current = clip.key.startsWith('chant') ? freeSince.current : null;
      pump();
    };
    void engine.load(src).then((buffer) => {
      if (saying.current !== said) return;
      const at = Date.now() + latest.current.clockOffset;
      // Lateness counts from when its turn came, not from when its file was ready.
      if (!buffer || voiceLate(clip, now, freeSince.current) || loadedTooLate(now, at)) {
        done();
        return;
      }
      const start = callStart(clip, Math.max(at, clip.at), chantEnded.current);
      const skip = clipSkip(clip, start, buffer.duration * 1000);
      if (skip === null) {
        done();
        return;
      }
      queue.current = shiftLine(queue.current, clip.line, start - clip.at);
      decodeAhead();
      said.handle = engine.say(
        buffer,
        start - latest.current.clockOffset,
        latest.current.volume,
        done,
        skip,
      );
      if (!said.handle) done();
    });
  }, [decodeAhead]);

  // A new line: it waits behind the clip being said (or cuts off a chant, or a line a Skip ended),
  // and its clips start loading at once.
  const hear = useCallback(
    (clips: VoiceClip[]) => {
      if (!clips.length) return;
      // The whole line is fetched now (most of it is here already); its first clips decode.
      soundEngine().prefetch(
        clips.flatMap((c) => clipOf(latest.current.audio?.voice, c.key, c.pick) ?? []),
      );
      queue.current = enqueueLine(queue.current, clips);
      decodeAhead();
      const now = saying.current;
      if (now?.handle && cutsOff(now.clip, clips[0]!)) now.handle.cut(CUT_MS);
      else if (now && !now.handle && cutsOff(now.clip, clips[0]!)) {
        // Still loading: it gives way before it starts.
        saying.current = null;
        freeSince.current = Date.now() + latest.current.clockOffset;
      }
      pump();
    },
    [pump, decodeAhead],
  );

  // Effects and the voice: due cues play once, where this device plays them.
  useEffect(() => {
    if (!on) return;
    const opts = { mode, isHost, effects, voice, isStage };
    const engine = soundEngine();
    const check = () => {
      const now = Date.now() + clockOffset;
      const line = voiceLine(view);
      const id = line[0]?.line;
      if (id && !lines.current.has(id)) {
        lines.current.add(id);
        if (voice && deviceSounds(mode, isHost, isStage)) hear(line);
      }
      const cues = [...effectCues(view, you), ...own.current];
      for (const cue of cues) {
        // Effects still to come load ahead of their moment.
        const src = cue.kind === 'sfx' ? clipOf(audio?.sfx, cue.key, cue.pick ?? cue.at) : null;
        if (src && cuePlays(cue, opts) && cue.at > now && cue.at < now + DECODE_AHEAD_MS)
          void engine.load(src);
      }
      for (const cue of dueCues(cues, now, played.current, LOOKAHEAD_MS)) {
        played.current.add(cue.id);
        if (!cuePlays(cue, opts)) continue;
        if (cue.kind === 'voice') {
          hear([voiceClipOf(cue, view.game?.stage ?? '')]);
          continue;
        }
        const src = clipOf(audio?.sfx, cue.key, cue.pick ?? cue.at);
        if (src)
          void engine.effect(
            src,
            cue.at - clockOffset,
            device.volume,
            cue.at - clockOffset + STALE_MS,
            cue.maxMs,
          );
      }
      // The voice moves on by itself; this catches a clip that was waiting for its moment.
      pump();
      if (played.current.size > 2000) played.current = new Set([...played.current].slice(-500));
      if (lines.current.size > 500) lines.current = new Set([...lines.current].slice(-100));
    };
    check();
    const timer = setInterval(check, 100);
    return () => {
      clearInterval(timer);
    };
  }, [
    on,
    view,
    you,
    clockOffset,
    audio,
    mode,
    isHost,
    effects,
    voice,
    device.volume,
    hear,
    pump,
    isStage,
  ]);

  // A device that goes quiet stops talking at once.
  useEffect(() => {
    if (on && voice && deviceSounds(mode, isHost, isStage)) return;
    queue.current = [];
    saying.current?.handle?.cut(CUT_MS);
    saying.current = null;
    setSpeaking(false);
  }, [on, voice, mode, isHost, isStage]);

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
    on && music && deviceSounds(mode, isHost, isStage) && choice
      ? clipOf(audio?.music, choice.key, choice.pick)
      : null;
  const level = musicLevel(device.volume, speaking);
  const levelNow = useRef(level);
  useEffect(() => {
    levelNow.current = level;
  });
  useEffect(() => {
    soundEngine().setMusic(wanted, levelNow.current);
  }, [wanted, unlocked]);
  useEffect(() => {
    soundEngine().setMusicLevel(level);
  }, [level]);
  useEffect(() => {
    return () => {
      soundEngine().setMusic(null, 0);
      queue.current = [];
      saying.current?.handle?.cut(CUT_MS);
      saying.current = null;
    };
  }, []);
}
