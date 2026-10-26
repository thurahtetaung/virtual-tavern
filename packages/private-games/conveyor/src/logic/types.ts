import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';
import { TYPE_IDS, type TypeId } from './cards.ts';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const ROUNDS = 3;
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 300;
export const DEFAULT_SECONDS = 30;
/** The spoon's giver chooses which card to hand over within this long, else one at random. */
export const GIVE_SECONDS = 15;
/** The round's scores stay up this long unless everyone taps Ready first. */
export const SCORES_SECONDS = 30;
/** How long the table waits before playing for a player who left. */
export const LEFT_BEAT_MS = 3000;
/** 2 players with draw piles: cards in hand at the deal, and in each player's own pile. */
export const PILE_HAND = 5;
/** Public log entries kept (older ones drop off). */
export const MAX_LOG = 120;

export type TimerMode = 'soft' | 'strict';

/** A card in a hand, a pile or the deck: an id that says nothing, and what it is. */
export interface Card {
  id: string;
  /** The variant (`nigiri-squid`, `maki-2`, `spoon-5`…). */
  k: string;
}

/** A card in front of a player this round (or a dessert kept from an earlier one). */
export interface Played {
  id: string;
  /** What it counts as: for a special order, the card it copies. */
  k: string;
  /** The turn it was played (1 = the round's first). */
  turn: number;
  /** A special order: the card it copied. */
  copy?: string;
  /** Turned face down by a takeout box: worth 2, and no longer the card it shows. */
  flipped?: boolean;
  /** A nigiri sitting on this wasabi (by id). */
  on?: string;
  /** A wasabi that has taken its nigiri. */
  filled?: boolean;
}

export interface Settings {
  /** A suggested menu's id, `random`, or `custom`. */
  menu: string;
  /** The custom menu: 1 roll, 3 appetizers, 2 specials, 1 dessert. */
  custom: TypeId[];
  /** Rounds 1 and 3 pass left, round 2 right. */
  passBoth: boolean;
  /** Lowest score wins. */
  golf: boolean;
  /** 2 players: 5 cards in hand and 5 in your own pile, drawn one a turn. */
  drawPile: boolean;
  /** Seconds for each pick and each choice; null: no clock. */
  seconds: number | null;
  timerMode: TimerMode;
}

export interface Seat {
  name: string;
  playing: boolean;
  /** Watching only for want of a seat: sat down at the next game if there's room. */
  waiting?: boolean;
}

/** A player's secret choice for the turn. */
export interface Pick {
  /** The card from the hand. */
  card: string;
  /** A special order: the card in front of you it copies. */
  target?: string;
  /** Chopsticks or a spoon in front of you, called this turn. */
  bonus?: string;
  /** Made for the player (the timer, the host, or the table for a leaver). */
  auto?: Auto;
}

export interface PlayerState {
  hand: Card[];
  /** 2 players with draw piles: your own face-down pile. */
  pile: Card[];
  /** The cards played this round. */
  tray: Played[];
  /** Desserts kept from earlier rounds (this round's join at its end). */
  desserts: Played[];
  /** Uramaki points scored this round. */
  ura: number;
  /** Total of the finished rounds (and desserts at the end). */
  score: number;
  pick: Pick | null;
  /** Who passed you the hand you hold this turn (null on the round's first turn). */
  from: PlayerId | null;
  /** Ready for the next round (`scores` stage). */
  ready: boolean;
}

/** Who made a move for whom: the strict timer, the host's Act for, or the table for a leaver. */
export type Auto = 'timer' | 'host' | 'left';

/** A spoon's request: a whole type, or one exact card. */
export interface Request {
  type: TypeId;
  variant?: string;
}

