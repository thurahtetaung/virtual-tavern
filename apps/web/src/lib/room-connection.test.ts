import type { RoomSnapshot } from '@vt/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in for socket.io's client socket: records what the page sends, fires what it hears. */
class FakeSocket {
  handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  emitted: unknown[][] = [];
  connected = false;
  active = true;
  io = { engine: {} };
  on(event: string, fn: (...a: unknown[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
    return this;
  }
  off(event: string, fn: (...a: unknown[]) => void) {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((f) => f !== fn),
    );
    return this;
  }
  emit(...a: unknown[]) {
    this.emitted.push(a);
    return this;
  }
  timeout() {
    return this;
  }
  connect() {
    this.connected = true;
    this.fire('connect');
  }
  disconnect() {
    this.connected = false;
    this.active = false;
  }
  fire(event: string, ...a: unknown[]) {
    for (const fn of this.handlers.get(event) ?? []) fn(...a);
  }
  sent(event: string) {
    return this.emitted.filter((e) => e[0] === event);
  }
}

const sockets: FakeSocket[] = [];
vi.mock('socket.io-client', () => ({
  io: () => {
    const s = new FakeSocket();
    sockets.push(s);
    return s;
  },
}));

const { RoomConnection } = await import('./room-connection.ts');

const snapshot = (over: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  id: 'room-1',
  gameId: 'codenames',
  hostId: 'p1',
  you: 'p1',
  players: [{ id: 'p1', name: 'Ana', color: 'red', connected: true }],
  hostAwayUntil: null,
  game: { phase: 'lobby', board: [{ word: 'moon' }, { word: 'sun' }], log: ['a'] },
  serverNow: 1,
  stage: { present: false },
  ...over,
});

function joined() {
  const states: RoomSnapshot[] = [];
  const conn = new RoomConnection('room-1', {
    state: (s) => states.push(s),
    status: () => {},
    error: () => {},
    lockReason: () => {},
    catchingUp: () => {},
    wrapped: () => {},
    next: () => {},
    playtestAwards: () => {},
    recap: () => {},
  });
  const socket = sockets.at(-1)!;
  conn.enable(() => ({ token: 't'.repeat(32), name: 'Ana' }));
  socket.connect();
  const join = socket.sent('room:join').at(-1)!;
  (join[2] as (res: unknown) => void)({ ok: true });
  return { conn, socket, states, join };
}

describe('RoomConnection patches', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('joins saying it takes patches, and rebuilds the room from them', () => {
    const { socket, states, join } = joined();
    expect(join[1]).toMatchObject({ roomId: 'room-1', patch: true });
    socket.fire('room:state', { ...snapshot(), seq: 1 });
    expect(states).toHaveLength(1);
    expect(states[0]).not.toHaveProperty('seq');
    socket.fire('room:patch', {
      seq: 2,
      base: 1,
      serverNow: 5,
      ops: [
        [2, ['game', 'log'], 1, 0, ['b']],
        [0, ['game', 'phase'], 'playing'],
      ],
    });
    expect(states).toHaveLength(2);
    expect(states[1]).toEqual(
      snapshot({ serverNow: 5, game: { ...snapshot().game!, phase: 'playing', log: ['a', 'b'] } }),
    );
    // What the patch didn't touch is the very same object, so memoised parts don't re-render.
    expect(states[1]!.players).toBe(states[0]!.players);
    expect((states[1]!.game as { board: unknown }).board).toBe(
      (states[0]!.game as { board: unknown }).board,
    );
    expect(socket.sent('room:resync')).toHaveLength(0);
  });

  it('asks once for the whole room when a patch does not fit, ignoring patches until it comes', () => {
    const { socket, states } = joined();
    socket.fire('room:state', { ...snapshot(), seq: 1 });
    // Update 2 went missing: patch 3 names a base this copy doesn't have.
    socket.fire('room:patch', { seq: 3, base: 2, serverNow: 2, ops: [] });
    socket.fire('room:patch', { seq: 4, base: 3, serverNow: 3, ops: [] });
    expect(socket.sent('room:resync')).toHaveLength(1);
    expect(states).toHaveLength(1);
    socket.fire('room:state', { ...snapshot({ serverNow: 9 }), seq: 5 });
    socket.fire('room:patch', {
      seq: 6,
      base: 5,
      serverNow: 10,
      ops: [[0, ['hostId'], 'p2']],
    });
    expect(states.map((s) => [s.serverNow, s.hostId])).toEqual([
      [1, 'p1'],
      [9, 'p1'],
      [10, 'p2'],
    ]);
    // A patch that fits its base but not the room (a bad path) is a misfit too.
    socket.fire('room:patch', { seq: 7, base: 6, serverNow: 11, ops: [[1, ['nope', 'x']]] });
    expect(socket.sent('room:resync')).toHaveLength(2);
    expect(states).toHaveLength(3);
  });

  it('keeps unchanged parts when the whole room comes again', () => {
    const { socket, states } = joined();
    socket.fire('room:state', { ...snapshot(), seq: 1 });
    socket.fire('room:state', { ...snapshot({ serverNow: 2, hostId: 'p2' }), seq: 2 });
    expect(states[1]!.players).toBe(states[0]!.players);
    expect(states[1]!.hostId).toBe('p2');
  });

  it('works with an older server that only sends whole rooms', () => {
    const { socket, states } = joined();
    socket.fire('room:state', snapshot());
    socket.fire('room:state', snapshot({ serverNow: 2 }));
    expect(states).toHaveLength(2);
    // A patch could never fit a room without a number.
    socket.fire('room:patch', { seq: 1, base: 0, serverNow: 3, ops: [] });
    expect(states).toHaveLength(2);
    expect(socket.sent('room:resync')).toHaveLength(1);
  });
});
