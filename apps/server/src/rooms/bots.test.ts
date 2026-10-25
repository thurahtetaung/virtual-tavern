import { type AnyGameDefinition, GameError } from '@vt/game-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openDb } from '../db/index.ts';
import { buildGames } from '../games/registry.ts';
import { MIGRATIONS } from '../test/helpers.ts';
import { WordListRepo } from '../word-lists.ts';
import { BotRunner, MAX_PER_HOUR } from './bots.ts';
import { RoomManager } from './manager.ts';
import { type PlaytestRecord, SqliteRoomStore } from './store.ts';

/**
 * A counter game: `bump` adds one, `nope` is always refused. Its view says who it is for, so a
 * test can see exactly what a bot was shown.
 */
function counter(bot: AnyGameDefinition['bot']): AnyGameDefinition {
  return {
    id: 'counter',
    name: 'Counter',
    description: '',
    minPlayers: 1,
    maxPlayers: 8,
    guide: { tagline: '', players: '', duration: '', goal: '', setup: [], sections: [], tips: [] },
    actionSchema: z.object({ type: z.enum(['bump', 'nope']) }),
    create: () => ({ phase: 'playing', n: 0, secret: 'only-for-the-server' }),
    reduce: (s: { n: number }, a: { type: string }) =>
      a.type === 'bump' ? { ...s, n: s.n + 1 } : new GameError('nope', 'Nope.'),
    playerJoined: (s: unknown) => s,
    playerLeft: (s: unknown) => s,
    view: (s: { n: number }, viewer: string | null) => ({ n: s.n, for: viewer }),
    bot,
  };
}

const HOST = 'human';
const BOT = 'bot-1';
const SECOND = 1000;

