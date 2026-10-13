import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';
import { CARD_TYPES, type CardType } from './cards.ts';

export const MIN_PLAYERS = 2;
/** Players dealt in at most; anyone else in the room watches. */
export const MAX_SEATS = 10;
/** Cards dealt to each player besides their Defuse. */
export const HAND_SIZE = 7;
/** The Nope window: host-adjustable, the same fixed length for everyone. */
export const NOPE_SECONDS = { min: 3, max: 8, default: 4 } as const;
/** A Nope this soon after the last one is refused (and kept), so two taps can't cancel out. */
export const NOPE_COOLDOWN_MS = 800;
/** The soft (or strict) clock on every decision. */
export const DECISION_SECONDS_OPTIONS = [20, 30, 45, 60, 90, 120] as const;
export const DEFAULT_DECISION_SECONDS = 45;
/** How long an explosion holds the table before play moves on. */
export const BEAT_MS = 2500;
/** A player can be nudged again after this long. */
export const NUDGE_MS = 15_000;
export const MAX_LOG = 60;
export const MAX_MEMORY = 12;
export const MAX_TRUTH = 40;
/** The pile is drawn edge by edge up to this many cards; a taller pile is compressed. */
export const PILE_EDGES = 24;

export type CardId = string;
export type Core = 'classic' | 'party';
/** The core deck's art and flavour (the rules are the same): `adult` is the 18+ deck. */
export type Art = 'classic' | 'adult';
export type Preset = 'classic' | 'adult' | 'party' | 'custom';

export interface Card {
  t: CardType;
  /** Which of the type's faces it shows (cycled through the manifest's art). */
  face: number;
}

export interface Settings {
  core: Core;
  art: Art;
  /** Expansion 1 (the Black Hole and friends). */
  x1: boolean;
  /** Remove a third of the pile before the Bombs go in. */
  faster: boolean;
  /** Legacy: five cards with different names take any card from the discard pile. */
  fiveCombo: boolean;
  /** Legacy: an attacked player's Attack passes on just two turns, never their own. */
  nonStacking: boolean;
  nopeSeconds: number;
  /** The decision clock, or null for none. */
  decisionSeconds: number | null;
  /** At zero the clock acts (safe defaults) instead of only nudging. */
  strict: boolean;
}

export type Stage = 'turn' | 'window' | 'favor' | 'alter' | 'salvage' | 'bomb' | 'place' | 'beat';

/** What a play is: a card's own action, or a combo that ignores the cards' instructions. */
export type PlayKind = 'card' | 'pair' | 'triple' | 'five';

/** A committed play waiting out its Nope window. */
export interface Pending {
  id: number;
  by: PlayerId;
  kind: PlayKind;
  /** The card's type for a single play; for a combo, the type that matched (or null for five). */
  t: CardType | null;
  cards: CardId[];
  target: PlayerId | null;
  /** The card asked for with Three of a Kind. */
  named: CardType | null;
}

export interface NopeWindow {
  id: number;
  endsAt: number;
  lastAt: number;
  /** Who played each Nope, in order. Odd length: the play is cancelled. */
  chain: { by: PlayerId; card: CardId }[];
}

export interface Turn {
  player: PlayerId;
  /** Turns still owed, the current one included. */
  owed: number;
  /** The turns came from an attack (so another attack stacks onto them). */
  chained: boolean;
  dir: 1 | -1;
  /** Turns started this game (for the log and stats). */
  n: number;
  /** Plays made in the current turn (bots stop after a couple). */
  plays: number;
}

/** A drawn Bomb (or Black Hole) waiting on the drawer. */
export interface Drawn {
  by: PlayerId;
  card: CardId;
  /** Drawn on the drawer's own turn (so dealing with it ends one of their turns). */
  ownTurn: boolean;
}

export type PlaceKind = 'bomb' | 'void';

/** A card the player hides back in the pile. */
export interface Placing {
  by: PlayerId;
  card: CardId;
  kind: PlaceKind;
  ownTurn: boolean;
}

export interface Favor {
  from: PlayerId;
  to: PlayerId;
}

export interface Alter {
  by: PlayerId;
  /** The top cards being rearranged, top first. */
  cards: CardId[];
}

export interface Beat {
  kind: 'explode';
  who: PlayerId;
  until: number;
}

/** Private knowledge, kept per player and shown only to them (until the end). */
export type Memory =
  | { id: number; kind: 'peek'; cards: Card[]; version: number; turn: number; at: number }
  | { id: number; kind: 'altered'; cards: Card[]; version: number; turn: number; at: number }
  | {
      id: number;
      kind: 'placed';
      t: CardType;
      /** 0 = top. */
      position: number;
      of: number;
      version: number;
      turn: number;
      at: number;
    }
  | {
      id: number;
      kind: 'got' | 'gave';
      card: Card;
      other: PlayerId;
      how: 'favor' | 'pair' | 'triple';
      turn: number;
      at: number;
    };
