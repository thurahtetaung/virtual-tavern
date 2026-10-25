import type { OpenQuestion, PlayerId, QuestionDeckSummary } from '@vt/game-sdk';
import { z } from 'zod';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 20;
/** Room capacity: up to `MAX_PLAYERS` play, the rest watch. */
export const ROOM_CAPACITY = 30;
export const TARGETS = [5, 8, 10] as const;
export const DEFAULT_TARGET = 8;
/** Answers are short: "one or two words". */
export const MAX_ANSWER_LENGTH = 30;
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 300;
/** How long the Pink Cow's holder has to pick the next holder (house rule). */
export const PICK_MS = 30_000;
/** A player may moo at most once in this long. */
export const MOO_GAP_MS = 5_000;
/** Moos kept in state (the newest). */
export const MAX_MOOS = 8;
/** Question ids remembered per room, so the decks are used up before anything repeats. */
export const MAX_USED_QUESTIONS = 500;
/** Rounds kept for the Scores tab's round log. */
export const MAX_HISTORY = 30;
/** Merge steps kept per round (the host's log). */
export const MAX_MERGES = 60;

export type Target = (typeof TARGETS)[number];
export type TimerMode = 'soft' | 'strict';

export interface Settings {
  deckIds: string[];
  /** Cows needed to win. */
  target: Target;
  /** Time to write an answer, or null for no timer. */
  answerSeconds: number | null;
  /** Soft: a reminder (the host may continue without the slow ones); strict: time's up locks. */
  timerMode: TimerMode;
  /** The host may swap the question once a round. */
  skip: boolean;
  /** House rule: with several unique answers, the Pink Cow's holder picks who takes it. */
  holderPicks: boolean;
  /** House rule: players tied on top at the target share the win instead of raising it. */
  sharedWin: boolean;
}

export interface Seat {
  name: string;
  /** false = just watching. */
  playing: boolean;
}

/** `answer`: everyone writes; `merge`: the host checks the groups; `pick`: the Pink Cow's holder picks. */
export type Stage = 'answer' | 'merge' | 'pick' | 'reveal';

/** Answers that count as the same. */
export interface Group {
  id: string;
  members: PlayerId[];
}

/** One step of the host's checking, shown to everyone at the reveal. */
export interface MergeStep {
  kind: 'merge' | 'split' | 'move' | 'reset';
  /** The answers involved, as shown (`merge`: from, into; `move`/`split`: the answer, into). */
  labels: string[];
}

export interface RoundResult {
  /** The herd's group, or null when the top answers tie (or nobody matched). */
  herd: string | null;
  /** Who scored a cow. */
  scorers: PlayerId[];
  /** The top answers tied: nobody scored. */
  tie: boolean;
  /** Players alone with their answer. */
  loners: PlayerId[];
  /** Players with no answer (blank or late): they match nothing. */
  blanks: PlayerId[];
  /** Who held the Pink Cow before this round. */
  pinkFrom: PlayerId | null;
  /** Who holds it after (the same as `pinkFrom` when it stayed). */
  pinkTo: PlayerId | null;
  /** How it moved: alone (`lone`), the holder's pick (`picked`), at random after the pick timed out. */
  pinkHow: 'lone' | 'picked' | 'timeout' | null;
  /** The target went up to this, after a tie at the top. */
  raisedTo: number | null;
  /** The game's winners, decided at this reveal. */
  winners: PlayerId[];
}

export interface Round {
  /** 1-based. */
  number: number;
  question: OpenQuestion;
  stage: Stage;
  /** Who answers this round: seated when it began, pruned as players leave. */
  players: PlayerId[];
  /** Answers as written (tidied), while writing and after. */
  answers: Record<PlayerId, string>;
  /** The host swapped the question this round. */
  skipped: boolean;
  /** Players left without an answer when the writing ended early (timer or host). */
  late: PlayerId[];
  /** The writing timer's end, or null without one. */
  deadline: number | null;
  /** The groups, from the end of the writing (auto) and then the host's checking. */
  groups: Group[];
  /** The automatic grouping, for "Start again". */
  auto: Group[];
  /** Next new group's number. */
  nextGroup: number;
  merges: MergeStep[];
  /** Set from the reveal on. */
  result: RoundResult | null;
  /** The Pink Cow holder's pick: who they may pick from, and until when. */
  pick: { options: PlayerId[]; deadline: number } | null;
}

export interface Score {
  name: string;
  cows: number;
  /** Rounds this player's answer was in the herd. */
  herds: number;
  /** Times this player took the Pink Cow. */
  pinks: number;
}

/** One finished round, for the Scores tab's log. */
export interface HistoryEntry {
  number: number;
  prompt: string;
  /** The herd's answer, or null on a tie. */
  herd: string | null;
  herdSize: number;
  scorers: PlayerId[];
  pinkTo: PlayerId | null;
  /** The Pink Cow changed hands this round. */
  pinkMoved: boolean;
}

