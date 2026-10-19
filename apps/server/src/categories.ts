import {
  type AdminCategoriesResponse,
  type CategoryBody,
  type GameCategory,
  type GameCategoryDef,
  MAX_CATEGORIES,
  type NewCategoryBody,
} from '@vt/protocol';
import { eq } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { appSettings } from './db/schema.ts';
import { type GameRegistry, isPrivate } from './games/registry.ts';

const KEY = 'game_categories';

/** The categories, in chip order, and each game's category ids, as kept in the app settings. */
interface Stored {
  categories: GameCategoryDef[];
  games: Record<string, string[]>;
}

export class CategoryError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
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

/**
 * Game categories, all from the database: the admin's categories and each game's ticks. Nothing
 * is set until the admin (or `scripts/set-game-categories.mjs`) sets it, and until then the game
 * lists carry no categories.
 */
export class GameCategories {
  private readonly db: Db;
  private readonly games: GameRegistry;
  private readonly titles: { title(gameId: string): string | null } | undefined;

  constructor(db: Db, games: GameRegistry, titles?: { title(gameId: string): string | null }) {
    this.db = db;
    this.games = games;
    this.titles = titles;
  }

  private read(): Stored {
    const raw = this.db.select().from(appSettings).where(eq(appSettings.key, KEY)).get()?.value;
    if (!raw) return { categories: [], games: {} };
    try {
      const parsed = JSON.parse(raw) as Partial<Stored> | null;
      const games = parsed?.games && typeof parsed.games === 'object' ? parsed.games : {};
      return {
        categories: Array.isArray(parsed?.categories) ? parsed.categories.filter(isDef) : [],
        games: Object.fromEntries(
          Object.entries(games).filter((e): e is [string, string[]] => Array.isArray(e[1])),
        ),
      };
    } catch {
      return { categories: [], games: {} };
    }
  }

  private write(value: Stored) {
    const json = JSON.stringify(value);
    this.db
      .insert(appSettings)
      .values({ key: KEY, value: json })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: json } })
      .run();
  }

  /** A game's category ids, in category order. */
  private of(gameId: string, stored: Stored): string[] {
    const chosen = stored.games[gameId] ?? [];
    return stored.categories.map((c) => c.id).filter((id) => chosen.includes(id));
  }

  /**
   * The categories of the games in `gameIds` (the games a viewer can see), each with its place
   * among them. Categories no listed game has are left out, so nothing hints at hidden games.
   */
  forGames(gameIds: readonly string[]): Map<string, GameCategory[]> {
    const stored = this.read();
    const used = new Set(gameIds.flatMap((id) => this.of(id, stored)));
    const visible = stored.categories
      .filter((c) => used.has(c.id))
      .map((c, order) => ({ id: c.id, name: c.name, emoji: c.emoji, order }));
    return new Map(
      gameIds.map((id) => {
        const mine = this.of(id, stored);
        return [id, visible.filter((c) => mine.includes(c.id))];
      }),
    );
  }

  admin(): AdminCategoriesResponse {
    const stored = this.read();
    return {
      categories: stored.categories,
      games: [...this.games.values()].map((g) => ({
        gameId: g.id,
        name: (isPrivate(g) && this.titles?.title(g.id)) || g.name,
        private: isPrivate(g),
        categories: this.of(g.id, stored),
      })),
    };
  }

  private find(stored: Stored, id: string) {
    const category = stored.categories.find((c) => c.id === id);
    if (!category) throw new CategoryError(404, 'not-found', 'No such category.');
    return category;
  }

  add(body: NewCategoryBody): GameCategoryDef {
    const stored = this.read();
    if (stored.categories.length >= MAX_CATEGORIES)
      throw new CategoryError(400, 'too-many', `At most ${MAX_CATEGORIES} categories.`);
    const ids = new Set(stored.categories.map((c) => c.id));
    if (body.id !== undefined && ids.has(body.id))
      throw new CategoryError(400, 'taken', `There is already a category "${body.id}".`);
    this.sameName(stored.categories, body.name);
    const category = { id: body.id ?? newId(body.name, ids), name: body.name, emoji: body.emoji };
    stored.categories.push(category);
    this.write(stored);
    return category;
  }

  update(id: string, body: CategoryBody) {
    const stored = this.read();
    this.find(stored, id);
    this.sameName(
      stored.categories.filter((c) => c.id !== id),
      body.name,
    );
    stored.categories = stored.categories.map((c) =>
      c.id === id ? { id, name: body.name, emoji: body.emoji } : c,
    );
    this.write(stored);
  }

  /** Puts the categories in this order; `ids` must name each category once. */
  reorder(ids: readonly string[]) {
    const stored = this.read();
    const same =
      ids.length === stored.categories.length &&
      new Set(ids).size === ids.length &&
      ids.every((id) => stored.categories.some((c) => c.id === id));
    if (!same) throw new CategoryError(400, 'bad-request', 'Send every category id once.');
    stored.categories = ids.map((id) => this.find(stored, id));
    this.write(stored);
  }

  /** Deletes a category and takes it off every game. */
  remove(id: string) {
    const stored = this.read();
    this.find(stored, id);
    stored.categories = stored.categories.filter((c) => c.id !== id);
    for (const [game, ids] of Object.entries(stored.games)) {
      const kept = ids.filter((c) => c !== id);
      if (kept.length) stored.games[game] = kept;
      else delete stored.games[game];
    }
    this.write(stored);
  }

  /** Sets a game's categories (empty takes it out of every one). */
  setGame(gameId: string, categories: readonly string[]) {
    if (!this.games.has(gameId)) throw new CategoryError(404, 'not-found', 'No such game.');
    const stored = this.read();
    const bad = categories.find((c) => !stored.categories.some((k) => k.id === c));
    if (bad !== undefined)
      throw new CategoryError(400, 'bad-request', `"${bad}" is not a category.`);
    if (categories.length) stored.games[gameId] = [...new Set(categories)];
    else delete stored.games[gameId];
    this.write(stored);
  }

  private sameName(others: readonly GameCategoryDef[], name: string) {
    const key = (s: string) => s.trim().toLocaleLowerCase();
    if (others.some((c) => key(c.name) === key(name)))
      throw new CategoryError(400, 'taken', `There is already a category called "${name}".`);
  }
}
