import { randomBytes, randomInt } from 'node:crypto';
import { LINK_CODE_ALPHABET, LINK_CODE_LENGTH, LINK_CODE_MS, type LinkCode } from '@vt/protocol';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { linkedKeys, roomContinuations } from './db/schema.ts';
import { playerIdFromToken } from './rooms/ids.ts';

/** An open phone-link code: whose seat it opens, and the back room it carries. */
export interface OpenLinkCode {
  roomId: string;
  playerId: string;
  /**
   * The back-room version the PC held when it asked for the code (a current unlock or an admin
   * session), or null: the phone gets an unlock only while the word is still that version.
   */
  backroom: number | null;
  expiresAt: number;
}

/** How long a spent code is remembered, so the phone can say it ran out rather than that it's wrong. */
export const SPENT_CODE_MEMORY_MS = 10 * 60_000;

/**
 * Phone-link codes, in memory only: four letters, single use, gone after `LINK_CODE_MS` (or a
 * restart, when the card just asks for another). One open code per player: a new one replaces it.
 * A spent code (run out, used or withdrawn) is remembered a while as spent, never reissued meanwhile.
 */
export class LinkCodes {
  private readonly codes = new Map<string, OpenLinkCode & { spent?: true }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private prune() {
    const now = this.now();
    for (const [code, c] of this.codes)
      if (c.expiresAt + SPENT_CODE_MEMORY_MS <= now) this.codes.delete(code);
  }

  /** A new code for the player (withdrawing their last one). */
  mint(roomId: string, playerId: string, backroom: number | null): LinkCode {
    this.cancel(roomId, playerId);
    this.prune();
    let code: string;
    do {
      code = Array.from(
        { length: LINK_CODE_LENGTH },
        () => LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)],
      ).join('');
    } while (this.codes.has(code));
    const expiresAt = this.now() + LINK_CODE_MS;
    this.codes.set(code, { roomId, playerId, backroom, expiresAt });
    return { code, expiresAt };
  }

  /** Withdraws the player's open code, if any. */
  cancel(roomId: string, playerId: string): void {
    for (const c of this.codes.values())
      if (c.roomId === roomId && c.playerId === playerId) c.spent = true;
  }

  /**
   * The open code, without using it up: `expired` when it ran out, was used or withdrawn, null
   * when no PC showed it.
   */
  peek(code: string): OpenLinkCode | 'expired' | null {
    this.prune();
    const found = this.codes.get(code);
    if (!found) return null;
    if (found.spent || found.expiresAt <= this.now()) return 'expired';
    return found;
  }

  /** The open code, using it up (see `peek`). */
  redeem(code: string): OpenLinkCode | 'expired' | null {
    const found = this.peek(code);
    if (found && found !== 'expired') this.codes.get(code)!.spent = true;
    return found;
  }
}

interface Row {
  keyHash: string;
  roomId: string;
  playerId: string;
  active: boolean;
}

/**
 * Linked phones' keys (see `linkedKeys` in the schema). Kept in memory as well (the table is small
 * and every broadcast asks), written through to SQLite so links survive a restart.
 */