describe('the playtest bot runner', () => {
  let db: ReturnType<typeof openDb>;
  let now = 1_000_000;
  const logger = { warn: vi.fn(), debug: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    db = openDb(':memory:', MIGRATIONS);
    now = 1_000_000;
    logger.warn.mockClear();
    logger.debug.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A playtest of `game` with one human seat and the given bots; the runner thinks for 2 s. */
  function setup(game: AnyGameDefinition, botIds = [BOT], extra: Partial<PlaytestRecord> = {}) {
    const games = new Map([...buildGames(), [game.id, game]]);
    const content = new WordListRepo(db);
    content.seedIfEmpty();
    const holder: { runner?: BotRunner } = {};
    const rooms: RoomManager = new RoomManager({
      store: new SqliteRoomStore(db),
      games,
      content,
      events: {
        changed: (id) => holder.runner?.poke(id),
        kicked: () => {},
        closed: (id) => holder.runner?.stop(id),
      },
      now: () => now,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const runner = (holder.runner = new BotRunner({
      rooms,
      words: () => [],
      logger,
      now: () => now,
      clock: () => now,
      delay: (trivial) => (trivial ? SECOND : 2 * SECOND),
      seed: () => 7,
    }));
    const roomId = rooms.create(game.id, HOST, {
      playtest: {
        bots: botIds.map((id) => ({ id, name: id })),
        speed: 'normal',
        paused: false,
        createdAt: now,
        ...extra,
      },
    });
    rooms.join(roomId, HOST, 'Ana', { admin: true });
    for (const id of botIds) rooms.join(roomId, id, id, { admin: true });
    const elapse = (ms: number) => {
      now += ms;
      vi.advanceTimersByTime(ms);
    };
    const state = () => (rooms.snapshot(roomId, HOST)!.game as { n: number }).n;
    return { rooms, runner, roomId, elapse, state };
  }

  it('moves only while a human seat is connected, after a human-like pause, from its own view', () => {
    const seen: unknown[] = [];
    const t = setup(
      counter((view: { n: number }) => {
        seen.push(view);
        return view.n < 3 ? { type: 'bump' } : null;
      }),
    );
    // Nobody is at the table yet: bots never play to an empty room.
    t.runner.poke(t.roomId);
    t.elapse(10 * SECOND);
    expect(t.state()).toBe(0);

    t.rooms.connected(t.roomId, HOST);
    t.elapse(2 * SECOND - 1);
    expect(t.state()).toBe(0);
    t.elapse(1);
    expect(t.state()).toBe(1);
    t.elapse(10 * SECOND);
    expect(t.state()).toBe(3);
    // Only ever its own seat's view, never the state.
    expect(
      seen.every(
        (v) => JSON.stringify(v) === JSON.stringify({ n: (v as { n: number }).n, for: BOT }),
      ),
    ).toBe(true);
    expect(JSON.stringify(seen)).not.toContain('only-for-the-server');

    // Everyone leaves mid-game: the bots stop.
    t.rooms.disconnected(t.roomId, HOST);
    expect(t.runner.pending(t.roomId)).toBe(0);
  });

  it('works out each move afresh when it is made', () => {
    let calls = 0;
    const t = setup(
      counter((view: { n: number }) => {
        calls += 1;
        // Only moves while the count is even: by the time its timer fires, a human made it odd.
        return view.n % 2 === 0 ? { type: 'bump' } : null;
      }),
    );
    t.rooms.connected(t.roomId, HOST);
    t.rooms.act(t.roomId, HOST, { type: 'bump' });
    t.elapse(5 * SECOND);
    expect(t.state()).toBe(1);
    expect(calls).toBeGreaterThan(1);
  });

  it('follows the speed and the pause switch', () => {
    const t = setup(
      counter((view: { n: number }) => (view.n < 10 ? { type: 'bump' } : null)),
      [BOT],
      { speed: 'slow' },
    );
    t.rooms.connected(t.roomId, HOST);
    t.elapse(4 * SECOND - 1);
    expect(t.state()).toBe(0);
    t.elapse(1);
    expect(t.state()).toBe(1);
    t.rooms.setPlaytest(t.roomId, { paused: true });
    t.elapse(60 * SECOND);
    expect(t.state()).toBe(1);
    t.rooms.setPlaytest(t.roomId, { paused: false, speed: 'fast' });
    t.elapse(SECOND / 2);
    expect(t.state()).toBe(2);
  });

  it('backs off after a refused move until the room changes', () => {
    let calls = 0;
    const t = setup(
      counter(() => {
        calls += 1;
        return { type: 'nope' };
      }),
    );
    t.rooms.connected(t.roomId, HOST);
    t.elapse(30 * SECOND);
    const after = calls;
    expect(logger.debug).toHaveBeenCalledTimes(1);
    t.elapse(30 * SECOND);
    expect(calls).toBe(after);
    // Something changes: it tries once more.
    t.rooms.act(t.roomId, HOST, { type: 'bump' });
    t.elapse(30 * SECOND);
    expect(logger.debug).toHaveBeenCalledTimes(2);
  });

  it('makes the moves a game marks as quick at button-press speed', () => {
    const game = counter((view: { n: number }) => (view.n < 1 ? { type: 'bump' } : null));
    const t = setup({
      ...game,
      botInfo: { quick: (move) => (move as { type: string }).type === 'bump' },
    });
    t.rooms.connected(t.roomId, HOST);
    t.elapse(SECOND);
    expect(t.state()).toBe(1);
    // Other games keep the usual pause.
    const slow = setup({ ...counter(() => ({ type: 'bump' })), id: 'counter-2' });
    slow.rooms.connected(slow.roomId, HOST);
    slow.elapse(SECOND);
    expect(slow.state()).toBe(0);
  });

  it('retries a refusal the game marks as worth another go, after its pause', () => {
    let calls = 0;
    const game = counter(() => {
      calls += 1;
      // Refused twice, then a move that is accepted.
      return { type: calls <= 2 ? 'nope' : 'bump' };
    });
    const t = setup({ ...game, botInfo: { retry: (code) => code === 'nope' } });
    t.rooms.connected(t.roomId, HOST);
    t.elapse(30 * SECOND);
    expect(logger.debug).not.toHaveBeenCalled();
    expect(t.state()).toBeGreaterThanOrEqual(1);
  });

  it('logs a hook that throws once per version, and skips that bot', () => {
    const t = setup(
      counter(() => {
        throw new Error('boom');
      }),
    );
    t.rooms.connected(t.roomId, HOST);
    t.elapse(30 * SECOND);
    t.rooms.act(t.roomId, HOST, { type: 'bump' });
    t.elapse(30 * SECOND);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(t.state()).toBe(1);
  });

  it('caps bot moves a second, and pauses bots that never stop', () => {
    const t = setup(
      counter(() => ({ type: 'bump' })),
      ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'],
    );
    t.rooms.connected(t.roomId, HOST);
    t.elapse(2 * SECOND);
    // Six bots were due at once; three moved this second.
    expect(t.state()).toBe(3);
    for (let i = 0; i < 400; i++) t.elapse(SECOND);
    expect(t.state()).toBe(MAX_PER_HOUR);
    expect(t.rooms.snapshot(t.roomId, HOST)!.meta!.playtest).toMatchObject({
      paused: true,
      stuck: true,
    });
    // Resuming by hand clears the note.
    t.rooms.setPlaytest(t.roomId, { paused: false });
    expect(t.rooms.snapshot(t.roomId, HOST)!.meta!.playtest!.stuck).toBeUndefined();
  });

  it('shows bots as always there, never hands them the host role, and picks up after a restart', () => {
    const t = setup(counter((view: { n: number }) => (view.n < 2 ? { type: 'bump' } : null)));
    const snap = t.rooms.snapshot(t.roomId, HOST)!;
    expect(snap.players.find((p) => p.id === BOT)).toMatchObject({ connected: true, bot: true });
    expect(t.rooms.liveRooms()).toEqual([]);
    t.rooms.close();
    // A fresh manager on the same database: the room loads lazily, and the admin's tab rejoining
    // is what wakes the bots.
    const reborn = new RoomManager({
      store: new SqliteRoomStore(db),
      games: new Map([
        ['counter', counter((v: { n: number }) => (v.n < 2 ? { type: 'bump' } : null))],
      ]),
      content: new WordListRepo(db),
      events: { changed: (id) => runner.poke(id), kicked: () => {} },
      now: () => now,
      logger: { warn: vi.fn(), error: vi.fn() },
    });
    const runner = new BotRunner({
      rooms: reborn,
      words: () => [],
      logger,
      now: () => now,
      clock: () => now,
      delay: () => SECOND,
      seed: () => 1,
    });
    reborn.join(t.roomId, HOST, 'Ana', { connect: true, admin: true });
    now += 5 * SECOND;
    vi.advanceTimersByTime(5 * SECOND);
    expect((reborn.snapshot(t.roomId, HOST)!.game as { n: number }).n).toBe(2);
    // The human leaves for good: a bot never becomes host.
    reborn.leave(t.roomId, HOST);
    expect(reborn.snapshot(t.roomId, BOT)!.hostId).not.toBe(BOT);
    runner.close();
    reborn.close();
  });
});
