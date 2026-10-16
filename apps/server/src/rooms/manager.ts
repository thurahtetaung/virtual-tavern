import { type AnyGameDefinition, type ContentProvider, createRng, isGameError } from '@vt/game-sdk';
import {
  type Ack,
  PLAYER_COLOR_NAMES,
  type PlayerColor,
  type PlaytestStatus,
  type RecapTone,
  type RoomMeta,
  type RoomSnapshot,
} from '@vt/protocol';
import { randomBytes } from 'node:crypto';
import { freeColor } from './colors.ts';
import { newRoomId, playerIdFromToken, randomSeed } from './ids.ts';
import { nameTaken, uniqueName } from './names.ts';
import type { PlaytestRecord, RoomRecord, RoomStore } from './store.ts';

export const MAX_PLAYERS_PER_ROOM = 30;
/** How long a disconnected host keeps the role before it passes to someone who is online. */
export const HOST_AWAY_MS = 2 * 60_000;
/** Largest game state (as JSON characters) a commit accepts; games must cap their own logs. */
export const MAX_STATE_JSON_LENGTH = 256 * 1024;
/** Longest delay `setTimeout` honours; anything larger fires immediately. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
/** How long to wait before retrying a deadline whose `onDeadline` threw. */
export const DEADLINE_RETRY_MS = 5_000;
/** The one back-off granted to a game whose `onDeadline` did not move its deadline forward. */
export const DEADLINE_STALL_BACKOFF_MS = 1_000;

export interface RoomEvents {
  /** Room state or presence changed; every connected player needs a fresh snapshot. */
  changed(roomId: string): void;
  kicked(roomId: string, playerId: string): void;
  /** The room was deleted on purpose (an ended playtest): everyone in it must go. */
  closed?(roomId: string): void;
}

/** Minimal structured logger (pino's `(obj, msg)` shape, so `app.log` fits). */
export interface RoomLogger {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** What a room-host observation is about. */
export type ObservationKind =
  | 'room.created'
  | 'player.joined'
  | 'player.renamed'
  | 'player.left'
  | 'player.kicked'
  | 'player.connected'
  | 'player.disconnected'
  | 'host.changed'
  | 'action'
  | 'deadline'
  | 'room.swept'
  /** The host wrapped up the night (`props`: tone and time zone). */
  | 'room.wrapped';

/**
 * Something the room host did, for stats. `before`/`after` are the room records around a
 * committed change (equal when nothing was saved, e.g. presence); `by` is the player it was
 * about, if any. Observations are reported after the change is saved and broadcast.
 */
export interface RoomObservation {
  kind: ObservationKind;
  roomId: string;
  gameId: string;
  now: number;
  by: string | null;
  /** The parsed action, for `action`. */
  action?: unknown;
  /** The name used, for joins and renames. */
  name?: string;
  /** Extra facts, for `room.wrapped` and `room.created` (a linked night's key). */
  props?: Record<string, unknown>;
  before: RoomRecord | null;
  after: RoomRecord | null;
  game: AnyGameDefinition | null;
  /** The room is test traffic: stats must record nothing about it. */
  test?: boolean;
}

/** Receives observations. Its failures are logged and never reach players. */
export interface RoomObserver {
  observe(o: RoomObservation): void;
}

/** A room someone is connected to, for the admin live view. */
export interface LiveRoomInfo {
  id: string;
  gameId: string;
  phase: string;
  players: { id: string; name: string; connected: boolean }[];
  hostId: string;
  createdAt: number;
  updatedAt: number;
}

type Observed = Pick<RoomObservation, 'kind' | 'by' | 'action' | 'name' | 'props'>;

interface LiveRoom {
  record: RoomRecord;
  game: AnyGameDefinition;
  /** Open connections per player (a player may have several tabs). */
  connections: Map<string, number>;
  /** When each player's last connection closed (server clock), while they stay away. */
  awaySince: Map<string, number>;
  deadlineTimer?: NodeJS.Timeout;
  hostAwayTimer?: NodeJS.Timeout;
  /** When the pending host hand-off happens (server epoch ms), while `hostAwayTimer` runs. */
  hostAwayDue?: number;
  /** Consecutive deadline firings after which the game's deadline still had not advanced. */
  deadlineStalls: number;
  /** Since when nobody has been connected (server clock); undefined while someone is. */
  emptySince?: number;
}

/** A playtest's bot seats. */
const botIds = (record: RoomRecord) => new Set(record.playtest?.bots.map((b) => b.id));

export class RoomError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const fail = (code: string, message: string): Ack => ({ ok: false, error: { code, message } });
const OK: Ack = { ok: true };

export interface RoomManagerDeps {
  store: RoomStore;
  games: ReadonlyMap<string, AnyGameDefinition>;
  /** Word lists, narrowed per room to the lists tagged for its game. */
  content: { forGame(gameId: string): ContentProvider };
  events: RoomEvents;
  now?: () => number;
  seed?: () => number;
  /** Where timer failures and misbehaving games are reported. Defaults to the console. */
  logger?: RoomLogger;
  /** Stats hook; never allowed to affect play. */
  observer?: RoomObserver | null;
  /** The room's recap settings for the snapshot (recaps on, tone). Default: on, cheeky. */
  recapMeta?: (roomId: string) => { recap: boolean; tone: RecapTone };
}

export interface JoinOptions {
  /** Also count the joiner as connected, in the same change (saves a second snapshot round). */
  connect?: boolean;
  /** The joiner is test traffic: the room is marked as a test room, for good. */
  test?: boolean;
  /** The joiner holds a current admin session: the only people a playtest room lets in. */
  admin?: boolean;
}

/**
 * Game-agnostic room host. Node runs each call to completion, and the store is synchronous,
 * so actions on a room are applied strictly one at a time.
 */
export class RoomManager {
  private readonly rooms = new Map<string, LiveRoom>();
  private readonly deps: Required<RoomManagerDeps>;

