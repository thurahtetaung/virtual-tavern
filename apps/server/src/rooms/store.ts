import { and, eq, lt, notInArray } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { rooms } from '../db/schema.ts';

export interface RoomRecord {
  id: string;
  gameId: string;
  hostId: string;
  /** Join order. */
  players: { id: string; name: string }[];
  state: unknown;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Test traffic opened or joined it: the stats record nothing about it. */
  test?: boolean | null;
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
}

export class SqliteRoomStore implements RoomStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  get(id: string): RoomRecord | null {
    return this.db.select().from(rooms).where(eq(rooms.id, id)).get() ?? null;
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
}
