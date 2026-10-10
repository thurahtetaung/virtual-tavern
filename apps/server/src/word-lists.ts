import { randomUUID } from 'node:crypto';
import type { ContentProvider } from '@vt/game-sdk';
import type { WordListBody, WordListDetail, WordListSummary } from '@vt/protocol';
import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from './db/index.ts';
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
});

export class WordListRepo implements ContentProvider {
  private readonly db: Db;
  private readonly now: () => number;

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
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

  list(): WordListSummary[] {
    return this.db.select().from(wordLists).orderBy(wordLists.name).all().map(summary);
  }

  get(id: string): WordListDetail | null {
    const row = this.db.select().from(wordLists).where(eq(wordLists.id, id)).get();
    return row ? { ...summary(row), words: row.words } : null;
  }

  create(body: Required<WordListBody>): WordListDetail {
    const now = this.now();
    const row: Row = {
      id: randomUUID(),
      name: body.name,
      description: body.description,
      words: normalizeWords(body.words),
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(wordLists).values(row).run();
    return { ...summary(row), words: row.words };
  }

  update(id: string, body: Required<WordListBody>): WordListDetail | null {
    const result = this.db
      .update(wordLists)
      .set({
        name: body.name,
        description: body.description,
        words: normalizeWords(body.words),
        updatedAt: this.now(),
      })
      .where(eq(wordLists.id, id))
      .run();
    return result.changes ? this.get(id) : null;
  }

  delete(id: string): boolean {
    return this.db.delete(wordLists).where(eq(wordLists.id, id)).run().changes > 0;
  }

  // ContentProvider (used synchronously by game logic)

  /** Oldest first, so games default to the original Starter list rather than whatever sorts first. */
  wordLists() {
    return this.db
      .select()
      .from(wordLists)
      .orderBy(asc(wordLists.createdAt), sql`rowid`)
      .all()
      .map((r) => ({ id: r.id, name: r.name, wordCount: r.words.length }));
  }

  words(listIds: readonly string[]): string[] {
    return listIds.flatMap((id) => this.get(id)?.words ?? []);
  }
}
