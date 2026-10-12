import type { AnyGameDefinition, InsightEvent } from '@vt/game-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { openDb } from '../db/index.ts';
import { RoomManager, type RoomObserver } from '../rooms/manager.ts';
import { SqliteRoomStore } from '../rooms/store.ts';
import { MIGRATIONS } from '../test/helpers.ts';
import { WordListRepo } from '../word-lists.ts';
import { dayOf } from './days.ts';
import { FLUSH_EVERY_MS, StatsRecorder } from './recorder.ts';
import { SqliteStatsStore } from './sqlite-store.ts';
import type { StatsEvent } from './types.ts';

interface QuizState {
  phase: 'lobby' | 'playing' | 'over';
  settings: { wordListIds: string[]; clueSeconds: number | null; deckSize: number };
  seats: Record<string, { name: string; playing: boolean }>;
  stage: 'clue' | 'guess';
  score: number;
  gamesPlayed: number;
}

type QuizAction =
  | { type: 'start' | 'finish' | 'lobby' | 'boom' }
  | { type: 'clue'; word: string }
  | { type: 'guess'; word: string; right: boolean };

/** A tiny game with the shape every real game shares (`phase`, `seats`, `settings`). */
const quiz: AnyGameDefinition = {
  id: 'quiz',
  name: 'Quiz',
  description: '',
  minPlayers: 1,
  maxPlayers: 8,
  guide: { tagline: '', players: '', duration: '', goal: '', setup: [], sections: [], tips: [] },
  actionSchema: z.object({
    type: z.string(),
    word: z.string().optional(),
    right: z.boolean().optional(),
  }),
  create: (): QuizState => ({
    phase: 'lobby',
    settings: { wordListIds: ['list-a', 'list-b'], clueSeconds: null, deckSize: 8 },
    seats: {},
    stage: 'clue',
    score: 0,
    gamesPlayed: 0,
  }),
  reduce: (s: QuizState, a: QuizAction): QuizState => {
    switch (a.type) {
      case 'start':
        return { ...s, phase: 'playing', stage: 'clue', score: 0 };
      case 'clue':
        return { ...s, stage: 'guess' };
      case 'guess':
        return { ...s, stage: 'clue', score: s.score + (a.right ? 1 : 0) };
      case 'finish':
        return { ...s, phase: 'over', gamesPlayed: s.gamesPlayed + 1 };
      case 'lobby':
        return { ...s, phase: 'lobby' };
      case 'boom':
        return { ...s, score: s.score + 100 };
    }
  },
  playerJoined: (s: QuizState, p: { id: string; name: string }): QuizState => ({
    ...s,
    seats: { ...s.seats, [p.id]: { name: p.name, playing: p.id !== 'watcher' } },
  }),
  playerLeft: (s: QuizState, id: string): QuizState => {
    const seats = { ...s.seats };
    delete seats[id];
    return { ...s, seats };
  },
  view: (s: unknown) => s,
  insights: (before: QuizState, after: QuizState, a: QuizAction | null, by: string | null) => {
    if (!a) return [];
    const out: InsightEvent[] = [];
    if (a.type === 'boom') throw new Error('insights bug');
    if (a.type === 'clue')
      out.push({ type: 'clue', playerId: by, words: [{ kind: 'clue', word: a.word }] });
    if (a.type === 'guess')
      out.push({
        type: 'guess',
        playerId: by,
        words: [{ kind: 'guess', word: a.word }],
        props: { correct: a.right },
      });
    if (a.type === 'finish')
      out.push({
        type: 'outcome',
        winners: Object.keys(after.seats).filter((id) => after.seats[id]!.playing),
        props: { score: after.score, from: before.score },
      });
    return out;
  },
};

const START = Date.UTC(2026, 9, 10, 12, 0, 0);

