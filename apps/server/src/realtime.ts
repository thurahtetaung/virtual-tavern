import {
  type Ack,
  type ClientToServerEvents,
  type ServerToClientEvents,
  joinRoomPayload,
  playerName,
} from '@vt/protocol';
import type { FastifyBaseLogger } from 'fastify';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { playerIdFromToken } from './rooms/ids.ts';
import { RoomError, type RoomEvents, type RoomManager } from './rooms/manager.ts';

interface SocketData {
  roomId?: string;
  playerId?: string;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type ClientSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const channel = (roomId: string) => `room:${roomId}`;

/** Routes manager events to sockets. Created before the manager so the two can reference each other. */
export function createRoomEvents(
  getIo: () => IO | undefined,
  getRooms: () => RoomManager,
): RoomEvents {
  return {
    changed(roomId) {
      const io = getIo();
      if (!io) return;
      for (const socket of io.of('/').adapter.rooms.get(channel(roomId)) ?? []) {
        const s = io.sockets.sockets.get(socket);
        const playerId = s?.data.playerId;
        if (!s || !playerId) continue;
        const snapshot = getRooms().snapshot(roomId, playerId);
        if (snapshot) s.emit('room:state', snapshot);
      }
    },
    kicked(roomId, playerId) {
      const io = getIo();
      if (!io) return;
      for (const id of io.of('/').adapter.rooms.get(channel(roomId)) ?? []) {
        const s = io.sockets.sockets.get(id);
        if (s?.data.playerId === playerId) {
          s.emit('room:kicked');
          void s.leave(channel(roomId));
          s.data = {};
        }
      }
    },
  };
}

function guard(log: FastifyBaseLogger, ack: unknown, run: () => Ack) {
  if (typeof ack !== 'function') return;
  try {
    (ack as (res: Ack) => void)(run());
  } catch (err) {
    if (!(err instanceof RoomError)) log.error({ err }, 'socket handler failed');
    const code = err instanceof RoomError ? err.code : 'server-error';
    const message = err instanceof RoomError ? err.message : 'Something went wrong. Please retry.';
    (ack as (res: Ack) => void)({ ok: false, error: { code, message } });
  }
}

const notJoined: Ack = { ok: false, error: { code: 'not-joined', message: 'Join a room first.' } };

export function attachRealtime(server: HttpServer, rooms: RoomManager, log: FastifyBaseLogger): IO {
  const io: IO = new Server(server, { serveClient: false, connectionStateRecovery: undefined });

  io.on('connection', (socket: ClientSocket) => {
    const inRoom = (fn: (roomId: string, playerId: string) => Ack) => () => {
      const { roomId, playerId } = socket.data;
      return roomId && playerId ? fn(roomId, playerId) : notJoined;
    };

    const detach = () => {
      const { roomId, playerId } = socket.data;
      if (roomId && playerId) {
        void socket.leave(channel(roomId));
        socket.data = {};
        rooms.disconnected(roomId, playerId);
      }
    };

    socket.on('room:join', (payload, ack) =>
      guard(log, ack, () => {
        const parsed = joinRoomPayload.safeParse(payload);
        if (!parsed.success) {
          return {
            ok: false,
            error: { code: 'bad-request', message: parsed.error.issues[0]!.message },
          };
        }
        const { roomId, token, name } = parsed.data;
        const playerId = playerIdFromToken(token);
        detach();
        const res = rooms.join(roomId, playerId, name);
        if (!res.ok) return res;
        socket.data = { roomId, playerId };
        void socket.join(channel(roomId));
        rooms.connected(roomId, playerId);
        return res;
      }),
    );

    socket.on('room:rename', (name, ack) =>
      guard(
        log,
        ack,
        inRoom((roomId, playerId) => {
          const parsed = playerName.safeParse(name);
          if (!parsed.success) {
            return {
              ok: false,
              error: { code: 'bad-name', message: parsed.error.issues[0]!.message },
            };
          }
          return rooms.rename(roomId, playerId, parsed.data);
        }),
      ),
    );

    socket.on('room:leave', (ack) =>
      guard(
        log,
        ack,
        inRoom((roomId, playerId) => {
          detach();
          return rooms.leave(roomId, playerId);
        }),
      ),
    );

    socket.on('room:kick', (target, ack) =>
      guard(
        log,
        ack,
        inRoom((roomId, playerId) => rooms.kick(roomId, playerId, String(target))),
      ),
    );

    socket.on('room:make-host', (target, ack) =>
      guard(
        log,
        ack,
        inRoom((roomId, playerId) => rooms.makeHost(roomId, playerId, String(target))),
      ),
    );

    socket.on('game:action', (action, ack) =>
      guard(
        log,
        ack,
        inRoom((roomId, playerId) => rooms.act(roomId, playerId, action)),
      ),
    );

    socket.on('disconnect', detach);
  });

  return io;
}