/** A choice the table waits on after the reveal. */
export type Step =
  | {
      /** Everyone who called chopsticks picks their second card, at once. */
      kind: 'chop';
      /** Each caller's chopsticks (by player): id and order number. */
      calls: Record<PlayerId, { id: string; no: number }>;
      choices: Record<PlayerId, { card: string; target?: string }>;
      auto: Record<PlayerId, Auto>;
    }
  | { kind: 'spoon'; by: PlayerId; id: string; no: number }
  | {
      kind: 'give';
      by: PlayerId;
      id: string;
      no: number;
      from: PlayerId;
      request: Request;
    }
  | { kind: 'menu'; by: PlayerId; id: string; no: number; drawn: Card[] }
  | { kind: 'copy'; by: PlayerId; id: string }
  | { kind: 'takeout'; by: PlayerId; id: string; no: number };

/** A numbered action waiting for its turn in the resolution. */
export interface Queued {
  /** `copy`: a special order that came by spoon, waiting for its target. */
  kind: 'spoon' | 'menu' | 'takeout' | 'copy';
  by: PlayerId;
  id: string;
  no: number;
}

export interface Part {
  key: TypeId | 'flipped' | 'uramaki';
  points: number;
  /** A short note ("most icons", "3 sets"). */
  note?: string;
}

export interface RoundRow {
  id: PlayerId;
  parts: Part[];
  points: number;
}

export interface RoundResult {
  round: number;
  rows: RoundRow[];
}

export interface Clock {
  key: string;
  since: number;
  reminded: boolean;
}

export interface Game {
  /** Seat order: passing left goes to the next seat. */
  order: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  names: Record<PlayerId, string>;
  /** The menu's types (nigiri is always there too). */
  menu: TypeId[];
  /** The suggested menu's id, when it is one. */
  preset: string | null;
  round: number;
  turn: number;
  /** Turns this round (the hand size). */
  turns: number;
  /** `pick`: everyone chooses; `resolve`: the reveal's choices; `scores`: between rounds. */
  stage: 'pick' | 'resolve' | 'scores';
  step: Step | null;
  queue: Queued[];
  /** Never sent: the round's face-down deck, top first. */
  deck: Card[];
  /** Never sent: desserts still to be added in later rounds. */
  dessertPile: Card[];
  /** Uramaki places taken this round. */
  claimed: number;
  results: RoundResult[];
  /** The desserts' scores at the end. */
  dessertRows: RoundRow[] | null;
  /** Players who left the room mid-game, with when: the table plays for them. */
  left: Record<PlayerId, number>;
  clock: Clock | null;
  winners: PlayerId[];
}

export type LogEntry = { id: number; round: number; turn: number; auto?: Auto } & (
  | { kind: 'round' }
  | {
      kind: 'reveal';
      /** Everyone's card this turn, and the bonus each called. */
      plays: { by: PlayerId; k: string; copy?: string; bonus?: string; auto?: Auto }[];
    }
  | { kind: 'wasabi'; by: PlayerId; k: string }
  | { kind: 'steal'; by: PlayerId; from: PlayerId; k: string; worth: number }
  | { kind: 'chop'; by: PlayerId; k: string }
  | { kind: 'spoon'; by: PlayerId; from: PlayerId | null; k: string | null }
  | { kind: 'menu'; by: PlayerId; k: string | null }
  | { kind: 'copy'; by: PlayerId; k: string | null }
  | { kind: 'takeout'; by: PlayerId; ks: string[] }
  | { kind: 'uramaki'; claims: { by: PlayerId; icons: number; points: number }[] }
  | { kind: 'miso'; by: PlayerId[] }
  | { kind: 'end'; points: Record<PlayerId, number> }
  | { kind: 'left'; player: PlayerId }
  | { kind: 'back'; player: PlayerId }
  | { kind: 'over'; winners: PlayerId[] }
);

export interface ConveyorState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Hidden randomness for deadlines and leavers, which come without an rng. Never sent. */
  seed: number;
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  log: LogEntry[];
  seq: number;
  gamesPlayed: number;
}

