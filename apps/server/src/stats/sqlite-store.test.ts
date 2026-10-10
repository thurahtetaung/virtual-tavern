import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/index.ts';
import { MIGRATIONS } from '../test/helpers.ts';
import { dayOf, resolveWindow } from './days.ts';
import { ulid } from './recorder.ts';
import { SqliteStatsStore } from './sqlite-store.ts';
import type { StatsEvent, Window } from './types.ts';

const GAMES = ['codenames', 'enigma', 'echo', 'reverie'];
const D1 = '2026-10-01';
const D2 = '2026-10-02';
const D3 = '2026-10-03';
const at = (day: string, hour: number, minute = 0) =>
  Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);

const win = (from: string, to: string, bucket: Window['bucket'] = 'day'): Window =>
  resolveWindow({ range: 'custom', from, to, bucket }, D3, null) as Window;

function ev(
  ts: number,
  type: string,
  gameId: string,
  props: Record<string, unknown> = {},
  playerId: string | null = null,
  roomId = 'room-1',
): StatsEvent {
  return { id: ulid(ts), ts, day: dayOf(ts), type, gameId, roomId, playerId, props };
}

/** One day of play: a Codenames game, an Echo game (perfect), an Enigma and a Reverie outcome. */
function dayOfPlay(day: string): StatsEvent[] {
  const t = (h: number, m = 0) => at(day, h, m);
  return [
    ev(t(18), 'room.created', 'codenames', {}, 'ana'),
    ev(t(18, 1), 'player.joined', 'codenames', { name: 'Ana' }, 'ana'),
    ev(t(18, 2), 'game.started', 'codenames', {
      players: ['ana', 'ben', 'cy', 'dee'],
      settings: ['wordList=starter', 'clueSeconds=off', 'timerMode=soft'],
    }),
    ev(t(18, 3), 'action', 'codenames', { action: 'give-clue' }, 'ana'),
    ev(
      t(18, 3),
      'insight.clue',
      'codenames',
      { count: 2, team: 'red', words: [{ kind: 'clue', word: 'Ocean' }] },
      'ana',
    ),
    ev(
      t(18, 4),
      'insight.guess',
      'codenames',
      { kind: 'red', correct: true, actMs: 2000, words: [{ kind: 'guess', word: 'WAVE' }] },
      'ben',
    ),
    ev(
      t(18, 5),
      'insight.guess',
      'codenames',
      { kind: 'blue', correct: false, actMs: 4000, words: [{ kind: 'guess', word: 'fish' }] },
      'ben',
    ),
    ev(
      t(18, 6),
      'insight.guess',
      'codenames',
      {
        kind: 'assassin',
        correct: false,
        actMs: 6000,
        words: [
          { kind: 'guess', word: 'bomb' },
          { kind: 'assassin', word: 'bomb' },
        ],
      },
      'ben',
    ),
    ev(t(18, 6), 'insight.outcome', 'codenames', {
      winner: 'blue',
      winReason: 'assassin',
      winners: ['cy', 'dee'],
    }),
    ev(t(18, 30), 'game.ended', 'codenames', {
      finished: true,
      durationMs: 28 * 60_000,
      players: ['ana', 'ben', 'cy', 'dee'],
      winners: ['cy', 'dee'],
    }),
    ev(
      t(20),
      'game.started',
      'echo',
      { players: ['ana', 'ben', 'cy'], settings: ['deckSize=8'] },
      null,
      'room-2',
    ),
    ev(
      t(20, 1),
      'insight.card',
      'echo',
      {
        outcome: 'right',
        guessMs: 1500,
        cancelledBy: ['cy'],
        words: [{ kind: 'cancelled', word: 'sea' }],
      },
      'ana',
      'room-2',
    ),
    ev(t(20, 2), 'insight.card', 'echo', { outcome: 'pass' }, 'ben', 'room-2'),
    ev(
      t(20, 3),
      'insight.outcome',
      'echo',
      { score: 8, deckSize: 8, winners: ['ana', 'ben', 'cy'] },
      null,
      'room-2',
    ),
    ev(
      t(20, 50),
      'game.ended',
      'echo',
      {
        finished: true,
        durationMs: 50 * 60_000,
        players: ['ana', 'ben', 'cy'],
        winners: ['ana', 'ben', 'cy'],
      },
      null,
      'room-2',
    ),
    ev(t(21), 'insight.decode', 'enigma', { success: true }, null, 'room-3'),
    ev(t(21), 'insight.intercept', 'enigma', { success: false }, null, 'room-3'),
    ev(t(21), 'insight.outcome', 'enigma', { winner: 'red', round: 6 }, null, 'room-3'),
    ev(
      t(22),
      'insight.story',
      'reverie',
      { allOrNone: true, words: [{ kind: 'story', word: 'Dreams' }] },
      'dee',
      'room-4',
    ),
    ev(t(22), 'insight.vote', 'reverie', { found: true }, 'ana', 'room-4'),
    ev(t(22), 'insight.outcome', 'reverie', { target: 30 }, null, 'room-4'),
    ev(
      t(23),
      'game.started',
      'enigma',
      { players: ['ana', 'ben', 'cy', 'dee'], settings: ['flow=alternating'] },
      null,
      'room-3',
    ),
    ev(
      t(23, 10),
      'game.ended',
      'enigma',
      {
        finished: false,
        durationMs: 10 * 60_000,
        players: ['ana', 'ben', 'cy', 'dee'],
        winners: [],
      },
      null,
      'room-3',
    ),
  ];
}