  constructor(deps: RoomManagerDeps) {
    this.deps = {
      now: Date.now,
      seed: randomSeed,
      logger: console,
      observer: null,
      recapMeta: () => ({ recap: true, tone: 'cheeky' }),
      ...deps,
    };
  }

  /**
   * Opens a room. `nightKey`: it continues that night ("Same crew, new game"), for the recap.
   * `test`: test traffic opened it, so the stats record nothing about it. `playtest`: an admin
   * playtest (always a test room too), which only admins may join.
   */
  create(
    gameId: string,
    hostId: string,
    opts: { nightKey?: string; test?: boolean; playtest?: PlaytestRecord } = {},
  ): string {
    const game = this.deps.games.get(gameId);
    if (!game) throw new RoomError('unknown-game', 'That game does not exist.');
    const now = this.deps.now();
    let id = newRoomId();
    while (this.deps.store.get(id)) id = newRoomId();
    const record: RoomRecord = {
      id,
      gameId,
      hostId,
      players: [],
      state: game.create(this.ctx(gameId), []),
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...((opts.test || opts.playtest) && { test: true }),
      ...(opts.playtest && { playtest: opts.playtest }),
    };
    this.deps.store.insert(record);
    this.observe(record, null, record, game, {
      kind: 'room.created',
      by: hostId,
      ...(opts.nightKey && { props: { nightKey: opts.nightKey } }),
    });
    return id;
  }

  exists(roomId: string): { gameId: string } | null {
    const room = this.load(roomId);
    return room ? { gameId: room.record.gameId } : null;
  }

  /** Whether test traffic opened or joined the room (its stats are not recorded). */
  isTest(roomId: string): boolean {
    const record = this.rooms.get(roomId)?.record ?? this.deps.store.get(roomId);
    return record?.test === true;
  }

  /** Whether the room is an admin playtest. */
  isPlaytest(roomId: string): boolean {
    const record = this.rooms.get(roomId)?.record ?? this.deps.store.get(roomId);
    return !!record?.playtest;
  }

