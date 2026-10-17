import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from './db/index.ts';
import { appSettings } from './db/schema.ts';
import { type GameRegistry, isPrivate } from './games/registry.ts';

const TITLES_KEY = 'private_game_titles';
const MUSIC_KEY = 'private_game_music';

export const MUSIC_PHASES = ['lobby', 'night', 'day', 'vote', 'reveal'] as const;
export type MusicPhase = (typeof MUSIC_PHASES)[number];
/** Track paths per phase (paths as the manifest's `musicTracks.*.file`). */
export type MusicMap = Partial<Record<MusicPhase, string[]>>;

export const gameTitleBody = z.object({
  /** The title to show unlocked players; null or empty clears it. */
  title: z.string().trim().max(80).nullable(),
});

const trackPath = z.string().min(1).max(200);
export const musicBody = z.object({
  /** Per phase; a missing phase falls back to the manifest's defaults. Null clears them all. */
  music: z
    .object(Object.fromEntries(MUSIC_PHASES.map((p) => [p, z.array(trackPath).max(40).optional()])))
    .strict()
    .nullable(),
});

/** The music each phase plays: the admin's choice where set, else the manifest's default. */
export function effectiveMusic(defaults: unknown, override: MusicMap | null): MusicMap {
  const base = (defaults && typeof defaults === 'object' ? defaults : {}) as Record<
    string,
    unknown
  >;
  const out: MusicMap = {};
  for (const phase of MUSIC_PHASES) {
    const chosen = override?.[phase];
    const fallback = base[phase];
    if (chosen) out[phase] = [...chosen];
    else if (Array.isArray(fallback))
      out[phase] = fallback.filter((t): t is string => typeof t === 'string');
  }
  return out;
}

/** The track files a manifest lists in `musicTracks` (`{ <id>: { file } }`). */
export function manifestTracks(manifest: unknown): string[] {
  const tracks = (manifest as { musicTracks?: unknown } | null)?.musicTracks;
  if (!tracks || typeof tracks !== 'object') return [];
  return Object.values(tracks as Record<string, { file?: unknown }>).flatMap((t) =>
    typeof t?.file === 'string' ? [t.file] : [],
  );
}

/** The first chosen path that isn't one of the manifest's tracks, or null. */
export function unknownTrack(music: MusicMap, tracks: readonly string[]): string | null {
  for (const phase of MUSIC_PHASES)
    for (const t of music[phase] ?? []) if (!tracks.includes(t)) return t;
  return null;
}

/**
 * Admin settings for back-room games, kept in the app settings table: the title shown to unlocked
 * players (the repository only ever uses each game's code name), and per-phase music overrides.
 * Both are maps by game id, so any private game can use them.
 */
export class PrivateGameSettings {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  private read<T>(key: string): Record<string, T> {
    const raw = this.db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, T>) : {};
    } catch {
      return {};
    }
  }

  private write(key: string, value: Record<string, unknown>) {
    const json = JSON.stringify(value);
    this.db
      .insert(appSettings)
      .values({ key, value: json })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: json } })
      .run();
  }

  titles(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.read<unknown>(TITLES_KEY)).filter(
        (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0,
      ),
    );
  }

  title(gameId: string): string | null {
    return this.titles()[gameId] ?? null;
  }

  setTitle(gameId: string, title: string | null) {
    const all = this.titles();
    if (title) all[gameId] = title;
    else delete all[gameId];
    this.write(TITLES_KEY, all);
  }

  music(gameId: string): MusicMap | null {
    return this.read<MusicMap>(MUSIC_KEY)[gameId] ?? null;
  }

  setMusic(gameId: string, music: MusicMap | null) {
    const all = this.read<MusicMap>(MUSIC_KEY);
    const kept = music
      ? Object.fromEntries(MUSIC_PHASES.flatMap((p) => (music[p] ? [[p, music[p]]] : [])))
      : {};
    if (music && Object.keys(kept).length) all[gameId] = kept;
    else delete all[gameId];
    this.write(MUSIC_KEY, all);
  }
}

/**
 * A game's name for stats and recaps: a back-room game's admin-set title where there is one, else
 * the registry's name (the code name), else the id. Every stats and recap game name goes through it.
 */
export function gameNamer(
  games: GameRegistry,
  titles: Pick<PrivateGameSettings, 'title'>,
): (gameId: string) => string {
  return (gameId) => {
    const game = games.get(gameId);
    return (isPrivate(game) && titles.title(gameId)) || game?.name || gameId;
  };
}
