import { storageKey } from '@vt/game-sdk';
import { useCallback, useSyncExternalStore } from 'react';

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