  join(roomId: string, playerId: string, wanted: string, opts: JoinOptions = {}): Ack {
    const room = this.load(roomId);
    // A playtest room looks like a dead link to anyone but an admin.
    if (!room || (room.record.playtest && !opts.admin))
      return fail('no-room', 'This room does not exist or has expired.');
    if (opts.test && !room.record.test) {
      // Marked before the join, so not even the test player's arrival is recorded.
      this.deps.store.markTest(roomId);
      room.record = { ...room.record, test: true };
    }
    const { record } = room;
    const existing = record.players.find((p) => p.id === playerId);
    // Two "Kim"s would be impossible to tell apart, so a taken name gets a number ("Kim 2").
    const name = uniqueName(
      wanted,
      record.players.filter((p) => p.id !== playerId).map((p) => p.name),
    );
    const capacity = Math.min(MAX_PLAYERS_PER_ROOM, room.game.maxPlayers);
    if (!existing && record.players.length >= capacity) {
      return fail('room-full', 'This room is full.');
    }
    // A newcomer gets a random colour nobody here has (theirs to change with `recolor`).
    const color =
      existing?.color ??
      freeColor(
        record.players.map((p) => p.color),
        (n) => createRng(this.deps.seed()).int(n),
      );
    const players = existing
      ? record.players.map((p) => (p.id === playerId ? { ...p, name } : p))
      : [...record.players, { id: playerId, name, color }];
    // A room whose creator never joined has no host among its members: the first joiner takes over.
    const hostId = players.some((p) => p.id === record.hostId) ? record.hostId : playerId;
    const unchanged = existing?.name === name && hostId === record.hostId;
    if (opts.connect) this.markConnected(room, playerId, hostId);
    if (unchanged) {
      if (opts.connect) this.deps.events.changed(roomId);
      return OK;
    }
    try {
      this.commit(
        room,
        {
          players,
          hostId,
          state: room.game.playerJoined(record.state, { id: playerId, name, color }),
        },
        0,
        existing?.name === name
          ? { kind: 'host.changed', by: hostId }
          : { kind: existing ? 'player.renamed' : 'player.joined', by: playerId, name },
      );
    } catch (err) {
      // The caller backs its socket out of the room, so the presence must go too.
      if (opts.connect) this.unmarkConnected(room, playerId);
      throw err;
    }
    return OK;
  }

  rename(roomId: string, playerId: string, name: string): Ack {
    const room = this.load(roomId);
    if (!room?.record.players.some((p) => p.id === playerId))
      return fail('not-in-room', 'Join first.');
    const others = room.record.players.filter((p) => p.id !== playerId).map((p) => p.name);
    if (nameTaken(name, others)) {
      return fail(
        'name-taken',
        `Someone here is already called ${name.trim()}. Pick another name.`,
      );
    }
    return this.join(roomId, playerId, name);
  }

  /**
   * Changes a player's colour, only while no game is in play (the lobby or the end screen) or the
   * game is between rounds (`canRecolor`); one that someone else here has is refused, as names are.
   */
  recolor(roomId: string, playerId: string, color: PlayerColor): Ack {
    const room = this.load(roomId);
    const me = room?.record.players.find((p) => p.id === playerId);
    if (!room || !me) return fail('not-in-room', 'Join first.');
    if (!this.meta(room).colors)
      return fail('game-running', 'Colours can only be changed between rounds.');
    if (me.color === color) return OK;
    const holder = room.record.players.find((p) => p.id !== playerId && p.color === color);
    if (holder) {
      return fail(
        'color-taken',
        `${holder.name} is already ${PLAYER_COLOR_NAMES[color]}. Pick another colour.`,
      );
    }
    const players = room.record.players.map((p) => (p.id === playerId ? { ...p, color } : p));
    // Not a stats event: the recap and stats name players by id, never by colour.
    this.commit(room, {
      players,
      state: room.game.playerJoined(room.record.state, { id: playerId, name: me.name, color }),
    });
    return OK;
  }

  leave(roomId: string, playerId: string): Ack {
    const room = this.load(roomId);
    if (!room?.record.players.some((p) => p.id === playerId)) return OK;
    this.removePlayer(room, playerId, 'player.left');
    return OK;
  }

  kick(roomId: string, by: string, target: string): Ack {
    const room = this.load(roomId);
    if (!room) return fail('no-room', 'Room not found.');
    if (room.record.hostId !== by) return fail('not-host', 'Only the host can remove players.');
    if (target === by) return fail('bad-target', 'Use Leave to leave the room.');
    if (!room.record.players.some((p) => p.id === target))
      return fail('bad-target', 'No such player.');
    this.removePlayer(room, target, 'player.kicked');
    this.deps.events.kicked(roomId, target);
    return OK;
  }

  makeHost(roomId: string, by: string, target: string): Ack {
    const room = this.load(roomId);
    if (!room) return fail('no-room', 'Room not found.');
    if (room.record.hostId !== by) return fail('not-host', 'Only the host can hand over hosting.');
    if (!room.record.players.some((p) => p.id === target))
      return fail('bad-target', 'No such player.');
    if (botIds(room.record).has(target)) return fail('bad-target', 'A bot can’t host.');
    this.commit(room, { hostId: target }, 0, { kind: 'host.changed', by: target });
    return OK;
  }

