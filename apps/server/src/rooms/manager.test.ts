import type { CodenamesView } from '@vt/game-codenames/logic';
import type { AnyGameDefinition } from '@vt/game-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openDb } from '../db/index.ts';
import { buildGames } from '../games/registry.ts';

const games = buildGames();
import { MIGRATIONS } from '../test/helpers.ts';
import { WordListRepo } from '../word-lists.ts';
import {
  DEADLINE_RETRY_MS,
  HOST_AWAY_MS,
  MAX_STATE_JSON_LENGTH,
  RoomManager,
  type RoomManagerDeps,
} from './manager.ts';
import { SqliteRoomStore } from './store.ts';

const DAY = 24 * 60 * 60_000;

/** A minimal game whose timer behaviour the test controls. State is `{ due, payload? }`. */
function stubGame(impl: Partial<AnyGameDefinition>): AnyGameDefinition {
  return {
    id: 'stub',
    name: 'Stub',
    description: '',
    minPlayers: 1,
    maxPlayers: 2,
    guide: { tagline: '', players: '', duration: '', goal: '', setup: [], sections: [], tips: [] },
    actionSchema: z.object({ type: z.string() }),
    create: () => ({ due: null }),
    reduce: (s: unknown) => s,
    playerJoined: (s: unknown) => s,
    playerLeft: (s: unknown) => s,
    view: (s: unknown) => s,
    nextDeadline: (s: { due: number | null }) => s.due,
    ...impl,
  };
}

