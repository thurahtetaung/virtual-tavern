import {
  type HostVolumeAction,
  type HostVolumeMode,
  type HostVolumes,
  hostVolumeMode,
  storageKey,
} from '@vt/game-sdk';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

// Each player's own volumes for a game's sound, kept on this device (per seat in a playtest): a
// master and one per sound type, each 0 to 1. A sound plays at master × its type's volume, and 0
// is off. The master slider shows only where more than one type plays on a device; where it
// doesn't, it counts as 100 %, so the one slider a player sees is the real volume. The host's settings decide where the room's sound plays; these only how loud it is here.

export type SoundKind = 'music' | 'effects' | 'voice';
export type VolumeKey = 'master' | SoundKind;
export type Volumes = Record<VolumeKey, number>;

export const VOLUME_KEYS: readonly VolumeKey[] = ['master', 'music', 'effects', 'voice'];
export const FULL_VOLUMES: Volumes = { master: 1, music: 1, effects: 1, voice: 1 };
/** Every slider out of the box, the table screen's too: half way. */
export const DEFAULT_VOLUMES: Volumes = { master: 0.5, music: 0.5, effects: 0.5, voice: 0.5 };

/**
 * The mark a device's stored volumes carry once they have been reset to the defaults: volumes
 * stored without it (before every slider started at 50 %) read as the defaults, once, and the
 * player's changes after that stick.
 */
export const VOLUMES_RESET = 1;

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const isLevel = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The base key a game's volumes are kept under (`storageKey` adds the playtest seat). */
export const volumesKey = (game: string) => `vt.${game}.volumes`;

/**
 * The volumes in `raw` (stored JSON, or null), each one checked: anything missing or broken is
 * the default. Nothing stored at all takes `legacy` (what an older switch kept) over the defaults;
 * volumes stored before the reset (without `reset: VOLUMES_RESET`) read as the defaults.
 */
export function parseVolumes(
  raw: string | null,
  defaults: Volumes,
  legacy?: Partial<Volumes> | null,
): Volumes {
  let stored: Partial<Record<VolumeKey, unknown>> | null;
  try {
    stored = raw ? (JSON.parse(raw) as Partial<Record<VolumeKey, unknown>>) : null;
  } catch {
    stored = null;
  }
  const kept = stored && typeof stored === 'object' ? stored : null;
  if (kept && (kept as { reset?: unknown }).reset !== VOLUMES_RESET) return { ...defaults };
  const from = kept ?? legacy ?? {};
  const out = { ...defaults };
  for (const k of VOLUME_KEYS) {
    const v = from[k];
    if (isLevel(v)) out[k] = clamp(v);
  }
  return out;
}

/** Whether the master ("All sound") slider shows: only with more than one sound type here. */
export const masterShown = (kinds: readonly SoundKind[]) => kinds.length > 1;

/**
 * The volumes as they are heard where `kinds` play: a master whose slider isn't shown counts as
 * 100 %, whatever was stored for it (an older default, a mute from before, or the host's).
 */
export const heardVolumes = (v: Volumes, kinds: readonly SoundKind[]): Volumes =>
  masterShown(kinds) ? v : { ...v, master: 1 };

/**
 * How loud a sound type plays on a device where `kinds` play (the sliders it shows): master × its
 * own volume, 0 to 1, with the master at 100 % where only one type plays. Always pass `kinds`:
 * without it the master always counts, as before this rule.
 */
export const gainOf = (v: Volumes, kind: SoundKind, kinds?: readonly SoundKind[]) =>
  clamp(kinds ? heardVolumes(v, kinds).master : v.master) * clamp(v[kind]);

/** Whether a sound type plays at all on a device where `kinds` play. */
export const audible = (v: Volumes, kind: SoundKind, kinds?: readonly SoundKind[]) =>
  gainOf(v, kind, kinds) > 0;

// One shared copy per key, so the lobby's panel, the in-play sheet and the sound hook move together.
const cache = new Map<string, Volumes>();
const listeners = new Map<string, Set<() => void>>();

/**
 * A device's volumes under `key` (the shared copy once read): stored ones from before the reset are
 * reset to the defaults, and the reset stored at once, so it happens only once.
 */
export function readVolumes(
  key: string,
  defaults: Volumes,
  legacy?: () => Partial<Volumes> | null,
): Volumes {
  const known = cache.get(key);
  if (known) return known;
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    raw = null;
  }
  const v = parseVolumes(raw, defaults, raw ? null : legacy?.());
  cache.set(key, v);
  if (raw && !isReset(raw)) store(key, v);
  return v;
}