describe('SqliteStatsStore', () => {
  let store: SqliteStatsStore;
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = openDb(':memory:', MIGRATIONS);
    store = new SqliteStatsStore(db, {
      gameIds: GAMES,
      gameName: (id) => id[0]!.toUpperCase() + id.slice(1),
      label: (k, v) => (k === 'wordList' && v === 'starter' ? 'Starter words' : undefined),
    });
    store.append([...dayOfPlay(D1), ...dayOfPlay(D2)]);
    const seen = (playerId: string, name: string) => ({
      playerId,
      name,
      now: at(D1, 18),
      joinedRoom: true,
    });
    store.upsertPlayers(
      [seen('ana', 'Ana'), seen('ben', 'Ben'), seen('cy', 'Cy'), seen('dee', 'Dee')],
      new Map(),
    );
  });

  const count = (sql: string) => db.$client.prepare(sql).pluck().get() as number;

  /** Every read for one window, as JSON, to compare raw against rolled-up answers. */
  function everything(w: Window) {
    return JSON.stringify([
      store.overview(w),
      store.games(w),
      ...GAMES.map((g) => store.game(g, w)),
      store.players(w),
      store.player('ben', w),
      store.fun(w),
      store.heatmap(w),
      store.timeseries('players_unique', w),
      store.timeseries('minutes_played', win(w.from, w.to, 'hour')),
      store.words('codenames', 'guess', w, 10),
      store.settings('codenames', w),
    ]);
  }

  it('reads a rolled-up day exactly like its raw events, before and after pruning', () => {
    const w = win(D1, D1);
    const raw = everything(w);
    store.rollupDay(D1, at(D3, 1));
    expect(everything(w)).toBe(raw);
    expect(store.prune(D2)).toBe(dayOfPlay(D1).length);
    expect(count(`select count(*) from stats_events where day = '${D1}'`)).toBe(0);
    expect(everything(w)).toBe(raw);
    // Rolling up again, even with the raw events gone, is harmless.
    store.rollupDay(D1, at(D3, 2));
    expect(everything(w)).toBe(raw);
  });

  it('answers a range that spans rolled-up and raw days', () => {
    const one = store.overview(win(D1, D1)).totals;
    store.rollupDay(D1, at(D3, 1));
    store.prune(D2);
    const both = store.overview(win(D1, D2)).totals;
    expect(both).toEqual({
      roomsCreated: one.roomsCreated * 2,
      gamesStarted: one.gamesStarted * 2,
      gamesFinished: one.gamesFinished * 2,
      gamesAbandoned: one.gamesAbandoned * 2,
      uniquePlayers: one.uniquePlayers,
      minutesPlayed: one.minutesPlayed * 2,
    });
    expect(store.words('codenames', 'guess', win(D1, D2), 2).words).toEqual([
      { word: 'bomb', count: 2 },
      { word: 'fish', count: 2 },
    ]);
  });

  it('only prunes days that are rolled up, and keeps the rollups', () => {
    expect(store.unrolledDays(D3)).toEqual([D1, D2]);
    expect(store.prune(D3)).toBe(0);
    store.rollupDay(D1, at(D3, 1));
    expect(store.unrolledDays(D3)).toEqual([D2]);
    store.prune(D3);
    expect(count('select count(*) from stats_events')).toBe(dayOfPlay(D2).length);
    expect(count(`select count(*) from stats_daily where day = '${D1}'`)).toBeGreaterThan(0);
  });

  it('sums the overview, game mix, calendar and hour heatmap', () => {
    const o = store.overview(win(D1, D2));
    expect(o.totals).toEqual({
      roomsCreated: 2,
      gamesStarted: 6,
      gamesFinished: 4,
      gamesAbandoned: 2,
      uniquePlayers: 4,
      minutesPlayed: 176,
    });
    expect(o.window.previousFrom).toBe('2026-09-29');
    expect(o.previous.gamesStarted).toBe(0);
    expect(o.calendar).toEqual([
      { day: D1, games: 3 },
      { day: D2, games: 3 },
    ]);
    expect(o.activity[0]).toEqual({
      t: D1,
      values: { codenames: 1, enigma: 1, echo: 1, reverie: 0, _all: 3 },
    });
    // 2026-10-01 is a Thursday (weekday 3): a game started at 18, 20 and 23.
    const cell = (weekday: number, hour: number) =>
      o.weekHour.find((c) => c.weekday === weekday && c.hour === hour)!.games;
    expect([cell(3, 18), cell(3, 20), cell(3, 23), cell(4, 18), cell(3, 19)]).toEqual([
      1, 1, 1, 1, 0,
    ]);
    expect(o.gameMix[0]).toEqual({ gameId: 'echo', games: 2, minutes: 100 });
    const hours = store.timeseries('games_started', win(D1, D1, 'hour')).series;
    expect(hours).toHaveLength(24);
    expect(hours[18]).toEqual({
      t: `${D1}T18`,
      values: { codenames: 1, enigma: 0, echo: 0, reverie: 0, _all: 1 },
    });
  });

  it('builds each game’s figures from its insight events', () => {
    const w = win(D1, D2);
    const fig = (game: string) =>
      Object.fromEntries(store.game(game, w).figures.map((f) => [f.id, f]));
    const cn = fig('codenames');
    expect(cn.wins).toMatchObject({
      parts: [
        { label: 'Red', value: 0 },
        { label: 'Blue', value: 2 },
      ],
    });
    expect(cn['assassin-rate']).toMatchObject({ value: 100 });
    expect(cn['average-clue']).toMatchObject({ value: 2 });
    expect(cn['guess-accuracy']).toMatchObject({ value: 33.3 });
    const en = fig('enigma');
    expect(
      [en['decode-rate'], en['intercept-rate'], en['rounds-per-game']].map(
        (f) => (f as { value: number }).value,
      ),
    ).toEqual([100, 0, 6]);
    const echo = fig('echo');
    expect(echo.scores).toMatchObject({ kind: 'histogram' });
    expect((echo.scores as { bins: { value: number }[] }).bins.at(-1)).toEqual({
      label: '8',
      value: 2,
    });
    expect(echo['best-score']).toMatchObject({ value: 8 });
    expect(echo['pass-rate']).toMatchObject({ value: 50 });
    expect(echo['perfect-games']).toMatchObject({ value: 2 });
    const rv = fig('reverie');
    expect(
      [rv['all-or-none'], rv['average-target']].map((f) => (f as { value: number }).value),
    ).toEqual([100, 30]);

    const cnStats = store.game('codenames', w);
    expect(cnStats).toMatchObject({
      averageMinutes: 28,
      averagePlayers: 4,
      playerCounts: [{ players: 4, games: 2 }],
    });
    expect(cnStats.settings).toEqual([
      { key: 'clueSeconds', value: 'off', label: 'Off', games: 2 },
      { key: 'timerMode', value: 'soft', label: 'soft', games: 2 },
      { key: 'wordList', value: 'starter', label: 'Starter words', games: 2 },
    ]);
    expect(store.games(w).games.find((g) => g.gameId === 'enigma')!.totals.gamesAbandoned).toBe(2);
  });

  it('lists players with aliases and hands out fun facts', () => {
    store.upsertPlayers(
      [{ playerId: 'ben', name: 'Benny', now: at(D2, 9), joinedRoom: false }],
      new Map([['ben', 3]]),
    );
    const w = win(D1, D2);
    const list = store.players(w).players;
    expect(list.map((p) => p.id).sort()).toEqual(['ana', 'ben', 'cy', 'dee']);
    expect(list.at(-1)!.id).toBe('dee');
    expect(list.find((p) => p.id === 'cy')).toMatchObject({
      games: 6,
      wins: 4,
      byGame: { codenames: 2, echo: 2, enigma: 2 },
    });

    const ben = store.player('ben', w)!;
    expect(ben).toMatchObject({ name: 'Benny', aliases: ['Benny', 'Ben'], games: 6 });
    expect(ben.calendar).toEqual([
      { day: D1, games: 3 },
      { day: D2, games: 3 },
    ]);
    expect(store.player('nobody', w)).toBeNull();

    const facts = Object.fromEntries(store.fun(w).facts.map((f) => [f.id, f]));
    expect(facts['assassin-magnet']).toMatchObject({
      playerId: 'ben',
      text: 'Benny found the assassin 2 times',
    });
    // Ana's two timed guesses are too few to count; Ben's six average 4 s.
    expect(facts['fastest-guesser']).toMatchObject({
      playerId: 'ben',
      text: 'Benny guessed in 4 s on average',
    });
    expect(facts['the-echo']).toMatchObject({ playerId: 'cy', gameId: 'echo' });
    expect(facts['perfect-echo']).toMatchObject({ value: 2 });
    expect(facts['longest-game']).toMatchObject({
      gameId: 'echo',
      text: 'The longest game was a 50-minute game of Echo',
    });
    expect(facts['riskiest-word']).toMatchObject({ text: '"bomb" was the assassin 2 times' });
    expect(facts['great-minds']).toMatchObject({ text: '"sea" cancelled itself out 2 times' });
    expect(ben.facts.map((f) => f.id)).toContain('assassin-magnet');
  });

  it('exports raw events as NDJSON in time order, across pages', () => {
    const many = Array.from({ length: 1500 }, (_, i) => ev(at(D3, 1) + i, 'action', 'echo'));
    store.append(many);
    const lines = [...store.exportNdjson(D3, D3)];
    expect(lines).toHaveLength(1500);
    const parsed = lines.map((l) => JSON.parse(l) as StatsEvent);
    expect(parsed.map((e) => e.ts)).toEqual(many.map((e) => e.ts));
    expect([...store.exportNdjson(D1, D1)]).toHaveLength(dayOfPlay(D1).length);
  });

  it('forgets everything on reset', () => {
    store.rollupDay(D1, at(D3, 1));
    store.reset();
    expect(store.firstDay()).toBeNull();
    expect(store.overview(win(D1, D2)).totals.gamesStarted).toBe(0);
    expect(store.player('ana', win(D1, D2))).toBeNull();
  });

  it('resolves ranges into windows', () => {
    expect(resolveWindow({ range: '7d' }, D3, null)).toEqual({
      from: '2026-09-27',
      to: D3,
      bucket: 'day',
      previousFrom: '2026-09-20',
      previousTo: '2026-09-26',
    });
    expect(resolveWindow({ range: 'today' }, D3, null)).toMatchObject({ from: D3, bucket: 'hour' });
    expect(resolveWindow({ range: 'all' }, D3, store.firstDay())).toMatchObject({ from: D1 });
    expect(resolveWindow({ range: '1y' }, D3, null)).toMatchObject({ bucket: 'week' });
    expect(resolveWindow({ range: '90d', bucket: 'hour' }, D3, null)).toMatchObject({
      bucket: 'day',
    });
    expect(resolveWindow({ range: 'custom', from: D3, to: D1 }, D3, null)).toBeTypeOf('string');
  });
});
