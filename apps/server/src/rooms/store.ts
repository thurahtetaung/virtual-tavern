import { and, eq, isNotNull, lt, notInArray } from 'drizzle-orm';
import type { PlayerColor, PlaytestSpeed } from '@vt/protocol';
import type { Db } from '../db/index.ts';
import { rooms } from '../db/schema.ts';
import { withColors } from './colors.ts';

export interface RoomRecord {
  id: string;
  gameId: string;
  hostId: string;
  /** Join order. */
  players: { id: string; name: string; color: PlayerColor }[];
  state: unknown;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Test traffic opened or joined it: the stats record nothing about it. */
  test?: boolean | null;
  /** An admin playtest (always a test room too); null or missing for normal rooms. */
  playtest?: PlaytestRecord | null;
  /** The current table-screen pass's nonce; null or missing when no table screen is paired. */
  stage?: string | null;
}

/** A playtest room's own settings, kept with the room. */
export interface PlaytestRecord {
  /** Seats played by the server (their ids come from tokens nobody kept). */
  bots: { id: string; name: string }[];
  speed: PlaytestSpeed;
  paused: boolean;
  /** Paused by the bot runner because the bots got stuck. */
  stuck?: boolean;
  createdAt: number;
}

/** Persistence boundary for rooms; swap the implementation to move off SQLite. */
export interface RoomStore {
  get(id: string): RoomRecord | null;
  insert(room: RoomRecord): void;
  /** Writes `room` if the stored version is `room.version - 1`; returns false on conflict. */
  update(room: RoomRecord): boolean;
  /** Marks the room as active at `at` without changing its version (presence, not a change). */
  touch(id: string, at: number): void;
  /** Marks the room as test traffic for good (without changing its version). */
  markTest(id: string): void;
  /** Deletes rooms untouched since `before`, except those in `keep`; returns them. */
  deleteIdle(before: number, keep?: readonly string[]): { id: string; test: boolean }[];
  /** Saves a playtest room's settings (without changing its version). */
  setPlaytest(id: string, playtest: PlaytestRecord): void;
  /** Saves the room's table-screen nonce, or clears it (without changing its version). */
  setStage(id: string, stage: string | null): void;
  /** Deletes one room; returns whether it existed. */
  delete(id: string): boolean;
  /** Like `deleteIdle`, but only playtest rooms; returns their ids. */
  deleteIdlePlaytests(before: number, keep?: readonly string[]): string[];
}

export class SqliteRoomStore implements RoomStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  get(id: string): RoomRecord | null {
    const row = this.db.select().from(rooms).where(eq(rooms.id, id)).get();
    // Rooms saved before players had colours get them here; the next change saves them.
    return row ? { ...row, players: withColors(row.players) } : null;
  }

  insert(room: RoomRecord): void {
    this.db.insert(rooms).values(room).run();
  }

  update(room: RoomRecord): boolean {
    const { id, version, ...rest } = room;
    return (
      this.db
        .update(rooms)
        .set({ ...rest, version })
        .where(and(eq(rooms.id, id), eq(rooms.version, version - 1)))
        .run().changes === 1
    );
  }

  touch(id: string, at: number): void {
    this.db.update(rooms).set({ updatedAt: at }).where(eq(rooms.id, id)).run();
  }

  markTest(id: string): void {
    this.db.update(rooms).set({ test: true }).where(eq(rooms.id, id)).run();
  }

  deleteIdle(before: number, keep: readonly string[] = []): { id: string; test: boolean }[] {
    const idle = lt(rooms.updatedAt, before);
    return this.db
      .delete(rooms)
      .where(keep.length ? and(idle, notInArray(rooms.id, [...keep])) : idle)
      .returning({ id: rooms.id, test: rooms.test })
      .all()
      .map((r) => ({ id: r.id, test: r.test === true }));
  }

  setPlaytest(id: string, playtest: PlaytestRecord): void {
    this.db.update(rooms).set({ playtest }).where(eq(rooms.id, id)).run();
  }

  setStage(id: string, stage: string | null): void {
    this.db.update(rooms).set({ stage }).where(eq(rooms.id, id)).run();
  }

  delete(id: string): boolean {
    return this.db.delete(rooms).where(eq(rooms.id, id)).run().changes === 1;
  }

  deleteIdlePlaytests(before: number, keep: readonly string[] = []): string[] {
    const idle = and(isNotNull(rooms.playtest), lt(rooms.updatedAt, before));
    return this.db
      .delete(rooms)
      .where(keep.length ? and(idle, notInArray(rooms.id, [...keep])) : idle)
      .returning({ id: rooms.id })
      .all()
      .map((r) => r.id);
  }
}
