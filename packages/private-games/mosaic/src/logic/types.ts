import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

/**
 * The five tile colours, in the order of the wall's first row. `aqua` is the light blue. The
 * coloured wall puts colour `(c − r) mod 5` at row r, column c, so every row and column holds
 * each colour once.
 */
export const COLOURS = ['blue', 'yellow', 'red', 'black', 'aqua'] as const;
export type Colour = (typeof COLOURS)[number];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
/** Tiles of each colour in the box. */
export const TILES_EACH = 20;
/** Tiles on each factory at the start of a round. */
export const FACTORY_SIZE = 4;
/** Factories by player count. */
export const FACTORIES_FOR: Record<number, number> = { 2: 5, 3: 7, 4: 9 };
/** The wall is 5 × 5; pattern line r holds r + 1 tiles. */
export const SIZE = 5;
/** What each floor space costs, left to right. Tiles past the seventh go to the lid for free. */
export const FLOOR = [-1, -1, -2, -2, -2, -3, -3] as const;
/** End bonuses. */
export const ROW_BONUS = 2;
export const COLUMN_BONUS = 7;
export const COLOUR_BONUS = 10;
export const DEFAULT_SECONDS = 60;
export const MIN_TIMER_SECONDS = 15;
export const MAX_TIMER_SECONDS = 300;
/** How long the table waits before playing the turn of a player who left. */
export const LEFT_BEAT_MS = 3000;
/** The wall-tiling at the end of a round: time to watch it, unless everyone moves on sooner. */
export const TILING_BASE_MS = 3000;
export const TILING_PER_PLAYER_MS = 1500;
/** A single take that costs this much or more is an "Ouch" for the whole table. */
export const OUCH = 5;
/** Public log entries kept (older ones drop off). */
export const MAX_LOG = 80;

export type TimerMode = 'soft' | 'strict';

export interface Settings {
  /** Seconds for each turn; null: no clock. */
  seconds: number | null;
  /** Soft: a reminder, and the host may act for the player. Strict: the safe move is made. */
  timerMode: TimerMode;
}

export interface Seat {
  name: string;
  /** Seated players play; the rest watch. */
  playing: boolean;
  /** Watching only for want of a seat: sat down at the next game if there's room. */
  waiting?: boolean;
}

/** A floor space holds a tile or the first-player marker. */
export type FloorItem = Colour | 'first';

export interface Line {
  colour: Colour | null;
  count: number;
}

export interface Board {
  /** Pattern lines, top (holds 1) to bottom (holds 5). */
  lines: Line[];
  /** wall[row][column]: the tile there, or null. */
  wall: (Colour | null)[][];
  /** At most 7 items, left to right. */
  floor: FloorItem[];
  score: number;
}

export type Counts = Record<Colour, number>;

/** One tile moved to the wall at the end of a round. */
export interface Placement {
  row: number;
  col: number;
  colour: Colour;
  points: number;
  /** The linked runs it scored for (0 when a run is just the tile). */
  across: number;
  down: number;
}

export interface Bonus {
  rows: number;
  columns: number;
  colours: number;
  points: number;
}

export interface PlayerScore {
  placed: Placement[];
  /** What lay on the floor, with the points it cost (never below 0 in total). */
  floor: FloorItem[];
  penalty: number;
  before: number;
  after: number;
  /** End bonuses, on the last round only. */
  bonus?: Bonus;
}

/** The wall-tiling of one round, kept so every screen can play it. */
export interface RoundScore {
  round: number;
  players: Record<PlayerId, PlayerScore>;
  /** Whether this round ended the game. */
  last: boolean;
}

/** `draft`: players take tiles in turn. `tiling`: the round's wall-tiling is on show. */
export type Stage = 'draft' | 'tiling';

/** Who made a move for whom: the strict timer, the host's Act for, or the table for a leaver. */
export type Auto = 'timer' | 'host' | 'left';

export interface Clock {
  key: string;
  since: number;
  reminded: boolean;
}

/** Where tiles are taken from: a factory's index, or the centre. */
export type Source = number | 'centre';
/** Where they go: a pattern line (0–4) or straight to the floor. */
export type Target = number | 'floor';

