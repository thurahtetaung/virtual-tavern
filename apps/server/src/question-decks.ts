import { randomUUID } from 'node:crypto';
import type { ContentProvider } from '@vt/game-sdk';
import {
  type PublicQuestionDeck,
  type QuestionDeckDetail,
  type QuestionDeckSummary,
  type QuestionKind,
  type StoredQuestion,
  openProblem,
  triviaProblem,
} from '@vt/protocol';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { buildGames, openQuestionGameIds, questionDeckGameIds } from './games/registry.ts';
import { questionDecks } from './db/schema.ts';

/** What a new deck is tagged with when no games are given (matches the column's SQL default). */
export const DEFAULT_QUESTION_GAMES: readonly string[] = ['hoodwink'];

/** The fields a deck is written with (the parsed `questionDeckBody`). */
export interface DeckInput {
  name: string;
  description: string;
  questions: StoredQuestion[];
  games?: readonly string[] | undefined;
  enabled?: boolean | undefined;
}

type Row = typeof questionDecks.$inferSelect;

// Counted in SQL, so listing decks never parses every question.
const summaryColumns = {
  id: questionDecks.id,
  name: questionDecks.name,
  description: questionDecks.description,
  updatedAt: questionDecks.updatedAt,
  games: questionDecks.games,
  enabled: questionDecks.enabled,
  questionCount: sql<number>`json_array_length(${questionDecks.questions})`,
  adult: sql<number>`exists(select 1 from json_each(${questionDecks.questions}) where json_extract(value, '$.adult') = 1)`,
};

type SummaryRow = {
  id: string;
  name: string;
  description: string;
  updatedAt: number;
  games: string[];
  enabled: boolean;
  questionCount: number;
  adult: number | boolean;
};

const summary = (r: SummaryRow): QuestionDeckSummary => ({
  id: r.id,
  name: r.name,
  description: r.description,
  questionCount: r.questionCount,
  adult: Boolean(r.adult),
  updatedAt: r.updatedAt,
  games: r.games,
  enabled: r.enabled,
});

const detail = (r: Row): QuestionDeckDetail => ({
  ...summary({
    ...r,
    questionCount: r.questions.length,
    adult: r.questions.some((q) => q.adult),
  }),
  questions: r.questions,
});

/** The player-safe view of a deck: no questions, no answers. */
export const publicDeck = (d: QuestionDeckSummary): PublicQuestionDeck => ({
  id: d.id,
  name: d.name,
  description: d.description,
  questionCount: d.questionCount,
  adult: d.adult,
});

export class QuestionDeckRepo {
  private readonly db: Db;
  private readonly now: () => number;
  /** The registered games that use question decks: the only ids a deck may be tagged with. */
  readonly gameIds: readonly string[];
  /** Those of `gameIds` that read open questions (no answers); the rest are trivia games. */
  readonly openGameIds: readonly string[];

  constructor(
    db: Db,
    now: () => number = Date.now,
    gameIds: readonly string[] = questionDeckGameIds(buildGames()),
    openGameIds: readonly string[] = openQuestionGameIds(buildGames()),
  ) {
    this.db = db;
    this.now = now;
    this.gameIds = gameIds;
    this.openGameIds = openGameIds;
  }

  /** A deck's kind from the games it is tagged for, or null when it mixes the two kinds. */
  kindOf(games: readonly string[]): QuestionKind | null {
    const open = games.filter((g) => this.openGameIds.includes(g)).length;
    if (open === 0) return 'trivia';
    return open === games.length ? 'open' : null;
  }

  /**
   * Why a deck can't be saved with these questions and tags (the stored tags on an update that
   * leaves them out, the default for a new deck), or null. Trivia decks keep Hoodwink's rules.
   */
  problem(questions: readonly StoredQuestion[], games: readonly string[]): string | null {
    const kind = this.kindOf(games);
    if (kind === null)
      return 'games: a deck is either for trivia games or for open-question games, not both.';
    return kind === 'open' ? openProblem(questions) : triviaProblem(questions);
  }

  /** The tags a deck has, or null when there is no such deck. */
  gamesOf(id: string): string[] | null {
    return (
      this.db
        .select({ games: questionDecks.games })
        .from(questionDecks)
        .where(eq(questionDecks.id, id))
        .get()?.games ?? null
    );
  }

  /**
   * The common answers to an open question (`<deck id>:<index>`) of an enabled deck tagged for
   * `gameId`, for playtest bots; empty otherwise. Never a trivia answer.
   */
  hints(gameId: string, questionId: string): string[] {
    if (!this.openGameIds.includes(gameId)) return [];
    const cut = questionId.lastIndexOf(':');
    const row = this.db
      .select()
      .from(questionDecks)
      .where(eq(questionDecks.id, questionId.slice(0, cut)))
      .get();
    if (!row?.enabled || !row.games.includes(gameId)) return [];
    return row.questions[Number(questionId.slice(cut + 1))]?.hints ?? [];
  }

  /** Every deck by name, disabled ones included (for admins). */
  list(): QuestionDeckSummary[] {
    return this.db
      .select(summaryColumns)
      .from(questionDecks)
      .orderBy(asc(questionDecks.name), asc(questionDecks.createdAt), sql`rowid`)
      .all()
      .map(summary);
  }

