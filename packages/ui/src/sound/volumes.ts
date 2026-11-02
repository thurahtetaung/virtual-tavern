import { type HostVolumeAction, type HostVolumes, storageKey } from '@vt/game-sdk';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

// Each player's own volumes for a game's sound, kept on this device (per seat in a playtest): a
// master and one per sound type, each 0 to 1. A sound plays at master × its type's volume, and 0
// is off. The host's settings decide where the room's sound plays; these only how loud it is here.

export type SoundKind = 'music' | 'effects' | 'voice';
export type VolumeKey = 'master' | SoundKind;
export type Volumes = Record<VolumeKey, number>;

export const VOLUME_KEYS: readonly VolumeKey[] = ['master', 'music', 'effects', 'voice'];
export const FULL_VOLUMES: Volumes = { master: 1, music: 1, effects: 1, voice: 1 };

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const isLevel = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** The base key a game's volumes are kept under (`storageKey` adds the playtest seat). */
export const volumesKey = (game: string) => `vt.${game}.volumes`;

/**
 * The volumes in `raw` (stored JSON, or null), each one checked: anything missing or broken is
 * the default. Nothing stored at all takes `legacy` (what an older switch kept) over the defaults.
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
  const from = stored && typeof stored === 'object' ? stored : (legacy ?? {});
  const out = { ...defaults };
  for (const k of VOLUME_KEYS) {
    const v = from[k];
    if (isLevel(v)) out[k] = clamp(v);
  }
  return out;
}

/** How loud a sound type plays: master × its own volume, 0 to 1. */
export const gainOf = (v: Volumes, kind: SoundKind) => clamp(v.master) * clamp(v[kind]);

/** Whether a sound type plays at all on this device. */
export const audible = (v: Volumes, kind: SoundKind) => gainOf(v, kind) > 0;

// One shared copy per key, so the lobby's panel, the in-play sheet and the sound hook move together.
const cache = new Map<string, Volumes>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string, defaults: Volumes, legacy?: () => Partial<Volumes> | null): Volumes {
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
  return v;
}

/** Sets one volume and tells every reader (the stored copy lasts while the browser keeps it). */
export function writeVolume(key: string, defaults: Volumes, which: VolumeKey, level: number) {
  const next = { ...read(key, defaults), [which]: clamp(level) };
  cache.set(key, next);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Private mode: the volumes last for this visit.
  }
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
  defaults: Volumes = FULL_VOLUMES,
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
  const get = () => read(key, defaults, legacy);
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

/** The table screen's volumes as a room keeps them (set by the host), full where unset. */
export function tableVolumes(
  stored: Partial<Record<VolumeKey, unknown>> | null | undefined,
  defaults: Volumes = FULL_VOLUMES,
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

// The host's volumes for everyone (`host-volume` in `@vt/game-sdk`): each device takes the host's
// latest change of a slider into its own volumes once, remembering the version it took, so a
// player's own change afterwards sticks until the host moves that slider again.

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
 * sliders to set (none on the host's own device, where they came from).
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
    set: isHost ? [] : changes.map(({ which, level }) => ({ which, level })),
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
 * The host's own setter: moves the slider here at once and, once the drag settles, sets that
 * slider for everyone (`send`). Anyone else's setter is their own, untouched.
 */
export function useHostSetter(
  setVolume: (which: VolumeKey, level: number) => void,
  isHost: boolean,
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
      if (!isHost) return;
      clearTimeout(timers.current.get(which));
      timers.current.set(
        which,
        setTimeout(() => {
          timers.current.delete(which);
          sendRef.current(which, clamp(level));
        }, HOST_SEND_MS),
      );
    },
    [setVolume, isHost],
  );
}

/** The line under the host's own sliders (`table`: the game's table screen follows them too). */
export const hostLine = (table: boolean) =>
  `Your sliders set everyone’s volume${table ? ' (and the table screen’s)' : ''}; players can change theirs after.`;

/** What a game's sound panel needs to share the host's sliders. */
export interface VolumeShare {
  /** The game's volumes key (`useVolumes`'s first argument). */
  game: string;
  isHost: boolean;
  /** Sends the game's `host-volume` action. */
  send: (which: VolumeKey, level: number) => void;
  /** The game's table screen plays sound and follows the host's sliders too. */
  table?: boolean;
}

/**
 * The panel's side of the host's volumes (the game's root takes the changes in with
 * `useHostVolumes`): the host's setter also sets everyone's, other players see "Set by the host"
 * for a moment, and the host gets a line saying their sliders set everyone's.
 */
export function useVolumeShare(
  share: VolumeShare,
  setVolume: (which: VolumeKey, level: number) => void,
): {
  setVolume: (which: VolumeKey, level: number) => void;
  hostSet: VolumeKey[];
  caption?: string;
} {
  const set = useHostSetter(setVolume, share.isHost, share.send);
  const hostSet = useHostNotes(share.game);
  return {
    setVolume: set,
    hostSet,
    ...(share.isHost ? { caption: hostLine(share.table === true) } : {}),
  };
}

/** A game's `VolumeShare`: the host's sliders go out as the game's `host-volume` action. */
export function volumeShare(
  game: string,
  isHost: boolean,
  act: (action: HostVolumeAction) => unknown,
  table = false,
): VolumeShare {
  return {
    game,
    isHost,
    table,
    send: (which, level) => {
      void act({ type: 'host-volume', which, level });
    },
  };
}
