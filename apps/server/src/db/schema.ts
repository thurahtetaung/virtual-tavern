import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const wordLists = sqliteTable('word_lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  words: text('words', { mode: 'json' }).$type<string[]>().notNull(),
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
