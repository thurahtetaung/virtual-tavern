import { randomUUID } from 'node:crypto';
import type { ContentProvider } from '@vt/game-sdk';
import type { WordListBody, WordListDetail, WordListSummary } from '@vt/protocol';
import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { buildGames, wordListGameIds } from './games/registry.ts';
import { seededPacks, wordLists } from './db/schema.ts';
import { STARTER_WORDS } from './db/starter-words.ts';
import type { WordPack } from './word-packs.ts';

/** Trims, drops blanks and removes case-insensitive duplicates, keeping the first spelling. */
export function normalizeWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  return words.flatMap((raw) => {
    const word = raw.trim().replace(/\s+/g, ' ');
    const key = word.toLocaleLowerCase();
    if (!word || seen.has(key)) return [];
    seen.add(key);
    return [word];
  });
}

type Row = typeof wordLists.$inferSelect;

const summary = (r: Row): WordListSummary => ({
  id: r.id,
  name: r.name,
  description: r.description,
  wordCount: r.words.length,
  updatedAt: r.updatedAt,
  games: r.games,
});

/** The fields a list is written with; `games` defaults to every word-list game. */
type ListInput = Omit<Required<WordListBody>, 'games'> & { games?: readonly string[] | undefined };

export class WordListRepo {
  private readonly db: Db;
  private readonly now: () => number;
  /**
   * The registered games that use word lists: what new and seeded lists are tagged with when no
   * games are given. (The column's SQL default also names "echo" before that game is registered,
   * so rows that existed when the column was added are ready for it.)
   */
  readonly gameIds: readonly string[];

  constructor(
    db: Db,
    now: () => number = Date.now,
    gameIds: readonly string[] = wordListGameIds(buildGames()),
  ) {
    this.db = db;
    this.now = now;
    this.gameIds = gameIds;
  }

  private tags(games: readonly string[] | undefined): string[] {
    return [...new Set(games?.length ? games : this.gameIds)];
  }

  /** Seeds the starter list when the database has no lists at all. */
  seedIfEmpty(): void {
    if (this.db.select({ id: wordLists.id }).from(wordLists).limit(1).all().length) return;
    this.create({
      name: 'Starter',
      description: 'A general mix of everyday nouns.',
      words: [...STARTER_WORDS],
    });
  }

  /**
   * Adds each built-in pack the first time it is seen. A pack is never re-added, so lists an admin
   * edited or deleted stay that way across restarts and deploys. Returns the slugs added.
   */
  seedPacks(packs: readonly WordPack[]): string[] {
    return this.db.$client.transaction(() => {
      const seen = new Set(
        this.db
          .select({ slug: seededPacks.slug })
          .from(seededPacks)
          .all()
          .map((r) => r.slug),
      );
      const added: string[] = [];
      for (const pack of packs) {
        if (seen.has(pack.slug)) continue;
        this.create({ name: pack.name, description: pack.description, words: pack.words });
        this.db.insert(seededPacks).values({ slug: pack.slug, seededAt: this.now() }).run();
        added.push(pack.slug);
      }
      return added;
    })();
  }

  /** Every list by name, or only those tagged for `gameId`. */
  list(gameId?: string): WordListSummary[] {
    const all = this.db.select().from(wordLists).orderBy(wordLists.name).all().map(summary);
    return gameId === undefined ? all : all.filter((l) => l.games.includes(gameId));
  }

  get(id: string): WordListDetail | null {
    const row = this.db.select().from(wordLists).where(eq(wordLists.id, id)).get();
    return row ? { ...summary(row), words: row.words } : null;
  }

  create(body: ListInput): WordListDetail {
    const now = this.now();
    const row: Row = {
      id: randomUUID(),
      name: body.name,
      description: body.description,
      words: normalizeWords(body.words),
      games: this.tags(body.games),
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(wordLists).values(row).run();
    return { ...summary(row), words: row.words };
  }

  /**
   * Replaces a list's fields. Omitted `games` keeps the list's current tags. Tags for games that
   * are not registered here (such as "echo" before it ships) can't be chosen in the editor, so
   * they are kept rather than silently dropped.
   */
  update(id: string, body: ListInput): WordListDetail | null {
    const current = this.db
      .select({ games: wordLists.games })
      .from(wordLists)
      .where(eq(wordLists.id, id))
      .get();
    if (!current) return null;
    const games = body.games?.length
      ? [...this.tags(body.games), ...current.games.filter((g) => !this.gameIds.includes(g))]
      : current.games;
    const result = this.db
      .update(wordLists)
      .set({
        name: body.name,
        description: body.description,
        words: normalizeWords(body.words),
        games,
        updatedAt: this.now(),
      })
      .where(eq(wordLists.id, id))
      .run();
    return result.changes ? this.get(id) : null;
  }

  delete(id: string): boolean {
    return this.db.delete(wordLists).where(eq(wordLists.id, id)).run().changes > 0;
  }

  /**
   * The content a room of `gameId` may read. Lists made only for that game come first (oldest
   * first), then the other lists it is tagged in (oldest first), so a lobby that defaults to the
   * first list opens on the game's own list and otherwise on the original Starter. Lists not
   * tagged for the game are invisible, including to `words()`.
   */
  forGame(gameId: string): ContentProvider {
    return {
      wordLists: () =>
        this.tagged(gameId).map((r) => ({ id: r.id, name: r.name, wordCount: r.words.length })),
      words: (listIds) => {
        const rows = new Map(this.tagged(gameId).map((r) => [r.id, r.words]));
        return listIds.flatMap((id) => rows.get(id) ?? []);
      },
    };
  }

  private tagged(gameId: string): Row[] {
    const rows = this.db
      .select()
      .from(wordLists)
      .orderBy(asc(wordLists.createdAt), sql`rowid`)
      .all()
      .filter((r) => r.games.includes(gameId));
    const own = (r: Row) => r.games.length === 1;
    return [...rows.filter(own), ...rows.filter((r) => !own(r))];
  }
}
