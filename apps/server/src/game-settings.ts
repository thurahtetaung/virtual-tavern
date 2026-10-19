import {
  type AdminGamesResponse,
  type CategoryBody,
  type GameCategory,
  type GameCategoryDef,
  type GameSettings,
  type GameSettingsBody,
  MAX_CATEGORIES,
  type MusicMap,
  type NewCategoryBody,
} from '@vt/protocol';
import type { AnyGameDefinition } from '@vt/game-sdk';
import { eq } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { appSettings } from './db/schema.ts';
import { type GameRegistry, isPrivate } from './games/registry.ts';

/** On/off, categories and the category list. */
const SETTINGS_KEY = 'game_settings';
/**
 * Back-room titles and music overrides keep the keys they always had, so a release before the
 * Games page (after a rollback) still reads what this one writes, and the other way round.
 */
const TITLES_KEY = 'private_game_titles';
const MUSIC_KEY = 'private_game_music';

/** What `game_settings` holds: fields at their defaults (on, no categories) are left out. */
interface Stored {
  categories: GameCategoryDef[];
  games: Record<string, { enabled?: false; categories?: string[] }>;
}

export class SettingsError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Why a game that is switched off can't open a room or start a new game. */
export const offMessage = (name: string) =>
  `${name} isn’t available right now. Pick another game, or ask the tavern keeper.`;

/** The phases a game plays music in, or none when it has no music. */
export const musicPhasesOf = (game: AnyGameDefinition | undefined): string[] =>
  game?.music?.phases.map((p) => p.id) ?? [];

