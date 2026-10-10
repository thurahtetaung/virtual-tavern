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

/** Decides who may enter private (back-room) rooms. */
export interface RoomGate {
  isPrivateRoom(roomId: string): boolean;
  /** Whether a raw `Cookie` header carries a current back-room unlock. */
  isUnlocked(cookieHeader: string | undefined): boolean;
}

/** Per-socket budget for client events (token bucket). */
export interface RateLimits {
  /** Sustained events per second. */
  perSecond: number;
  /** Events a quiet socket may send at once. */
  burst: number;
  /** Rejected events in a row after which the socket is dropped. */
  disconnectAfter: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { perSecond: 20, burst: 40, disconnectAfter: 200 };

export interface RealtimeOptions {
  limits?: Partial<RateLimits>;
}

/** Broadcast messages at least this big are compressed. */
const DEFLATE_THRESHOLD = 1024;

/** The gate each server was attached with, so manager events can re-check it on broadcast. */
const gates = new WeakMap<IO, RoomGate>();

/** Takes the socket out of its room without telling the manager (the caller already has). */
function leaveRoom(socket: ClientSocket) {
  const { roomId } = socket.data;
  if (roomId) void socket.leave(channel(roomId));
  socket.data = {};
}

/** Takes the socket out of its room and records the lost presence. */
function detach(socket: ClientSocket, rooms: RoomManager) {
  const { roomId, playerId } = socket.data;
  leaveRoom(socket);
  if (roomId && playerId) rooms.disconnected(roomId, playerId);
}

/** Routes manager events to sockets. Created before the manager so the two can reference each other. */
export function createRoomEvents(
  getIo: () => IO | undefined,
  getRooms: () => RoomManager,
): RoomEvents {
  return {
    changed(roomId) {
      const io = getIo();
      const ids = io?.of('/').adapter.rooms.get(channel(roomId));
      if (!io || !ids) return;
      const gate = gates.get(io);
      const isPrivate = gate?.isPrivateRoom(roomId) ?? false;
      // One gate check per distinct cookie, one view per player, one encode per player.
      const unlockedByCookie = new Map<string | undefined, boolean>();
      const socketsByPlayer = new Map<string, string[]>();
      const lockedOut: ClientSocket[] = [];
      for (const id of ids) {
        const s = io.sockets.sockets.get(id);
        const playerId = s?.data.playerId;
        if (!s || !playerId) continue;
        if (isPrivate && gate) {
          const cookie = s.request.headers.cookie;
          let unlocked = unlockedByCookie.get(cookie);
          if (unlocked === undefined) {
            unlocked = gate.isUnlocked(cookie);
            unlockedByCookie.set(cookie, unlocked);
          }
          if (!unlocked) {
            lockedOut.push(s);
            continue;
          }
        }
        const list = socketsByPlayer.get(playerId);
        if (list) list.push(id);
        else socketsByPlayer.set(playerId, [id]);
      }
      const rooms = getRooms();
      for (const [playerId, sockets] of socketsByPlayer) {
        const snapshot = rooms.snapshot(roomId, playerId);
        if (!snapshot) break;
        io.to(sockets).emit('room:state', snapshot);
      }
      // Their unlock expired or was revoked: this snapshot never reached them, and no later one will.
      const stale = lockedOut.map((s) => ({ s, playerId: s.data.playerId }));
      for (const { s } of stale) {
        leaveRoom(s);
        s.emit('room:locked');
      }
      for (const { playerId } of stale) if (playerId) rooms.disconnected(roomId, playerId);
    },
    kicked(roomId, playerId) {
      const io = getIo();
      if (!io) return;
      for (const id of io.of('/').adapter.rooms.get(channel(roomId)) ?? []) {
        const s = io.sockets.sockets.get(id);
        if (s?.data.playerId === playerId) {
          s.emit('room:kicked');
          leaveRoom(s);
        }
      }
    },
  };
}

class TokenBucket {
  private tokens: number;
  private last: number;
  /** Rejections since the last accepted event. */
  rejected = 0;
  private readonly limits: RateLimits;

  constructor(limits: RateLimits) {
    this.limits = limits;
    this.tokens = limits.burst;
    this.last = Date.now();
  }

  take(): boolean {
    const now = Date.now();
    const refill = ((now - this.last) / 1000) * this.limits.perSecond;
    this.tokens = Math.min(this.limits.burst, this.tokens + Math.max(0, refill));
    this.last = now;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.rejected = 0;
      return true;
    }
    this.rejected += 1;
    return false;
  }
}

const reply = (ack: unknown, res: Ack) => {
  if (typeof ack === 'function') (ack as (res: Ack) => void)(res);
};

