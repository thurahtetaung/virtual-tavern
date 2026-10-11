import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

/**
 * The card roles. These plain words are the ids in code and the fallback labels on screen; the
 * cards' display names and art come from the private manifest in asset storage.
 */
export const ROLES = [
  'spy',
  'guard',
  'priest',
  'baron',
  'handmaid',
  'prince',
  'chancellor',
  'king',
  'countess',
  'princess',
] as const;
export type Role = (typeof ROLES)[number];

export const EDITION_IDS = ['classic', '2019'] as const;
export type Edition = (typeof EDITION_IDS)[number];

export interface EditionConfig {
  id: Edition;
  label: string;
  minPlayers: number;
  maxPlayers: number;
  /** The cards in the edition, lowest rank first, with how many of each are in the deck. */
  cards: { role: Role; rank: number; count: number }[];
  /** Favour tokens needed to win the game, by number of players. */
  tokens: Record<number, number>;
  /** How a tie at the end of a round is settled. */
  tiebreak: 'discards' | 'share';
}

export const EDITIONS: Record<Edition, EditionConfig> = {
  classic: {
    id: 'classic',
    label: 'Classic',
    minPlayers: 2,
    maxPlayers: 4,
    cards: [
      { role: 'guard', rank: 1, count: 5 },
      { role: 'priest', rank: 2, count: 2 },
      { role: 'baron', rank: 3, count: 2 },
      { role: 'handmaid', rank: 4, count: 2 },
      { role: 'prince', rank: 5, count: 2 },
      { role: 'king', rank: 6, count: 1 },
      { role: 'countess', rank: 7, count: 1 },
      { role: 'princess', rank: 8, count: 1 },
    ],
    tokens: { 2: 7, 3: 5, 4: 4 },
    tiebreak: 'discards',
  },
  '2019': {
    id: '2019',
    label: '2019',
    minPlayers: 2,
    maxPlayers: 6,
    cards: [
      { role: 'spy', rank: 0, count: 2 },
      { role: 'guard', rank: 1, count: 6 },
      { role: 'priest', rank: 2, count: 2 },
      { role: 'baron', rank: 3, count: 2 },
      { role: 'handmaid', rank: 4, count: 2 },
      { role: 'prince', rank: 5, count: 2 },
      { role: 'chancellor', rank: 6, count: 2 },
      { role: 'king', rank: 7, count: 1 },
      { role: 'countess', rank: 8, count: 1 },
      { role: 'princess', rank: 9, count: 1 },
    ],
    tokens: { 2: 6, 3: 5, 4: 4, 5: 3, 6: 3 },
    tiebreak: 'share',
  },
};

/** The most players any edition seats. */
export const MAX_SEATS = 6;
export const MIN_PLAYERS = 2;
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 600;
/** Public log entries kept (older ones drop off). */
export const MAX_LOG = 60;
/** Private notes kept per player. */
export const MAX_NOTES = 30;

export type TimerMode = 'soft' | 'strict';

export interface Settings {
  edition: Edition;
  /** Seconds for each turn (and again for a Chancellor's choice); null disables the timer. */
  turnSeconds: number | null;
  timerMode: TimerMode;
  /** A short game plays to fewer favour tokens (`shortTarget`). Missing in older rooms: full. */
  short?: boolean;
}

export interface Seat {
  name: string;
  /** Seated players play; the rest watch. */
  playing: boolean;
  tokens: number;
  /**
   * Watching only because there was no seat (the table was full, or a game was on), not by
   * choice: sat down automatically as soon as a seat is free between games.
   */
  waiting?: boolean;
}

export interface RoundPlayer {
  /** Kept so the round still shows who someone was after they leave the room. */
  name: string;
  hand: Role[];
  /** Played and discarded cards, oldest first: public. */
  discards: Role[];
  out: boolean;
  protected: boolean;
  left: boolean;
}

export type RoundStage = 'play' | 'chancellor' | 'over';
export type RoundEndReason = 'last-standing' | 'deck-empty';

export interface RoundResult {
  reason: RoundEndReason;
  winners: PlayerId[];
  /** The final card of every player still in at the end, shown to everyone. */
  hands: Record<PlayerId, Role>;
  /** Classic ties: the totals of the tied players' discards. */
  discardTotals: Record<PlayerId, number> | null;
  /** The one surviving player who played or discarded a Spy (2019), who gains a token. */
  spy: PlayerId | null;
}

