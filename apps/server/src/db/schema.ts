import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const wordLists = sqliteTable('word_lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  words: text('words', { mode: 'json' }).$type<string[]>().notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
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