  act(roomId: string, playerId: string, action: unknown): Ack {
    const room = this.load(roomId);
    if (!room) return fail('no-room', 'Room not found.');
    if (!room.record.players.some((p) => p.id === playerId))
      return fail('not-in-room', 'Join first.');
    const parsed = room.game.actionSchema.safeParse(action);
    if (!parsed.success) return fail('bad-action', 'That move is not valid.');
    const result: unknown = room.game.reduce(room.record.state, parsed.data, {
      ...this.ctx(room.record.gameId),
      by: playerId,
      isHost: room.record.hostId === playerId,
      connected: (id) => room.connections.has(id) || botIds(room.record).has(id),
    });
    if (isGameError(result)) return fail(result.code, result.message);
    try {
      this.commit(room, { state: result }, 0, {
        kind: 'action',
        by: playerId,
        action: parsed.data,
      });
    } catch (err) {
      if (err instanceof RoomError && err.code === 'state-too-large')
        return fail(err.code, err.message);
      throw err;
    }
    return OK;
  }

  connected(roomId: string, playerId: string): void {
    const room = this.load(roomId);
    if (!room) return;
    this.markConnected(room, playerId, room.record.hostId);
    this.deps.events.changed(roomId);
  }

  disconnected(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.unmarkConnected(room, playerId);
    this.deps.events.changed(roomId);
  }

  snapshot(roomId: string, viewer: string): RoomSnapshot | null {
    const room = this.load(roomId);
    if (!room) return null;
    const { record } = room;
    const seated = record.players.some((p) => p.id === viewer);
    const bots = botIds(record);
    return {
      id: record.id,
      gameId: record.gameId,
      hostId: record.hostId,
      you: viewer,
      players: record.players.map((p) => {
        // A playtest bot is always there.
        if (bots.has(p.id)) return { ...p, connected: true, bot: true as const };
        const connected = room.connections.has(p.id);
        const awaySince = connected ? undefined : room.awaySince.get(p.id);
        return awaySince === undefined ? { ...p, connected } : { ...p, connected, awaySince };
      }),
      hostAwayUntil:
        room.hostAwayTimer && !room.connections.has(record.hostId)
          ? (room.hostAwayDue ?? null)
          : null,
      game: room.game.view(record.state, seated ? viewer : null),
      serverNow: this.deps.now(),
      meta: this.meta(room),
    };
  }

  /** The coarse phase every game reports for stats, and the room's recap settings. */
  private meta(room: LiveRoom): RoomMeta {
    const state = room.record.state as { phase?: unknown; gamesPlayed?: unknown } | null;
    const phase = state?.phase;
    const gameNo = state?.gamesPlayed;
    const { playtest } = room.record;
    const coarse = phase === 'playing' || phase === 'over' ? phase : 'lobby';
    return {
      phase: coarse,
      gameNo: typeof gameNo === 'number' ? gameNo : 0,
      colors: coarse !== 'playing' || room.game.canRecolor?.(room.record.state) === true,
      ...this.deps.recapMeta(room.record.id),
      // A playtest records no night, so it has no recap to show.
      ...(playtest && {
        recap: false,
        playtest: {
          speed: playtest.speed,
          paused: playtest.paused,
          bots: playtest.bots.length,
          ...(playtest.stuck && { stuck: true as const }),
        },
      }),
    };
  }

  /** A playtest's settings and seats, for the admin (null if it is not a live playtest). */
  playtestStatus(roomId: string): PlaytestStatus | null {
    const room = this.load(roomId);
    if (!room?.record.playtest) return null;
    const meta = this.meta(room);
    return {
      roomId,
      gameId: room.record.gameId,
      phase: meta.phase,
      playtest: meta.playtest!,
      players: room.record.players.map((p) =>
        botIds(room.record).has(p.id)
          ? { ...p, connected: true, bot: true as const }
          : { ...p, connected: room.connections.has(p.id) },
      ),
    };
  }

