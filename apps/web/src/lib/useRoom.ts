import type { Ack, ClientToServerEvents, RoomSnapshot, ServerToClientEvents } from '@vt/protocol';
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
  | 'locked';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Live connection to one room. Rejoins automatically after network drops or server restarts. */
export function useRoom(roomId: string, name: string | null) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [status, setStatus] = useState<RoomStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<ClientSocket | null>(null);
  // Latest name for automatic rejoins, so a reconnect never reverts a rename.
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    if (!name) return;
    const socket: ClientSocket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    const join = () => {
      socket.emit(
        'room:join',
        { roomId, token: playerToken(), name: nameRef.current ?? name },
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
    socket.on('room:state', (s) => {
      setSnapshot(s);
      setClockOffset(s.serverNow - Date.now());
    });
    socket.on('room:kicked', () => {
      setStatus('kicked');
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

  return { snapshot, clockOffset, status, error, call, leave };
}
