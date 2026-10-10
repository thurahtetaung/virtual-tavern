import { z } from 'zod';

// The admin stats API contract (`/api/admin/stats/*`). The server builds these from the stats
// store; the admin stats page renders them. Times are epoch ms, days are 'YYYY-MM-DD' (UTC).

export const STATS_RANGES = ['today', '7d', '30d', '90d', '1y', 'all', 'custom'] as const;
export const STATS_BUCKETS = ['hour', 'day', 'week', 'month'] as const;
/** Kinds of words the games report: clues given, guesses made, clues that cancelled, assassin hits. */
export const WORD_KINDS = ['clue', 'guess', 'cancelled', 'assassin', 'story'] as const;

export type StatsRange = (typeof STATS_RANGES)[number];
export type StatsBucket = (typeof STATS_BUCKETS)[number];
export type WordKind = (typeof WORD_KINDS)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Query string accepted by every historical endpoint. `from`/`to` are required for `custom`. */
export const statsQuery = z
  .object({
    range: z.enum(STATS_RANGES).default('30d'),
    from: day.optional(),
    to: day.optional(),
    bucket: z.enum(STATS_BUCKETS).optional(),
    game: z.string().min(1).max(40).optional(),
  })
  .refine((q) => q.range !== 'custom' || (q.from !== undefined && q.to !== undefined), {
    message: 'A custom range needs from and to',
  });
export type StatsQuery = z.infer<typeof statsQuery>;

export const statsWordsQuery = z.object({
  range: z.enum(STATS_RANGES).default('30d'),
  from: day.optional(),
  to: day.optional(),
  game: z.string().min(1).max(40),
  kind: z.enum(WORD_KINDS),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type StatsWordsQuery = z.infer<typeof statsWordsQuery>;

/** The resolved window a response covers, plus the equally long window before it (for deltas). */
export interface StatsWindow {
  from: string;
  to: string;
  bucket: StatsBucket;
  previousFrom: string;
  previousTo: string;
}

// ---- Live ----

export interface LiveRoom {
  id: string;
  gameId: string;
  phase: 'lobby' | 'playing' | 'over' | string;
  players: { id: string; name: string; connected: boolean }[];
  hostId: string;
  createdAt: number;
  updatedAt: number;
}

export interface LiveStats {
  now: number;
  /** Open browser connections (tabs), whether or not they are in a room. */
  sockets: number;
  /** Distinct players connected to a room right now. */
  playersOnline: number;
  /** Distinct players seen in the last 5 minutes. */
  playersRecent: number;
  rooms: LiveRoom[];
  /** Per game: rooms with someone connected, and how many of them are mid-game. */
  byGame: { gameId: string; rooms: number; playing: number; players: number }[];
  /** Players online, one point per minute for the last hour. */
  lastHour: { ts: number; players: number }[];
}

// ---- Overview ----

export interface StatsTotals {
  roomsCreated: number;
  gamesStarted: number;
  gamesFinished: number;
  gamesAbandoned: number;
  uniquePlayers: number;
  minutesPlayed: number;
}

export interface SeriesPoint {
  /** Bucket start: 'YYYY-MM-DD' for day/week/month, ISO 'YYYY-MM-DDTHH' for hour. */
  t: string;
  /** Value per game id (and '_all' for the total). */
  values: Record<string, number>;
}

export interface StatsOverview {
  window: StatsWindow;
  totals: StatsTotals;
  previous: StatsTotals;
  /** Games started per bucket, per game. */
  activity: SeriesPoint[];
  /** Games started per day, for the calendar heatmap. */
  calendar: { day: string; games: number }[];
  /** Games started by weekday (0 = Monday) and UTC hour. */
  weekHour: { weekday: number; hour: number; games: number }[];
  gameMix: { gameId: string; games: number; minutes: number }[];
}

// ---- Per game ----

export interface GameStats {
  gameId: string;
  window: StatsWindow;
  totals: StatsTotals;
  activity: SeriesPoint[];
  averageMinutes: number;
  averagePlayers: number;
  /** Count of finished games by number of players. */
  playerCounts: { players: number; games: number }[];
  /** Settings chosen at game start, e.g. key 'wordList' / 'timerMode' / 'deckSize' / 'flow' / 'cardSet'. */
  settings: { key: string; value: string; label: string; games: number }[];
  /** Game-specific figures, keyed by a stable id, rendered as labelled tiles or charts. */
  figures: GameFigure[];
}

export type GameFigure =
  | { id: string; label: string; kind: 'number'; value: number; unit?: string }
  | { id: string; label: string; kind: 'percent'; value: number }
  | { id: string; label: string; kind: 'split'; parts: { label: string; value: number }[] }
  | { id: string; label: string; kind: 'histogram'; bins: { label: string; value: number }[] };

export interface WordCount {
  word: string;
  count: number;
}

export interface StatsWords {
  gameId: string;
  kind: WordKind;
  window: StatsWindow;
  words: WordCount[];
}

// ---- Players ----

export interface PlayerSummary {
  id: string;
  name: string;
  /** Every name this player has used, most used first. */
  aliases: string[];
  firstSeen: number;
  lastSeen: number;
  games: number;
  wins: number;
  minutes: number;
  /** Games per game id. */
  byGame: Record<string, number>;
}

export interface PlayerProfile extends PlayerSummary {
  names: { name: string; uses: number; firstSeen: number; lastSeen: number }[];
  calendar: { day: string; games: number }[];
  /** Light-hearted superlatives earned by this player, e.g. "Fastest guesser". */
  facts: FunFact[];
}

export interface StatsPlayers {
  window: StatsWindow;
  players: PlayerSummary[];
}

// ---- Fun ----

export interface FunFact {
  id: string;
  title: string;
  /** One line, ready to show, e.g. "Ana guessed in 3.2 s on average". */
  text: string;
  gameId?: string;
  playerId?: string;
  value?: number;
}

export interface StatsFun {
  window: StatsWindow;
  facts: FunFact[];
}
