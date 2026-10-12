import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.ts';
import { buildGames } from '../games/registry.ts';
import { MIGRATIONS } from '../test/helpers.ts';
import { WordListRepo } from '../word-lists.ts';
import { RoomManager, type RoomObservation } from './manager.ts';
import { type PlaytestRecord, SqliteRoomStore } from './store.ts';

const MIN = 60_000;
const PLAYTEST: PlaytestRecord = { bots: [], speed: 'normal', paused: false, createdAt: 0 };

describe('playtest rooms in the room manager', () => {
  let now = 1_000_000;
  let db: ReturnType<typeof openDb>;
  let store: SqliteRoomStore;
  const events = { changed: vi.fn(), kicked: vi.fn(), closed: vi.fn() };
  const observed: RoomObservation[] = [];

  const manager = () => {
    const content = new WordListRepo(db);
    content.seedIfEmpty();
    return new RoomManager({
      store,
      games: buildGames(),
      content,
      events,
      now: () => now,
      logger: { warn: vi.fn(), error: vi.fn() },
      observer: { observe: (o) => observed.push(o) },
    });
  };

  beforeEach(() => {
    now = 1_000_000;
    db = openDb(':memory:', MIGRATIONS);
    store = new SqliteRoomStore(db);
    observed.length = 0;
    events.closed.mockClear();
  });

  it('is a test room only admins may join, and never a live room', () => {
    const rooms = manager();
    const id = rooms.create('codenames', 'p1', { playtest: PLAYTEST });
    expect(rooms.isPlaytest(id)).toBe(true);
    expect(rooms.isTest(id)).toBe(true);
    expect(store.get(id)?.playtest).toEqual(PLAYTEST);
    // Even its opening is reported as test traffic, so the stats skip it.
    expect(observed[0]).toMatchObject({ kind: 'room.created', test: true });

    expect(rooms.join(id, 'p2', 'Mallory', { connect: true })).toMatchObject({
      ok: false,
      error: { code: 'no-room' },
    });
    expect(rooms.join(id, 'p1', 'Ana', { connect: true, admin: true })).toEqual({ ok: true });
    expect(rooms.liveRooms()).toEqual([]);
    expect(rooms.playtestsRunning()).toBe(1);
    expect(rooms.snapshot(id, 'p1')?.meta).toMatchObject({
      recap: false,
      playtest: { speed: 'normal', paused: false, bots: 0 },
    });

    // A normal room is unchanged: listed live, joinable by anyone, no playtest meta.
    const normal = rooms.create('codenames', 'q1');
    expect(rooms.isPlaytest(normal)).toBe(false);
    expect(rooms.join(normal, 'q1', 'Kim', { connect: true })).toEqual({ ok: true });
    expect(rooms.liveRooms().map((r) => r.id)).toEqual([normal]);
    expect(rooms.snapshot(normal, 'q1')?.meta?.playtest).toBeUndefined();
    rooms.close();
  });

  it('leaves test-traffic rooms out of the live view too', () => {
    const rooms = manager();
    const id = rooms.create('codenames', 'p1', { test: true });
    rooms.join(id, 'p1', 'Ana', { connect: true });
    expect(rooms.liveRooms()).toEqual([]);
    expect(rooms.occupiedRooms()).toEqual([{ id, gameId: 'codenames' }]);
    expect(rooms.playtestsRunning()).toBe(0);
    rooms.close();
  });

  it('ends a playtest on demand: sockets told, row deleted, observers cleaned up', () => {
    const rooms = manager();
    const id = rooms.create('codenames', 'p1', { playtest: PLAYTEST });
    rooms.join(id, 'p1', 'Ana', { connect: true, admin: true });
    const normal = rooms.create('codenames', 'q1');
    expect(rooms.removePlaytest(normal)).toBe(false);
    expect(rooms.removePlaytest(id)).toBe(true);
    expect(events.closed).toHaveBeenCalledWith(id);
    expect(store.get(id)).toBeNull();
    expect(rooms.exists(id)).toBeNull();
    expect(observed.at(-1)).toMatchObject({ kind: 'room.swept', roomId: id, test: true });
    expect(rooms.removePlaytest(id)).toBe(false);
    rooms.close();
  });

  it('sweeps a playtest 15 minutes after its last seat left, not before', () => {
    const rooms = manager();
    const idle = 15 * MIN;
    const id = rooms.create('codenames', 'p1', { playtest: PLAYTEST });
    rooms.join(id, 'p1', 'Ana', { connect: true, admin: true });
    const normal = rooms.create('codenames', 'q1');
    now += 60 * MIN;
    // Someone is in it: never idle.
    expect(rooms.sweepPlaytests(idle)).toBe(0);
    rooms.disconnected(id, 'p1');
    now += idle - 1;
    expect(rooms.sweepPlaytests(idle)).toBe(0);
    now += 1;
    expect(rooms.sweepPlaytests(idle)).toBe(1);
    expect(events.closed).toHaveBeenCalledWith(id);
    expect(store.get(id)).toBeNull();
    // Normal rooms are left to the usual (days-long) sweep.
    expect(store.get(normal)).not.toBeNull();
    rooms.close();
  });

  it('sweeps an idle playtest that is not loaded (after a restart) by its last change', () => {
    const first = manager();
    const id = first.create('codenames', 'p1', { playtest: PLAYTEST });
    first.close();
    now += 20 * MIN;
    const rooms = manager();
    expect(rooms.sweepPlaytests(15 * MIN)).toBe(1);
    expect(store.get(id)).toBeNull();
    expect(observed.at(-1)).toMatchObject({ kind: 'room.swept', roomId: id, test: true });
    rooms.close();
  });
});
