import { type AnyGameDefinition, type ContentProvider, createRng, isGameError } from '@vt/game-sdk';
import type { Ack, RoomSnapshot } from '@vt/protocol';
import { newRoomId, randomSeed } from './ids.ts';
import type { RoomRecord, RoomStore } from './store.ts';

export const MAX_PLAYERS_PER_ROOM = 30;
/** How long a disconnected host keeps the role before it passes to someone who is online. */
export const HOST_AWAY_MS = 2 * 60_000;

export interface RoomEvents {
  /** Room state or presence changed; every connected player needs a fresh snapshot. */
  changed(roomId: string): void;
  kicked(roomId: string, playerId: string): void;
}

interface LiveRoom {
  record: RoomRecord;
  game: AnyGameDefinition;
  /** Open connections per player (a player may have several tabs). */
  connections: Map<string, number>;
  deadlineTimer?: NodeJS.Timeout;
  hostAwayTimer?: NodeJS.Timeout;
}

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
  content: ContentProvider;
  events: RoomEvents;
  now?: () => number;
  seed?: () => number;
}

/**
 * Game-agnostic room host. Node runs each call to completion, and the store is synchronous,
 * so actions on a room are applied strictly one at a time.
 */
export class RoomManager {
  private readonly rooms = new Map<string, LiveRoom>();
  private readonly deps: Required<RoomManagerDeps>;

  constructor(deps: RoomManagerDeps) {
    this.deps = { now: Date.now, seed: randomSeed, ...deps };
  }

  create(gameId: string, hostId: string): string {
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
      state: game.create(this.ctx(), []),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.deps.store.insert(record);
    return id;
  }

  exists(roomId: string): { gameId: string } | null {
    const room = this.load(roomId);
    return room ? { gameId: room.record.gameId } : null;
  }

  join(roomId: string, playerId: string, name: string): Ack {
    const room = this.load(roomId);
    if (!room) return fail('no-room', 'This room does not exist or has expired.');
    const { record } = room;
    const existing = record.players.find((p) => p.id === playerId);
    if (!existing && record.players.length >= MAX_PLAYERS_PER_ROOM) {
      return fail('room-full', 'This room is full.');
    }
    if (existing?.name === name) return OK;
    const players = existing
      ? record.players.map((p) => (p.id === playerId ? { ...p, name } : p))
      : [...record.players, { id: playerId, name }];
    this.commit(room, {
      players,
      state: room.game.playerJoined(record.state, { id: playerId, name }),
    });
    return OK;
  }

  rename(roomId: string, playerId: string, name: string): Ack {
    const room = this.load(roomId);
    if (!room?.record.players.some((p) => p.id === playerId))
      return fail('not-in-room', 'Join first.');
    return this.join(roomId, playerId, name);
  }

  leave(roomId: string, playerId: string): Ack {
    const room = this.load(roomId);
    if (!room?.record.players.some((p) => p.id === playerId)) return OK;
    this.removePlayer(room, playerId);
    return OK;
  }

  kick(roomId: string, by: string, target: string): Ack {
    const room = this.load(roomId);
    if (!room) return fail('no-room', 'Room not found.');
    if (room.record.hostId !== by) return fail('not-host', 'Only the host can remove players.');
    if (target === by) return fail('bad-target', 'Use Leave to leave the room.');
    if (!room.record.players.some((p) => p.id === target))
      return fail('bad-target', 'No such player.');
    this.removePlayer(room, target);
    this.deps.events.kicked(roomId, target);
    return OK;
  }

