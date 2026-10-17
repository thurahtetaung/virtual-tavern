import type {
  Ack,
  ClientToServerEvents,
  LockReason,
  NextTable,
  RecapLine,
  RoomSnapshot,
  ServerToClientEvents,
} from '@vt/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Socket, io } from 'socket.io-client';
import { playerToken } from './identity.ts';
import { JoinWatch } from './retry.ts';

export type RoomStatus =
  | 'connecting'
  | 'joined'
  | 'reconnecting'
  | 'kicked'
  | 'left'
  | 'error'
  /** A back-room room, and this browser's unlock is missing or no longer valid. */
  | 'locked'
  /** The admin ended this playtest: the room is gone. */
  | 'closed';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Live connection to one room. Rejoins automatically after network drops or server restarts.
 * `token`: the identity to join as (a playtest seat); by default the browser's own player.
 */
export function useRoom(roomId: string, name: string | null, token?: string) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  /** Why a `locked` room turned this browser away (the door words it to match). */
  const [lockReason, setLockReason] = useState<LockReason>('none');
  /** Counts the host's wrap-ups heard on this page, so the recap can open everywhere. */
  const [wraps, setWraps] = useState(0);
  /** "Same crew, new game": the latest table someone here opened for the night. */
  const [next, setNext] = useState<NextTable | null>(null);
  /** A playtest's award preview for its finished game (never saved anywhere). */
  const [playtestAwards, setPlaytestAwards] = useState<RecapLine[] | null>(null);
  const socketRef = useRef<ClientSocket | null>(null);
  // Latest name for automatic rejoins, so a reconnect never reverts a rename.
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  // The seat this page joins as, kept for every automatic rejoin (the same seat after a drop).
  const tokenRef = useRef(token);

  useEffect(() => {
    if (!name) return;
    const socket: ClientSocket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    // Whether the server has this page in the room right now.
    let joined = false;
    const watch = new JoinWatch(() => {
      if (socket.connected) join();
    });

    const join = () => {
      watch.sent();
      socket.emit(
        'room:join',
        { roomId, token: tokenRef.current ?? playerToken(), name: nameRef.current ?? name },
        (res) => {
          if (res.ok) {
            joined = true;
            watch.accepted();
            setStatus('joined');
            setError(null);
          } else {
            watch.stop();
            if (res.error.code === 'backroom-locked') setLockReason(res.error.reason ?? 'none');
            setStatus(res.error.code === 'backroom-locked' ? 'locked' : 'error');
            setError(res.error.message);
          }
        },
      );
    };
    // A phone that slept mid-join can come back to a socket that looks fine but is dead: start
    // over on a fresh connection. A socket closed on purpose (kicked, locked out, closed, left)
    // is no longer `active` and stays closed.
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || joined || !socket.active) return;
      socket.disconnect();
      socket.connect();
    };
    document.addEventListener('visibilitychange', onVisible);

    socket.on('connect', join);
    socket.on('disconnect', () => {
      joined = false;
      watch.stop();
      setStatus((s) => (s === 'joined' ? 'reconnecting' : s));
    });
    // The server can't be reached (down, or the phone is offline). socket.io keeps retrying, so
    // say so instead of sitting on "Opening the door…"; a successful join flips it back.
    socket.on('connect_error', () =>
      setStatus((s) => (s === 'connecting' || s === 'joined' ? 'reconnecting' : s)),
    );
    socket.on('room:state', (s) => {
      watch.stop();
      setSnapshot(s);
      setClockOffset(s.serverNow - Date.now());
      // A new game drops the last one's preview.
      if (s.meta?.phase === 'playing') setPlaytestAwards(null);
    });
    socket.on('room:kicked', () => {
      setStatus('kicked');
      socket.disconnect();
    });
    socket.on('room:wrapped', () => setWraps((n) => n + 1));
    socket.on('room:next', (table) => setNext(table));
    socket.on('room:playtestAwards', (lines) => setPlaytestAwards(lines));
    socket.on('room:closed', () => {
      setStatus('closed');
      socket.disconnect();
    });
    // The word changed, everyone was signed out or the admin session ended: the server already
    // dropped us from the room.
    socket.on('room:locked', (reason) => {
      setLockReason(reason);
      setStatus('locked');
      socket.disconnect();
    });

    return () => {
      watch.stop();
      document.removeEventListener('visibilitychange', onVisible);
      socket.disconnect();
      socketRef.current = null;
    };
    // Only (re)connect when the room or the presence of a name changes; renames go through `rename`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, name !== null]);

  const call = useCallback(
    <E extends keyof ClientToServerEvents>(event: E, ...args: unknown[]): Promise<Ack> =>
      new Promise((resolve) => {
        const socket = socketRef.current;
        if (!socket?.connected) {
          resolve({
            ok: false,
            error: { code: 'offline', message: 'Reconnecting… try again in a moment.' },
          });
          return;
        }
        (socket.timeout(8000).emit as (...a: unknown[]) => void)(
          event,
          ...args,
          (err: unknown, res: Ack) =>
            resolve(
              err
                ? { ok: false, error: { code: 'timeout', message: 'The server did not respond.' } }
                : res,
            ),
        );
      }),
    [],
  );

  const leave = useCallback(async () => {
    await call('room:leave');
    socketRef.current?.disconnect();
    setStatus('left');
  }, [call]);

  return {
    snapshot,
    clockOffset,
    status,
    lockReason,
    error,
    call,
    leave,
    wraps,
    next,
    dismissNext: () => setNext(null),
    playtestAwards,
  };
}
