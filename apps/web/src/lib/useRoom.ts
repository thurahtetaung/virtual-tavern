import type {
  Ack,
  ClientToServerEvents,
  LockReason,
  NextTable,
  RecapLine,
  RoomSnapshot,
} from '@vt/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { playerToken } from './identity.ts';
import { type RecapPush, RoomConnection, type RoomStatus } from './room-connection.ts';

export type { RoomStatus } from './room-connection.ts';

/** A server clock estimate that moved less than this keeps the old one (no re-render). */
const CLOCK_JITTER_MS = 50;

/**
 * Live connection to one room (`RoomConnection`), as React state.
 * `token`: the identity to join as (a playtest seat); by default the browser's own player.
 * The socket connects at once, so it opens while the page looks the room up and loads the game;
 * the join waits for a name and for `ready` (the identity is settled), then goes out as soon as
 * the socket is up.
 */
export function useRoom(roomId: string, name: string | null, token?: string, ready = true) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [status, setStatus] = useState<RoomStatus>('connecting');
  /** Back after a while away: the room on screen may be stale until the next update. */
  const [catchingUp, setCatchingUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Why a `locked` room turned this browser away (the door words it to match). */
  const [lockReason, setLockReason] = useState<LockReason>('none');
  /** Counts the host's wrap-ups heard on this page, so the recap can open everywhere. */
  const [wraps, setWraps] = useState(0);
  /** "Same crew, new game": the latest table someone here opened for the night. */
  const [next, setNext] = useState<NextTable | null>(null);
  /** A playtest's award preview for its finished game (never saved anywhere). */
  const [playtestAwards, setPlaytestAwards] = useState<RecapLine[] | null>(null);
  /** The night recap the server pushed with the latest state it belongs to. */
  const [recapPush, setRecapPush] = useState<(RecapPush & { at: number }) | null>(null);
  const connRef = useRef<RoomConnection | null>(null);
  // Latest name for automatic rejoins, so a reconnect never reverts a rename.
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  const canJoin = ready && name !== null;

  useEffect(() => {
    const conn = new RoomConnection(roomId, {
      state: (s) => {
        setSnapshot(s);
        const offset = s.serverNow - Date.now();
        setClockOffset((o) => (Math.abs(offset - o) > CLOCK_JITTER_MS ? offset : o));
        // A new game drops the last one's preview.
        if (s.meta?.phase === 'playing') setPlaytestAwards(null);
      },
      status: setStatus,
      error: setError,
      lockReason: setLockReason,
      catchingUp: setCatchingUp,
      wrapped: () => setWraps((n) => n + 1),
      next: setNext,
      playtestAwards: setPlaytestAwards,
      recap: (push) => setRecapPush({ ...push, at: performance.now() }),
    });
    connRef.current = conn;
    const onVisible = () => conn.visibility(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      conn.dispose();
      connRef.current = null;
    };
  }, [roomId]);

  // The name and seat are known: join (once; rejoins after drops reuse them). Renames go through
  // `room:rename`, and the seat never changes on a page.
  useEffect(() => {
    if (!canJoin) return;
    const seat = token ?? playerToken();
    connRef.current?.enable(() => ({ token: seat, name: nameRef.current ?? '' }));
  }, [canJoin, token, roomId]);

  const call = useCallback(
    <E extends keyof ClientToServerEvents>(event: E, ...args: unknown[]): Promise<Ack> =>
      connRef.current?.call(event, ...args) ??
      Promise.resolve({
        ok: false,
        error: { code: 'offline', message: 'Reconnecting… try again in a moment.' },
      }),
    [],
  );

  const leave = useCallback(async () => {
    await connRef.current?.leave();
  }, []);

  // Hangs up for good, staying a member (a page that can't show the room).
  const close = useCallback(() => {
    connRef.current?.close();
  }, []);

  return {
    snapshot,
    clockOffset,
    status,
    catchingUp,
    lockReason,
    error,
    call,
    leave,
    close,
    wraps,
    next,
    dismissNext: () => setNext(null),
    playtestAwards,
    recapPush,
  };
}
