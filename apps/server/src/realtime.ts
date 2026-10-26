import {
  type Ack,
  type AckWith,
  type ClientToServerEvents,
  type LockReason,
  type NextTable,
  type RecapLine,
  type RoomRecap,
  type RoomSnapshot,
  type ServerToClientEvents,
  type StageCode,
  joinRoomPayload,
  stageJoinPayload,
  playerColor,
  playerName,
} from '@vt/protocol';
import type { FastifyBaseLogger } from 'fastify';
import type { IncomingHttpHeaders, Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { playerIdFromToken } from './rooms/ids.ts';
import type { RecapService } from './recap/service.ts';
import { RoomError, type RoomEvents, type RoomManager } from './rooms/manager.ts';

interface SocketData {
  roomId?: string;
  playerId?: string;
  /** A table screen: in the room as a watcher, never a player. */
  stage?: true;
}

type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type ClientSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const channel = (roomId: string) => `room:${roomId}`;

/** Decides who may enter private (back-room) rooms and admin playtests. */
export interface RoomGate {
  isPrivateRoom(roomId: string): boolean;
  /**
   * Whether a raw `Cookie` header has the back room: a current unlock, or a current admin session
   * (the admin always has the back room).
   */
  hasBackroom(cookieHeader: string | undefined): boolean;
  /** Why a raw `Cookie` header without the back room was turned away. Default: `'changed'`. */
  lockReason?(cookieHeader: string | undefined): LockReason;
  /** Whether the room is an admin playtest (only admins may be in it). Default: never. */
  isPlaytest?(roomId: string): boolean;
  /** Whether a raw `Cookie` header carries a current admin session. Default: never. */
  isAdmin?(cookieHeader: string | undefined): boolean;
  /**
   * Whether a raw `Cookie` header may watch the room as its table screen: a current table-screen
   * pass for that room (or, in a playtest, the admin's session). Default: never.
   */
  stageAllowed?(roomId: string, cookieHeader: string | undefined): boolean;
}

/** The host's table-screen controls (pairing codes and removal). */
export interface StageControls {
  mint(roomId: string, by: string): AckWith<StageCode>;
  remove(roomId: string, by: string): Ack;
}

/**
 * Who may be in a room. A playtest takes an admin session; every other room needs the back room
 * (an unlock or an admin session) when it is private.
 */
function roomAccess(gate: RoomGate | undefined, roomId: string) {
  if (gate?.isPlaytest?.(roomId)) return (cookie: string | undefined) => !!gate.isAdmin?.(cookie);
  if (gate?.isPrivateRoom(roomId)) return (cookie: string | undefined) => gate.hasBackroom(cookie);
  return null;
}

/** Sends a playtest's award preview to everyone in the room. */
export function sendPlaytestAwards(io: IO, roomId: string, lines: RecapLine[]): void {
  io.to(channel(roomId)).emit('room:playtestAwards', lines);
}

/**
 * Open sockets that are not in a test room (playtests and test traffic are never counted), nor
 * table screens (they are not visitors).
 */
export function countSockets(io: IO, isTestRoom: (roomId: string) => boolean): number {
  let n = 0;
  for (const s of io.sockets.sockets.values()) {
    const { roomId, stage } = s.data;
    if (stage) continue;
    if (!roomId || !isTestRoom(roomId)) n += 1;
  }
  return n;
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
  /** Night recaps; without it the recap events answer `recap-off`. */
  recap?: RecapService;
  /** Whether a handshake is test traffic (`x-vt-test`); rooms it joins record no stats. */
  isTestTraffic?: (headers: IncomingHttpHeaders) => boolean;
  /** A playtest's award preview to send a seat that (re)joins, if its game just ended. */
  playtestAwards?: (roomId: string) => RecapLine[] | null;
  /** A refused move (`game:action`), for the metrics. */
  onRefusal?: (roomId: string, code: string) => void;
  /** Table-screen pairing; without it the host's table-screen events are refused. */
  stage?: StageControls;
}

/** The gate each server was attached with, so manager events can re-check it on broadcast. */
const gates = new WeakMap<IO, RoomGate>();

/** Why a socket's cookie was turned away from a back-room room. */
const lockReason = (gate: RoomGate | undefined, cookie: string | undefined): LockReason =>
  gate?.lockReason?.(cookie) ?? 'changed';
/** The last snapshot each socket was sent (minus the clock), so unchanged views aren't re-sent. */
const lastSent = new WeakMap<ClientSocket, string>();
/** The recap service each server was attached with, for the recaps pushed with the state. */
const recaps = new WeakMap<IO, RecapService>();
/** The recap moment of the last snapshot each socket was sent (`<phase>:<gameNo>|<tone>`). */
const recapMoment = new WeakMap<ClientSocket, string>();

/** The state a recap belongs to, as the browser names it (`<phase>:<gameNo>`). */
const recapFor = (s: RoomSnapshot) => `${s.meta?.phase}:${s.meta?.gameNo}`;

/**
 * Pushes the night recap to each socket, as that socket may see it (a back-room table only to
 * a browser that has the back room), so nobody has to ask for it.
 */
function pushRecap(io: IO, roomId: string, targets: { s: ClientSocket; for: string }[]) {
  const recap = recaps.get(io);
  const gate = gates.get(io);
  if (!recap || !gate) return;
  const built = new Map<string, unknown>();
  for (const { s, for: forState } of targets) {
    const playerId = s.data.playerId;
    if (!playerId || s.data.roomId !== roomId || !s.connected) continue;
    const unlocked = gate.hasBackroom(s.request.headers.cookie);
    const key = `${playerId}|${unlocked}`;
    if (!built.has(key)) {
      const res = recap.recap(roomId, playerId, { scope: 'night', opened: false }, { unlocked });
      built.set(key, res.ok ? res.data : undefined);
    }
    const data = built.get(key);
    if (data !== undefined)
      s.emit('room:recap', { recap: data as RoomRecap | null, for: forState });
  }
}

/** Takes the socket out of its room without telling the manager (the caller already has). */
function leaveRoom(socket: ClientSocket) {
  const { roomId } = socket.data;
  if (roomId) void socket.leave(channel(roomId));
  socket.data = {};
}

/** Takes the socket out of its room and records the lost presence. */
function detach(socket: ClientSocket, rooms: RoomManager) {
  const { roomId, playerId, stage } = socket.data;
  leaveRoom(socket);
  if (roomId && playerId) rooms.disconnected(roomId, playerId);
  if (roomId && stage) rooms.stageDisconnected(roomId);
}

/**
 * "Same crew, new game": tells everyone in `roomId` about the new table, so they can follow. A
 * back-room table is only announced to sockets that have the back room.
 */
export function announceNextTable(
  io: IO,
  roomId: string,
  next: NextTable,
  privateTable: boolean,
): void {
  const ids = io.of('/').adapter.rooms.get(channel(roomId));
  const gate = gates.get(io);
  for (const id of ids ?? []) {
    const s = io.sockets.sockets.get(id);
    if (!s || !s.data.playerId || s.data.playerId === next.by) continue;
    if (privateTable && !gate?.hasBackroom(s.request.headers.cookie)) continue;
    s.emit('room:next', next);
  }
}

/** Routes manager events to sockets. Created before the manager so the two can reference each other. */
export function createRoomEvents(
  getIo: () => IO | undefined,
  getRooms: () => RoomManager,
  /** Each change sent: how long it took and each snapshot's size in bytes (for the metrics). */
  onBroadcast?: (seconds: number, sizes: number[]) => void,
): RoomEvents {
  return {
    changed(roomId) {
      const io = getIo();
      const ids = io?.of('/').adapter.rooms.get(channel(roomId));
      if (!io || !ids) return;
      const started = performance.now();
      const sizes: number[] = [];
      const access = roomAccess(gates.get(io), roomId);
      // One gate check per distinct cookie, one view per player, one encode per player.
      const unlockedByCookie = new Map<string | undefined, boolean>();
      const socketsByPlayer = new Map<string, string[]>();
      const lockedOut: ClientSocket[] = [];
      const stages: string[] = [];
      for (const id of ids) {
        const s = io.sockets.sockets.get(id);
        // A table screen's pass is re-checked on every change, like an unlock.
        if (s?.data.stage) {
          if (gates.get(io)?.stageAllowed?.(roomId, s.request.headers.cookie)) stages.push(id);
          else lockedOut.push(s);
          continue;
        }
        const playerId = s?.data.playerId;
        if (!s || !playerId) continue;
        if (access) {
          const cookie = s.request.headers.cookie;
          let unlocked = unlockedByCookie.get(cookie);
          if (unlocked === undefined) {
            unlocked = access(cookie);
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
      const recapDue: { s: ClientSocket; for: string }[] = [];
      for (const [playerId, sockets] of socketsByPlayer) {
        const snapshot = rooms.snapshot(roomId, playerId);
        if (!snapshot) break;
        // Only send what changed for this player. An unchanged view is never re-sent, so the
        // timing of messages can't reveal that someone else acted (a hidden role at night), and
        // nobody re-renders for changes they can't see.
        const key = JSON.stringify({ ...snapshot, serverNow: 0 });
        const due = sockets.filter((id) => {
          const s = io.sockets.sockets.get(id);
          if (!s || lastSent.get(s) === key) return false;
          lastSent.set(s, key);
          return true;
        });
        if (due.length) {
          io.to(due).emit('room:state', snapshot);
          if (onBroadcast) sizes.push(Buffer.byteLength(key));
        }
        // A join, a game starting or ending and a new tone each come with their recap.
        if (snapshot.meta?.recap) {
          const moment = `${recapFor(snapshot)}|${snapshot.meta.tone}`;
          for (const id of due) {
            const s = io.sockets.sockets.get(id)!;
            if (recapMoment.get(s) === moment) continue;
            recapMoment.set(s, moment);
            recapDue.push({ s, for: recapFor(snapshot) });
          }
        }
      }
      // Table screens get the spectator view (what anyone not seated sees), never a player's.
      if (stages.length) {
        const snapshot = rooms.snapshot(roomId, null);
        if (snapshot) {
          const key = JSON.stringify({ ...snapshot, serverNow: 0 });
          const due = stages.filter((id) => {
            const s = io.sockets.sockets.get(id)!;
            if (lastSent.get(s) === key) return false;
            lastSent.set(s, key);
            return true;
          });
          if (due.length) io.to(due).emit('room:state', snapshot);
        }
      }
      // After the change is fully recorded (the stats observer runs once the state is sent).
      if (recapDue.length) queueMicrotask(() => pushRecap(io, roomId, recapDue));
      if (onBroadcast && sizes.length) onBroadcast((performance.now() - started) / 1000, sizes);
      // Their unlock (or admin session) expired or was revoked: this snapshot never reached them,
      // and no later one will.
      const stale = lockedOut.map((s) => ({ s, playerId: s.data.playerId, stage: s.data.stage }));
      for (const { s, stage } of stale) {
        leaveRoom(s);
        s.emit('room:locked', stage ? 'none' : lockReason(gates.get(io), s.request.headers.cookie));
      }
      for (const { playerId, stage } of stale) {
        if (playerId) rooms.disconnected(roomId, playerId);
        if (stage) rooms.stageDisconnected(roomId);
      }
    },
    closed(roomId) {
      const io = getIo();
      if (!io) return;
      for (const id of [...(io.of('/').adapter.rooms.get(channel(roomId)) ?? [])]) {
        const s = io.sockets.sockets.get(id);
        if (!s) continue;
        s.emit('room:closed');
        leaveRoom(s);
      }
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

const recapOff: Ack = {
  ok: false,
  error: { code: 'recap-off', message: 'Night recaps are switched off.' },
};

const notJoined: Ack = { ok: false, error: { code: 'not-joined', message: 'Join a room first.' } };

const lockedOutAck = (reason: LockReason): Ack => ({
  ok: false,
  error: {
    code: 'backroom-locked',
    message: 'This room is in the back room. Unlock it first.',
    reason,
  },
});

const noRoom: Ack = {
  ok: false,
  error: { code: 'no-room', message: 'This room does not exist or has expired.' },
};

const unpaired: Ack = {
  ok: false,
  error: {
    code: 'stage-unpaired',
    message: 'This table screen is not paired with the room. Pair it again with a new code.',
  },
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
    // Uncompressed, to test whether it stops the blips where a connection is cut every few minutes,
    // just after the browser's heartbeat reply.
    perMessageDeflate: false,
  });
  gates.set(io, gate);
  if (opts.recap) recaps.set(io, opts.recap);

  io.on('connection', (socket: ClientSocket) => {
    const bucket = new TokenBucket(limits);
    // Read once, from the handshake: the header travels on the first polling or upgrade request.
    const test = opts.isTestTraffic?.(socket.request.headers) ?? false;
    // The cookie is re-checked on every action, so changing the password locks out players mid-game.
    const allowed = (roomId: string) => {
      const access = roomAccess(gate, roomId);
      return !access || access(socket.request.headers.cookie);
    };
    const isAdmin = () => !!gate.isAdmin?.(socket.request.headers.cookie);
    const locked = () => lockedOutAck(lockReason(gate, socket.request.headers.cookie));

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
        return locked();
      }
      return fn(roomId, playerId);
    };

    /** Leaves whatever room the socket was in before, as a player or a table screen. */
    const leavePrevious = (prev: SocketData, roomId: string) => {
      if (!prev.roomId) return;
      if (prev.roomId !== roomId) void socket.leave(channel(prev.roomId));
      if (prev.playerId) rooms.disconnected(prev.roomId, prev.playerId);
      if (prev.stage) rooms.stageDisconnected(prev.roomId);
    };

    /** A table screen: in on its pass alone, never a player (no seat, no moves, no presence). */
    const joinAsStage = (roomId: string): Ack => {
      if (!gate.stageAllowed?.(roomId, socket.request.headers.cookie)) return unpaired;
      const prev = socket.data;
      if (prev.stage && prev.roomId === roomId) return { ok: true };
      socket.data = { roomId, stage: true };
      void socket.join(channel(roomId));
      leavePrevious(prev, roomId);
      if (!rooms.stageConnected(roomId)) {
        leaveRoom(socket);
        return noRoom;
      }
      return { ok: true };
    };

    const joinAs = (payload: unknown): Ack => {
      const stage = stageJoinPayload.safeParse(payload);
      if (stage.success) return joinAsStage(stage.data.roomId);
      const parsed = joinRoomPayload.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          error: { code: 'bad-request', message: parsed.error.issues[0]!.message },
        };
      }
      const { roomId, token, name } = parsed.data;
      // A playtest looks like a dead link to anyone but an admin.
      if (gate.isPlaytest?.(roomId) && !isAdmin()) return noRoom;
      if (!allowed(roomId)) return locked();
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
        res = rooms.join(roomId, playerId, name, {
          connect: true,
          ...(test && { test }),
          ...(isAdmin() && { admin: true }),
        });
      } catch (err) {
        rollback();
        throw err;
      }
      if (!res.ok) {
        rollback();
        return res;
      }
      leavePrevious(prev, roomId);
      // A seat that reopens on a finished playtest game still sees its award preview.
      const preview = opts.playtestAwards?.(roomId);
      if (preview) socket.emit('room:playtestAwards', preview);
      return res;
    };

    socket.on('room:join', (payload, ack) => guarded(ack, () => joinAs(payload)));

    // A join that came with the connection (`auth`): the room's state follows the connection at
    // once, a round trip sooner than a `room:join` sent after it. Same checks, same answers.
    const auth: unknown = socket.handshake.auth;
    if (auth !== null && typeof auth === 'object' && 'roomId' in auth)
      guarded(
        (res: Ack) => socket.emit('room:joined', res),
        () => joinAs(auth),
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

    socket.on('room:recolor', (color, ack) =>
      guarded(
        ack,
        inRoom((roomId, playerId) => {
          const parsed = playerColor.safeParse(color);
          if (!parsed.success)
            return { ok: false, error: { code: 'bad-color', message: 'Pick one of the colours.' } };
          return rooms.recolor(roomId, playerId, parsed.data);
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

    // ---- Table screen (the host pairs and removes it) ----
    const notOffered: Ack = {
      ok: false,
      error: { code: 'stage-off', message: 'Table screens are not available here.' },
    };

    socket.on('room:stage-code', (ack) => {
      let data: StageCode | null = null;
      guarded(
        typeof ack === 'function'
          ? (res: Ack) => ack(res.ok && data ? { ok: true, data } : (res as AckWith<StageCode>))
          : undefined,
        inRoom((roomId, playerId) => {
          if (!opts.stage) return notOffered;
          const res = opts.stage.mint(roomId, playerId);
          if (!res.ok) return res;
          data = res.data;
          return { ok: true };
        }),
      );
    });

    socket.on('room:stage-remove', (ack) =>
      guarded(
        ack,
        inRoom((roomId, playerId) =>
          opts.stage ? opts.stage.remove(roomId, playerId) : notOffered,
        ),
      ),
    );

    socket.on('game:action', (action, ack) =>
      guarded(
        ack,
        inRoom((roomId, playerId) => {
          const res = rooms.act(roomId, playerId, action);
          if (!res.ok) opts.onRefusal?.(roomId, res.error.code);
          return res;
        }),
      ),
    );

    // ---- Night recaps (members only; the back-room unlock is re-checked like any action) ----
    const recap = opts.recap;

    socket.on('room:recap', (query, ack) => {
      let data: unknown = null;
      guarded(
        typeof ack === 'function'
          ? (res: Ack) => (ack as (r: AckWith<unknown>) => void)(res.ok ? { ok: true, data } : res)
          : undefined,
        inRoom((roomId, playerId) => {
          if (!recap) return recapOff;
          const q = (query !== null && typeof query === 'object' ? query : {}) as {
            scope?: unknown;
            opened?: unknown;
            nightKey?: unknown;
          };
          const res = recap.recap(
            roomId,
            playerId,
            {
              scope: q.scope === 'game' || q.scope === 'hall' ? q.scope : 'night',
              opened: q.opened === true,
              ...(typeof q.nightKey === 'string' && q.nightKey && { nightKey: q.nightKey }),
            },
            { unlocked: gate.hasBackroom(socket.request.headers.cookie) },
          );
          if (!res.ok) return res;
          data = res.data;
          return { ok: true };
        }),
      );
    });

    socket.on('room:wrap', (tz, ack) =>
      guarded(
        ack,
        inRoom((roomId, playerId) => {
          if (!recap) return recapOff;
          const res = recap.wrap(roomId, playerId, tz);
          if (!res.ok) return res;
          // Each device gets the wrapped-up recap first, then opens it.
          const here = [...(io.of('/').adapter.rooms.get(channel(roomId)) ?? [])]
            .map((id) => io.sockets.sockets.get(id))
            .filter((s): s is ClientSocket => !!s);
          pushRecap(
            io,
            roomId,
            here.map((s) => ({ s, for: recapMoment.get(s)?.split('|')[0] ?? '' })),
          );
          io.to(channel(roomId)).emit('room:wrapped', res.data);
          return { ok: true };
        }),
      ),
    );

    socket.on('room:recap-tone', (tone, tz, ack) =>
      guarded(
        ack,
        inRoom((roomId, playerId) =>
          recap ? recap.setTone(roomId, playerId, tone, tz) : recapOff,
        ),
      ),
    );

    socket.on('room:recap-shared', (how, ack) =>
      guarded(
        ack,
        inRoom((roomId, playerId) => (recap ? recap.shared(roomId, playerId, how) : recapOff)),
      ),
    );

    socket.on('disconnect', () => detach(socket, rooms));
  });

  return io;
}
