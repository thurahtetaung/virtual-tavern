import type { CodenamesView } from '@vt/game-codenames/logic';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../db/index.ts';
import { games } from '../games/registry.ts';
import { MIGRATIONS } from '../test/helpers.ts';
import { WordListRepo } from '../word-lists.ts';
import { HOST_AWAY_MS, RoomManager } from './manager.ts';
import { SqliteRoomStore } from './store.ts';

describe('RoomManager', () => {
  let now = 1_000_000;
  let rooms: RoomManager;
  const changed = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const db = openDb(':memory:', MIGRATIONS);
    const content = new WordListRepo(db);
    content.seedIfEmpty();
    rooms = new RoomManager({
      store: new SqliteRoomStore(db),
      games,
      content,
      events: { changed, kicked: vi.fn() },
      now: () => now,
    });
  });
  afterEach(() => {
    rooms.close();
    vi.useRealTimers();
  });

  function seatedGame(settings: object = {}) {
    const id = rooms.create('codenames', 'h');
    for (const p of ['h', 'a', 'b', 'c']) rooms.join(id, p, p.toUpperCase());
    rooms.act(id, 'h', { type: 'join-team', team: 'red', role: 'spymaster' });
    rooms.act(id, 'a', { type: 'join-team', team: 'red', role: 'operative' });
    rooms.act(id, 'b', { type: 'join-team', team: 'blue', role: 'spymaster' });
    rooms.act(id, 'c', { type: 'join-team', team: 'blue', role: 'operative' });
    rooms.act(id, 'h', { type: 'update-settings', ...settings });
    return id;
  }
  const game = (id: string) => rooms.snapshot(id, 'h')!.game as CodenamesView;

  it('fires turn timers on the server', () => {
    const id = seatedGame({ clueSeconds: 30, timerMode: 'strict' });
    expect(rooms.act(id, 'h', { type: 'start' })).toEqual({ ok: true });
    const first = game(id).turn!.team;
    now += 30_000;
    vi.advanceTimersByTime(30_000);
    expect(game(id).turn!.team).not.toBe(first);
    expect(game(id).log.at(-1)).toMatchObject({ type: 'end-turn', reason: 'timeout' });
  });

  it('never ends a turn on a soft timer', () => {
    const id = seatedGame({ clueSeconds: 30 });
    rooms.act(id, 'h', { type: 'start' });
    const first = game(id).turn!.team;
    now += 120_000;
    vi.advanceTimersByTime(120_000);
    expect(game(id).turn).toMatchObject({ team: first, stage: 'clue' });
  });

  it('passes hosting to an online player when the host stays away', () => {
    const id = seatedGame();
    for (const p of ['h', 'a', 'b']) rooms.connected(id, p);
    rooms.disconnected(id, 'h');
    vi.advanceTimersByTime(HOST_AWAY_MS - 1);
    expect(rooms.snapshot(id, 'a')!.hostId).toBe('h');
    vi.advanceTimersByTime(1);
    expect(rooms.snapshot(id, 'a')!.hostId).toBe('a');
  });

  it('keeps the host if they come back in time', () => {
    const id = seatedGame();
    rooms.connected(id, 'h');
    rooms.connected(id, 'a');
    rooms.disconnected(id, 'h');
    rooms.connected(id, 'h');
    vi.advanceTimersByTime(HOST_AWAY_MS);
    expect(rooms.snapshot(id, 'a')!.hostId).toBe('h');
  });

  it('counts multiple tabs as one presence', () => {
    const id = seatedGame();
    rooms.connected(id, 'a');
    rooms.connected(id, 'a');
    rooms.disconnected(id, 'a');
    expect(rooms.snapshot(id, 'h')!.players.find((p) => p.id === 'a')!.connected).toBe(true);
  });

  it('shows non-members the observer view', () => {
    const id = seatedGame();
    rooms.act(id, 'h', { type: 'start' });
    const snap = rooms.snapshot(id, 'stranger')!;
    expect((snap.game as CodenamesView).me).toBeNull();
    expect((snap.game as CodenamesView).board.every((c) => c.kind === null)).toBe(true);
  });

  it('sweeps idle rooms', () => {
    const id = seatedGame();
    now += 8 * 24 * 60 * 60_000;
    expect(rooms.sweep(7 * 24 * 60 * 60_000)).toBe(1);
    expect(rooms.exists(id)).toBeNull();
  });
});