function guard(log: FastifyBaseLogger, ack: unknown, run: () => Ack) {
  if (typeof ack !== 'function') return;
  try {
    reply(ack, run());
  } catch (err) {
    if (!(err instanceof RoomError)) log.error({ err }, 'socket handler failed');
    const code = err instanceof RoomError ? err.code : 'server-error';
    const message = err instanceof RoomError ? err.message : 'Something went wrong. Please retry.';
    reply(ack, { ok: false, error: { code, message } });
  }
}

const notJoined: Ack = { ok: false, error: { code: 'not-joined', message: 'Join a room first.' } };

const lockedOut: Ack = {
  ok: false,
  error: { code: 'backroom-locked', message: 'This room is in the back room. Unlock it first.' },
};

const rateLimited: Ack = {
  ok: false,
  error: { code: 'rate-limited', message: 'Too many requests. Slow down a little.' },
};

export function attachRealtime(
  server: HttpServer,
  rooms: RoomManager,
  log: FastifyBaseLogger,
  gate: RoomGate,
  opts: RealtimeOptions = {},
): IO {
  const limits: RateLimits = { ...DEFAULT_RATE_LIMITS, ...opts.limits };
  const io: IO = new Server(server, {
    serveClient: false,
    connectionStateRecovery: undefined,
    perMessageDeflate: { threshold: DEFLATE_THRESHOLD },
  });
  gates.set(io, gate);

  io.on('connection', (socket: ClientSocket) => {
    const bucket = new TokenBucket(limits);
    // The cookie is re-checked on every action, so changing the password locks out players mid-game.
    const allowed = (roomId: string) =>
      !gate.isPrivateRoom(roomId) || gate.isUnlocked(socket.request.headers.cookie);

    /** Every client event goes through here: budget first, then the usual error handling. */
    const guarded = (ack: unknown, run: () => Ack) => {
      if (bucket.take()) {
        guard(log, ack, run);
        return;
      }
      reply(ack, rateLimited);
      if (bucket.rejected >= limits.disconnectAfter) {
        log.warn({ socket: socket.id, playerId: socket.data.playerId }, 'socket flooding; dropped');
        socket.disconnect(true);
      }
    };

    const inRoom = (fn: (roomId: string, playerId: string) => Ack) => () => {
      const { roomId, playerId } = socket.data;
      if (!roomId || !playerId) return notJoined;
      if (!allowed(roomId)) {
        detach(socket, rooms);
        return lockedOut;
      }
      return fn(roomId, playerId);
    };

    socket.on('room:join', (payload, ack) =>
      guarded(ack, () => {
        const parsed = joinRoomPayload.safeParse(payload);
        if (!parsed.success) {
          return {
            ok: false,
            error: { code: 'bad-request', message: parsed.error.issues[0]!.message },
          };
        }
        const { roomId, token, name } = parsed.data;
        if (!allowed(roomId)) return lockedOut;
        const playerId = playerIdFromToken(token);
        // Enter the channel first so the join's own snapshot reaches this socket; back out if it
        // fails, so a bad join never costs the socket the room it was already in.
        const prev = socket.data;
        const rollback = () => {
          if (prev.roomId !== roomId) void socket.leave(channel(roomId));
          socket.data = prev;
        };
        socket.data = { roomId, playerId };
        void socket.join(channel(roomId));
        let res: Ack;
        try {
          res = rooms.join(roomId, playerId, name, { connect: true });
        } catch (err) {
          rollback();
          throw err;
        }
        if (!res.ok) {
          rollback();
          return res;
        }
        if (prev.roomId && prev.playerId) {
          if (prev.roomId !== roomId) void socket.leave(channel(prev.roomId));
          rooms.disconnected(prev.roomId, prev.playerId);
        }
        return res;
      }),
    );

    socket.on('room:rename', (name, ack) =>
      guarded(
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
      guarded(
        ack,
        inRoom((roomId, playerId) => {
          detach(socket, rooms);
          return rooms.leave(roomId, playerId);
        }),
      ),
    );

    socket.on('room:kick', (target, ack) =>
      guarded(
        ack,
        inRoom((roomId, playerId) => rooms.kick(roomId, playerId, String(target))),
      ),
    );

    socket.on('room:make-host', (target, ack) =>
      guarded(
        ack,
        inRoom((roomId, playerId) => rooms.makeHost(roomId, playerId, String(target))),
      ),
    );

    socket.on('game:action', (action, ack) =>
      guarded(
        ack,
        inRoom((roomId, playerId) => rooms.act(roomId, playerId, action)),
      ),
    );

    socket.on('disconnect', () => detach(socket, rooms));
  });

  return io;
}