const cardId = z.string().min(1).max(16);
const typeId = z.enum(TYPE_IDS as [TypeId, ...TypeId[]]);
const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    menu: z.string().min(1).max(20).optional(),
    custom: z.array(typeId).max(7).optional(),
    passBoth: z.boolean().optional(),
    golf: z.boolean().optional(),
    drawPile: z.boolean().optional(),
    seconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  /** This turn's card (and a special order's target, and a bonus to call). Changeable until all are in. */
  z.object({
    type: z.literal('pick'),
    card: cardId,
    target: cardId.optional(),
    bonus: cardId.optional(),
  }),
  /** Takes back this turn's pick (before everyone has picked). */
  z.object({ type: z.literal('unpick') }),
  /** Chopsticks: the second card. */
  z.object({ type: z.literal('chop'), card: cardId, target: cardId.optional() }),
  /** A spoon: the card asked for. */
  z.object({ type: z.literal('spoon'), want: typeId, variant: z.string().max(24).optional() }),
  /** The spoon's giver: which card to hand over. */
  z.object({ type: z.literal('give'), card: cardId }),
  /** A menu: the card played from the four drawn. */
  z.object({ type: z.literal('menu'), card: cardId, target: cardId.optional() }),
  /** A special order that came by spoon: what it copies. */
  z.object({ type: z.literal('copy'), target: cardId }),
  /** A takeout box: the earlier cards to turn face down (any number, none included). */
  z.object({ type: z.literal('takeout'), cards: z.array(cardId).max(40) }),
  z.object({ type: z.literal('ready') }),
  /** The host deals the next round without waiting for everyone to be ready. */
  z.object({ type: z.literal('next-round') }),
  z.object({ type: z.literal('act-for'), player: z.string().min(1).max(128) }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type ConveyorAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
  waiting?: boolean;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  /** Cards in hand (a count: hands are secret). */
  hand: number;
  /** Cards left in their own pile (2 players with draw piles). */
  pile: number;
  tray: Played[];
  desserts: Played[];
  ura: number;
  score: number;
  /** Has chosen this turn's card (`pick`), or is ready (`scores`). */
  done: boolean;
  left: boolean;
}

/** The step the table waits on, with only what this viewer may see. */
export type StepView =
  | { kind: 'chop'; players: PlayerId[]; done: PlayerId[] }
  | { kind: 'spoon'; by: PlayerId; no: number }
  | {
      kind: 'give';
      by: PlayerId;
      from: PlayerId;
      /** The request: to its maker and the giver only. */
      request: Request | null;
      /** The giver's choices (cards in their hand that fit): to the giver only. */
      options: Card[] | null;
    }
  | {
      kind: 'menu';
      by: PlayerId;
      no: number;
      /** The four drawn cards: to the menu's player only. */
      drawn: Card[] | null;
      count: number;
    }
  | { kind: 'copy'; by: PlayerId }
  | { kind: 'takeout'; by: PlayerId; no: number };

export interface ClockView {
  /** Who the clock times (null: everyone still choosing). */
  who: PlayerId | null;
  since: number;
  deadline: number | null;
  /** The deadline is a fixed one that always acts (the spoon giver's). */
  fixed: boolean;
  reminded: boolean;
}

export interface GameView {
  order: PlayerId[];
  players: PlayerView[];
  menu: TypeId[];
  preset: string | null;
  round: number;
  rounds: number;
  turn: number;
  turns: number;
  /** This round's passing: 1 to the left (next seat), −1 to the right. */
  dir: 1 | -1;
  stage: Game['stage'];
  step: StepView | null;
  /** Numbered actions still to come this turn (public once revealed). */
  queue: { kind: Exclude<Queued['kind'], 'copy'>; by: PlayerId; no: number }[];
  /** Cards left in the deck (a count). */
  deck: number;
  /** The viewer's own hand (watchers: null). */
  hand: Card[] | null;
  /** The viewer's own choice this turn, while it is secret. */
  myPick: Pick | null;
  /** The viewer's chopsticks choice while it is secret. */
  myChop: { card: string; target?: string } | null;
  claimed: number;
  results: RoundResult[];
  dessertRows: RoundRow[] | null;
  clock: ClockView | null;
  winners: PlayerId[];
  golf: boolean;
  drawPile: boolean;
}

export interface ConveyorView {
  phase: ConveyorState['phase'];
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
  log: LogEntry[];
}
