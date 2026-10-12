import type {
  Ack,
  ClientToServerEvents,
  NextTable,
  RecapLine,
  RoomSnapshot,
  ServerToClientEvents,
} from '@vt/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type Socket, io } from 'socket.io-client';
import { playerToken } from './identity.ts';

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

    const join = () => {
      socket.emit(
        'room:join',
        { roomId, token: tokenRef.current ?? playerToken(), name: nameRef.current ?? name },
        (res) => {
          if (res.ok) {
            setStatus('joined');
            setError(null);
          } else {
            setStatus(res.error.code === 'backroom-locked' ? 'locked' : 'error');
            setError(res.error.message);
          }
        },
      );
    };

    socket.on('connect', join);
    socket.on('disconnect', () => setStatus((s) => (s === 'joined' ? 'reconnecting' : s)));
    // The server can't be reached (down, or the phone is offline). socket.io keeps retrying, so
    // say so instead of sitting on "Opening the door…"; a successful join flips it back.
    socket.on('connect_error', () =>
      setStatus((s) => (s === 'connecting' || s === 'joined' ? 'reconnecting' : s)),
    );
    socket.on('room:state', (s) => {
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
    // The password changed or everyone was signed out: the server already dropped us from the room.
    socket.on('room:locked', () => {
      setStatus('locked');
      socket.disconnect();
    });

    return () => {
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
    error,
    call,
    leave,
    wraps,
    next,
    dismissNext: () => setNext(null),
    playtestAwards,
  };
}