export interface Moo {
  from: PlayerId;
  to: PlayerId[];
  at: number;
}

export interface StampedeState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  seats: Record<PlayerId, Seat>;
  /** The decks this game is offered, as last seen through `ctx.content`. */
  decks: QuestionDeckSummary[];
  /** Everyone who has played a round this game, leavers included. */
  scores: Record<PlayerId, Score>;
  /** Who holds the Pink Cow (null: it's in the middle). */
  pinkCow: PlayerId | null;
  /** Cows to win: the setting, raised after a tie at the top. */
  target: number;
  round: Round | null;
  history: HistoryEntry[];
  moos: Moo[];
  /**
   * The host as last seen acting: the one who checks the groups. The game can't see the room's
   * host otherwise, so a new host claims the checking with `check`.
   */
  checker: PlayerId | null;
  /** Questions drawn in this room, oldest first (capped). */
  usedQuestionIds: string[];
  /** Hidden seed for the timed-out pick. Never sent to clients. */
  seed: number;
  gamesPlayed: number;
  winners: PlayerId[];
  /** `abandoned`: the host ended the game early, back to the lobby (kept until the next start). */
  endReason: 'won' | 'too-few' | 'no-questions' | 'abandoned' | null;
}

const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();
const groupId = z.string().min(1).max(12);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    deckIds: z.array(z.string().min(1)).min(1).max(50).optional(),
    target: z.union([z.literal(5), z.literal(8), z.literal(10)]).optional(),
    answerSeconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
    skip: z.boolean().optional(),
    holderPicks: z.boolean().optional(),
    sharedWin: z.boolean().optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('back-to-lobby') }),
  // Length and content are checked in `reduce`, so the player gets a friendly message.
  z.object({ type: z.literal('answer'), text: z.string().max(200) }),
  z.object({ type: z.literal('moo') }),
  z.object({ type: z.literal('skip') }),
  /** Host: stop waiting for the players still writing; they have no answer this round. */
  z.object({ type: z.literal('continue-without') }),
  /** Host: take over checking the groups (after the host changed). */
  z.object({ type: z.literal('check') }),
  z.object({ type: z.literal('merge'), from: groupId, into: groupId }),
  /** Moves one answer into another group, or on its own (`into: null`, a split). */
  z.object({
    type: z.literal('move'),
    player: z.string().min(1).max(100),
    into: groupId.nullable(),
  }),
  z.object({ type: z.literal('reset-groups') }),
  z.object({ type: z.literal('reveal') }),
  z.object({ type: z.literal('pick'), player: z.string().min(1).max(100) }),
  z.object({ type: z.literal('next-round') }),
]);

export type StampedeAction = z.infer<typeof actionSchema>;

// ---- What each player is allowed to see ----

/** `waiting`: seated, but joined after this round began. */
export type Role = 'player' | 'waiting' | 'spectator';

export interface GroupView {
  id: string;
  /** The answer as shown: its most common spelling. */
  label: string;
  members: PlayerId[];
  /** Each member's answer as they wrote it. */
  answers: Record<PlayerId, string>;
}

/** "These look like a typo of each other": a merge the host may want. */
export interface Suggestion {
  from: string;
  into: string;
}

export interface RoundView {
  number: number;
  stage: Stage;
  prompt: string;
  questionId: string;
  deckId: string;
  players: PlayerId[];
  /** Players who have sent an answer (not what it is). */
  answered: PlayerId[];
  /** The viewer's own answer, if they've written one. */
  myAnswer: string | null;
  /** Whether the host may still swap this question. */
  canSkip: boolean;
  skipped: boolean;
  late: PlayerId[];
  deadline: number | null;
  /** The groups: to the checker while checking, to everyone from the pick on; else null. */
  groups: GroupView[] | null;
  /** Likely typos, to the checker while checking. */
  suggestions: Suggestion[];
  /** The checking steps: the checker's while checking, everyone's from the pick on. */
  merges: MergeStep[] | null;
  /** Who is checking the groups (the host as last seen). */
  checker: PlayerId | null;
  result: RoundResult | null;
  pick: { options: PlayerId[]; deadline: number } | null;
}

export interface ScoreView extends Score {
  id: PlayerId;
  /** No longer in the room (can't win). */
  left: boolean;
}

export interface StampedeView {
  phase: StampedeState['phase'];
  settings: Settings;
  seats: Array<Seat & { id: PlayerId }>;
  me: (Seat & { id: PlayerId }) | null;
  role: Role;
  decks: QuestionDeckSummary[];
  round: RoundView | null;
  /** Most cows first. */
  scores: ScoreView[];
  pinkCow: PlayerId | null;
  target: number;
  history: HistoryEntry[];
  moos: Moo[];
  winners: PlayerId[];
  endReason: StampedeState['endReason'];
}