export interface Game {
  /** Seat order; play goes round it from the round's starter. */
  order: PlayerId[];
  players: Record<PlayerId, Board>;
  /** Names kept for players who have left. */
  names: Record<PlayerId, string>;
  /** The bag, top first. Never sent: only its counts. */
  bag: Colour[];
  /** The box lid (discards): public. */
  lid: Counts;
  factories: Colour[][];
  centre: Counts;
  /** Where the first-player marker is: `centre`, or the id of the player who took it. */
  marker: string;
  /** Who started this round. */
  starter: PlayerId;
  current: PlayerId;
  round: number;
  stage: Stage;
  /** Turns finished so far (all rounds). */
  turns: number;
  /** The last round's wall-tiling. */
  scoring: RoundScore | null;
  /** The tiling stage ends then, or earlier once every player still here is ready. */
  tilingUntil: number | null;
  ready: PlayerId[];
  /** Players who left the room mid-game, with when: the table plays their turns. */
  left: Record<PlayerId, number>;
  /** Players the host removed after they left: out of the turn order and the scoring. */
  removed: PlayerId[];
  clock: Clock | null;
  winners: PlayerId[];
}

export type LogEntry = { id: number; round: number; auto?: Auto } & (
  | { kind: 'start'; first: PlayerId }
  | {
      kind: 'take';
      by: PlayerId;
      source: Source;
      colour: Colour;
      count: number;
      target: Target;
      /** Tiles that went to the pattern line, the floor and (past a full floor) the lid. */
      toLine: number;
      toFloor: number;
      toLid: number;
      /** Took the first-player marker with them. */
      marker: boolean;
      /** The floor points this take will cost (0 or negative). */
      penalty: number;
      /** Tiles left behind that slid to the centre. */
      leftover: number;
      /** Some of the tiles sent to the floor could have gone in a pattern line. */
      dumped: number;
    }
  /** A round's wall-tiling (its number is the entry's `round`). */
  | { kind: 'round' }
  | { kind: 'left'; player: PlayerId }
  | { kind: 'back'; player: PlayerId }
  | { kind: 'removed'; player: PlayerId }
  /** `empty`: no tiles were left to start a round; `alone`: one player left. */
  | { kind: 'end'; winners: PlayerId[]; how?: 'empty' | 'alone' }
);

export interface MosaicState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Hidden randomness for refills after a deadline, which comes without an rng. Never sent. */
  seed: number;
  /** Insertion-ordered by join time. */
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  log: LogEntry[];
  /** The last log id handed out; never reset. */
  seq: number;
  gamesPlayed: number;
  /** Who started the last game: the next game starts one seat on. */
  lastFirst: PlayerId | null;
}

const id = z.string().min(1).max(128);
const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    seconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  /** Take every tile of one colour from a factory or the centre, and place them. */
  z.object({
    type: z.literal('take'),
    source: z.union([z.number().int().min(0).max(8), z.literal('centre')]),
    colour: z.enum(COLOURS),
    target: z.union([
      z
        .number()
        .int()
        .min(0)
        .max(SIZE - 1),
      z.literal('floor'),
    ]),
  }),
  /** Done watching the wall-tiling. */
  z.object({ type: z.literal('ready') }),
  /** The host ends the wall-tiling for everyone. */
  z.object({ type: z.literal('skip-tiling') }),
  z.object({ type: z.literal('act-for'), player: id }),
  /** The host takes a player who left out of the game. */
  z.object({ type: z.literal('remove'), player: id }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type MosaicAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
  waiting?: boolean;
}

export interface PlayerView extends Board {
  id: PlayerId;
  name: string;
  /** Left the room: the table plays their turns. */
  left: boolean;
  /** Removed by the host after leaving: out of the game. */
  removed: boolean;
}

export interface ClockView {
  who: PlayerId;
  since: number;
  deadline: number | null;
  reminded: boolean;
}

export interface GameView {
  order: PlayerId[];
  players: PlayerView[];
  /** Tiles left in the bag, per colour (never their order). */
  bag: Counts;
  lid: Counts;
  factories: Colour[][];
  centre: Counts;
  /** `centre`, or the id of the player who took it. */
  marker: string;
  starter: PlayerId;
  current: PlayerId;
  round: number;
  stage: Stage;
  turns: number;
  scoring: RoundScore | null;
  tilingUntil: number | null;
  ready: PlayerId[];
  clock: ClockView | null;
  winners: PlayerId[];
}

export interface MosaicView {
  phase: MosaicState['phase'];
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
  log: LogEntry[];
}
