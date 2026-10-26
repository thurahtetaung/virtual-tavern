import { randomUUID } from 'node:crypto';
import type { AnyGameDefinition, ContentProvider } from '@vt/game-sdk';
import type { ContentPackDetail, ContentPackSummary } from '@vt/protocol';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { contentPacks } from './db/schema.ts';

type Row = typeof contentPacks.$inferSelect;

export interface PackInput {
  gameId: string;
  kind: string;
  name: string;
  data: unknown;
  enabled?: boolean | undefined;
}

const entriesOf = (data: unknown) =>
  Array.isArray(data)
    ? data.length
    : data && typeof data === 'object'
      ? Object.keys(data).length
      : 0;

const summary = (r: Row): ContentPackSummary => ({
  id: r.id,
  gameId: r.gameId,
  kind: r.kind,
  name: r.name,
  enabled: r.enabled,
  size: JSON.stringify(r.data).length,
  entries: entriesOf(r.data),
  updatedAt: r.updatedAt,
});

const detail = (r: Row): ContentPackDetail => ({ ...summary(r), data: r.data });

/** The games that read content packs, and the schema for each kind they read. */
export type PackGames = ReadonlyMap<string, Pick<AnyGameDefinition, 'access' | 'contentPacks'>>;

export class ContentPackRepo {
  private readonly db: Db;
  private readonly now: () => number;
  private readonly games: PackGames;

  constructor(db: Db, games: PackGames, now: () => number = Date.now) {
    this.db = db;
    this.games = games;
    this.now = now;
  }

  /**
   * Why `gameId`/`kind`/`data` can't be a pack, or null: only private games that declare the kind
   * take packs, and the data must pass that kind's schema. On success, `data` is the parsed form.
   */
  check(input: PackInput): { problem: string } | { data: unknown } {
    const game = this.games.get(input.gameId);
    if (!game || game.access !== 'private' || !game.contentPacks)
      return { problem: `"${input.gameId}" is not a back-room game that uses content packs.` };
    const schema = game.contentPacks.kinds[input.kind];
    if (!schema) return { problem: `"${input.kind}" is not a kind of pack this game reads.` };
    const parsed = schema.safeParse(input.data);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.length ? `${issue.path.join('.')}: ` : '';
      return { problem: `data: ${path}${issue?.message ?? 'not valid'}` };
    }
    return { data: parsed.data };
  }

  /** Every pack, disabled ones included (for admins), without data. */
  list(): ContentPackSummary[] {
    return this.db
      .select()
      .from(contentPacks)
      .orderBy(asc(contentPacks.gameId), asc(contentPacks.kind), asc(contentPacks.name))
      .all()
      .map(summary);
  }

  /** Every pack with its data (the admin backup). */
  exportAll(): ContentPackDetail[] {
    return this.db
      .select()
      .from(contentPacks)
      .orderBy(asc(contentPacks.gameId), asc(contentPacks.kind), asc(contentPacks.name))
      .all()
      .map(detail);
  }

  get(id: string): ContentPackDetail | null {
    const row = this.db.select().from(contentPacks).where(eq(contentPacks.id, id)).get();
    return row ? detail(row) : null;
  }

  /** Adds a pack whose data has already passed `check`. */
  create(input: PackInput): ContentPackDetail {
    const now = this.now();
    const row: Row = {
      id: randomUUID(),
      gameId: input.gameId,
      kind: input.kind,
      name: input.name,
      data: input.data,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(contentPacks).values(row).run();
    return detail(row);
  }

  /** Replaces a pack's data (already through `check`), keeping its id, name and switch. */
  replace(id: string, data: unknown): ContentPackDetail | null {
    const changed = this.db
      .update(contentPacks)
      .set({ data, updatedAt: this.now() })
      .where(eq(contentPacks.id, id))
      .run().changes;
    return changed ? this.get(id) : null;
  }

  setEnabled(id: string, enabled: boolean): ContentPackSummary | null {
    const changed = this.db
      .update(contentPacks)
      .set({ enabled })
      .where(eq(contentPacks.id, id))
      .run().changes;
    if (!changed) return null;
    const row = this.db.select().from(contentPacks).where(eq(contentPacks.id, id)).get();
    return row ? summary(row) : null;
  }

  delete(id: string): boolean {
    return this.db.delete(contentPacks).where(eq(contentPacks.id, id)).run().changes > 0;
  }

  /** What a room of `gameId` may read: the enabled packs of each kind it declares. */
  forGame(gameId: string): Required<Pick<ContentProvider, 'contentPacks'>> {
    return {
      contentPacks: (kind) => {
        if (!this.games.get(gameId)?.contentPacks?.kinds[kind]) return [];
        return this.db
          .select()
          .from(contentPacks)
          .where(
            and(
              eq(contentPacks.gameId, gameId),
              eq(contentPacks.kind, kind),
              eq(contentPacks.enabled, true),
            ),
          )
          .orderBy(asc(contentPacks.createdAt), sql`rowid`)
          .all()
          .map((r) => ({ id: r.id, name: r.name, data: r.data }));
      },
    };
  }
}

/** The per-room content, with content packs added for the games that declare them. */
export function withContentPacks(
  content: { forGame(gameId: string): ContentProvider },
  packs: ContentPackRepo,
  games: PackGames,
): { forGame(gameId: string): ContentProvider } {
  return {
    forGame: (gameId) => {
      const base = content.forGame(gameId);
      return games.get(gameId)?.contentPacks ? { ...base, ...packs.forGame(gameId) } : base;
    },
  };
}