  /**
   * Changes a playtest's bot settings (speed, pause; `stuck` when the bot runner paused it).
   * Presence-style: the room's version doesn't move, but every seat hears of it.
   */
  setPlaytest(
    roomId: string,
    patch: Partial<Pick<PlaytestRecord, 'speed' | 'paused' | 'stuck'>>,
  ): boolean {
    const room = this.load(roomId);
    const current = room?.record.playtest;
    if (!room || !current) return false;
    const playtest = { ...current, ...patch };
    // Pausing or resuming by hand clears the "stuck" note.
    if (patch.paused !== undefined && patch.stuck === undefined) delete playtest.stuck;
    this.savePlaytest(room, playtest);
    this.deps.events.changed(roomId);
    return true;
  }

  /** Adds a bot seat to a playtest, in the lobby only. Its id comes from a token nobody keeps. */
  addBot(roomId: string, wanted: string): Ack {
    const room = this.load(roomId);
    if (!room?.record.playtest) return fail('no-room', 'This playtest has ended.');
    if (!room.game.bot) return fail('no-bots', `${room.game.name} has no bots yet.`);
    if (this.meta(room).phase !== 'lobby')
      return fail('game-running', 'Add bots in the lobby, between games.');
    const id = playerIdFromToken(randomBytes(32).toString('base64url'));
    const name = uniqueName(
      wanted,
      room.record.players.map((p) => p.name),
    );
    const playtest = room.record.playtest;
    this.savePlaytest(room, { ...playtest, bots: [...playtest.bots, { id, name }] });
    const res = this.join(roomId, id, name, { admin: true });
    if (!res.ok) this.savePlaytest(room, playtest);
    return res;
  }

  /** Takes a bot seat out of a playtest (as if it left). */
  removeBot(roomId: string, botId: string): Ack {
    const room = this.load(roomId);
    if (!room?.record.playtest) return fail('no-room', 'This playtest has ended.');
    if (!botIds(room.record).has(botId)) return fail('bad-target', 'No such bot.');
    return this.leave(roomId, botId);
  }

  /**
   * What the bot runner needs to know about a playtest: its bots and settings, whether a human
   * seat is there, and the version its moves are based on. Null when it isn't a live playtest.
   */
  botTable(roomId: string): {
    game: AnyGameDefinition;
    bots: string[];
    paused: boolean;
    speed: PlaytestRecord['speed'];
    humans: number;
    version: number;
  } | null {
    const room = this.rooms.get(roomId);
    const playtest = room?.record.playtest;
    if (!room || !playtest) return null;
    return {
      game: room.game,
      bots: playtest.bots.map((b) => b.id),
      paused: playtest.paused,
      speed: playtest.speed,
      humans: room.connections.size,
      version: room.record.version,
    };
  }

  /** A bot seat's own view (and nothing else), as any player of that seat would see it. */
  botView(roomId: string, botId: string): { view: unknown; version: number } | null {
    const room = this.rooms.get(roomId);
    if (!room || !botIds(room.record).has(botId)) return null;
    return { view: room.game.view(room.record.state, botId), version: room.record.version };
  }

  private savePlaytest(room: LiveRoom, playtest: PlaytestRecord) {
    this.deps.store.setPlaytest(room.record.id, playtest);
    room.record = { ...room.record, playtest };
  }

  /** Ends a playtest at once: everyone in it is told, and the room and its timers are gone. */
  removePlaytest(roomId: string): boolean {
    const room = this.load(roomId);
    if (!room?.record.playtest) return false;
    this.drop(roomId, room);
    return true;
  }

  /**
   * Deletes playtests nobody has been connected to for `maxIdleMs` (loaded ones by when the
   * last person left, the rest by their last change); returns how many were removed.
   */
  sweepPlaytests(maxIdleMs: number): number {
    const before = this.deps.now() - maxIdleMs;
    let removed = 0;
    for (const [id, room] of [...this.rooms]) {
      if (!room.record.playtest || room.emptySince === undefined || room.emptySince > before)
        continue;
      this.drop(id, room);
      removed += 1;
    }
    for (const id of this.deps.store.deleteIdlePlaytests(before, [...this.rooms.keys()])) {
      this.deps.events.closed?.(id);
      this.notifySwept(id, null, null);
      removed += 1;
    }
    return removed;
  }

  /** Playtests someone is connected to (they are never counted as rooms anywhere else). */
  playtestsRunning(): number {
    let n = 0;
    for (const room of this.rooms.values())
      if (room.record.playtest && room.connections.size > 0) n += 1;
    return n;
  }

  /** Deletes a loaded room for good, telling its sockets first. */
  private drop(roomId: string, room: LiveRoom) {
    this.deps.events.closed?.(roomId);
    this.unload(roomId);
    this.deps.store.delete(roomId);
    this.notifySwept(roomId, room.record, room.game);
  }

