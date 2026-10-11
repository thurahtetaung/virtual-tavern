import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

export const MIN_PLAYERS = 3;
/** Players dealt in at most; anyone else in the room watches. */
export const MAX_SEATS = 12;
/** Two spies is a host option from this many players. */
export const TWO_SPIES_MIN = 7;
export const ROUND_SECONDS_OPTIONS = [240, 300, 360] as const;
export const DEFAULT_ROUND_SECONDS = 300;
/** The vote is strict: anyone who hasn't voted when it runs out abstains. */
export const VOTE_SECONDS = 45;
/** A caught spy's last chance; no pick in time counts as wrong. */
export const GUESS_SECONDS = 30;
export const MAX_ROUNDS = 30;

/** One edition of a location pack: the host picks one or more. */
export interface PackEdition {
  id: string;
  label: string;
  /** Location ids. Names, art and coaching are looked up by the UI. */
  locations: string[];
}

export interface Pack {
  editions: PackEdition[];
}

export interface Settings {
  /** Chosen edition ids (at least one). */
  editions: string[];
  /** Length of the talking part of each round. */
  roundSeconds: number;
  /** Rounds in a game; null means one per player, so everyone starts the asking once. */
  rounds: number | null;
  /** Two spies (who don't know each other) at 7 or more players. */
  twoSpies: boolean;
}

export interface Seat {
  name: string;
  /** Seated players are dealt in; the rest watch. */
  playing: boolean;
  score: number;
}

export type Stage = 'talk' | 'vote' | 'guess' | 'reveal';
export type SpyOutcome = 'escaped' | 'stole' | 'caught';

export interface RoundResult {
  location: string;
  spies: PlayerId[];
  /** Voter -> who they voted for. Non-voters abstained. */
  votes: Record<PlayerId, PlayerId>;
  /** Who the vote named: the top vote-getter (or top two with two spies), or nobody on a tie. */
  named: PlayerId[];
  /** Each spy's fate, and the location a caught spy guessed (null: no guess in time). */
  spyResults: { id: PlayerId; outcome: SpyOutcome; guess: string | null }[];
  /** Points scored this round. */
  points: Record<PlayerId, number>;
}

export interface Round {
  number: number;
  /** A fresh id per deal (a redeal gets a new one): keys each player's board notes. */
  deal: number;
  /** Dealt-in players, in seat order. */
  players: PlayerId[];
  /** Kept so the round can still name players who leave. */
  names: Record<PlayerId, string>;
  /** Who asks the first question. */
  starter: PlayerId;
  location: string;
  spies: PlayerId[];
  stage: Stage;
  deadline: number | null;
  ready: PlayerId[];
  votes: Record<PlayerId, PlayerId>;
  named: PlayerId[];
  /** Caught spies, set when the vote resolves. */
  caught: PlayerId[];
  /** Caught spies' guesses. */
  guesses: Record<PlayerId, string | null>;
  result: RoundResult | null;
  /** The name of a spy who left, so the round was dealt again. */
  redealtAfter: string | null;
}

export interface MasqueradeState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Hidden randomness for deadlines and leavers, which come without an rng. Never sent. */
  seed: number;
  /** A random id for this room's table, so players' board notes never mix rooms up. */
  table: number;
  /** Insertion-ordered by join time: the seating order. */
  seats: Record<PlayerId, Seat>;
  /** Rounds in this game, fixed at the start. */
  totalRounds: number;
  round: Round | null;
  /** Locations already played this game, so they don't repeat until the pack runs out. */
  used: string[];
  /** Deals handed out; never reset, so deal ids stay unique. */
  deals: number;
  /** Where the asking starts in round 1; it moves one seat on each round. */
  starterOffset: number;
  /** Why the game went back to the lobby. */
  notice: 'too-few' | null;
  winners: PlayerId[];
  gamesPlayed: number;
}

const id = z.string().min(1).max(128);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    editions: z.array(z.string().min(1).max(40)).min(1).max(10).optional(),
    roundSeconds: z.union([z.literal(240), z.literal(300), z.literal(360)]).optional(),
    rounds: z.number().int().min(1).max(MAX_ROUNDS).nullable().optional(),
    twoSpies: z.boolean().optional(),
  }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('ready-to-vote'), ready: z.boolean() }),
  z.object({ type: z.literal('vote'), target: id }),
  z.object({ type: z.literal('spy-guess'), location: z.string().min(1).max(80) }),
  z.object({ type: z.literal('next-round') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type MasqueradeAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
  score: number;
}

export type Role = 'local' | 'spy' | 'watching';

export interface RoundView {
  number: number;
  deal: number;
  players: { id: PlayerId; name: string }[];
  starter: PlayerId;
  stage: Stage;
  deadline: number | null;
  /** The viewer's part this round. */
  role: Role;
  /** Only locals see it. */
  location: string | null;
  /** How many spies there are (public: it's a lobby setting). */
  spyCount: number;
  readyCount: number;
  /** Who has tapped Ready to vote (public: only votes are secret, not who has acted). */
  readyIds: PlayerId[];
  meReady: boolean;
  votedCount: number;
  /** Who has voted so far; never whom they voted for until the vote resolves. */
  votedIds: PlayerId[];
  /** Only the viewer's own vote, until the vote resolves. */
  myVote: PlayerId | null;
  /** After the vote: everyone's votes and who was named. */
  votes: Record<PlayerId, PlayerId> | null;
  named: PlayerId[] | null;
  /** After the vote: the spies it caught (only caught spies are revealed before the end). */
  caught: PlayerId[] | null;
  /** Caught spies who have made their guess. */
  guessed: PlayerId[];
  /** Whether the viewer is a caught spy who still has to guess. */
  canGuess: boolean;
  result: RoundResult | null;
  redealtAfter: string | null;
}

export interface EditionView {
  id: string;
  label: string;
  count: number;
}

export interface MasqueradeView {
  phase: MasqueradeState['phase'];
  table: number;
  settings: Settings;
  editions: EditionView[];
  /** Every location in the chosen editions, in pack order: the Locations board. */
  locations: string[];
  seats: SeatView[];
  me: SeatView | null;
  totalRounds: number;
  round: RoundView | null;
  notice: MasqueradeState['notice'];
  winners: PlayerId[];
}
