import { describe, expect, it } from 'vitest';
import type { StatsEvent } from '../stats/types.ts';
import { NIGHT_GAP_MS, NIGHT_MAX_MS, currentNight, nights, splitGames } from './night.ts';

const H = 60 * 60_000;
let seq = 0;
const ev = (
  type: string,
  ts: number,
  props: Record<string, unknown> = {},
  playerId: string | null = null,
): StatsEvent => ({
  id: `E${String(seq++).padStart(6, '0')}`,
  ts,
  day: '2026-10-10',
  type,
  gameId: 'codenames',
  roomId: 'r',
  playerId,
  props,
});

/** A whole game from `start` lasting `minutes`. */
const game = (
  start: number,
  minutes = 20,
  opts: { finished?: boolean; winners?: string[] } = {},
) => [
  ev('game.started', start, { players: ['a', 'b', 'c', 'd'] }),
  ev('insight.guess', start + 60_000, { correct: true }, 'a'),
  ev('game.ended', start + minutes * 60_000, {
    finished: opts.finished ?? true,
    players: ['a', 'b', 'c', 'd'],
    winners: opts.winners ?? ['a', 'b'],
  }),
];

describe('splitting games', () => {
  it('pairs starts with ends and strips the insight prefix', () => {
    const { games } = splitGames(game(0));
    expect(games).toHaveLength(1);
    expect(games[0]!.finished).toBe(true);
    expect(games[0]!.game.events).toEqual([
      { type: 'guess', ts: 60_000, playerId: 'a', props: { correct: true } },
    ]);
    expect(games[0]!.game.winners).toEqual(['a', 'b']);
  });

  it('a start with no end is still running', () => {
    const { games } = splitGames([ev('game.started', 0, { players: ['a'] })]);
    expect(games[0]!.endedAt).toBeNull();
    expect(games[0]!.finished).toBe(false);
  });
});

describe('nights', () => {
  it('games less than three hours apart make one night', () => {
    const night = currentNight([...game(0), ...game(1 * H), ...game(3 * H)]);
    expect(night!.games).toHaveLength(3);
  });

  it('a gap of more than three hours starts a new night', () => {
    const all = nights([...game(0, 20), ...game(20 * 60_000 + NIGHT_GAP_MS + 1)]);
    expect(all).toHaveLength(2);
    expect(all.at(-1)!.games).toHaveLength(1);
  });

  it('a wrap-up splits the night, and marks it wrapped until the next game', () => {
    const before = [...game(0), ev('room.wrapped', 25 * 60_000)];
    expect(currentNight(before)!.wrapped).toBe(true);
    const all = nights([...before, ...game(30 * 60_000)]);
    expect(all).toHaveLength(2);
    expect(all[0]!.wrapped).toBe(true);
    expect(all[1]!.wrapped).toBe(false);
  });

  it('never spans more than 16 hours', () => {
    const events = [];
    for (let t = 0; t <= 18 * H; t += 2 * H) events.push(...game(t, 30));
    const all = nights(events);
    expect(all.length).toBe(2);
    for (const n of all) expect(n.endedAt - n.startedAt).toBeLessThanOrEqual(NIGHT_MAX_MS);
  });

  it('a running game counts as running, and gives nothing away', () => {
    const night = currentNight([
      ...game(0),
      ev('game.started', H, { players: ['a', 'b'] }),
      ev('insight.guess', H + 1000, { correct: false }, 'b'),
    ]);
    expect(night!.running).toBe(1);
    expect(night!.games).toHaveLength(1);
    expect(night!.games[0]!.events.every((e) => e.ts < H)).toBe(true);
  });

  it('abandoned games are counted but never scored', () => {
    const night = currentNight([...game(0), ...game(H, 5, { finished: false })]);
    expect(night!.abandoned).toBe(1);
    expect(night!.games).toHaveLength(1);
  });

  it('a game whose end was lost (an old crash) is abandoned when the next one starts', () => {
    const night = currentNight([
      ev('game.started', 0, { players: ['a'] }),
      ev('insight.guess', 1000, {}, 'a'),
      ...game(H),
    ]);
    expect(night!.abandoned).toBe(1);
    expect(night!.games).toHaveLength(1);
  });

  it('a game started before a restart and ended after it is one game', () => {
    // The recorder reopens the start from the store, so the events are simply start … end.
    const night = currentNight([
      ev('game.started', 0, { players: ['a', 'b'] }),
      ev('insight.guess', 1000, { correct: true }, 'a'),
      ev('room.created', 2000),
      ev('insight.guess', 3000, { correct: true }, 'b'),
      ev('game.ended', 4000, { finished: true, players: ['a', 'b'], winners: ['a'] }),
    ]);
    expect(night!.games).toHaveLength(1);
    expect(night!.games[0]!.events).toHaveLength(2);
  });

  it('nothing played: no night', () => {
    expect(currentNight([ev('room.created', 0)])).toBeNull();
  });
});

describe('linked rooms', () => {
  /** A game in another room. */
  const elsewhere = (roomId: string, gameId: string, start: number, minutes = 20) =>
    game(start, minutes).map((e) => ({ ...e, roomId, gameId }));

  it('merges games from rooms that share a night, in the order they started', () => {
    const night = currentNight([...game(0), ...elsewhere('r2', 'echo', 1 * H)]);
    expect(night!.games.map((g) => g.gameId)).toEqual(['codenames', 'echo']);
    expect(night!.gameRooms).toEqual(['r', 'r2']);
    expect([...night!.rooms].sort()).toEqual(['r', 'r2']);
  });

  it('two tables at once: a game in one room does not close the other', () => {
    const events = [...game(0, 120), ...elsewhere('r2', 'echo', 30 * 60_000, 20)];
    const { games } = splitGames(events);
    expect(games.map((g) => [g.roomId, g.finished])).toEqual([
      ['r', true],
      ['r2', true],
    ]);
    // The night runs to the later of the two ends.
    expect(currentNight(events)!.endedAt).toBe(120 * 60_000);
  });

  it("a room's current night is its latest with a game there, else the night it continues", () => {
    const events = [...game(0), ...elsewhere('r2', 'echo', 5 * H)];
    expect(currentNight(events, { roomId: 'r' })!.key).toBe(events[0]!.id);
    const key = events[0]!.id;
    expect(currentNight(events, { roomId: 'r2' })!.key).not.toBe(key);
    expect(currentNight(events, { roomId: 'r3', link: key })!.key).toBe(key);
    expect(currentNight(events, { roomId: 'r3', link: null })).toBeNull();
  });
});