  /** Lets the observers clean up after a room that is gone (as a sweep does). */
  private notifySwept(roomId: string, record: RoomRecord | null, game: AnyGameDefinition | null) {
    this.notify({
      test: true,
      kind: 'room.swept',
      roomId,
      gameId: record?.gameId ?? '',
      now: this.deps.now(),
      by: null,
      before: record,
      after: null,
      game,
    });
  }

  /** Who is in the room and who hosts it, for the recap (null if the room is gone). */
  members(roomId: string): {
    gameId: string;
    hostId: string;
    players: { id: string; name: string }[];
    phase: RoomMeta['phase'];
  } | null {
    const room = this.load(roomId);
    if (!room) return null;
    return {
      gameId: room.record.gameId,
      hostId: room.record.hostId,
      players: room.record.players,
      phase: this.meta(room).phase,
    };
  }

  /**
   * Host only: wraps up the night. Nothing in the room changes; the stats observer records it
   * (with `props`) and the recap opens everywhere.
   */
  wrap(roomId: string, by: string, props: Record<string, unknown>): Ack {
    const room = this.load(roomId);
    if (!room) return fail('no-room', 'Room not found.');
    if (!room.record.players.some((p) => p.id === by)) return fail('not-in-room', 'Join first.');
    if (room.record.hostId !== by) return fail('not-host', 'Only the host can wrap up the night.');
    if (this.meta(room).phase === 'playing')
      return fail('game-running', 'Finish this game first, then wrap up the night.');
    this.observe(room.record, room.record, room.record, room.game, {
      kind: 'room.wrapped',
      by,
      props,
    });
    return OK;
  }

  /** Every loaded room someone is connected to, test rooms included (for re-checking gates). */
  occupiedRooms(): { id: string; gameId: string }[] {
    return [...this.rooms.values()]
      .filter((r) => r.connections.size > 0)
      .map((r) => ({ id: r.record.id, gameId: r.record.gameId }));
  }