function isReset(raw: string): boolean {
  try {
    return (JSON.parse(raw) as { reset?: unknown } | null)?.reset === VOLUMES_RESET;
  } catch {
    return false;
  }
}

function store(key: string, v: Volumes) {
  try {
    localStorage.setItem(key, JSON.stringify({ ...v, reset: VOLUMES_RESET }));
  } catch {
    // Private mode: the volumes last for this visit.
  }
}

/** Sets one volume and tells every reader (the stored copy lasts while the browser keeps it). */
export function writeVolume(key: string, defaults: Volumes, which: VolumeKey, level: number) {
  const next = { ...readVolumes(key, defaults), [which]: clamp(level) };
  cache.set(key, next);
  store(key, next);
  for (const l of listeners.get(key) ?? []) l();
}

/** Forgets the shared copies (tests). */
export function resetVolumeCache() {
  cache.clear();
}

/**
 * This player's volumes for `game`, and a setter. `legacy` reads what an older sound switch kept,
 * used once when nothing is stored yet.
 */
export function useVolumes(
  game: string,
  defaults: Volumes = DEFAULT_VOLUMES,
  legacy?: () => Partial<Volumes> | null,
): [Volumes, (which: VolumeKey, level: number) => void] {
  const key = storageKey(volumesKey(game));
  const subscribe = useCallback(
    (on: () => void) => {
      let set = listeners.get(key);
      if (!set) listeners.set(key, (set = new Set()));
      set.add(on);
      return () => {
        set.delete(on);
      };
    },
    [key],
  );
  const get = () => readVolumes(key, defaults, legacy);
  const volumes = useSyncExternalStore(subscribe, get, get);
  const set = useCallback(
    (which: VolumeKey, level: number) => {
      writeVolume(key, defaults, which, level);
    },
    // `defaults` is a game's constant.
    [key, defaults],
  );
  return [volumes, set];
}

/** Reads an older `{ muted, volume }` device switch as a master volume. */
export function legacyDevice(key: string): Partial<Volumes> | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as {
      muted?: unknown;
      volume?: unknown;
    } | null;
    if (!raw || typeof raw !== 'object') return null;
    if (raw.muted === true) return { master: 0 };
    return isLevel(raw.volume) ? { master: clamp(raw.volume) } : null;
  } catch {
    return null;
  }
}

/** The table screen's volumes as a room keeps them (set by the host), the defaults where unset. */
export function tableVolumes(
  stored: Partial<Record<VolumeKey, unknown>> | null | undefined,
  defaults: Volumes = DEFAULT_VOLUMES,
): Volumes {
  const out = { ...defaults };
  for (const k of VOLUME_KEYS) {
    const v = stored?.[k];
    if (isLevel(v)) out[k] = clamp(v);
  }
  return out;
}

/** Where the room's sound plays, as a host picks it. */
export type WhereMode = 'off' | 'host' | 'all' | 'stage';

/** Which sliders a device gets: its own, and (the host, with a table screen) the table's. */
export interface SoundPlan {
  mine: SoundKind[];
  table: SoundKind[];
}

/**
 * The sliders for the sound that actually plays on this device: the room's types (`room`) where
 * the room's sound plays here, plus the personal ones (`personal`, a player's own cues) wherever
 * sound is on. The table screen has no input, so with "Table screen" the host gets its sliders.
 */
export function soundPlan(
  mode: WhereMode,
  isHost: boolean,
  room: readonly SoundKind[],
  personal: readonly SoundKind[] = [],
): SoundPlan {
  const both = (a: readonly SoundKind[]) =>
    (['music', 'effects', 'voice'] as const).filter((k) => a.includes(k) || personal.includes(k));
  if (mode === 'off') return { mine: [], table: [] };
  if (mode === 'all' || (mode === 'host' && isHost)) return { mine: both(room), table: [] };
  if (mode === 'host') return { mine: both([]), table: [] };
  return { mine: both([]), table: isHost ? [...room] : [] };
}

