import { PLAYER_COLORS, type PlayerColor, type PlayerId } from '@vt/game-sdk';
import { ALL_CARDS } from '@vt/private-reverie/cards';
import { z } from 'zod';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 10;
/** Cards in every hand: each play is replaced at once while the deck lasts. */
export const HAND_SIZE = 6;
/** Every player plays two cards a round. */
export const PLAYS_EACH = 2;
/** Votes on the Conspirator that catch them, at every table size. */
export const CATCH_VOTES = 2;
/** Points: a Detective who found the Conspirator, an escaped Conspirator, their word-picker. */
export const POINTS = { detective: 3, conspirator: 5, picker: 4 } as const;
/** Longest word (or short phrase) the word-picker may type. */
export const MAX_WORD = 30;
/** Longest topic line for the Thematic Game. */
export const MAX_TOPIC = 40;
/** A player who left the room for good has their turn made for them after this beat. */
export const LEFT_BEAT_MS = 3000;
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 600;
/** The discussion's reminder by default. */
export const DEFAULT_DISCUSS_SECONDS = 180;

// ---- Cards ----

/** The game's own decks, by card number (art `cards/<nnn>.jpg` in its private storage). */
export const DECKS = {
  base: { from: 1, to: 168 },
  noir: { from: 169, to: 252 },
} as const;
export type OwnDeck = keyof typeof DECKS;

/**
 * "Our picture cards" are Reverie's (Starlight's set included), numbered here from `OURS_BASE`
 * on: card `OURS_BASE + n` is Reverie's card `n`.
 */
export const OURS_BASE = 1000;
export const OURS_CARDS: readonly number[] = ALL_CARDS.map((n) => OURS_BASE + n);

const range = ({ from, to }: { from: number; to: number }) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const DECK_CARDS: Record<DeckId, readonly number[]> = {
  base: range(DECKS.base),
  noir: range(DECKS.noir),
  ours: OURS_CARDS,
};

export type DeckId = OwnDeck | 'ours';
export const DECK_IDS: readonly DeckId[] = ['base', 'noir', 'ours'];

/** Reverie's card number for one of our picture cards, or null for the game's own. */
export const oursCard = (card: number): number | null =>
  card >= OURS_BASE ? card - OURS_BASE : null;

export const deckOf = (card: number): DeckId =>
  card >= OURS_BASE ? 'ours' : card >= DECKS.noir.from ? 'noir' : 'base';

// ---- Settings ----

export type TimerMode = 'soft' | 'strict';
export type Scoring = 'rulebook' | 'caught' | 'fun';
export const SCORINGS: readonly Scoring[] = ['rulebook', 'caught', 'fun'];
export type SoundMode = 'off' | 'host' | 'all';
export const SOUND_MODES: readonly SoundMode[] = ['off', 'host', 'all'];

export interface Settings {
  decks: Record<DeckId, boolean>;
  /** Everyone picks the word twice, at any table size (under 5 players it's always twice). */
  twice: boolean;
  /** The printed vote: one at a time, clockwise from the word-picker's left, in the open. */
  openVote: boolean;
  /** The printed No Discussion variant: straight from the plays to the vote. */
  noDiscussion: boolean;
  scoring: Scoring;
  /** Everyone is the Conspirator about equally often. */
  balanced: boolean;
  /** The Thematic Game's topic ('' = off). */
  topic: string;
  /** Seconds for the word, each card play and the vote; null: no timer. */
  turnSeconds: number | null;
  /** Seconds for each explanation; null: no timer. */
  talkSeconds: number | null;
  /** Seconds for the discussion; null: no timer. */
  discussSeconds: number | null;
  timerMode: TimerMode;
  /** Where the two sound cues play. */
  sound: SoundMode;
}

export const DEFAULT_SETTINGS: Settings = {
  decks: { base: true, noir: true, ours: false },
  twice: false,
  openVote: false,
  noDiscussion: false,
  scoring: 'rulebook',
  balanced: false,
  topic: '',
  turnSeconds: null,
  talkSeconds: null,
  discussSeconds: DEFAULT_DISCUSS_SECONDS,
  timerMode: 'soft',
  sound: 'all',
};

// ---- State ----

export type SeatColor = PlayerColor;
export const SEAT_COLORS = PLAYER_COLORS;

export interface Seat {
  name: string;
  color: SeatColor;
  /** Seated players play; the rest watch. */
  playing: boolean;
}

/** A card on the table. */
export interface Play {
  by: PlayerId;
  card: number;
  /** 1 or 2: the player's first or second card. */
  lap: 1 | 2;
  /** Made for the player (a strict timer, the host's Act for, or they left). */
  auto?: boolean;
}

export type Stage = 'card' | 'word' | 'play' | 'explain' | 'discuss' | 'vote' | 'reveal';

export interface RoundResult {
  conspirator: PlayerId;
  /** Votes on the Conspirator. */
  against: number;
  /** At least two votes found the Conspirator. */
  caught: boolean;
  /** Points each player won this round (only those who scored). */
  points: Record<PlayerId, number>;
  /** Every vote, voter → accused. */
  votes: Record<PlayerId, PlayerId>;
}

