import { z } from 'zod';

// Question decks: admin-managed trivia questions. The decks themselves are private content: they
// live only in the server's database (imported with `scripts/import-question-decks.mjs`) and are
// never committed. `scripts/import-question-decks.mjs` repeats these rules in plain JavaScript so
// it can check a deck before uploading it; keep the two in step.

export const MAX_QUESTIONS_PER_DECK = 5000;
/** Long enough for proverb and first-line answers. */
export const MAX_ANSWER_LENGTH = 160;
export const QUESTION_BLANK = '___';

/** Non-overlapping occurrences of `___` (so `______` counts twice). */
export const blankCount = (prompt: string) => prompt.split(QUESTION_BLANK).length - 1;

/** A prompt has exactly one `___` where the answer goes, or no blank and ends with "?". */
export const promptShapeOk = (prompt: string) => {
  const blanks = blankCount(prompt);
  return blanks === 1 || (blanks === 0 && prompt.endsWith('?'));
};

/** An absolute http(s) URL with a host and no spaces. */
const isHttpUrl = (value: string) => /^https?:\/\/[^\s/?#]+\S*$/i.test(value);

const answerText = z.string().trim().min(1).max(MAX_ANSWER_LENGTH);

export const questionBody = z.object({
  prompt: z
    .string()
    .trim()
    .min(5)
    .max(300)
    .refine(promptShapeOk, 'A prompt needs exactly one "___", or no blank and a final "?".'),
  answer: answerText,
  /** Other accepted forms of the answer. */
  alternates: z.array(answerText).max(10).default([]),
  /** Where the answer can be checked. */
  sources: z
    .array(z.string().trim().max(500).refine(isHttpUrl, 'Sources must be http(s) URLs.'))
    .max(5)
    .default([]),
  adult: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  /**
   * Ready-made fake answers the game may use as house lies. Rooms get them through
   * `ctx.content.questions()`; no HTTP response carries them except the admin detail and export.
   */
  decoys: z.array(answerText).max(30).optional(),
});
export type QuestionBody = z.input<typeof questionBody>;
export type StoredQuestion = z.output<typeof questionBody>;

export const questionDeckBody = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).default(''),
  questions: z.array(questionBody).min(1).max(MAX_QUESTIONS_PER_DECK),
  /** Games that offer the deck. Omitted means `["hoodwink"]` for a new deck, unchanged on update. */
  games: z
    .array(
      z
        .string()
        .min(1)
        .max(40)
        .regex(/^[a-z0-9-]+$/, 'Game ids are lowercase letters, digits and dashes.'),
    )
    .min(1)
    .max(10)
    .optional(),
  /** Omitted means enabled for a new deck, and unchanged on an update. */
  enabled: z.boolean().optional(),
});
export type QuestionDeckBody = z.input<typeof questionDeckBody>;

/** Switches a deck on or off without resending its questions. */
export const questionDeckEnabledBody = z.object({ enabled: z.boolean() });

/** The first problem in a failed parse, with its path (e.g. `questions.3.prompt: …`). */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0]!;
  return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

/** A deck as admins see it in the list. */
export interface QuestionDeckSummary {
  id: string;
  name: string;
  description: string;
  questionCount: number;
  /** Whether any question is marked adult. */
  adult: boolean;
  updatedAt: number;
  /** Ids of the games that offer this deck. */
  games: string[];
  /** Disabled decks are hidden from hosts and rooms; only admins see them. */
  enabled: boolean;
}

export interface QuestionDeckDetail extends QuestionDeckSummary {
  questions: StoredQuestion[];
}

/**
 * What unlocked players see (`GET /api/backroom/question-decks/:gameId`, private games only):
 * never questions, answers or decoys.
 */
export interface PublicQuestionDeck {
  id: string;
  name: string;
  description: string;
  questionCount: number;
  adult: boolean;
}
