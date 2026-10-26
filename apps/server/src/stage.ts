import { randomInt } from 'node:crypto';
import {
  type Ack,
  type AckWith,
  STAGE_CODE_ALPHABET,
  STAGE_CODE_LENGTH,
  type StageCode,
} from '@vt/protocol';
import type { Backroom } from './backroom.ts';
import type { RoomManager } from './rooms/manager.ts';

export const STAGE_COOKIE = 'vt_stage';
/** How long a table-screen pass lasts at most (a room nobody touches for this long is swept). */
export const STAGE_SESSION_MS = 7 * 24 * 60 * 60_000;
/** How long a pairing code works. */
export const STAGE_CODE_MS = 10 * 60_000;
/** Codes a room may have open at once (each new one is a fresh guess target). */
export const MAX_OPEN_STAGE_CODES = 5;

/**
 * Pairing codes, in memory only: short, single use and gone after `STAGE_CODE_MS` (or a restart,
 * when the host just asks for another).
 */
export class StageCodes {
  private readonly codes = new Map<string, { roomId: string; expiresAt: number }>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private prune() {
    const now = this.now();
    for (const [code, c] of this.codes) if (c.expiresAt <= now) this.codes.delete(code);
  }

  /** A new code for the room, or null when it already has `MAX_OPEN_STAGE_CODES` open. */
  mint(roomId: string): StageCode | null {
    this.prune();
    let open = 0;
    for (const c of this.codes.values()) if (c.roomId === roomId) open += 1;
    if (open >= MAX_OPEN_STAGE_CODES) return null;
    let code: string;
    do {
      code = Array.from(
        { length: STAGE_CODE_LENGTH },
        () => STAGE_CODE_ALPHABET[randomInt(STAGE_CODE_ALPHABET.length)],
      ).join('');
    } while (this.codes.has(code));
    const expiresAt = this.now() + STAGE_CODE_MS;
    this.codes.set(code, { roomId, expiresAt });
    return { code, expiresAt };
  }

  /** The room a code pairs with, using it up; null when it is unknown, used or expired. */
  redeem(code: string): string | null {
    this.prune();
    const found = this.codes.get(code);
    if (!found) return null;
    this.codes.delete(code);
    return found.roomId;
  }
}

/**
 * The table screen's door. A paired screen holds a signed `vt_stage` cookie,
 * `<roomId>.<nonce>.<backroom version>.<issued at>`: it opens that one room, as a watcher only,
 * while the room keeps that nonce (pairing again or the host's removal replaces it, and it goes
 * with the room). For a back-room room it is that room's unlock and nothing more, and it dies
 * with the back-room word (a new password or "Sign everyone out").
 */
export class StageDoor {
  readonly codes: StageCodes;
  private readonly rooms: RoomManager;
  private readonly backroom: Backroom;
  private readonly isPrivateRoom: (roomId: string) => boolean;
  private readonly now: () => number;

  constructor(opts: {
    rooms: RoomManager;
    backroom: Backroom;
    isPrivateRoom: (roomId: string) => boolean;
    now?: () => number;
  }) {
    this.rooms = opts.rooms;
    this.backroom = opts.backroom;
    this.isPrivateRoom = opts.isPrivateRoom;
    this.now = opts.now ?? Date.now;
    this.codes = new StageCodes(this.now);
  }

  /** Host only: a pairing code for the room. */
  mint(roomId: string, by: string): AckWith<StageCode> {
    const host = this.rooms.hostOnly(roomId, by, 'Only the host can pair a table screen.');
    if (!host.ok) return host;
    const code = this.codes.mint(roomId);
    if (!code)
      return {
        ok: false,
        error: {
          code: 'too-many-codes',
          message: 'Use one of the codes you have, or wait a few minutes for a new one.',
        },
      };
    return { ok: true, data: code };
  }

  /** Host only: the table screen leaves and its pass stops working. */
  remove(roomId: string, by: string): Ack {
    return this.rooms.removeStage(roomId, by);
  }

  /** Redeems a code: the room and the pass to set, or null for a bad, used or expired code. */
  pair(code: string): { roomId: string; pass: string } | null {
    const roomId = this.codes.redeem(code);
    const nonce = roomId ? this.rooms.pairStage(roomId) : null;
    if (!roomId || !nonce) return null;
    return { roomId, pass: `${roomId}.${nonce}.${this.backroom.version()}.${this.now()}` };
  }

  /** The room an (already unsigned) pass opens right now, or null. */
  roomOf(value: string | null | undefined): string | null {
    const [roomId, nonce, version, issued] = value?.split('.') ?? [];
    const issuedAt = Number(issued);
    if (!roomId || !nonce || !Number.isFinite(issuedAt)) return null;
    const age = this.now() - issuedAt;
    if (age < 0 || age >= STAGE_SESSION_MS) return null;
    if (this.rooms.stagePass(roomId) !== nonce) return null;
    if (this.isPrivateRoom(roomId) && Number(version) !== this.backroom.version()) return null;
    return roomId;
  }
}
