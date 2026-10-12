import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const wordLists = sqliteTable('word_lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  words: text('words', { mode: 'json' }).$type<string[]>().notNull(),
  /**
   * Ids of the games that offer this list. The default (every word-list game) tags the lists
   * that existed when the column was added; ids of games that are not registered are simply
   * never matched.
   */
  games: text('games', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'["codenames","enigma","echo"]'`),
  /** Disabled lists stay editable in the admin area but are hidden from hosts and rooms. */
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** One question in a deck; the stored shape of `questionBody` in `@vt/protocol`. */
export interface QuestionRow {
  prompt: string;
  answer: string;
  alternates: string[];
  sources: string[];
  adult: boolean;
  tags: string[];
  /** Ready-made fake answers games may use as house lies; never served over HTTP except to admins. */
  decoys?: string[];
}

/**
 * Trivia question decks. Private content: imported through the admin API, never committed.
 * A question's id is `<deck id>:<index in questions>`.
 */
export const questionDecks = sqliteTable('question_decks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  questions: text('questions', { mode: 'json' }).$type<QuestionRow[]>().notNull(),
  /** Disabled decks stay in the admin area but are hidden from hosts and rooms. */
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** Ids of the games that offer this deck. */
  games: text('games', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'["hoodwink"]'`),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** Small key/value store for server-wide settings (e.g. the back-room password hash). */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/** Built-in word packs already added once; admins may since have edited or deleted them. */
export const seededPacks = sqliteTable('seeded_packs', {
  slug: text('slug').primaryKey(),
  seededAt: integer('seeded_at').notNull(),
});

export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(),
  gameId: text('game_id').notNull(),
  hostId: text('host_id').notNull(),
  players: text('players', { mode: 'json' }).$type<{ id: string; name: string }[]>().notNull(),
  state: text('state', { mode: 'json' }).$type<unknown>().notNull(),
  /** Incremented on every write; guards against lost updates if rooms are ever spread over processes. */
  version: integer('version').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  /** Opened or joined by test traffic (`x-vt-test`): nothing it does is recorded in the stats. */
  test: integer('test', { mode: 'boolean' }),
});

// ---- Stats (admin only) ----
// Raw events are append-only and flat, so they map one-to-one onto a column store later. Daily
// rollups are kept forever; raw events are pruned once their day is rolled up and 90 days old.

/** One thing that happened. `props` holds the event-specific details as JSON. */
export const statsEvents = sqliteTable(
  'stats_events',
  {
    id: text('id').primaryKey(),
    ts: integer('ts').notNull(),
    /** 'YYYY-MM-DD' (UTC) of `ts`. */
    day: text('day').notNull(),
    type: text('type').notNull(),
    gameId: text('game_id').notNull(),
    roomId: text('room_id').notNull(),
    playerId: text('player_id'),
    props: text('props', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    index('stats_events_day_game').on(t.day, t.gameId),
    index('stats_events_type_ts').on(t.type, t.ts),
    index('stats_events_player_ts').on(t.playerId, t.ts),
    index('stats_events_room_ts').on(t.roomId, t.ts),
  ],
);

/** Everyone who has joined a room, keyed by the public player id. */
export const statsPlayers = sqliteTable('stats_players', {
  playerId: text('player_id').primaryKey(),
  firstSeen: integer('first_seen').notNull(),
  lastSeen: integer('last_seen').notNull(),
  lastName: text('last_name').notNull(),
  gamesPlayed: integer('games_played').notNull().default(0),
  roomsJoined: integer('rooms_joined').notNull().default(0),
});

/** Every name a player has used (one device, many aliases). */
export const statsPlayerNames = sqliteTable(
  'stats_player_names',
  {
    playerId: text('player_id').notNull(),
    name: text('name').notNull(),
    firstSeen: integer('first_seen').notNull(),
    lastSeen: integer('last_seen').notNull(),
    uses: integer('uses').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.playerId, t.name] })],
);

/** Days whose raw events have been rolled up into the daily tables. */
export const statsRollups = sqliteTable('stats_rollups', {
  day: text('day').primaryKey(),
  rolledAt: integer('rolled_at').notNull(),
});