describe('RoomManager', () => {
  let now = 1_000_000;
  let db: ReturnType<typeof openDb>;
  let rooms: RoomManager;
  const changed = vi.fn();
  const logger = { warn: vi.fn(), error: vi.fn() };

  function manager(overrides: Partial<RoomManagerDeps> = {}) {
    const content = new WordListRepo(db);
    content.seedIfEmpty();
    return new RoomManager({
      store: new SqliteRoomStore(db),
      games,
      content,
      events: { changed, kicked: vi.fn() },
      now: () => now,
      logger,
      ...overrides,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    db = openDb(':memory:', MIGRATIONS);
    rooms = manager();
    logger.warn.mockClear();
    logger.error.mockClear();
  });
  afterEach(() => {
    rooms.close();
    vi.useRealTimers();
  });

  /** Moves both the clock and the fake timers forward together. */
  function elapse(ms: number) {
    now += ms;
    vi.advanceTimersByTime(ms);
  }

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
    elapse(30_000);
    expect(game(id).turn!.team).not.toBe(first);
    expect(game(id).log.at(-1)).toMatchObject({ type: 'end-turn', reason: 'timeout' });
  });

  it('never ends a turn on a soft timer', () => {
    const id = seatedGame({ clueSeconds: 30 });
    rooms.act(id, 'h', { type: 'start' });
    const first = game(id).turn!.team;
    elapse(120_000);
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
    now += 8 * DAY;
    expect(rooms.sweep(7 * DAY)).toBe(1);
    expect(rooms.exists(id)).toBeNull();
  });

  describe('host hand-off', () => {
    it('starts the hand-off clock when a room is loaded with its host offline', () => {
      const id = seatedGame();
      rooms.close();
      // A fresh manager over the same database, as after a restart.
      rooms = manager();
      rooms.snapshot(id, 'a'); // loads the room; nobody is connected
      elapse(HOST_AWAY_MS / 2);
      rooms.connected(id, 'a');
      elapse(HOST_AWAY_MS / 2);
      expect(rooms.snapshot(id, 'a')!.hostId).toBe('a');
    });

    it('restarts the clock when someone connects after it ran out with nobody online', () => {
      const id = seatedGame();
      rooms.connected(id, 'h');
      rooms.connected(id, 'a');
      rooms.disconnected(id, 'h');
      rooms.disconnected(id, 'a');
      elapse(HOST_AWAY_MS); // fires with nobody to hand over to
      expect(rooms.snapshot(id, 'a')!.hostId).toBe('h');
      rooms.connected(id, 'a');
      elapse(HOST_AWAY_MS - 1);
      expect(rooms.snapshot(id, 'a')!.hostId).toBe('h');
      elapse(1);
      expect(rooms.snapshot(id, 'a')!.hostId).toBe('a');
    });

    it('makes the first joiner host when the creator never joined', () => {
      const id = rooms.create('codenames', 'creator');
      expect(rooms.join(id, 'a', 'A')).toEqual({ ok: true });
      expect(rooms.snapshot(id, 'a')!.hostId).toBe('a');
      rooms.join(id, 'creator', 'Late');
      expect(rooms.snapshot(id, 'a')!.hostId).toBe('a');
    });

    it('counts a joiner as present in the same change', () => {
      const id = seatedGame();
      changed.mockClear();
      expect(rooms.join(id, 'x', 'X', { connect: true })).toEqual({ ok: true });
      expect(changed).toHaveBeenCalledTimes(1);
      expect(rooms.snapshot(id, 'x')!.players.find((p) => p.id === 'x')).toMatchObject({
        connected: true,
      });
    });
  });

  describe('deadline timers', () => {
    function timerRoom(impl: Partial<AnyGameDefinition>) {
      const stub = stubGame(impl);
      rooms.close();
      rooms = manager({ games: new Map([[stub.id, stub]]) });
      const id = rooms.create(stub.id, 'h');
      rooms.join(id, 'h', 'H');
      return id;
    }
    const due = (id: string) => (rooms.snapshot(id, 'h')!.game as { due: number | null }).due;

    it('logs a throwing onDeadline and retries it later', () => {
      let calls = 0;
      const id = timerRoom({
        create: () => ({ due: now + 1_000 }),
        onDeadline: (_s, at: number) => {
          if (calls++ === 0) throw new Error('boom');
          return { due: at + 60_000 };
        },
      });
      elapse(1_000);
      expect(calls).toBe(1);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(due(id)).toBe(now);
      elapse(DEADLINE_RETRY_MS - 1);
      expect(calls).toBe(1);
      elapse(1);
      expect(calls).toBe(2);
      expect(due(id)).toBe(now + 60_000);
    });

    it('does not fire a far-future deadline early', () => {
      let calls = 0;
      timerRoom({
        create: () => ({ due: now + 30 * DAY }),
        onDeadline: (_s, at: number) => {
          calls++;
          return { due: at + DAY };
        },
      });
      elapse(25 * DAY); // longer than one setTimeout can wait
      expect(calls).toBe(0);
      elapse(5 * DAY);
      expect(calls).toBe(1);
    });

    it('does not spin when onDeadline returns the same state', () => {
      let calls = 0;
      const id = timerRoom({
        create: () => ({ due: now + 1_000 }),
        onDeadline: (s: unknown) => {
          calls++;
          return s;
        },
      });
      for (let i = 0; i < 60; i++) elapse(1_000);
      expect(calls).toBe(2);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledTimes(1);
      // A player action gives the game another (equally bounded) chance.
      rooms.act(id, 'h', { type: 'poke' });
      for (let i = 0; i < 60; i++) elapse(1_000);
      expect(calls).toBe(4);
    });

    it('does not spin when onDeadline leaves the deadline in the past', () => {
      let calls = 0;
      timerRoom({
        create: () => ({ due: now + 1_000 }),
        onDeadline: (s: { due: number }) => {
          calls++;
          return { ...s, poked: calls };
        },
      });
      for (let i = 0; i < 60; i++) elapse(1_000);
      expect(calls).toBe(2);
    });

    it('resumes normal timing once the game makes progress again', () => {
      let calls = 0;
      const id = timerRoom({
        create: () => ({ due: now + 1_000 }),
        onDeadline: (s: { due: number }, at: number) => {
          calls++;
          return calls === 1 ? { ...s } : { due: at + 10_000 };
        },
      });
      elapse(1_000);
      expect(calls).toBe(1);
      elapse(1_000); // the one back-off
      expect(calls).toBe(2);
      expect(due(id)).toBe(now + 10_000);
      elapse(10_000);
      expect(calls).toBe(3);
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('game contract', () => {
    it("enforces the game's own player cap", () => {
      const stub = stubGame({ maxPlayers: 2 });
      rooms.close();
      rooms = manager({ games: new Map([[stub.id, stub]]) });
      const id = rooms.create(stub.id, 'h');
      expect(rooms.join(id, 'h', 'H')).toEqual({ ok: true });
      expect(rooms.join(id, 'a', 'A')).toEqual({ ok: true });
      expect(rooms.join(id, 'b', 'B')).toMatchObject({ ok: false, error: { code: 'room-full' } });
      expect(rooms.join(id, 'a', 'Anna')).toEqual({ ok: true }); // renames still pass
    });

    it('rejects a change that makes the state too large', () => {
      const stub = stubGame({
        reduce: (s: { due: null }) => ({ ...s, blob: 'x'.repeat(MAX_STATE_JSON_LENGTH) }),
      });
      rooms.close();
      rooms = manager({ games: new Map([[stub.id, stub]]) });
      const id = rooms.create(stub.id, 'h');
      rooms.join(id, 'h', 'H');
      const before = rooms.snapshot(id, 'h')!.game;
      expect(rooms.act(id, 'h', { type: 'grow' })).toMatchObject({
        ok: false,
        error: { code: 'state-too-large' },
      });
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(rooms.snapshot(id, 'h')!.game).toEqual(before);
    });

    it('does not count a joiner as present when the join itself is rejected', () => {
      let joins = 0;
      const stub = stubGame({
        playerJoined: (s: { due: null }) =>
          joins++ === 0 ? { ...s, blob: 'x'.repeat(MAX_STATE_JSON_LENGTH) } : s,
      });
      rooms.close();
      rooms = manager({ games: new Map([[stub.id, stub]]) });
      const id = rooms.create(stub.id, 'h');
      expect(() => rooms.join(id, 'h', 'H', { connect: true })).toThrow(
        expect.objectContaining({ code: 'state-too-large' }),
      );
      expect(rooms.snapshot(id, 'h')!.players).toEqual([]);
      // No ghost presence survives the failed join: one real connection, one disconnect, offline.
      expect(rooms.join(id, 'h', 'H', { connect: true })).toEqual({ ok: true });
      rooms.disconnected(id, 'h');
      expect(rooms.snapshot(id, 'h')!.players).toEqual([{ id: 'h', name: 'H', connected: false }]);
    });
  });
});
