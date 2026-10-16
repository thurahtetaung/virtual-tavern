import type { CodenamesView } from '@vt/game-codenames/logic';
import type { AnyGameDefinition } from '@vt/game-sdk';
import { PLAYER_COLOR_NAMES, PLAYER_COLORS, type PlayerColor } from '@vt/protocol';
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

  it('tells everyone when an away host will be replaced', () => {
    const id = seatedGame();
    for (const p of ['h', 'a']) rooms.connected(id, p);
    expect(rooms.snapshot(id, 'a')!.hostAwayUntil).toBeNull();
    rooms.disconnected(id, 'h');
    expect(rooms.snapshot(id, 'a')!.hostAwayUntil).toBe(now + HOST_AWAY_MS);
    rooms.connected(id, 'h');
    expect(rooms.snapshot(id, 'a')!.hostAwayUntil).toBeNull();
    rooms.disconnected(id, 'h');
    elapse(HOST_AWAY_MS);
    // Handed off to an online player: nobody is away any more.
    expect(rooms.snapshot(id, 'a')).toMatchObject({ hostId: 'a', hostAwayUntil: null });
  });

  describe('names', () => {
    it('numbers a joiner whose name is taken', () => {
      const id = rooms.create('codenames', 'h');
      rooms.join(id, 'h', 'Kim');
      rooms.join(id, 'a', 'kim');
      rooms.join(id, 'b', 'Kim');
      expect(rooms.snapshot(id, 'h')!.players.map((p) => p.name)).toEqual([
        'Kim',
        'kim 2',
        'Kim 3',
      ]);
      // Rejoining under the saved name keeps a number rather than taking anyone's name.
      rooms.join(id, 'a', 'Kim');
      expect(rooms.snapshot(id, 'h')!.players.map((p) => p.name)).toEqual([
        'Kim',
        'Kim 2',
        'Kim 3',
      ]);
    });

    it('refuses a rename to a name someone already has', () => {
      const id = rooms.create('codenames', 'h');
      rooms.join(id, 'h', 'Kim');
      rooms.join(id, 'a', 'Ana');
      expect(rooms.rename(id, 'a', 'KIM')).toEqual({
        ok: false,
        error: {
          code: 'name-taken',
          message: 'Someone here is already called KIM. Pick another name.',
        },
      });
      expect(rooms.rename(id, 'a', 'ana')).toEqual({ ok: true });
      expect(rooms.rename(id, 'h', 'Kim')).toEqual({ ok: true });
    });
  });

  describe('colours', () => {
    const colors = (id: string) => rooms.snapshot(id, 'p0')!.players.map((p) => p.color);

    it('gives every joiner a colour nobody here has, then shares the least used', () => {
      const id = rooms.create('masquerade', 'p0');
      for (let i = 0; i < PLAYER_COLORS.length; i++) rooms.join(id, `p${i}`, `P${i}`);
      expect([...colors(id)].sort()).toEqual([...PLAYER_COLORS].sort());
      rooms.join(id, 'extra', 'Extra');
      expect(PLAYER_COLORS).toContain(colors(id).at(-1));
    });

    it('keeps a colour through a rejoin and a rename', () => {
      const id = rooms.create('masquerade', 'p0');
      rooms.join(id, 'p0', 'Ana');
      const [color] = colors(id);
      rooms.join(id, 'p0', 'Ana');
      rooms.rename(id, 'p0', 'Anna');
      expect(colors(id)).toEqual([color]);
    });

    it('changes a colour, refusing one someone else has', () => {
      const id = rooms.create('masquerade', 'p0');
      rooms.join(id, 'p0', 'Ana');
      rooms.join(id, 'p1', 'Ben');
      const [ana, ben] = colors(id) as [PlayerColor, PlayerColor];
      const version = rooms.snapshot(id, 'p0')!;
      expect(rooms.recolor(id, 'p1', ana)).toEqual({
        ok: false,
        error: {
          code: 'color-taken',
          message: `Ana is already ${PLAYER_COLOR_NAMES[ana]}. Pick another colour.`,
        },
      });
      expect(rooms.snapshot(id, 'p0')).toEqual(version);
      expect(rooms.recolor(id, 'p1', ben)).toEqual({ ok: true });
      const free = PLAYER_COLORS.find((c) => c !== ana && c !== ben)!;
      expect(rooms.recolor(id, 'p1', free)).toEqual({ ok: true });
      expect(colors(id)).toEqual([ana, free]);
      expect(rooms.recolor(id, 'nobody', free)).toMatchObject({ error: { code: 'not-in-room' } });
    });

    it('keeps colours over a restart and colours rooms saved without them', () => {
      const id = rooms.create('masquerade', 'p0');
      rooms.join(id, 'p0', 'Ana');
      rooms.join(id, 'p1', 'Ben');
      const free = PLAYER_COLORS.find((c) => c !== colors(id)[0])!;
      expect(rooms.recolor(id, 'p1', free)).toEqual({ ok: true });
      rooms.close();
      rooms = manager();
      expect(colors(id)[1]).toBe(free);

      const old = rooms.create('masquerade', 'p0');
      rooms.close();
      const store = new SqliteRoomStore(db);
      const record = store.get(old)!;
      store.update({
        ...record,
        version: record.version + 1,
        // As saved before rooms had colours.
        players: [
          { id: 'p0', name: 'Ana' },
          { id: 'p1', name: 'Ben' },
        ] as typeof record.players,
      });
      rooms = manager();
      expect(colors(old)).toEqual(['red', 'blue']);
    });

    it('starts every room afresh', () => {
      const a = rooms.create('masquerade', 'p0');
      rooms.join(a, 'p0', 'Ana');
      rooms.recolor(a, 'p0', 'teal');
      const b = rooms.create('masquerade', 'p1');
      rooms.join(b, 'p1', 'Ben');
      rooms.recolor(b, 'p1', 'teal');
      rooms.join(b, 'p0', 'Ana');
      expect(rooms.snapshot(b, 'p0')!.players.map((p) => p.color)[1]).not.toBe('teal');
      expect(colors(a)).toEqual(['teal']);
    });

    it('changes colours mid-game too', () => {
      const id = seatedGame();
      expect(rooms.act(id, 'h', { type: 'start' })).toEqual({ ok: true });
      const before = rooms.snapshot(id, 'h')!.players.map((p) => p.color);
      const free = PLAYER_COLORS.find((c) => !before.includes(c))!;
      expect(rooms.recolor(id, 'h', free)).toEqual({ ok: true });
      expect(rooms.snapshot(id, 'h')!.players.map((p) => p.color)).toEqual([
        free,
        ...before.slice(1),
      ]);
      expect(rooms.recolor(id, 'a', free)).toMatchObject({ error: { code: 'color-taken' } });
    });

    it("makes Reverie's seat colour the player's colour", () => {
      const id = rooms.create('reverie', 'p0');
      rooms.join(id, 'p0', 'Ana');
      rooms.join(id, 'p1', 'Ben');
      // Ana's colour is random, so Ben picks one she can't have.
      const free = PLAYER_COLORS.find((c) => c !== colors(id)[0])!;
      expect(rooms.recolor(id, 'p1', free)).toEqual({ ok: true });
      const seats = (rooms.snapshot(id, 'p0')!.game as { seats: { color: string }[] }).seats;
      expect(seats.map((s) => s.color)).toEqual([colors(id)[0], free]);
    });
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

  it('says since when an away player has been gone, and forgets it when they return', () => {
    const id = seatedGame();
    const player = (p: string) => rooms.snapshot(id, 'h')!.players.find((x) => x.id === p)!;
    expect(player('a')).not.toHaveProperty('awaySince'); // never seen since the server started
    rooms.connected(id, 'a');
    expect(player('a')).toEqual({
      id: 'a',
      name: 'A',
      color: expect.any(String) as string,
      connected: true,
    });
    const left = now;
    rooms.disconnected(id, 'a');
    now += 5 * 60_000;
    expect(player('a')).toMatchObject({ connected: false, awaySince: left });
    rooms.connected(id, 'a');
    expect(player('a')).not.toHaveProperty('awaySince');
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

  it('never sweeps a room someone is in, however long since its last change', () => {
    const id = seatedGame();
    rooms.connected(id, 'a');
    now += 30 * DAY;
    expect(rooms.sweep(7 * DAY)).toBe(0);
    expect(rooms.exists(id)).not.toBeNull();
  });

  it('counts visits as activity: the idle clock runs from when the last player left', () => {
    const id = seatedGame();
    now += 6 * DAY;
    rooms.connected(id, 'a');
    now += 2 * DAY;
    rooms.disconnected(id, 'a');
    now += 6 * DAY; // 14 days since the last change, 6 since anyone was here
    expect(rooms.sweep(7 * DAY)).toBe(0);
    now += 2 * DAY;
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

    it('only lets a room read the word lists tagged for its game', () => {
      const stub = stubGame({
        create: (ctx) => ({ due: null, lists: ctx.content.wordLists().map((l) => l.name) }),
        reduce: (s: object, action: { ids?: string[] }, ctx) => ({
          ...s,
          words: ctx.content.words(action.ids ?? []),
        }),
        actionSchema: z.object({ type: z.string(), ids: z.array(z.string()).optional() }),
      });
      // The Starter list seeded by manager() is tagged for the real games only, not the stub.
      const repo = new WordListRepo(db, () => now, ['stub', 'codenames']);
      const mine = repo.create({ name: 'Mine', description: '', words: ['a'], games: ['stub'] });
      const theirs = repo.create({
        name: 'Theirs',
        description: '',
        words: ['b'],
        games: ['codenames'],
      });
      rooms.close();
      rooms = manager({ games: new Map([[stub.id, stub]]), content: repo });
      const id = rooms.create(stub.id, 'h');
      rooms.join(id, 'h', 'H');
      expect(rooms.snapshot(id, 'h')!.game).toMatchObject({ lists: ['Mine'] });
      expect(rooms.act(id, 'h', { type: 'read', ids: [mine.id, theirs.id] })).toEqual({ ok: true });
      expect(rooms.snapshot(id, 'h')!.game).toMatchObject({ words: ['a'] });
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
      expect(rooms.snapshot(id, 'h')!.players).toEqual([
        {
          id: 'h',
          name: 'H',
          color: expect.any(String) as string,
          connected: false,
          awaySince: now,
        },
      ]);
    });
  });
});
