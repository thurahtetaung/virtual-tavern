import { and, eq, lt } from 'drizzle-orm';
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
}

/** Persistence boundary for rooms; swap the implementation to move off SQLite. */
export interface RoomStore {
  get(id: string): RoomRecord | null;
  insert(room: RoomRecord): void;
  /** Writes `room` if the stored version is `room.version - 1`; returns false on conflict. */
  update(room: RoomRecord): boolean;
  /** Deletes rooms untouched since `before`; returns their ids. */
  deleteIdle(before: number): string[];
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

  deleteIdle(before: number): string[] {
    return this.db
      .delete(rooms)
      .where(lt(rooms.updatedAt, before))
      .returning({ id: rooms.id })
      .all()
      .map((r) => r.id);
  }
}