/** The line saying where the room's sound plays ("Sound plays on Ana’s phone."). */
export function whereLine(mode: WhereMode, host: string, isHost: boolean): string {
  switch (mode) {
    case 'off':
      return 'Sound is off: the host’s choice.';
    case 'host':
      return isHost ? 'Sound plays on your phone (the host’s).' : `Sound plays on ${host}’s phone.`;
    case 'all':
      return 'Sound plays on every phone.';
    case 'stage':
      return isHost
        ? 'Sound plays on the table screen: your Table screen sliders set its volume.'
        : `Sound plays on the table screen; ${host} (the host) sets its volume.`;
  }
}

// The host's volumes for everyone (`host-volume` in `@vt/game-sdk`): with "Everyone", each device
// takes the host's latest change of a slider into its own volumes once, remembering the version it
// took, so a player's own change afterwards sticks until the host moves that slider again. With
// "Just me" the host's sliders are their own; a device only records what the room holds, so
// switching to "Everyone" pushes nothing until the host's next move.

/** The base key of the host's versions a device has taken in (`storageKey` adds the seat). */
export const hostAppliedKey = (game: string) => `vt.${game}.volumes.host`;

/** How long a slider says "Set by the host" after the host moved it. */
export const HOST_NOTE_MS = 8000;

export type Applied = Partial<Record<VolumeKey, number>>;

/** The host's changes this device hasn't taken in yet. */
export function hostChanges(
  host: HostVolumes | null | undefined,
  applied: Applied,
): { which: VolumeKey; level: number; v: number }[] {
  const out: { which: VolumeKey; level: number; v: number }[] = [];
  for (const k of VOLUME_KEYS) {
    const h = host?.[k];
    if (!h || !isLevel(h.level) || !isLevel(h.v) || applied[k] === h.v) continue;
    out.push({ which: k, level: clamp(h.level), v: h.v });
  }
  return out;
}

/**
 * What this device does with the room's host volumes: the versions it has now taken in, and the
 * sliders to set (none on the host's own device, where they came from, and none with "Just me").
 */
export function takeHostChanges(
  host: HostVolumes | null | undefined,
  applied: Applied,
  isHost: boolean,
): { applied: Applied; set: { which: VolumeKey; level: number }[] } {
  const changes = hostChanges(host, applied);
  const next = { ...applied };
  for (const c of changes) next[c.which] = c.v;
  return {
    applied: next,
    set:
      isHost || hostVolumeMode(host) !== 'all'
        ? []
        : changes.map(({ which, level }) => ({ which, level })),
  };
}

function readApplied(key: string): Applied {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Record<string, unknown> | null;
    const out: Applied = {};
    for (const k of VOLUME_KEYS) if (raw && isLevel(raw[k])) out[k] = raw[k];
    return out;
  } catch {
    return {};
  }
}

// Which sliders the host just set, per game, for the "Set by the host" line.
const notes = new Map<string, Partial<Record<VolumeKey, number>>>();
const noteListeners = new Set<() => void>();
const tellNotes = () => {
  for (const l of noteListeners) l();
};

function noteHostSet(game: string, which: VolumeKey, now: number) {
  notes.set(game, { ...notes.get(game), [which]: now + HOST_NOTE_MS });
  tellNotes();
  setTimeout(tellNotes, HOST_NOTE_MS + 50);
}

/** Forgets the "Set by the host" notes (tests). */
export function resetHostNotes() {
  notes.clear();
}

/** The sliders the host set in the last few seconds on this device (empty for the host). */
export function useHostNotes(game: string): VolumeKey[] {
  const subscribe = useCallback((on: () => void) => {
    noteListeners.add(on);
    return () => {
      noteListeners.delete(on);
    };
  }, []);
  const get = () => {
    const until = notes.get(game) ?? {};
    const now = Date.now();
    return VOLUME_KEYS.filter((k) => (until[k] ?? 0) > now).join(',');
  };
  const list = useSyncExternalStore(subscribe, get, get);
  return list ? (list.split(',') as VolumeKey[]) : [];
}

/**
 * Takes the host's changes into this device's volumes, once each. Call it where the game is always
 * mounted (lobby and play), with the game's own volume setter. The host's own device only records
 * the versions: its sliders are where they came from.
 */