  makeHost(roomId: string, by: string, target: string): Ack {
    const room = this.load(roomId);
    if (!room) return fail('no-room', 'Room not found.');
    if (room.record.hostId !== by) return fail('not-host', 'Only the host can hand over hosting.');
    if (!room.record.players.some((p) => p.id === target))
      return fail('bad-target', 'No such player.');
    this.commit(room, { hostId: target });
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
      ...this.ctx(),
      by: playerId,
      isHost: room.record.hostId === playerId,
    });
    if (isGameError(result)) return fail(result.code, result.message);
    this.commit(room, { state: result });
    return OK;
  }

  connected(roomId: string, playerId: string): void {
    const room = this.load(roomId);
    if (!room) return;
    room.connections.set(playerId, (room.connections.get(playerId) ?? 0) + 1);
    if (playerId === room.record.hostId) {
      clearTimeout(room.hostAwayTimer);
      room.hostAwayTimer = undefined;
    }
    this.deps.events.changed(roomId);
  }

  disconnected(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const left = (room.connections.get(playerId) ?? 1) - 1;
    if (left > 0) room.connections.set(playerId, left);
    else room.connections.delete(playerId);
    if (left <= 0 && playerId === room.record.hostId) this.armHostAway(room);
    this.deps.events.changed(roomId);
  }

  snapshot(roomId: string, viewer: string): RoomSnapshot | null {
    const room = this.load(roomId);
    if (!room) return null;
    const { record } = room;
    const seated = record.players.some((p) => p.id === viewer);
    return {
      id: record.id,
      gameId: record.gameId,
      hostId: record.hostId,
      you: viewer,
      players: record.players.map((p) => ({ ...p, connected: room.connections.has(p.id) })),
      game: room.game.view(record.state, seated ? viewer : null),
      serverNow: this.deps.now(),
    };
  }

  /** Deletes idle rooms nobody is connected to; returns how many were removed. */
  sweep(maxIdleMs: number): number {
    const ids = this.deps.store.deleteIdle(this.deps.now() - maxIdleMs);
    for (const id of ids) this.unload(id);
    for (const [id, room] of this.rooms) {
      if (room.connections.size === 0 && !room.deadlineTimer) this.unload(id);
    }
    return ids.length;
  }

  close(): void {
    for (const id of [...this.rooms.keys()]) this.unload(id);
  }

  private ctx() {
    return { now: this.deps.now(), rng: createRng(this.deps.seed()), content: this.deps.content };
  }

  private load(roomId: string): LiveRoom | null {
    const live = this.rooms.get(roomId);
    if (live) return live;
    const record = this.deps.store.get(roomId);
    const game = record && this.deps.games.get(record.gameId);
    if (!record || !game) return null;
    const room: LiveRoom = { record, game, connections: new Map() };
    this.rooms.set(roomId, room);
    // After a restart, timers resume (or fire at once if they expired while we were down).
    this.armDeadline(room);
    return room;
  }

  private unload(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    clearTimeout(room.deadlineTimer);
    clearTimeout(room.hostAwayTimer);
    this.rooms.delete(roomId);
  }

  private commit(room: LiveRoom, patch: Partial<Pick<RoomRecord, 'players' | 'state' | 'hostId'>>) {
    const next: RoomRecord = {
      ...room.record,
      ...patch,
      version: room.record.version + 1,
      updatedAt: this.deps.now(),
    };
    if (!this.deps.store.update(next)) {
      // Another writer got there first: drop our cached copy so the next call reloads.
      this.unload(room.record.id);
      throw new RoomError('conflict', 'The room changed elsewhere. Please retry.');
    }
    room.record = next;
    if ('state' in patch) this.armDeadline(room);
    this.deps.events.changed(next.id);
  }

  private removePlayer(room: LiveRoom, playerId: string) {
    const players = room.record.players.filter((p) => p.id !== playerId);
    let hostId = room.record.hostId;
    if (hostId === playerId) {
      hostId = (players.find((p) => room.connections.has(p.id)) ?? players[0])?.id ?? hostId;
    }
    room.connections.delete(playerId);
    this.commit(room, {
      players,
      hostId,
      state: room.game.playerLeft(room.record.state, playerId),
    });
  }

  private armDeadline(room: LiveRoom) {
    clearTimeout(room.deadlineTimer);
    room.deadlineTimer = undefined;
    const due = room.game.nextDeadline?.(room.record.state) ?? null;
    if (due === null) return;
    room.deadlineTimer = setTimeout(
      () => {
        room.deadlineTimer = undefined;
        try {
          const state: unknown = room.game.onDeadline!(room.record.state, this.deps.now());
          if (state !== room.record.state) this.commit(room, { state });
          else this.armDeadline(room);
        } catch {
          // Conflict: the room was unloaded and the timer is re-armed on next load.
        }
      },
      Math.max(0, due - this.deps.now()),
    );
  }

  private armHostAway(room: LiveRoom) {
    clearTimeout(room.hostAwayTimer);
    room.hostAwayTimer = setTimeout(() => {
      room.hostAwayTimer = undefined;
      if (room.connections.has(room.record.hostId)) return;
      const next = room.record.players.find((p) => room.connections.has(p.id));
      try {
        if (next) this.commit(room, { hostId: next.id });
      } catch {
        // Conflict: nothing to do; the next load sees the latest host.
      }
    }, HOST_AWAY_MS);
  }
}