/** Per day and game: additive counters (`max.*` metrics keep the day's maximum instead). */
export const statsDaily = sqliteTable(
  'stats_daily',
  {
    day: text('day').notNull(),
    gameId: text('game_id').notNull(),
    metric: text('metric').notNull(),
    value: real('value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.gameId, t.metric] })],
);

/** Per day, game and player: games, wins, minutes and the counters behind the fun facts. */
export const statsDailyPlayers = sqliteTable(
  'stats_daily_players',
  {
    day: text('day').notNull(),
    gameId: text('game_id').notNull(),
    playerId: text('player_id').notNull(),
    metric: text('metric').notNull(),
    value: real('value').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.gameId, t.playerId, t.metric] }),
    index('stats_daily_players_player').on(t.playerId, t.day),
  ],
);

/** Words the games reported per day: clues, guesses, cancelled clues, assassin hits, stories. */
export const statsDailyWords = sqliteTable(
  'stats_daily_words',
  {
    day: text('day').notNull(),
    gameId: text('game_id').notNull(),
    kind: text('kind').notNull(),
    word: text('word').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.gameId, t.kind, t.word] }),
    index('stats_daily_words_game_kind').on(t.gameId, t.kind, t.day),
  ],
);

/** Settings chosen when games started (word lists, timers, deck sizes, flows, card sets). */
export const statsDailySettings = sqliteTable(
  'stats_daily_settings',
  {
    day: text('day').notNull(),
    gameId: text('game_id').notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.gameId, t.key, t.value] })],
);

// ---- Night recaps ----

/**
 * Per-room recap settings the host chose. Not a stats table, so the admin stats reset leaves it
 * alone; a swept room's row goes with it.
 */
export const roomRecapSettings = sqliteTable('room_recap_settings', {
  roomId: text('room_id').primaryKey(),
  tone: text('tone').notNull().default('cheeky'),
  /** The host's `Date#getTimezoneOffset()`, for the card's date and late-night awards. */
  tzOffsetMin: integer('tz_offset_min'),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * Frozen night cards: a night is frozen when the host wraps it up or the room's next night
 * begins, and is never recomputed. `card` holds the cards in both tones (and, for a public room
 * whose linked night reached the back room, a public-only variant). Not stats tables: the admin
 * stats reset leaves them alone, and a swept room's rows go with it.
 */
export const recapNights = sqliteTable(
  'recap_nights',
  {
    roomId: text('room_id').notNull(),
    nightKey: text('night_key').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at').notNull(),
    wrappedAt: integer('wrapped_at'),
    games: integer('games').notNull(),
    tone: text('tone').notNull(),
    card: text('card').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.nightKey] }),
    index('recap_nights_started').on(t.startedAt),
  ],
);

/** Who won what on each frozen night: the Hall of fame and the freshness of later cards. */
export const recapAwards = sqliteTable(
  'recap_awards',
  {
    roomId: text('room_id').notNull(),
    nightKey: text('night_key').notNull(),
    awardId: text('award_id').notNull(),
    /** Empty for a moment that names nobody. */
    playerId: text('player_id').notNull(),
    /** The game it came from; null for the night's own awards. */
    gameId: text('game_id'),
    /** `moment`, `mvp` or `award`. */
    slot: text('slot').notNull().default('award'),
    value: real('value'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.nightKey, t.awardId, t.playerId] }),
    index('recap_awards_player').on(t.playerId, t.createdAt),
  ],
);

/** Each room's records, from the night cards' numbers (biggest clue cashed, quickest day…). */
export const recapRecords = sqliteTable(
  'recap_records',
  {
    roomId: text('room_id').notNull(),
    recordId: text('record_id').notNull(),
    playerId: text('player_id'),
    value: real('value').notNull(),
    at: integer('at').notNull(),
    nightKey: text('night_key').notNull(),
    gameId: text('game_id').notNull(),
    emoji: text('emoji').notNull(),
    /** The nugget as the card showed it (with placeholders). */
    text: text('text').notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.recordId] })],
);