export type MemoryKind = Memory['kind'];

/** One public event. The browser words it. */
export interface LogEntry {
  id: number;
  at: number;
  turn: number;
  kind:
    | 'start'
    | 'play'
    | 'nope'
    | 'cancelled'
    | 'resolved'
    | 'draw'
    | 'drew-bomb'
    | 'defuse'
    | 'placed'
    | 'explode'
    | 'void-up'
    | 'favor'
    | 'steal'
    | 'ask'
    | 'salvage'
    | 'shuffle'
    | 'reverse'
    | 'attacked'
    | 'empty'
    | 'left'
    | 'timeout'
    | 'act-for'
    | 'win';
  by?: PlayerId;
  target?: PlayerId;
  /** Cards shown (types), in play order. */
  cards?: CardType[];
  play?: PlayKind;
  named?: CardType;
  /** Whether a Three of a Kind found the card. */
  hit?: boolean;
  n?: number;
  /** Where a drawn card came from. */
  from?: 'top' | 'bottom';
  /** What a timeout or act-for did. */
  did?: string;
}

/** The end screen's account of where every hidden card went. */
export interface Truth {
  turn: number;
  by: PlayerId;
  kind: PlaceKind;
  position: number;
  of: number;
  /** Who drew it next (filled in when they did). */
  drawnBy?: PlayerId;
  card: CardId;
}

export interface Game {
  players: PlayerId[];
  names: Record<PlayerId, string>;
  core: Core;
  art: Art;
  x1: boolean;
  fiveCombo: boolean;
  nonStacking: boolean;
  cards: Record<CardId, Card>;
  /** Index 0 is the top. */
  pile: CardId[];
  /** Last is the top. */
  discard: CardId[];
  hands: Record<PlayerId, CardId[]>;
  /** Face-up in front of a player: the Bomb that blew them up. */
  front: Record<PlayerId, CardId[]>;
  /** Out of the game: removed by Faster, exploded hands. */
  out: CardId[];
  /** A drawn Bomb or Black Hole while its drawer deals with it. */
  limbo: CardId | null;
  /** The Black Hole has been drawn and is face up wherever it is. */
  voidUp: boolean;
  /** Bombs the table knows are still out there (public bookkeeping). */
  bombsOut: number;
  /** In elimination order. */
  dead: { id: PlayerId; turn: number }[];
  left: PlayerId[];
  turn: Turn;
  pending: Pending | null;
  window: NopeWindow | null;
  drawn: Drawn | null;
  placing: Placing | null;
  favor: Favor | null;
  alter: Alter | null;
  beat: Beat | null;
  /** When the current decision started (its soft or strict clock). */
  decisionAt: number;
  pileVersion: number;
  seq: number;
  memory: Record<PlayerId, Memory[]>;
  log: LogEntry[];
  truth: Truth[];
  nudges: Record<PlayerId, number>;
  winner: PlayerId | null;
  /** Hidden seed for deadline randomness (never in a view). */
  seed: number;
  stats: GameStats;
}

/** Counters the end-of-game insight reads. */
export interface GameStats {
  maxOwed: number;
  maxOwedBy: PlayerId | null;
  longestChain: number;
  draws: number;
}

/** A test-only setup (see `rig` in `game.ts`): exact hands and the top of the pile. */
export interface Rig {
  hands: CardType[][];
  top: CardType[];
  first: number;
}

export interface ShortFuseState {
  phase: 'lobby' | 'playing' | 'over';
  stage: Stage | null;
  settings: Settings;
  seats: Record<PlayerId, { name: string; playing: boolean }>;
  game: Game | null;
  gamesPlayed: number;
  rig: Rig | null;
  seed: number;
}

// ---- Actions ----