export class LinkedKeys {
  private readonly db: Db;
  private readonly now: () => number;
  /** `<keyHash>|<roomId>` → row. */
  private readonly rows = new Map<string, Row>();
  /** "Same crew, new game": each table's next tables. */
  private readonly next = new Map<string, Set<string>>();

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
    for (const c of db.select().from(roomContinuations).all()) this.addNext(c.roomId, c.nextRoomId);
    for (const r of db.select().from(linkedKeys).all())
      this.rows.set(`${r.keyHash}|${r.roomId}`, {
        keyHash: r.keyHash,
        roomId: r.roomId,
        playerId: r.playerId,
        active: r.active,
      });
  }

  private find(pred: (r: Row) => boolean): Row[] {
    return [...this.rows.values()].filter(pred);
  }

  /**
   * The player a phone's key opens in the room (`active` false: it waits for the player's PC to
   * join this table first), or null.
   */
  lookup(roomId: string, key: string): { playerId: string; active: boolean } | null {
    const row = this.rows.get(`${playerIdFromToken(key)}|${roomId}`);
    return row ? { playerId: row.playerId, active: row.active } : null;
  }

  /** The hash of the player's active key in the room, or null when no phone is linked. */
  keyOf(roomId: string, playerId: string): string | null {
    return (
      this.find((r) => r.roomId === roomId && r.playerId === playerId && r.active)[0]?.keyHash ??
      null
    );
  }

  /** Whether any of these keys (raw) opens a seat in the room other than `playerId`'s. */
  otherSeat(roomId: string, playerId: string, keys: readonly string[]): string | null {
    for (const key of keys) {
      const row = this.rows.get(`${playerIdFromToken(key)}|${roomId}`);
      if (row && row.playerId !== playerId) return row.playerId;
    }
    return null;
  }

  /**
   * A new key for the player's phone in the room. It replaces the player's last one (one phone
   * per player), in every table it opened. Returns the raw key (for the phone only) and the hash
   * of the key it replaced, if any (its phone is sent away).
   */
  create(
    roomId: string,
    playerId: string,
    /** Whether the player is in a table now (only those open to the key at once). */
    isMember: (roomId: string, playerId: string) => boolean = () => false,
  ): { key: string; replaced: string | null; opened: string[] } {
    const old = this.find((r) => r.roomId === roomId && r.playerId === playerId)[0]?.keyHash;
    if (old) this.deleteKey(old);
    const key = randomBytes(24).toString('base64url');
    const keyHash = playerIdFromToken(key);
    this.insert({ keyHash, roomId, playerId, active: true });
    // The night's next tables, as "Same crew, new game" chained them from this one: the key
    // opens those the player is in, and waits in the rest until their PC joins (as `carry`).
    const opened: string[] = [];
    for (const next of this.nextTables(roomId)) {
      const active = isMember(next, playerId);
      this.insert({ keyHash, roomId: next, playerId, active });
      if (active) opened.push(next);
    }
    return { key, replaced: old ?? null, opened };
  }

  /** Every table chained after this one by "Same crew, new game" (not the table itself). */
  private nextTables(roomId: string): string[] {
    const seen = new Set<string>([roomId]);
    const queue = [roomId];
    while (queue.length) {
      for (const n of this.next.get(queue.shift()!) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    seen.delete(roomId);
    return [...seen];
  }

  private addNext(roomId: string, next: string) {
    let set = this.next.get(roomId);
    if (!set) this.next.set(roomId, (set = new Set()));
    set.add(next);
  }

  /** Unlinks the player's phone in the room, in every table; the key's hash, or null. */
  remove(roomId: string, playerId: string): string | null {
    const key = this.find((r) => r.roomId === roomId && r.playerId === playerId)[0]?.keyHash;
    if (!key) return null;
    this.deleteKey(key);
    return key;
  }

  /**
   * "Same crew, new game": every key in the night's rooms is copied into the new table, waiting
   * (`active: false`) until its player's own browser joins it.
   */
  carry(from: readonly string[], to: string): void {
    // Remembered, so a phone linked later at an earlier table reaches this one too (`create`).
    for (const f of from) {
      if (f === to) continue;
      this.addNext(f, to);
      this.db
        .insert(roomContinuations)
        .values({ roomId: f, nextRoomId: to })
        .onConflictDoNothing()
        .run();
    }
    const seen = new Set<string>();
    for (const r of this.find((row) => from.includes(row.roomId) && row.active)) {
      if (seen.has(r.keyHash)) continue;
      seen.add(r.keyHash);
      this.insert({ keyHash: r.keyHash, roomId: to, playerId: r.playerId, active: false });
    }
  }

  /**
   * The player's own browser joined the room: a key waiting there opens it now. Returns the
   * key's hash when one did (its phone is told to follow), else null.
   */
  activate(roomId: string, playerId: string): string | null {
    const row = this.find((r) => r.roomId === roomId && r.playerId === playerId && !r.active)[0];
    if (!row) return null;
    row.active = true;
    this.db
      .update(linkedKeys)
      .set({ active: true })
      .where(and(eq(linkedKeys.keyHash, row.keyHash), eq(linkedKeys.roomId, roomId)))
      .run();
    return row.keyHash;
  }

  /** A swept room's keys (and its place in the chain of tables) go with it. */
  forgetRoom(roomId: string): void {
    if (this.next.delete(roomId) || [...this.next.values()].some((s) => s.has(roomId))) {
      for (const set of this.next.values()) set.delete(roomId);
      this.db
        .delete(roomContinuations)
        .where(or(eq(roomContinuations.roomId, roomId), eq(roomContinuations.nextRoomId, roomId)))
        .run();
    }
    const gone = this.find((r) => r.roomId === roomId);
    if (!gone.length) return;
    for (const r of gone) this.rows.delete(`${r.keyHash}|${roomId}`);
    this.db.delete(linkedKeys).where(eq(linkedKeys.roomId, roomId)).run();
  }

  private insert(row: Row) {
    this.rows.set(`${row.keyHash}|${row.roomId}`, row);
    this.db
      .insert(linkedKeys)
      .values({ ...row, createdAt: this.now() })
      .onConflictDoUpdate({
        target: [linkedKeys.keyHash, linkedKeys.roomId],
        set: { playerId: row.playerId, active: row.active },
      })
      .run();
  }

  private deleteKey(keyHash: string) {
    for (const r of this.find((row) => row.keyHash === keyHash))
      this.rows.delete(`${r.keyHash}|${r.roomId}`);
    this.db
      .delete(linkedKeys)
      .where(inArray(linkedKeys.keyHash, [keyHash]))
      .run();
  }
}
