import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

/**
 * The five tile colours, in the order of the wall's first row. `aqua` is the light blue. The
 * coloured wall puts colour `(c − r) mod 5` at row r, column c, so every row and column holds
 * each colour once.
 */
export const COLOURS = ['blue', 'yellow', 'red', 'black', 'aqua'] as const;
export type Colour = (typeof COLOURS)[number];
/** A tile: one of the colours, or (with the jokers option) a joker, which stands in for any. */
export type Tile = Colour | 'joker';
export const TILES = [...COLOURS, 'joker'] as const;

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
/** Jokers in the box: 2 of each colour make way for 10 jokers at 3–4 players, 1 each for 5 at 2. */
export const JOKERS_FOR: Record<number, number> = { 2: 5, 3: 10, 4: 10 };
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
  /** Host options (missing in rooms saved before them: off). The blank wall: free placement. */
  grey?: boolean;
  /** Joker tiles in the bag. */
  jokers?: boolean;
  /** Special factories, flipped at random each round. */
  specials?: boolean;
}

/**
 * The special factories' faces: `sf1` takes an extra tile from the bag, `sf2` one of its colour
 * from each neighbour, `sf3` keeps its leftovers, `sf4` sends them to its neighbours, `sf5`
 * becomes its picker's floor shield. There are 9 faces: one of each, but five `sf2` (a colour
 * each).
 */
export type SpecialKind = 'sf1' | 'sf2' | 'sf3' | 'sf4' | 'sf5';
export interface Special {
  kind: SpecialKind;
  /** `sf2` only: the colour it gathers. */
  colour?: Colour;
  /** `sf5` only: the player who took it as a shield (it has left the circle). */
  holder?: PlayerId;
}

export interface Seat {
  name: string;
  /** Seated players play; the rest watch. */
  playing: boolean;
  /** Watching only for want of a seat: sat down at the next game if there's room. */
  waiting?: boolean;
}

/** A floor space holds a tile or the first-player marker. */
export type FloorItem = Tile | 'first';

export interface Line {
  /** The line's colour, or null while it is empty or holds only jokers. */
  colour: Colour | null;
  /** Tiles in it, jokers included. */
  count: number;
  /** Of which jokers (missing: none). */
  jokers?: number;
}

export interface Board {
  /** Pattern lines, top (holds 1) to bottom (holds 5). */
  lines: Line[];
  /** wall[row][column]: the tile there, or null. */
  wall: (Tile | null)[][];
  /** At most 7 items, left to right. */
  floor: FloorItem[];
  score: number;
  /**
   * The special factory taken as a floor shield this round: null while it waits for a tile, the
   * item it caught (which costs nothing), or missing without one.
   */
  shield?: FloorItem | null;
}

/** Tiles by colour; `joker` only with the jokers option (missing: none). */
export type Counts = Record<Colour, number> & { joker?: number };

/** One tile moved to the wall at the end of a round. */
export interface Placement {
  row: number;
  col: number;
  /** The tile that went to the wall (a joker stands in for the line's colour). */
  colour: Tile;
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
  /** Full lines whose tile had no free space: all their tiles fell to the floor. */
  fell?: number[];
  /** What the floor shield caught (no cost). */
  shielded?: FloorItem;
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

/**
 * `draft`: players take tiles in turn. `wall`: players with a choice (the grey wall, a line of
 * jokers) pick where their tiles go, top line first. `tiling`: the round's wall-tiling is on show.
 */
export type Stage = 'draft' | 'wall' | 'tiling';

/** A player's wall-tiling while it is under way: the next line to look at and what's done. */
export interface WallProgress {
  /** The line waiting for a choice, or null once this player's lines are all done. */
  row: number | null;
  score: PlayerScore;
}

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
/** Where a special factory's leftovers go, by colour: its left or its right neighbour. */
export type Split = Partial<Record<Tile, 'left' | 'right'>>;

/**
 * A take: every tile of `colour` (or the jokers alone, for `joker`) from a place, with that
 * place's jokers too when `jokers` is set, and where a special factory's leftovers go.
 */
export interface Move {
  source: Source;
  colour: Tile;
  jokers?: boolean;
  split?: Split;
  target: Target;
}

export interface Game {
  /** Seat order; play goes round it from the round's starter. */
  order: PlayerId[];
  players: Record<PlayerId, Board>;
  /** Names kept for players who have left. */
  names: Record<PlayerId, string>;
  /** The bag, top first. Never sent: only its counts. */
  bag: Tile[];
  /** The box lid (discards): public. */
  lid: Counts;
  factories: Tile[][];
  /** With special factories: the face of each factory this round (null: a plain one). */
  specials?: (Special | null)[];
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
  /** In the `wall` stage: each player's wall-tiling so far. */
  walls?: Record<PlayerId, WallProgress> | null;
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
      /** The colour taken, or `joker` for jokers alone. */
      colour: Tile;
      count: number;
      /** Jokers among them, taken with the colour (missing: none). */
      jokers?: number;
      /** The special factory taken from. */
      special?: SpecialKind;
      /** `sf4`: how many leftovers went to the left and to the right neighbour. */
      sent?: { left: number; right: number };
      /** `sf5`: the shield caught a tile (or the marker) on this take. */
      shielded?: boolean;
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
  /** Where a player put a tile on the wall, when it was their choice. */
  | { kind: 'wall'; by: PlayerId; row: number; col: number; tile: Tile }
  /** The special factories turned up for a round. */
  | { kind: 'specials'; faces: Special[] }
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
const side = z.enum(['left', 'right']);
const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    seconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
    grey: z.boolean().optional(),
    jokers: z.boolean().optional(),
    specials: z.boolean().optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  /**
   * Take every tile of one colour from a factory or the centre, and place them. `joker` takes the
   * jokers alone; a colour with `jokers` takes that place's jokers too. `split` sends a special
   * factory's leftovers to its neighbours.
   */
  z.object({
    type: z.literal('take'),
    source: z.union([z.number().int().min(0).max(8), z.literal('centre')]),
    colour: z.enum(TILES),
    jokers: z.boolean().optional(),
    split: z.partialRecord(z.enum(TILES), side).optional(),
    target: z.union([
      z
        .number()
        .int()
        .min(0)
        .max(SIZE - 1),
      z.literal('floor'),
    ]),
  }),
  /** Where the waiting line's tile goes on the wall (the grey wall, a line of jokers). */
  z.object({
    type: z.literal('wall'),
    row: z
      .number()
      .int()
      .min(0)
      .max(SIZE - 1),
    col: z
      .number()
      .int()
      .min(0)
      .max(SIZE - 1),
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
  factories: Tile[][];
  specials: (Special | null)[] | null;
  centre: Counts;
  /** `centre`, or the id of the player who took it. */
  marker: string;
  starter: PlayerId;
  current: PlayerId;
  round: number;
  stage: Stage;
  turns: number;
  scoring: RoundScore | null;
  /** In the `wall` stage: each player's wall-tiling so far (all public). */
  walls: Record<PlayerId, WallProgress> | null;
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