export interface Round {
  no: number;
  picker: PlayerId;
  /** Everyone at the table, the word-picker first, then clockwise. */
  order: PlayerId[];
  stage: Stage;
  word: string | null;
  /** Secret until the reveal: never in a view before it. */
  conspirator: PlayerId | null;
  plays: Play[];
  /** Whose card play, explanation or (open vote) vote it is. */
  turn: PlayerId | null;
  explained: PlayerId[];
  /** Secret votes: voter → accused (only "voted" in views until the reveal). */
  votes: Record<PlayerId, PlayerId>;
  /** Votes made for players (strict timer, Act for, left). */
  autoVotes: PlayerId[];
  /** Explanations the timer or the host ended. */
  skipped: PlayerId[];
  /** When the current step began, for its timer. */
  since: number;
  result: RoundResult | null;
}

/** One finished round, public. */
export interface RoundRecord extends RoundResult {
  no: number;
  picker: PlayerId;
  word: string;
}

export type EndReason = 'rounds' | 'too-few';

export interface Game {
  /** Everyone playing, in seat order. */
  players: PlayerId[];
  names: Record<PlayerId, string>;
  /** Word-pickers still to come after this round, in order. */
  pickers: PlayerId[];
  /** How many rounds the game has (fewer when a word-picker leaves). */
  rounds: number;
  deck: number[];
  hands: Record<PlayerId, number[]>;
  /** Points won, one entry per scoring round (the tokens; ties go to more of them). */
  tokens: Record<PlayerId, number[]>;
  /** Times each player was the Conspirator this game. Secret (the balanced deal reads it). */
  conspired: Record<PlayerId, number>;
  /** Players who left the room for good, and when. */
  left: Record<PlayerId, number>;
  round: Round;
  history: RoundRecord[];
}

export interface RedHerringState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Hidden randomness for deadlines and leavers. Never shown. */
  seed: number;
  /** Insertion-ordered by join time: the seating order (clockwise). */
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  winners: PlayerId[];
  endReason: EndReason | null;
  gamesPlayed: number;
}

// ---- Actions ----

const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();
const id = z.string().min(1).max(100);
const card = z
  .number()
  .int()
  .min(1)
  .max(OURS_BASE + 2000);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    decks: z.object({ base: z.boolean(), noir: z.boolean(), ours: z.boolean() }).optional(),
    twice: z.boolean().optional(),
    openVote: z.boolean().optional(),
    noDiscussion: z.boolean().optional(),
    scoring: z.enum(['rulebook', 'caught', 'fun']).optional(),
    balanced: z.boolean().optional(),
    topic: z.string().max(200).optional(),
    turnSeconds: timerSeconds.optional(),
    talkSeconds: timerSeconds.optional(),
    discussSeconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
    sound: z.enum(['off', 'host', 'all']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('back-to-lobby') }),
  z.object({ type: z.literal('play-again') }),
  /** A card from your hand onto the table (the word-picker's first card, or your turn's). */
  z.object({ type: z.literal('play'), card }),
  z.object({ type: z.literal('word'), word: z.string().max(200) }),
  /** The explainer is done (the host may end anyone's explanation). */
  z.object({ type: z.literal('done') }),
  z.object({ type: z.literal('end-discussion') }),
  z.object({ type: z.literal('vote'), player: id }),
  z.object({ type: z.literal('next-round') }),
  /** The host makes the safe move for a player the table is waiting on. */
  z.object({ type: z.literal('act-for'), player: id }),
  /** The host takes a player who has dropped out of play, as if they had left. */
  z.object({ type: z.literal('remove'), player: id }),
]);

export type RedHerringAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  color: SeatColor;
  playing: boolean;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  /** Left the room for good: the table plays for them. */
  left: boolean;
  /** Points so far. */
  score: number;
  /** Rounds they scored in (the tiebreak). */
  tokens: number;
  /** Cards in hand. */
  hand: number;
}

export interface RoundView {
  no: number;
  picker: PlayerId;
  order: PlayerId[];
  stage: Stage;
  /**
   * The word: the word-picker's from the moment they write it, everyone's once it is said out
   * loud (the explanations) and at the reveal.
   */
  word: string | null;
  /**
   * Your notebook (everyone but the word-picker, once the word is written): the word, or a blank
   * page for the Conspirator. Same shape for every role.
   */
  notebook: { word: string | null } | null;
  plays: Play[];
  turn: PlayerId | null;
  explained: PlayerId[];
  skipped: PlayerId[];
  /** Who has voted (secret votes stay secret until the reveal). */
  voted: PlayerId[];
  myVote: PlayerId | null;
  /** Open vote: every vote as cast; secret vote: only at the reveal. */
  votes: Record<PlayerId, PlayerId> | null;
  autoVotes: PlayerId[];
  since: number;
  /** When the current step's timer runs out, if it has one. */
  deadline: number | null;
  result: RoundResult | null;
}

export interface GameView {
  players: PlayerView[];
  rounds: number;
  /** Your own hand only. */
  hand: number[];
  deck: number;
  round: RoundView;
  history: RoundRecord[];
}

export interface RedHerringView {
  phase: RedHerringState['phase'];
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
  winners: PlayerId[];
  endReason: EndReason | null;
}