/** The music each phase plays: the admin's choice where set, else the manifest's default. */
export function effectiveMusic(
  defaults: unknown,
  override: MusicMap | null,
  phases: readonly string[],
): MusicMap {
  const base = (defaults && typeof defaults === 'object' ? defaults : {}) as Record<
    string,
    unknown
  >;
  const out: MusicMap = {};
  for (const phase of phases) {
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
  for (const paths of Object.values(music))
    for (const t of paths) if (!tracks.includes(t)) return t;
  return null;
}

/** A short id from a new category's name, unlike any category so far. */
function newId(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
      .replace(/-+$/, '') || 'category';
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

const isDef = (c: unknown): c is GameCategoryDef =>
  !!c &&
  typeof (c as GameCategoryDef).id === 'string' &&
  typeof (c as GameCategoryDef).name === 'string' &&
  typeof (c as GameCategoryDef).emoji === 'string';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Every game's settings (on/off, categories, a back-room game's title, music) and the category
 * list, all from the app settings table: the one place the server reads and writes them. Nothing
 * is in code: every game starts on, with no categories, its code name and its manifest's music.
 */
export class GameSettingsStore {
  private readonly db: Db;
  private readonly games: GameRegistry;

  constructor(db: Db, games: GameRegistry) {
    this.db = db;
    this.games = games;
  }

  private raw(key: string): Record<string, unknown> {
    const value = this.db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
    if (!value) return {};
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }

  private write(key: string, value: unknown) {
    const json = JSON.stringify(value);
    this.db
      .insert(appSettings)
      .values({ key, value: json })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: json } })
      .run();
  }

  private read(): Stored {
    const raw = this.raw(SETTINGS_KEY);
    const games: Stored['games'] = {};
    for (const [id, value] of Object.entries(asRecord(raw.games))) {
      const g = asRecord(value);
      const categories = Array.isArray(g.categories)
        ? g.categories.filter((c): c is string => typeof c === 'string')
        : [];
      games[id] = {
        ...(g.enabled === false && { enabled: false as const }),
        ...(categories.length && { categories }),
      };
    }
    return {
      categories: Array.isArray(raw.categories) ? raw.categories.filter(isDef) : [],
      games,
    };
  }

  private save(stored: Stored) {
    for (const [id, g] of Object.entries(stored.games))
      if (g.enabled !== false && !g.categories?.length) delete stored.games[id];
    this.write(SETTINGS_KEY, stored);
  }

  // ---- Titles and music (back-room games) ----

  titles(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.raw(TITLES_KEY)).filter(
        (e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0,
      ),
    );
  }

  /** A back-room game's admin-set title, or null. */
  title(gameId: string): string | null {
    return this.titles()[gameId] ?? null;
  }

  /** The admin's music for a game with music, or null for its manifest's defaults. */
  music(gameId: string): MusicMap | null {
    const phases = musicPhasesOf(this.games.get(gameId));
    const chosen = asRecord(this.raw(MUSIC_KEY)[gameId]);
    const kept = Object.fromEntries(
      phases.flatMap((p) => {
        const paths = chosen[p];
        return Array.isArray(paths)
          ? [[p, paths.filter((t): t is string => typeof t === 'string')]]
          : [];
      }),
    );
    return Object.keys(kept).length ? kept : null;
  }

  // ---- On/off ----

  /** Whether players may open new rooms of the game (on unless the admin switched it off). */
  enabled(gameId: string): boolean {
    return this.read().games[gameId]?.enabled !== false;
  }

  // ---- One game's record ----

  /** A game's settings, with only the fields that apply to it. */
  get(gameId: string, stored = this.read()): GameSettings {
    const game = this.games.get(gameId);
    return {
      enabled: stored.games[gameId]?.enabled !== false,
      categories: this.categoriesOf(gameId, stored),
      ...(isPrivate(game) && { title: this.title(gameId) }),
      ...(game?.music && { music: this.music(gameId) }),
    };
  }

  /**
   * Changes the fields sent. A field that doesn't apply to the game (a title for a public game,
   * music for a game without it) is refused. Music tracks are checked against the manifest by the
   * caller, which can read it.
   */
  update(gameId: string, body: GameSettingsBody) {
    const game = this.games.get(gameId);
    if (!game) throw new SettingsError(404, 'not-found', 'No such game.');
    if (body.title !== undefined && !isPrivate(game))
      throw new SettingsError(400, 'bad-request', 'Only back-room games have a title.');
    if (body.music !== undefined) {
      const phases = musicPhasesOf(game);
      if (!phases.length) throw new SettingsError(400, 'bad-request', 'This game has no music.');
      const bad = Object.keys(body.music ?? {}).find((p) => !phases.includes(p));
      if (bad !== undefined)
        throw new SettingsError(400, 'bad-request', `"${bad}" is not one of the game’s phases.`);
    }
    const stored = this.read();
    if (body.categories !== undefined) {
      const bad = body.categories.find((c) => !stored.categories.some((k) => k.id === c));
      if (bad !== undefined)
        throw new SettingsError(400, 'bad-request', `"${bad}" is not a category.`);
    }

    if (body.enabled !== undefined || body.categories !== undefined) {
      const g = { ...stored.games[gameId] };
      if (body.enabled === false) g.enabled = false;
      else if (body.enabled === true) delete g.enabled;
      if (body.categories !== undefined) g.categories = [...new Set(body.categories)];
      stored.games[gameId] = g;
      this.save(stored);
    }
    if (body.title !== undefined) {
      const all = this.titles();
      if (body.title) all[gameId] = body.title;
      else delete all[gameId];
      this.write(TITLES_KEY, all);
    }
    if (body.music !== undefined) {
      const all = this.raw(MUSIC_KEY);
      const kept = Object.fromEntries(Object.entries(body.music ?? {}));
      if (Object.keys(kept).length) all[gameId] = kept;
      else delete all[gameId];
      this.write(MUSIC_KEY, all);
    }
  }

  // ---- Categories ----

  /** A game's category ids, in category order. */
  private categoriesOf(gameId: string, stored: Stored): string[] {
    const chosen = stored.games[gameId]?.categories ?? [];
    return stored.categories.map((c) => c.id).filter((id) => chosen.includes(id));
  }

  /**
   * The categories of the games in `gameIds` (the games a viewer can see), each with its place
   * among them. Categories no listed game has are left out, so nothing hints at hidden games.
   */
  categoriesFor(gameIds: readonly string[]): Map<string, GameCategory[]> {
    const stored = this.read();
    const used = new Set(gameIds.flatMap((id) => this.categoriesOf(id, stored)));
    const visible = stored.categories
      .filter((c) => used.has(c.id))
      .map((c, order) => ({ id: c.id, name: c.name, emoji: c.emoji, order }));
    return new Map(
      gameIds.map((id) => {
        const mine = this.categoriesOf(id, stored);
        return [id, visible.filter((c) => mine.includes(c.id))];
      }),
    );
  }

  admin(): AdminGamesResponse {
    const stored = this.read();
    return {
      categories: stored.categories,
      games: [...this.games.values()].map((g) => ({
        gameId: g.id,
        name: g.name,
        private: isPrivate(g),
        settings: this.get(g.id, stored),
        ...(g.music && { musicPhases: g.music.phases.map((p) => ({ ...p })) }),
      })),
    };
  }

  private find(stored: Stored, id: string) {
    const category = stored.categories.find((c) => c.id === id);
    if (!category) throw new SettingsError(404, 'not-found', 'No such category.');
    return category;
  }

  addCategory(body: NewCategoryBody): GameCategoryDef {
    const stored = this.read();
    if (stored.categories.length >= MAX_CATEGORIES)
      throw new SettingsError(400, 'too-many', `At most ${MAX_CATEGORIES} categories.`);
    const ids = new Set(stored.categories.map((c) => c.id));
    if (body.id !== undefined && ids.has(body.id))
      throw new SettingsError(400, 'taken', `There is already a category "${body.id}".`);
    this.sameName(stored.categories, body.name);
    const category = { id: body.id ?? newId(body.name, ids), name: body.name, emoji: body.emoji };
    stored.categories.push(category);
    this.save(stored);
    return category;
  }

  updateCategory(id: string, body: CategoryBody) {
    const stored = this.read();
    this.find(stored, id);
    this.sameName(
      stored.categories.filter((c) => c.id !== id),
      body.name,
    );
    stored.categories = stored.categories.map((c) =>
      c.id === id ? { id, name: body.name, emoji: body.emoji } : c,
    );
    this.save(stored);
  }

  /** Puts the categories in this order; `ids` must name each category once. */
  reorderCategories(ids: readonly string[]) {
    const stored = this.read();
    const same =
      ids.length === stored.categories.length &&
      new Set(ids).size === ids.length &&
      ids.every((id) => stored.categories.some((c) => c.id === id));
    if (!same) throw new SettingsError(400, 'bad-request', 'Send every category id once.');
    stored.categories = ids.map((id) => this.find(stored, id));
    this.save(stored);
  }

  /** Deletes a category and takes it off every game. */
  removeCategory(id: string) {
    const stored = this.read();
    this.find(stored, id);
    stored.categories = stored.categories.filter((c) => c.id !== id);
    for (const g of Object.values(stored.games))
      if (g.categories) g.categories = g.categories.filter((c) => c !== id);
    this.save(stored);
  }

  private sameName(others: readonly GameCategoryDef[], name: string) {
    const key = (s: string) => s.trim().toLocaleLowerCase();
    if (others.some((c) => key(c.name) === key(name)))
      throw new SettingsError(400, 'taken', `There is already a category called "${name}".`);
  }
}

/**
 * A game's name for stats and recaps: a back-room game's admin-set title where there is one, else
 * the registry's name (the code name), else the id. Every stats and recap game name goes through it.
 */
export function gameNamer(
  games: GameRegistry,
  titles: Pick<GameSettingsStore, 'title'>,
): (gameId: string) => string {
  return (gameId) => {
    const game = games.get(gameId);
    return (isPrivate(game) && titles.title(gameId)) || game?.name || gameId;
  };
}