export function useHostVolumes({
  game,
  host,
  isHost,
  setVolume,
}: {
  game: string;
  host: HostVolumes | null | undefined;
  isHost: boolean;
  setVolume: (which: VolumeKey, level: number) => void;
}) {
  const key = storageKey(hostAppliedKey(game));
  const setRef = useRef(setVolume);
  useEffect(() => {
    setRef.current = setVolume;
  });
  const sig = JSON.stringify(host ?? null);
  useEffect(() => {
    const before = readApplied(key);
    const { applied, set } = takeHostChanges(host, before, isHost);
    if (JSON.stringify(applied) === JSON.stringify(before)) return;
    const now = Date.now();
    for (const c of set) {
      setRef.current(c.which, c.level);
      noteHostSet(game, c.which, now);
    }
    try {
      localStorage.setItem(key, JSON.stringify(applied));
    } catch {
      // Private mode: taken in for this visit only.
    }
    // `sig` stands for `host`.
  }, [sig, key, isHost, game]);
}

/** How long the host's slider waits for the drag to settle before telling the room. */
export const HOST_SEND_MS = 250;

/**
 * The host's own setter: moves the slider here at once and, with "Everyone" (`shares`), once the
 * drag settles, sets that slider for everyone (`send`). Anyone else's setter is their own.
 */
export function useHostSetter(
  setVolume: (which: VolumeKey, level: number) => void,
  shares: boolean,
  send: (which: VolumeKey, level: number) => void,
): (which: VolumeKey, level: number) => void {
  const timers = useRef(new Map<VolumeKey, ReturnType<typeof setTimeout>>());
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of t.values()) clearTimeout(id);
    };
  }, []);
  return useCallback(
    (which: VolumeKey, level: number) => {
      setVolume(which, level);
      if (!shares) return;
      clearTimeout(timers.current.get(which));
      timers.current.set(
        which,
        setTimeout(() => {
          timers.current.delete(which);
          sendRef.current(which, clamp(level));
        }, HOST_SEND_MS),
      );
    },
    [setVolume, shares],
  );
}

/**
 * The line under the host's own sliders, saying whose volume they set (`table`: the game's table
 * screen follows them too with "Everyone").
 */
export const hostLine = (mode: HostVolumeMode, table: boolean) =>
  mode === 'all'
    ? `Your sliders set everyone’s volume${table ? ' (and the table screen’s)' : ''}; players can change theirs after.`
    : 'Your sliders set only your own volume, like everyone else’s.';

/** What a game's sound panel needs to share the host's sliders. */
export interface VolumeShare {
  /** The game's volumes key (`useVolumes`'s first argument). */
  game: string;
  isHost: boolean;
  /** Whose volume the host's sliders set (the room's choice). */
  mode: HostVolumeMode;
  /** Sends the game's `host-volume` action with a slider's level. */
  send: (which: VolumeKey, level: number) => void;
  /** Sends the game's `host-volume` action with the host's choice. */
  setMode: (mode: HostVolumeMode) => void;
  /** The game's table screen plays sound and follows the host's sliders too. */
  table?: boolean;
}

/** The host's choice of whose volume their sliders set, for the panel's switch. */
export interface HostModeControl {
  mode: HostVolumeMode;
  set: (mode: HostVolumeMode) => void;
}

/**
 * The panel's side of the host's volumes (the game's root takes the changes in with
 * `useHostVolumes`): the host gets the "Just me / Everyone" switch and a line saying which is on;
 * with "Everyone" the host's setter also sets everyone's, and other players see "Set by the host"
 * for a moment.
 */
export function useVolumeShare(
  share: VolumeShare,
  setVolume: (which: VolumeKey, level: number) => void,
): {
  setVolume: (which: VolumeKey, level: number) => void;
  hostSet: VolumeKey[];
  caption?: string;
  hostMode?: HostModeControl;
} {
  const set = useHostSetter(setVolume, share.isHost && share.mode === 'all', share.send);
  const hostSet = useHostNotes(share.game);
  return {
    setVolume: set,
    hostSet,
    ...(share.isHost
      ? {
          caption: hostLine(share.mode, share.table === true),
          hostMode: { mode: share.mode, set: share.setMode },
        }
      : {}),
  };
}

/**
 * A game's `VolumeShare`: the host's sliders and choice go out as the game's `host-volume` action;
 * `host` is the room's host volumes (where the choice is kept).
 */
export function volumeShare(
  game: string,
  isHost: boolean,
  act: (action: HostVolumeAction) => unknown,
  host: HostVolumes | null | undefined,
  table = false,
): VolumeShare {
  return {
    game,
    isHost,
    table,
    mode: hostVolumeMode(host),
    send: (which, level) => {
      void act({ type: 'host-volume', which, level });
    },
    setMode: (mode) => {
      void act({ type: 'host-volume', mode });
    },
  };
}
