import type { Rng } from './rng.ts';
import type { PlayerId } from './types.ts';

/**
 * What a playtest bot knows besides its own seat's view: never the game state, never another
 * seat's view. The room host builds it fresh for every move.
 */
export interface BotCtx {
  /** The bot's own seat. */
  me: PlayerId;
  /** Server time (for deadlines in the view). */
  now: number;
  /** Seeded per call by the bot runner. */
  rng: Rng;
  /** Words from the given admin word lists (never questions, answers or decoys). */
  words(listIds: readonly string[]): string[];
  /**
   * Common answers to an open question (its deck's `hints`), for games with
   * `questionKind: 'open'`; empty when the deck gives none. Never trivia answers or decoys.
   */
  hints?(questionId: string): string[];
}

/** How a game's bots fit a playtest, for the admin's setup. */
export interface BotInfo {
  /**
   * Seats a bot can't play, said for the setup ("The Forensic Scientist must be human"). Set it
   * when only some roles have a bot; the setup then keeps those roles with a human.
   */
  note?: string;
  /**
   * Host actions the playtest runs once its seats are in, before any tab opens (to put a
   * human-only role with the host, say). Refused ones are ignored.
   */
  setup?(hostId: PlayerId): unknown[];
  /**
   * Refusals (by error code) a bot should retry after its usual pause instead of waiting for the
   * room to change: for a move whose outcome the bot can't foresee from its view, where the next
   * try (with fresh randomness) may well be accepted.
   */
  retry?(code: string): boolean;
  /**
   * Moves the bot makes at button-press speed (0.6–1.2 s rather than 1.5–4 s), for games that
   * move faster than a turn, like a live auction's bids.
   */
  quick?(move: unknown): boolean;
}

/** One random item, or undefined from an empty list. */
export function pickOne<T>(rng: Rng, xs: readonly T[]): T | undefined {
  return xs.length ? xs[rng.int(xs.length)] : undefined;
}

/** Up to `n` different random items. */
export function pickN<T>(rng: Rng, xs: readonly T[], n: number): T[] {
  return rng.shuffle(xs).slice(0, Math.max(0, n));
}

/** A coin that comes up true with probability `p`. */
export const chance = (rng: Rng, p: number) => rng.next() < p;

const CANNED: Record<'lie' | 'clue', readonly string[]> = {
  lie: [
    'a quiet storm',
    'seven tin spoons',
    'the left-handed baker',
    'a very small lighthouse',
    'moonlit marmalade',
    'a borrowed accordion',
    'the third goose',
    'a velvet umbrella',
    'yesterday’s thunder',
    'an orange kettle',
    'two sleepy owls',
    'the lost harbour',
  ],
  clue: [
    'A quiet storm',
    'Somewhere warm',
    'Not what it seems',
    'Long ago',
    'The long way home',
    'Almost there',
    'Under the stairs',
    'A small mercy',
    'Before breakfast',
    'Out of tune',
  ],
};

/**
 * Self-written filler for free-text fields whose words don't matter in a playtest (a lie, a
 * story's clue). The rng is fresh for every move, so a refused text is not simply sent again.
 */
export function cannedText(rng: Rng, kind: 'lie' | 'clue'): string {
  return pickOne(rng, CANNED[kind])!;
}
