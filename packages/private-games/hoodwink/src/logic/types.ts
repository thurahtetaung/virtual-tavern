import type { PlayerId, Question, QuestionDeckSummary } from '@vt/game-sdk';
import { z } from 'zod';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
export const ROUND_COUNTS = [5, 7, 10] as const;
export const DEFAULT_ROUNDS = 7;
/** Real answers run up to 160 characters (proverbs, first lines), so lies may too. */
export const MAX_LIE_LENGTH = 160;
/** Points for picking the real answer. */
export const TRUTH_POINTS = 1000;
/** Points for each player your lie fools (shared between the authors of a merged lie). */
export const FOOL_POINTS = 500;
/** Points per player fooled by a lie the game picked for you ("Lie for me", or filled in). */
export const AUTO_FOOL_POINTS = 250;
/** The vote is padded with house fakes up to this many options, while decoys last. */
export const MIN_OPTIONS = 4;
/** Shared credit is rounded down to a multiple of this. */
export const POINT_STEP = 50;
/** Question ids remembered per room, so rematches avoid repeats while the decks allow. */
export const MAX_USED_QUESTIONS = 500;
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 600;

export type RoundCount = (typeof ROUND_COUNTS)[number];
export type TimerMode = 'soft' | 'strict';

export interface Settings {
  deckIds: string[];
  rounds: RoundCount;
  /** Time to write a lie. */
  clueSeconds: number | null;
  /** Time to vote. */
  guessSeconds: number | null;
  timerMode: TimerMode;
}

export interface Seat {
  name: string;
  /** false = just watching. */
  playing: boolean;
}

export type Stage = 'write' | 'vote' | 'reveal';

/** One answer on the voting board: the truth, or a lie (merged if several players wrote it). */
export interface Option {
  /** As shown on the board: first letter capitalised, so the truth doesn't stand out. */
  text: string;
  truth: boolean;
  /** Who wrote this lie (empty for the truth and house fakes). */
  authors: PlayerId[];
  /** Authors whose lie the game picked for them; they score half. */
  auto: PlayerId[];
  /** A built-in fake added to pad a small board: nobody's lie, scores for nobody. */
  house: boolean;
}

export interface Round {
  /** 1-based. */
  number: number;
  question: Question;
  stage: Stage;
  /** Who plays this round: seated when it began, pruned as players leave while writing. */
  players: PlayerId[];
  /** Lies as written, while writing. */
  lies: Record<PlayerId, string>;
  /** Players whose current lie the game picked for them. */
  autoLies: PlayerId[];
  /** The shuffled board, built when voting starts. */
  options: Option[];
  /** Who votes: the round's players when voting started (leavers who hadn't voted are dropped). */
  voters: PlayerId[];
  /** Option index each voter picked. */
  votes: Record<PlayerId, number>;
  /** Points scored this round, filled at the reveal. */
  points: Record<PlayerId, number>;
  /** Epoch ms when the current stage times out, or null if untimed. */
  deadline: number | null;
}

export interface Score {
  name: string;
  score: number;
  /** Players fooled by this player's lies, over the game. */
  fooled: number;
  /** Times this player found the truth. */
  truths: number;
}

export interface HoodwinkState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  seats: Record<PlayerId, Seat>;
  /** The decks this game is offered, as last seen through `ctx.content`. */
  decks: QuestionDeckSummary[];
  /** Questions still to come, next first. Never sent to clients. */
  questions: Question[];
  round: Round | null;
  /** Everyone who has played a round this game, leavers included. */
  scores: Record<PlayerId, Score>;
  /** Questions drawn in this room's earlier games, oldest first (capped). */
  usedQuestionIds: string[];
  /** Hidden seed for shuffling the voting board. Never sent to clients. */
  seed: number;
  gamesPlayed: number;
  endReason: 'finished' | 'too-few' | null;
}

const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    deckIds: z.array(z.string().min(1)).min(1).max(50).optional(),
    rounds: z.union([z.literal(5), z.literal(7), z.literal(10)]).optional(),
    clueSeconds: timerSeconds.optional(),
    guessSeconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('back-to-lobby') }),
  // Length and content are checked in `reduce`, so the player gets a friendly message.
  z.object({ type: z.literal('lie'), text: z.string().max(400) }),
  z.object({ type: z.literal('lie-for-me') }),
  z.object({ type: z.literal('vote'), option: z.number().int().min(0).max(20) }),
  z.object({ type: z.literal('next-round') }),
  /** Host: stop waiting for the players still missing; the stage ends as a strict timeout would. */
  z.object({ type: z.literal('continue-without') }),
]);

export type HoodwinkAction = z.infer<typeof actionSchema>;

// ---- What each player is allowed to see ----

/** `waiting`: seated, but joined after this round began. */
export type Role = 'player' | 'waiting' | 'spectator';

export interface OptionView {
  index: number;
  text: string;
  /** The viewer wrote this lie (so can't vote for it). */
  mine: boolean;
  /** Revealed only at the reveal. */
  truth: boolean | null;
  /** Revealed only at the reveal. */
  authors: PlayerId[] | null;
  /** Who picked this option; revealed only at the reveal. */
  voters: PlayerId[] | null;
  /** Authors whose lie the game picked for them; revealed only at the reveal. */
  auto: PlayerId[] | null;
  /** A built-in house fake; revealed only at the reveal. */
  house: boolean | null;
}

export interface RoundView {
  number: number;
  rounds: number;
  /** The last round, which scores double. */
  double: boolean;
  stage: Stage;
  /** The question, with `___` where the answer goes. */
  prompt: string;
  deckId: string;
  /** The real answer: null until the reveal. */
  answer: string | null;
  players: PlayerId[];
  /** Players who have written their lie. */
  written: PlayerId[];
  /** The viewer's own lie, if they've written one. */
  myLie: string | null;
  /** The viewer's lie was picked by "Lie for me". */
  myLieAuto: boolean;
  /** The question has built-in fakes, so "Lie for me" is offered. */
  canLieForMe: boolean;
  /** The board: empty while lies are being written. */
  options: OptionView[];
  voters: PlayerId[];
  /** Voters who have voted (not what they picked). */
  voted: PlayerId[];
  myVote: number | null;
  /** Points scored this round: null until the reveal. */
  points: Record<PlayerId, number> | null;
  deadline: number | null;
}

export interface ScoreView extends Score {
  id: PlayerId;
  /** No longer in the room. */
  left: boolean;
}

export interface HoodwinkView {
  phase: HoodwinkState['phase'];
  settings: Settings;
  seats: Array<Seat & { id: PlayerId }>;
  me: (Seat & { id: PlayerId }) | null;
  role: Role;
  decks: QuestionDeckSummary[];
  round: RoundView | null;
  /** Highest score first. */
  scores: ScoreView[];
  endReason: HoodwinkState['endReason'];
}
