import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.ts';
import { buildGames } from '../games/registry.ts';
import { MIGRATIONS } from '../test/helpers.ts';
import { WordListRepo } from '../word-lists.ts';
import { HOST_AWAY_MS, RoomManager, type RoomObservation } from './manager.ts';
import { SqliteRoomStore } from './store.ts';

describe('a table screen in the room manager', () => {
  let now = 1_000_000;
  let db: ReturnType<typeof openDb>;
  let store: SqliteRoomStore;
  const events = { changed: vi.fn(), kicked: vi.fn(), closed: vi.fn() };
  const observed: RoomObservation[] = [];
  const games = buildGames();

  const manager = () => {
    const content = new WordListRepo(db);
    content.seedIfEmpty();
    return new RoomManager({
      store,
      games,
      content,
      events,
      now: () => now,
      logger: { warn: vi.fn(), error: vi.fn() },
      observer: { observe: (o) => observed.push(o) },
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000_000;
    db = openDb(':memory:', MIGRATIONS);
    store = new SqliteRoomStore(db);
    observed.length = 0;
    events.closed.mockClear();
  });

  it('gets the spectator view and counts for nothing a player does', () => {
    const rooms = manager();
    const id = rooms.create('codenames', 'p1');
    rooms.join(id, 'p1', 'Ana', { connect: true });
    rooms.join(id, 'p2', 'Ben', { connect: true });
    observed.length = 0;
    expect(rooms.stageConnected(id)).toBe(true);
    const snap = rooms.snapshot(id, null)!;
    const state = store.get(id)!.state;
    expect(snap).toMatchObject({ you: '', role: 'stage', stage: { present: true } });
    expect(snap.game).toEqual(games.get('codenames')!.view(state, null));
    expect(rooms.snapshot(id, 'p1')).toMatchObject({ stage: { present: true } });
    expect(rooms.snapshot(id, 'p1')!.role).toBeUndefined();
    // No stats event, no member, no live-room visitor.
    expect(observed).toEqual([]);
    expect(rooms.liveRooms()[0]!.players.map((p) => p.name)).toEqual(['Ana', 'Ben']);

    // Everyone leaves: the host's hand-off runs as if nobody were there, and it never hosts.
    rooms.disconnected(id, 'p1');
    rooms.disconnected(id, 'p2');
    expect(rooms.liveRooms()).toEqual([]);
    now += HOST_AWAY_MS;
    vi.advanceTimersByTime(HOST_AWAY_MS);
    expect(rooms.snapshot(id, null)!.hostId).toBe('p1');

    rooms.stageDisconnected(id);
    expect(rooms.snapshot(id, 'p1')).toMatchObject({ stage: { present: false } });
    rooms.stageDisconnected(id);
    expect(rooms.snapshot(id, 'p1')).toMatchObject({ stage: { present: false } });
  });

  it('never keeps a room from being swept, and tells the screen it went', () => {
    const rooms = manager();
    const id = rooms.create('codenames', 'p1');
    rooms.join(id, 'p1', 'Ana', { connect: true });
    rooms.pairStage(id);
    rooms.disconnected(id, 'p1');
    rooms.stageConnected(id);
    now += 8 * 24 * 60 * 60_000;
    expect(rooms.sweep(7 * 24 * 60 * 60_000)).toBe(1);
    expect(events.closed).toHaveBeenCalledWith(id);
    expect(rooms.stagePass(id)).toBeNull();
  });

  it('keeps one pass per room: pairing again replaces it, the host removes it', () => {
    const rooms = manager();
    const id = rooms.create('codenames', 'p1');
    rooms.join(id, 'p1', 'Ana', { connect: true });
    rooms.join(id, 'p2', 'Ben', { connect: true });
    const first = rooms.pairStage(id);
    const second = rooms.pairStage(id);
    expect(second).not.toBe(first);
    expect(rooms.stagePass(id)).toBe(second);
    // Saved with the room, so a restart keeps the screen paired.
    expect(manager().stagePass(id)).toBe(second);
    expect(rooms.removeStage(id, 'p2')).toMatchObject({ ok: false, error: { code: 'not-host' } });
    expect(rooms.removeStage(id, 'p1')).toEqual({ ok: true });
    expect(rooms.stagePass(id)).toBeNull();
    expect(rooms.pairStage('no-such-room-0000')).toBeNull();
  });
});