describe('StatsRecorder', () => {
  let now = START;
  let db: ReturnType<typeof openDb>;
  let store: SqliteStatsStore;
  let recorder: StatsRecorder;
  let rooms: RoomManager;
  const logger = { warn: vi.fn(), error: vi.fn() };

  function manager(observer: RoomObserver) {
    return new RoomManager({
      store: new SqliteRoomStore(db),
      games: new Map([['quiz', quiz]]),
      content: new WordListRepo(db),
      events: { changed: vi.fn(), kicked: vi.fn() },
      now: () => now,
      logger,
      observer,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    now = START;
    db = openDb(':memory:', MIGRATIONS);
    store = new SqliteStatsStore(db, { gameIds: ['quiz'] });
    recorder = new StatsRecorder({ store, logger });
    rooms = manager(recorder);
    logger.warn.mockClear();
    logger.error.mockClear();
  });
  afterEach(() => {
    rooms.close();
    vi.useRealTimers();
  });

  const events = (): StatsEvent[] =>
    [...store.exportNdjson('0000-01-01', '9999-12-31')].map((l) => JSON.parse(l) as StatsEvent);
  const act = (roomId: string, by: string, action: QuizAction, after = 1000) => {
    now += after;
    expect(rooms.act(roomId, by, action)).toEqual({ ok: true });
  };

  function room() {
    const id = rooms.create('quiz', 'ana');
    rooms.join(id, 'ana', 'Ana');
    rooms.join(id, 'ben', 'Ben');
    rooms.join(id, 'watcher', 'Wat');
    return id;
  }

  it('records a game from start to finish, with players, settings and time to act', () => {
    const id = room();
    rooms.rename(id, 'ben', 'Benny');
    act(id, 'ana', { type: 'start' });
    act(id, 'ana', { type: 'clue', word: 'Ocean' }, 5000);
    act(id, 'ben', { type: 'guess', word: 'Wave', right: true }, 3000);
    act(id, 'ana', { type: 'finish' }, 51_000);
    recorder.flush();

    const all = events();
    expect(all.map((e) => e.type)).toEqual([
      'room.created',
      'player.joined',
      'player.joined',
      'player.joined',
      'player.renamed',
      'action',
      'game.started',
      'action',
      'insight.clue',
      'action',
      'insight.guess',
      'action',
      'insight.outcome',
      'game.ended',
    ]);
    expect(all.every((e) => e.day === dayOf(START) && e.gameId === 'quiz' && e.roomId === id)).toBe(
      true,
    );
    const started = all.find((e) => e.type === 'game.started')!;
    expect(started.props).toEqual({
      players: ['ana', 'ben'],
      settings: ['wordList=list-a', 'wordList=list-b', 'clueSeconds=off', 'deckSize=8'],
      gameNo: 0,
    });
    expect(all.find((e) => e.type === 'insight.guess')).toMatchObject({
      playerId: 'ben',
      props: { correct: true, actMs: 3000, words: [{ kind: 'guess', word: 'Wave' }] },
    });
    expect(all.find((e) => e.type === 'game.ended')!.props).toEqual({
      finished: true,
      durationMs: 59_000,
      players: ['ana', 'ben'],
      winners: ['ana', 'ben'],
    });
  });

  it('counts a game left for the lobby as abandoned', () => {
    const id = room();
    act(id, 'ana', { type: 'start' });
    act(id, 'ana', { type: 'lobby' }, 30_000);
    recorder.flush();
    expect(events().find((e) => e.type === 'game.ended')!.props).toMatchObject({
      finished: false,
      durationMs: 30_000,
    });
  });

  it('finishes a game that was started before a restart', () => {
    const id = room();
    act(id, 'ana', { type: 'start' });
    recorder.flush();
    rooms.close();
    // A new process: fresh recorder and manager over the same database.
    recorder = new StatsRecorder({ store, logger });
    rooms = manager(recorder);
    act(id, 'ana', { type: 'finish' }, 90_000);
    recorder.flush();
    expect(events().find((e) => e.type === 'game.ended')!.props).toMatchObject({
      finished: true,
      durationMs: 90_000,
      players: ['ana', 'ben'],
    });
  });

  it('ends an abandoned game when its room is swept', () => {
    const id = room();
    act(id, 'ana', { type: 'start' });
    now += 8 * 24 * 60 * 60_000;
    expect(rooms.sweep(7 * 24 * 60 * 60_000)).toBe(1);
    recorder.flush();
    const ended = events().filter((e) => e.type === 'game.ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.props).toMatchObject({ finished: false, reason: 'swept', durationMs: 0 });
    expect(events().at(-1)!.type).toBe('room.swept');
  });

  it('notes host changes', () => {
    const id = room();
    expect(rooms.makeHost(id, 'ana', 'ben')).toEqual({ ok: true });
    recorder.flush();
    expect(events().find((e) => e.type === 'host.changed')).toMatchObject({
      playerId: 'ben',
      props: { from: 'ana' },
    });
  });

  it('keeps every name a player used', () => {
    const id = room();
    rooms.rename(id, 'ben', 'Benny');
    rooms.rename(id, 'ben', 'Ben');
    act(id, 'ana', { type: 'start' });
    recorder.flush();
    const day = dayOf(START);
    const w = { from: day, to: day, bucket: 'day' as const, previousFrom: day, previousTo: day };
    const ben = store.player('ben', w)!;
    expect(ben.name).toBe('Ben');
    // Joined as Ben, renamed twice, then seen as Ben again at the game start.
    expect(ben.names.map((n) => [n.name, n.uses])).toEqual([
      ['Ben', 3],
      ['Benny', 1],
    ]);
    expect(ben.aliases).toEqual(['Ben', 'Benny']);
    expect(ben.games).toBe(1);
  });

  it('buffers writes and flushes them every couple of seconds', () => {
    const id = room();
    act(id, 'ana', { type: 'start' });
    expect(events()).toEqual([]);
    vi.advanceTimersByTime(FLUSH_EVERY_MS);
    expect(events().length).toBeGreaterThan(0);
  });

  it('never lets a failing insight, store or observer reach the room host', () => {
    const id = room();
    act(id, 'ana', { type: 'start' });
    act(id, 'ana', { type: 'boom' });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: id }),
      'game insights failed',
    );

    vi.spyOn(store, 'append').mockImplementation(() => {
      throw new Error('disk full');
    });
    act(id, 'ana', { type: 'finish' });
    expect(() => recorder.flush()).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/flush/));

    rooms.close();
    rooms = manager({
      observe: () => {
        throw new Error('observer bug');
      },
    });
    act(id, 'ana', { type: 'start' });
    expect(rooms.join(id, 'cy', 'Cy')).toEqual({ ok: true });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: id }),
      'stats observer failed',
    );
  });

  it('records nothing for a test room, from opening to sweep', () => {
    const players = () =>
      db.$client.prepare('select count(*) from stats_players').pluck().get() as number;
    rooms.close();
    recorder = new StatsRecorder({ store, logger, isTestRoom: (r) => rooms.isTest(r) });
    rooms = manager(recorder);
    const id = rooms.create('quiz', 'ana', { test: true });
    rooms.join(id, 'ana', 'Ana');
    rooms.join(id, 'ben', 'Ben');
    act(id, 'ana', { type: 'start' });
    act(id, 'ana', { type: 'clue', word: 'Ocean' });
    act(id, 'ana', { type: 'finish' });
    recorder.record('recap.viewed', { roomId: id, gameId: 'quiz', playerId: 'ana', now });
    now += 8 * 24 * 60 * 60_000;
    expect(rooms.sweep(7 * 24 * 60 * 60_000)).toBe(1);
    recorder.flush();
    expect(events()).toEqual([]);
    expect(players()).toBe(0);
  });

  it('stops recording once a test player joins, even mid-game and after a restart', () => {
    const id = room();
    act(id, 'ana', { type: 'start' });
    recorder.flush();
    const before = events().length;
    rooms.join(id, 'bot', 'Bot', { test: true });
    act(id, 'ana', { type: 'finish' });
    // A fresh manager reads the mark back from the database.
    rooms.close();
    rooms = manager(recorder);
    expect(rooms.isTest(id)).toBe(true);
    now += 8 * 24 * 60 * 60_000;
    expect(rooms.sweep(7 * 24 * 60 * 60_000)).toBe(1);
    recorder.flush();
    expect(events()).toHaveLength(before);
    expect(events().some((e) => e.playerId === 'bot')).toBe(false);
  });
});