const id = z.string().min(1).max(100);
const cardId = z.string().min(1).max(20);
const cardType = z.enum(CARD_TYPES);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    preset: z.enum(['classic', 'adult', 'party']).optional(),
    core: z.enum(['classic', 'party']).optional(),
    art: z.enum(['classic', 'adult']).optional(),
    x1: z.boolean().optional(),
    faster: z.boolean().optional(),
    fiveCombo: z.boolean().optional(),
    nonStacking: z.boolean().optional(),
    nopeSeconds: z.number().int().min(NOPE_SECONDS.min).max(NOPE_SECONDS.max).optional(),
    decisionSeconds: z.number().int().min(10).max(300).nullable().optional(),
    strict: z.boolean().optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  /** Test servers only: fix the hands and the top of the pile for the next game. */
  z.object({
    type: z.literal('rig'),
    hands: z.array(z.array(cardType).max(12)).max(10),
    top: z.array(cardType).max(20),
    first: z.number().int().min(0).max(9),
  }),
  /** One card, or a combo (two or three of a kind, five different). */
  z.object({
    type: z.literal('play'),
    cards: z.array(cardId).min(1).max(5),
    target: id.optional(),
    named: cardType.optional(),
  }),
  z.object({ type: z.literal('draw') }),
  /** Answers the window it names, so a tap that crosses a change is refused, not misapplied. */
  z.object({ type: z.literal('nope'), window: z.number().int() }),
  z.object({ type: z.literal('give'), card: cardId }),
  /** The rearranged top cards, as indexes into the cards shown (top first). */
  z.object({ type: z.literal('order'), order: z.array(z.number().int().min(0).max(9)).max(10) }),
  z.object({ type: z.literal('salvage'), card: cardId }),
  z.object({ type: z.literal('defuse') }),
  /** 0 is the top of the pile. */
  z.object({ type: z.literal('place'), position: z.number().int().min(0).max(500) }),
  z.object({ type: z.literal('nudge'), player: id }),
  /** Host: make an absent player's move with the safe default. */
  z.object({ type: z.literal('act-for'), player: id }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type ShortFuseAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface CardView extends Card {
  id: CardId;
}

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  hand: number;
  dead: boolean;
  /** The turn they exploded on. */
  deadTurn: number | null;
  left: boolean;
  /** Face up in front of them. */
  front: CardView[];
}

/** The draw pile as everyone sees it: a stack with no faces showing, except a face-up Black Hole. */
export interface PileView {
  count: number;
  bombsOut: number;
  /** `hidden`: still somewhere face down; `up`: face up in the pile; `gone`: out of the pile. */
  void: 'none' | 'hidden' | 'up' | 'gone';
  /**
   * Where the face-up Black Hole shows in the side of the stack: its edge from the top, out of
   * `edges` (exact when the pile is short enough to draw card by card).
   */
  voidEdge: number | null;
  /** The face-up Black Hole is the top card (a face-up card on top is plain to see). */
  voidTop: boolean;
  edges: number;
  version: number;
}

export interface WindowView {
  id: number;
  endsAt: number;
  seconds: number;
  chain: PlayerId[];
  /** Whether the play is cancelled as things stand (an odd number of Nopes). */
  cancelled: boolean;
}

export interface PendingView {
  by: PlayerId;
  kind: PlayKind;
  t: CardType | null;
  cards: CardView[];
  target: PlayerId | null;
  named: CardType | null;
}

/** What the viewer is asked to do right now, with what they need to do it. */
export type Prompt =
  | { kind: 'turn' }
  | { kind: 'give'; to: PlayerId }
  | { kind: 'alter'; cards: CardView[] }
  | { kind: 'salvage'; options: CardView[] }
  | { kind: 'bomb'; card: CardView; canDefuse: boolean }
  | { kind: 'place'; card: CardView; count: number; void: boolean };

export interface EndView {
  winner: PlayerId | null;
  hands: Record<PlayerId, CardView[]>;
  pile: CardView[];
  truth: Truth[];
}

export interface GameView {
  players: PlayerView[];
  core: Core;
  art: Art;
  x1: boolean;
  fiveCombo: boolean;
  nonStacking: boolean;
  /** Card types in this game (for the Three of a Kind picker and the glossary). */
  types: CardType[];
  turn: Turn;
  pile: PileView;
  discard: CardView[];
  /** Your own hand (null for watchers and the exploded). */
  hand: CardView[] | null;
  pending: PendingView | null;
  window: WindowView | null;
  canNope: boolean;
  prompt: Prompt | null;
  /** Who the table waits on. */
  waiting: PlayerId[];
  /** Who is choosing what, for everyone's status line. */
  busy: { who: PlayerId; what: 'give' | 'alter' | 'salvage' | 'bomb' | 'place' } | null;
  drawnKind: 'bomb' | 'void' | null;
  decisionAt: number;
  /** Soft clock unless strict. */
  decisionEnds: number | null;
  beat: Beat | null;
  memory: Memory[];
  log: LogEntry[];
  nudges: Record<PlayerId, number>;
  winner: PlayerId | null;
  end: EndView | null;
}

export interface Readout {
  players: number;
  pile: number;
  bombs: number;
  defuses: number;
  hand: number;
  turnsEach: number;
  void: boolean;
}

export interface ShortFuseView {
  phase: ShortFuseState['phase'];
  stage: Stage | null;
  settings: Settings;
  preset: Preset;
  seats: SeatView[];
  me: SeatView | null;
  readout: Readout;
  game: GameView | null;
  gamesPlayed: number;
  /** The test rig is armed for the next game (test servers only). */
  rigged: boolean;
  /** This server accepts the test rig (browser tests only; never in production). */
  rigAllowed: boolean;
}