export interface Round {
  number: number;
  /** Turn order: everyone dealt in, starting with the first player. */
  order: PlayerId[];
  players: Record<PlayerId, RoundPlayer>;
  /** The draw pile, top first. Never sent to players. */
  deck: Role[];
  /** The face-down card set aside at the start; a Prince on an empty deck draws it. */
  setAside: Role | null;
  /** With two players, three more cards are set aside face up. */
  faceUp: Role[];
  current: PlayerId;
  stage: RoundStage;
  deadline: number | null;
  result: RoundResult | null;
}

/** Why someone left the round. */
export type OutCause = Role | 'left';

export type LogEntry =
  | {
      id: number;
      round: number;
      kind: 'play';
      by: PlayerId;
      card: Role;
      target: PlayerId | null;
      guess: Role | null;
      /** Played with no effect: every other player was protected or out. */
      noEffect: boolean;
      /** Guard: whether the guess was right. */
      hit?: boolean;
      /** Prince: the card the target discarded. */
      discarded?: Role;
      /** Chancellor: how many cards were drawn. */
      drew?: number;
      /** Baron: the comparison was a tie. */
      tie?: boolean;
      /** A strict timer played this card for a player who ran out of time. */
      timedOut?: boolean;
      /** Chancellor: a strict timer chose the kept card for them. */
      autoKept?: boolean;
    }
  | {
      id: number;
      round: number;
      kind: 'out';
      player: PlayerId;
      cause: OutCause;
      /** Who knocked them out (themselves for the Princess), if anyone. */
      by: PlayerId | null;
      /** Their hand, now face up. */
      cards: Role[];
    }
  | {
      id: number;
      round: number;
      kind: 'round-end';
      winners: PlayerId[];
      reason: RoundEndReason;
      spy: PlayerId | null;
    };

/** What only one player learned: never shown to anyone else. */
/** `timedOut`: a strict timer played the card that produced this note. */
export type Note =
  | { id: number; round: number; kind: 'peek'; target: PlayerId; card: Role; timedOut?: boolean }
  | {
      id: number;
      round: number;
      kind: 'compare';
      other: PlayerId;
      mine: Role;
      theirs: Role;
      result: 'win' | 'lose' | 'tie';
      timedOut?: boolean;
    }
  | {
      id: number;
      round: number;
      kind: 'trade';
      other: PlayerId;
      gave: Role;
      got: Role;
      timedOut?: boolean;
    };

export type EndReason = 'target' | 'too-few';

export interface RoyalPostState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Hidden randomness for deadlines and leavers, which come without an rng. Never sent. */
  seed: number;
  /** Insertion-ordered by join time: this is the seating order. */
  seats: Record<PlayerId, Seat>;
  /** Tokens needed to win, fixed when the game starts. */
  target: number;
  round: Round | null;
  log: LogEntry[];
  notes: Record<PlayerId, Note[]>;
  /** The last log or note id handed out; never reset, so ids stay unique across games. */
  seq: number;
  winners: PlayerId[];
  endReason: EndReason | null;
  gamesPlayed: number;
}

const role = z.enum(ROLES);
const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    edition: z.enum(EDITION_IDS).optional(),
    turnSeconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
    short: z.boolean().optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({
    type: z.literal('play'),
    card: role,
    target: z.string().min(1).max(128).optional(),
    guess: role.optional(),
  }),
  z.object({
    type: z.literal('chancellor-keep'),
    keep: role,
    bottomOrder: z.array(role).max(2),
  }),
  z.object({ type: z.literal('next-round') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type RoyalPostAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
  tokens: number;
  /** Watching for want of a seat: dealt in at the next game if there's room. */
  waiting?: boolean;
}

export interface RoundPlayerView {
  id: PlayerId;
  name: string;
  out: boolean;
  protected: boolean;
  left: boolean;
  discards: Role[];
  /** Cards in hand (the cards themselves stay hidden). */
  handCount: number;
}

export interface RoundView {
  number: number;
  /** Players in turn order. */
  players: RoundPlayerView[];
  current: PlayerId;
  stage: RoundStage;
  deckCount: number;
  /** Whether the face-down set-aside card is still there (never what it is). */
  setAside: boolean;
  faceUp: Role[];
  deadline: number | null;
  result: RoundResult | null;
}

export interface RoyalPostView {
  phase: RoyalPostState['phase'];
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  /** Tokens needed to win: fixed during a game, or what the lobby's player count would need. */
  target: number;
  round: RoundView | null;
  /** Only the viewer's own cards. */
  hand: Role[];
  log: LogEntry[];
  /** Only the viewer's own private notes. */
  notes: Note[];
  winners: PlayerId[];
  endReason: EndReason | null;
}
