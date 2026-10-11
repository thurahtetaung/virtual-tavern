import type { RecapTone } from '@vt/protocol';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { appSettings, roomRecapSettings } from '../db/schema.ts';

/** The admin kill switch, in `app_settings` ("1" or "0"; missing means on). */
const ENABLED_KEY = 'recap.enabled';

export const isTone = (v: unknown): v is RecapTone => v === 'cheeky' || v === 'wholesome';

interface RoomSettings {
  tone: RecapTone;
  tzOffsetMin: number | null;
}

/**
 * Night recap settings: the admin's on/off switch and each room's tone. Read on every snapshot,
 * so both are cached in memory (this process is the only writer).
 */
export class RecapSettings {
  private readonly db: Db;
  private readonly now: () => number;
  private enabledCache: boolean | null = null;
  private readonly rooms = new Map<string, RoomSettings>();

  constructor(db: Db, now: () => number) {
    this.db = db;
    this.now = now;
  }

  enabled(): boolean {
    if (this.enabledCache === null) {
      const row = this.db.select().from(appSettings).where(eq(appSettings.key, ENABLED_KEY)).get();
      this.enabledCache = row?.value !== '0';
    }
    return this.enabledCache;
  }

  setEnabled(on: boolean): void {
    this.db
      .insert(appSettings)
      .values({ key: ENABLED_KEY, value: on ? '1' : '0' })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: on ? '1' : '0' } })
      .run();
    this.enabledCache = on;
  }

  room(roomId: string): RoomSettings {
    const cached = this.rooms.get(roomId);
    if (cached) return cached;
    const row = this.db
      .select()
      .from(roomRecapSettings)
      .where(eq(roomRecapSettings.roomId, roomId))
      .get();
    const settings: RoomSettings = {
      tone: isTone(row?.tone) ? row.tone : 'cheeky',
      tzOffsetMin: row?.tzOffsetMin ?? null,
    };
    this.remember(roomId, settings);
    return settings;
  }

  /** Saves the tone and/or the host's time zone. */
  update(roomId: string, patch: { tone?: RecapTone; tzOffsetMin?: number | null }): void {
    const next = { ...this.room(roomId), ...patch };
    this.db
      .insert(roomRecapSettings)
      .values({
        roomId,
        tone: next.tone,
        tzOffsetMin: next.tzOffsetMin,
        updatedAt: this.now(),
      })
      .onConflictDoUpdate({
        target: roomRecapSettings.roomId,
        set: { tone: next.tone, tzOffsetMin: next.tzOffsetMin, updatedAt: this.now() },
      })
      .run();
    this.remember(roomId, next);
  }

  /** A swept room's settings go with it. */
  forget(roomId: string): void {
    this.rooms.delete(roomId);
    this.db.delete(roomRecapSettings).where(eq(roomRecapSettings.roomId, roomId)).run();
  }

  private remember(roomId: string, settings: RoomSettings) {
    this.rooms.delete(roomId);
    this.rooms.set(roomId, settings);
    // Rooms come and go: keep the cache small (oldest first).
    if (this.rooms.size > 500) this.rooms.delete(this.rooms.keys().next().value!);
  }
}

/** A valid `getTimezoneOffset()` value, or null. */
export const tzOffset = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && Math.abs(v) <= 14 * 60 ? v : null;