  /** Rooms with at least one connected player, for the admin live view (never test rooms). */
  liveRooms(): LiveRoomInfo[] {
    const out: LiveRoomInfo[] = [];
    for (const room of this.rooms.values()) {
      if (room.connections.size === 0 || room.record.test) continue;
      const { record } = room;
      const phase = (record.state as { phase?: unknown } | null)?.phase;
      out.push({
        id: record.id,
        gameId: record.gameId,
        phase: typeof phase === 'string' ? phase : 'lobby',
        players: record.players.map((p) => ({ ...p, connected: room.connections.has(p.id) })),
        hostId: record.hostId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }
    return out;
  }

  /** Deletes idle rooms nobody is connected to; returns how many were removed. */
  sweep(maxIdleMs: number): number {
    // A room with someone in it right now is never idle, however long since its last change.
    const occupied = [...this.rooms].filter(([, r]) => r.connections.size > 0).map(([id]) => id);
    const deleted = this.deps.store.deleteIdle(this.deps.now() - maxIdleMs, occupied);
    for (const { id, test } of deleted) {
      const live = this.rooms.get(id);
      this.unload(id);
      const record = live?.record ?? null;
      this.notify({
        ...((test || record?.test) && { test: true }),
        kind: 'room.swept',
        roomId: id,
        gameId: record?.gameId ?? '',
        now: this.deps.now(),
        by: null,
        before: record,
        after: null,
        game: live?.game ?? null,
      });
    }
    for (const [id, room] of this.rooms) {
      if (room.connections.size === 0 && !room.deadlineTimer) this.unload(id);
    }
    return deleted.length;
  }

  close(): void {
    for (const id of [...this.rooms.keys()]) this.unload(id);
  }

  /** A game only ever sees the word lists tagged for it. */
  private ctx(gameId: string) {
    return {
      now: this.deps.now(),
      rng: createRng(this.deps.seed()),
      content: this.deps.content.forGame(gameId),
    };
  }

  private load(roomId: string): LiveRoom | null {
    const live = this.rooms.get(roomId);
    if (live) return live;
    const record = this.deps.store.get(roomId);
    const game = record && this.deps.games.get(record.gameId);
    if (!record || !game) return null;
    const room: LiveRoom = {
      record,
      game,
      connections: new Map(),
      awaySince: new Map(),
      deadlineStalls: 0,
      emptySince: this.deps.now(),
    };
    this.rooms.set(roomId, room);
    // After a restart, timers resume (or fire at once if they expired while we were down).
    this.armDeadline(room);
    // Nobody is connected yet, the host included: start the hand-off clock right away.
    this.armHostAway(room);
    return room;
  }

  private unload(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    clearTimeout(room.deadlineTimer);
    clearTimeout(room.hostAwayTimer);
    this.rooms.delete(roomId);
  }

  /**
   * Persists a change and tells everyone. `rearm` is the minimum delay before the game's next
   * deadline may fire, or null to leave the deadline timer off until the next change.
   */
  private commit(
    room: LiveRoom,
    patch: Partial<Pick<RoomRecord, 'players' | 'state' | 'hostId'>>,
    rearm: number | null = 0,
    observed?: Observed,
  ) {
    const before = room.record;
    const next: RoomRecord = {
      ...room.record,
      ...patch,
      version: room.record.version + 1,
      updatedAt: this.deps.now(),
    };
    if ('state' in patch) {
      const size = JSON.stringify(next.state).length;
      if (size > MAX_STATE_JSON_LENGTH) {
        this.deps.logger.error(
          { roomId: next.id, gameId: next.gameId, size, max: MAX_STATE_JSON_LENGTH },
          'game state too large; change rejected',
        );
        throw new RoomError('state-too-large', 'The game state grew too large to save.');
      }
    }
    if (!this.deps.store.update(next)) {
      // Another writer got there first: drop our cached copy so the next call reloads.
      this.unload(room.record.id);
      throw new RoomError('conflict', 'The room changed elsewhere. Please retry.');
    }
    room.record = next;
    if ('state' in patch) {
      if (rearm === null) this.clearDeadline(room);
      else this.armDeadline(room, rearm);
    }
    this.deps.events.changed(next.id);
    if (observed) this.observe(next, before, next, room.game, observed);
  }

  /** Reports to the stats observer; whatever it does, play carries on. */
  private observe(
    record: RoomRecord,
    before: RoomRecord | null,
    after: RoomRecord | null,
    game: AnyGameDefinition,
    observed: Observed,
  ) {
    this.notify({
      ...observed,
      ...(record.test && { test: true }),
      roomId: record.id,
      gameId: record.gameId,
      now: this.deps.now(),
      before,
      after,
      game,
    });
  }

  private notify(o: RoomObservation) {
    const { observer } = this.deps;
    if (!observer) return;
    try {
      observer.observe(o);
    } catch (err) {
      this.deps.logger.error({ roomId: o.roomId, kind: o.kind, err }, 'stats observer failed');
    }
  }

  /** Arriving or leaving counts as activity, so the idle clock runs from the last visit. */
  private touch(room: LiveRoom) {
    const now = this.deps.now();
    room.record = { ...room.record, updatedAt: now };
    this.deps.store.touch(room.record.id, now);
  }

  private markConnected(room: LiveRoom, playerId: string, hostId: string) {
    room.connections.set(playerId, (room.connections.get(playerId) ?? 0) + 1);
    room.awaySince.delete(playerId);
    room.emptySince = undefined;
    this.touch(room);
    this.observe(room.record, room.record, room.record, room.game, {
      kind: 'player.connected',
      by: playerId,
    });
    if (playerId === hostId) {
      clearTimeout(room.hostAwayTimer);
      room.hostAwayTimer = undefined;
      room.hostAwayDue = undefined;
    } else if (!room.connections.has(hostId) && !room.hostAwayTimer) {
      // The host is away and no hand-off is pending (it already fired with nobody online).
      this.armHostAway(room);
    }
  }

  private unmarkConnected(room: LiveRoom, playerId: string) {
    const left = (room.connections.get(playerId) ?? 1) - 1;
    if (left > 0) room.connections.set(playerId, left);
    else {
      room.connections.delete(playerId);
      room.awaySince.set(playerId, this.deps.now());
      if (room.connections.size === 0) room.emptySince = this.deps.now();
    }
    this.touch(room);
    if (left <= 0 && playerId === room.record.hostId) this.armHostAway(room);
    this.observe(room.record, room.record, room.record, room.game, {
      kind: 'player.disconnected',
      by: playerId,
    });
  }

  private removePlayer(room: LiveRoom, playerId: string, kind: 'player.left' | 'player.kicked') {
    const players = room.record.players.filter((p) => p.id !== playerId);
    const bots = botIds(room.record);
    let hostId = room.record.hostId;
    if (hostId === playerId) {
      // A playtest bot never hosts: the role goes to a human seat.
      hostId =
        (players.find((p) => room.connections.has(p.id)) ?? players.find((p) => !bots.has(p.id)))
          ?.id ?? hostId;
    }
    const playtest = room.record.playtest;
    if (playtest && bots.has(playerId))
      this.savePlaytest(room, {
        ...playtest,
        bots: playtest.bots.filter((b) => b.id !== playerId),
      });
    room.connections.delete(playerId);
    room.awaySince.delete(playerId);
    if (room.connections.size === 0) room.emptySince ??= this.deps.now();
    this.commit(
      room,
      {
        players,
        hostId,
        state: room.game.playerLeft(room.record.state, playerId, this.deps.now()),
      },
      0,
      { kind, by: playerId },
    );
  }

  private clearDeadline(room: LiveRoom) {
    clearTimeout(room.deadlineTimer);
    room.deadlineTimer = undefined;
  }

  private armDeadline(room: LiveRoom, minDelay = 0) {
    this.clearDeadline(room);
    const due = room.game.nextDeadline?.(room.record.state) ?? null;
    if (due === null) return;
    if (minDelay === 0) room.deadlineStalls = 0;
    const delay = Math.min(Math.max(minDelay, due - this.deps.now(), 0), MAX_TIMEOUT_MS);
    room.deadlineTimer = setTimeout(() => {
      room.deadlineTimer = undefined;
      this.fireDeadline(room, due);
    }, delay);
  }

  private fireDeadline(room: LiveRoom, due: number) {
    const now = this.deps.now();
    // A deadline further out than one timer can wait for: keep waiting.
    if (due > now) {
      this.armDeadline(room);
      return;
    }
    const log = { roomId: room.record.id, gameId: room.record.gameId };
    let state: unknown;
    try {
      state = room.game.onDeadline!(room.record.state, now);
    } catch (err) {
      this.deps.logger.error({ ...log, err }, 'onDeadline failed; retrying later');
      this.armDeadline(room, DEADLINE_RETRY_MS);
      return;
    }
    // A game whose deadline does not move forward would re-fire at once, forever.
    const following = room.game.nextDeadline?.(state) ?? null;
    let rearm: number | null = 0;
    if (following !== null && following <= now) {
      room.deadlineStalls += 1;
      if (room.deadlineStalls > 1) {
        this.deps.logger.error({ ...log, due: following }, 'deadline still stuck; timer stopped');
        rearm = null;
      } else {
        this.deps.logger.warn({ ...log, due: following }, 'deadline did not advance; backing off');
        rearm = DEADLINE_STALL_BACKOFF_MS;
      }
    }
    try {
      if (state !== room.record.state)
        this.commit(room, { state }, rearm, { kind: 'deadline', by: null });
      else if (rearm === null) this.clearDeadline(room);
      else this.armDeadline(room, rearm);
    } catch (err) {
      // A conflict means the room was unloaded; the timer is re-armed on the next load.
      if (err instanceof RoomError && err.code === 'conflict') return;
      // An oversized state (already logged) will not shrink by retrying; wait for a player.
      if (err instanceof RoomError && err.code === 'state-too-large') return;
      this.deps.logger.error({ ...log, err }, 'deadline commit failed; retrying later');
      if (this.rooms.get(room.record.id) === room) this.armDeadline(room, DEADLINE_RETRY_MS);
    }
  }

  private armHostAway(room: LiveRoom) {
    clearTimeout(room.hostAwayTimer);
    room.hostAwayDue = this.deps.now() + HOST_AWAY_MS;
    room.hostAwayTimer = setTimeout(() => {
      room.hostAwayTimer = undefined;
      room.hostAwayDue = undefined;
      if (room.connections.has(room.record.hostId)) return;
      const next = room.record.players.find((p) => room.connections.has(p.id));
      if (!next) return; // Nobody online to take over; `connected()` restarts the clock.
      try {
        this.commit(room, { hostId: next.id }, 0, { kind: 'host.changed', by: next.id });
      } catch (err) {
        if (!(err instanceof RoomError && err.code === 'conflict')) {
          this.deps.logger.error({ roomId: room.record.id, err }, 'host hand-off failed');
        }
      }
    }, HOST_AWAY_MS);
  }
}