  /** The enabled decks by name, or only the enabled ones tagged for `gameId` (for players). */
  listEnabled(gameId?: string): QuestionDeckSummary[] {
    return this.list().filter(
      (d) => d.enabled && (gameId === undefined || d.games.includes(gameId)),
    );
  }

  /** Every deck by name with its questions, disabled ones included (the admin backup). */
  exportAll(): QuestionDeckDetail[] {
    return this.db
      .select()
      .from(questionDecks)
      .orderBy(asc(questionDecks.name), asc(questionDecks.createdAt), sql`rowid`)
      .all()
      .map(detail);
  }

  /** A deck's name without loading its questions (labels on the admin stats page). */
  name(id: string): string | undefined {
    return this.db
      .select({ name: questionDecks.name })
      .from(questionDecks)
      .where(eq(questionDecks.id, id))
      .get()?.name;
  }

  get(id: string): QuestionDeckDetail | null {
    const row = this.db.select().from(questionDecks).where(eq(questionDecks.id, id)).get();
    return row ? detail(row) : null;
  }

  create(body: DeckInput): QuestionDeckDetail {
    const now = this.now();
    const row: Row = {
      id: randomUUID(),
      name: body.name,
      description: body.description,
      questions: body.questions,
      games: [...new Set(body.games?.length ? body.games : DEFAULT_QUESTION_GAMES)],
      enabled: body.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(questionDecks).values(row).run();
    return detail(row);
  }

  /** Replaces a deck's fields. Omitted `games` and `enabled` keep the deck's current values. */
  update(id: string, body: DeckInput): QuestionDeckDetail | null {
    const result = this.db
      .update(questionDecks)
      .set({
        name: body.name,
        description: body.description,
        questions: body.questions,
        ...(body.games?.length ? { games: [...new Set(body.games)] } : {}),
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        updatedAt: this.now(),
      })
      .where(eq(questionDecks.id, id))
      .run();
    return result.changes ? this.get(id) : null;
  }

  /** Switches a deck on or off, leaving everything else (including `updatedAt`) alone. */
  setEnabled(id: string, enabled: boolean): QuestionDeckSummary | null {
    const changed = this.db
      .update(questionDecks)
      .set({ enabled })
      .where(eq(questionDecks.id, id))
      .run().changes;
    if (!changed) return null;
    return (
      this.db
        .select(summaryColumns)
        .from(questionDecks)
        .where(eq(questionDecks.id, id))
        .all()
        .map(summary)[0] ?? null
    );
  }

  delete(id: string): boolean {
    return this.db.delete(questionDecks).where(eq(questionDecks.id, id)).run().changes > 0;
  }

  /**
   * The question content a room of `gameId` may read: only enabled decks tagged for the game.
   * Question ids are `<deck id>:<index>`, stable as long as the deck isn't replaced.
   */
  forGame(
    gameId: string,
  ): Required<Pick<ContentProvider, 'questionDecks'>> &
    Pick<ContentProvider, 'questions' | 'openQuestions'> {
    const rowsOf = (deckIds: readonly string[]) => {
      const wanted = [...new Set(deckIds)];
      if (!wanted.length) return [];
      const rows = new Map(
        this.db
          .select()
          .from(questionDecks)
          .where(inArray(questionDecks.id, wanted))
          .all()
          .filter((r) => r.enabled && r.games.includes(gameId))
          .map((r) => [r.id, r]),
      );
      return wanted.flatMap((deckId) => {
        const row = rows.get(deckId);
        return row ? [row] : [];
      });
    };
    const decks = () =>
      this.listEnabled(gameId).map((d) => ({
        id: d.id,
        name: d.name,
        ...(d.description ? { description: d.description } : {}),
        questionCount: d.questionCount,
        ...(d.adult ? { adult: true } : {}),
      }));
    if (this.openGameIds.includes(gameId)) {
      return {
        questionDecks: decks,
        // Prompts only: the hints stay on the server, for bots (`hints`).
        openQuestions: (deckIds) =>
          rowsOf(deckIds).flatMap((row) =>
            row.questions.map((q, i) => ({
              id: `${row.id}:${i}`,
              deckId: row.id,
              prompt: q.prompt,
            })),
          ),
      };
    }
    return {
      questionDecks: decks,
      questions: (deckIds) =>
        rowsOf(deckIds).flatMap((row) =>
          row.questions.flatMap((q, i) =>
            // Trivia games only ever get answered questions.
            q.answer === undefined
              ? []
              : [
                  {
                    id: `${row.id}:${i}`,
                    deckId: row.id,
                    prompt: q.prompt,
                    answer: q.answer,
                    alternates: q.alternates,
                    ...(q.decoys?.length ? { decoys: q.decoys } : {}),
                  },
                ],
          ),
        ),
    };
  }
}

/**
 * The per-room content: word lists for every game, plus question decks for games that set
 * `usesQuestionDecks`. Other games never see the decks.
 */
export function roomContent(
  wordLists: { forGame(gameId: string): ContentProvider },
  decks: QuestionDeckRepo,
  games: ReadonlyMap<string, { usesQuestionDecks?: boolean }>,
): { forGame(gameId: string): ContentProvider } {
  return {
    forGame: (gameId) => {
      const words = wordLists.forGame(gameId);
      return games.get(gameId)?.usesQuestionDecks ? { ...words, ...decks.forGame(gameId) } : words;
    },
  };
}
