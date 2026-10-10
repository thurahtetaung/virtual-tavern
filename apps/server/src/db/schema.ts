import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const wordLists = sqliteTable('word_lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  words: text('words', { mode: 'json' }).$type<string[]>().notNull(),
  /**
   * Ids of the games that offer this list. The default names "echo" ahead of that game shipping,
   * so lists that exist when the column is added are ready for it; ids of games that are not
   * registered are simply never matched.
   */
  games: text('games', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'["codenames","enigma","echo"]'`),
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
});
