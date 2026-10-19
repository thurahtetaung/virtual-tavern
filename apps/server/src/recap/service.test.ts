import type { HallOfFame, RecapQuery, RoomRecap } from '@vt/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../db/index.ts';
import { buildGames } from '../games/registry.ts';
import { gameNamer } from '../game-settings.ts';
import type { RoomObservation } from '../rooms/manager.ts';
import { ulid } from '../stats/recorder.ts';
import { SqliteStatsStore } from '../stats/sqlite-store.ts';
import type { StatsEvent } from '../stats/types.ts';
import { MIGRATIONS } from '../test/helpers.ts';
import { RecapStore } from './hall.ts';
import { RecapService } from './service.ts';
import { RecapSettings } from './settings.ts';

const H = 60 * 60_000;
const PLAYERS = ['ana', 'ben', 'cy', 'dee'];

/** A recap service over a real in-memory database, with rooms faked and events written by hand. */
function setup() {
  const db = openDb(':memory:', MIGRATIONS);
  const games = buildGames();
  const stats = new SqliteStatsStore(db, { gameIds: [...games.keys()] });
  const store = new RecapStore(db);
  let now = Date.UTC(2026, 9, 10, 19);
  const clock = () => now;
  const settings = new RecapSettings(db, clock);
  const rooms = new Map<string, { gameId: string; hostId: string; players: typeof names }>();
  const names = PLAYERS.map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1) }));

  const emit = (
    roomId: string,
    type: string,
    props: Record<string, unknown> = {},
    playerId: string | null = null,
  ) => {
    const e: StatsEvent = {
      id: ulid(now),
      ts: now,
      day: new Date(now).toISOString().slice(0, 10),
      type,
      gameId: rooms.get(roomId)!.gameId,
      roomId,
      playerId,
      props,
    };
    stats.append([e]);
    return e;
  };
  const phase = { value: 'over' as 'lobby' | 'playing' | 'over' };
  /** Admin-set back-room titles. */
  const titles = new Map<string, string>();
  const service = new RecapService({
    source: stats,
    store,
    games,
    gameName: gameNamer(games, { title: (id) => titles.get(id) ?? null }),
    rooms: {
      members: (roomId) => {
        const r = rooms.get(roomId);
        return r ? { ...r, phase: phase.value } : null;
      },
      wrap: (roomId, by, props) => {
        emit(roomId, 'room.wrapped', props, by);
        return { ok: true };
      },
    },
    settings,
    flush: () => {},
    record: () => {},
    changed: () => {},
    logger: { warn: () => {}, error: () => {} },
    now: clock,
  });

  const open = (roomId: string, gameId: string, nightKey?: string) => {
    rooms.set(roomId, { gameId, hostId: 'ana', players: names });
    emit(roomId, 'room.created', nightKey ? { nightKey } : {}, 'ana');
    for (const p of names) emit(roomId, 'player.joined', { name: p.name }, p.id);
  };
  /** One finished game: Ana guesses in `guessMs`, Ana and Ben win. Returns its start event. */
  const play = (
    roomId: string,
    opts: { guessMs?: number; minutes?: number; end?: boolean } = {},
  ) => {
    const start = emit(roomId, 'game.started', { players: PLAYERS });
    now += 60_000;
    for (let i = 0; i < 3; i++)
      emit(roomId, 'insight.guess', { correct: true, actMs: opts.guessMs ?? 5_000 }, 'ana');
    if (opts.end === false) return start;
    finish(roomId, opts.minutes);
    return start;
  };
  function finish(roomId: string, minutes = 20) {
    now += minutes * 60_000;
    emit(roomId, 'game.ended', { finished: true, players: PLAYERS, winners: ['ana', 'ben'] });
    now += 5 * 60_000;
  }
  const ask = <T>(roomId: string, query: RecapQuery, unlocked = true) => {
    const res = service.recap(roomId, 'ana', query, { unlocked });
    if (!res.ok) throw new Error(res.error.code);
    return res.data as T;
  };
  /** The room host just started a game (as the room host would report it). */
  const started = (roomId: string) =>
    service.observe({
      kind: 'action',
      roomId,
      gameId: rooms.get(roomId)!.gameId,
      now,
      by: 'ana',
      before: { state: { phase: 'lobby' } },
      after: { state: { phase: 'playing' } },
      game: null,
    } as unknown as RoomObservation);
  return {
    db,
    stats,
    store,
    service,
    open,
    play,
    finish,
    ask,
    started,
    phase,
    titles,
    advance: (ms: number) => (now += ms),
  };
}

let t: ReturnType<typeof setup>;
beforeEach(() => {
  t = setup();
});

describe('frozen nights', () => {
  it('a wrapped-up night is frozen and never recomputed', () => {
    t.open('pub', 'codenames');
    t.play('pub');
    t.play('pub');
    const live = t.ask<RoomRecap>('pub', { scope: 'night' });
    expect(live.frozen).toBeUndefined();
    expect(t.service.wrap('pub', 'ana', 0)).toEqual({ ok: true, data: live.nightKey });
    const frozen = t.ask<RoomRecap>('pub', { scope: 'night' });
    expect(frozen).toMatchObject({ frozen: true, status: 'wrapped', nightKey: live.nightKey });
    const { previous: _p, ...card } = frozen;

    // Later events (a rename, a whole new night) leave the frozen card exactly as it was.
    t.advance(H);
    t.play('pub', { guessMs: 900 });
    const again = t.ask<RoomRecap>('pub', { scope: 'night', nightKey: live.nightKey });
    expect(again).toEqual(card);
    expect(t.service.wrap('pub', 'ana', 0)).toMatchObject({ ok: true });
    expect(t.ask<RoomRecap>('pub', { scope: 'night', nightKey: live.nightKey })).toEqual(card);
    // Both tones were frozen.
    t.service.setTone('pub', 'ana', 'wholesome', 0);
    expect(t.ask<RoomRecap>('pub', { scope: 'night', nightKey: live.nightKey }).tone).toBe(
      'wholesome',
    );
  });

  it("the next night's first game freezes the night before", () => {
    t.open('pub', 'codenames');
    const first = t.play('pub');
    t.advance(4 * H);
    expect(t.store.isFrozen('pub', first.id)).toBe(false);
    t.play('pub', { end: false });
    t.started('pub');
    expect(t.store.isFrozen('pub', first.id)).toBe(true);
    const current = t.ask<RoomRecap>('pub', { scope: 'night' });
    expect(current.games).toHaveLength(0);
    expect(current.running).toBe(1);
    expect(current.previous?.map((n) => n.nightKey)).toEqual([first.id]);
  });

  it('a swept room takes its recaps along; the stats reset does not', () => {
    t.open('pub', 'codenames');
    t.play('pub');
    t.service.wrap('pub', 'ana', 0);
    t.stats.reset();
    expect(t.store.nights('pub')).toHaveLength(1);
    expect(t.store.awards('pub').length).toBeGreaterThan(0);
    expect(t.store.records('pub').size).toBeGreaterThan(0);
    t.service.observe({ kind: 'room.swept', roomId: 'pub' } as RoomObservation);
    expect(t.store.nights('pub')).toEqual([]);
    expect(t.store.awards('pub')).toEqual([]);
    expect(t.store.records('pub').size).toBe(0);
  });
});

describe('room records', () => {
  it('a number that beats the room record gets the badge, and the record moves', () => {
    t.open('pub', 'codenames');
    t.play('pub', { guessMs: 4_000 });
    // The first night sets the record; there was nothing to beat yet.
    const first = t.ask<RoomRecap>('pub', { scope: 'night' });
    expect(first.nuggets.find((n) => n.text.startsWith('Fastest guess'))?.record).toBeUndefined();
    t.service.wrap('pub', 'ana', 0);
    expect(t.store.records('pub').get('codenames:codenames.fastest-guess')?.value).toBe(4);

    t.advance(H);
    t.play('pub', { guessMs: 2_000 });
    const faster = t.ask<RoomRecap>('pub', { scope: 'night' });
    expect(faster.nuggets.find((n) => n.text.startsWith('Fastest guess'))).toEqual({
      emoji: '⚡',
      text: 'Fastest guess: 2 s',
      record: true,
    });
    t.service.wrap('pub', 'ana', 0);
    expect(t.store.records('pub').get('codenames:codenames.fastest-guess')?.value).toBe(2);

    t.advance(H);
    t.play('pub', { guessMs: 3_000 });
    const slower = t.ask<RoomRecap>('pub', { scope: 'night' });
    expect(slower.nuggets.some((n) => n.record)).toBe(false);
    const hall = t.ask<HallOfFame>('pub', { scope: 'hall' });
    expect(hall.records.find((r) => r.id === 'codenames:codenames.fastest-guess')?.text).toBe(
      'Fastest guess: 2 s',
    );
  });
});

describe('the hall of fame', () => {
  it('counts MVPs, favourite awards and nights together', () => {
    t.open('pub', 'codenames');
    for (let night = 0; night < 2; night++) {
      t.play('pub');
      t.play('pub');
      t.service.wrap('pub', 'ana', 0);
      t.advance(H);
    }
    t.play('pub');
    const hall = t.ask<HallOfFame>('pub', { scope: 'hall' });
    // Two frozen nights and tonight's live one.
    expect(hall.nights).toBe(3);
    expect(hall.previous).toHaveLength(2);
    expect(hall.previous[0]!.mix).toEqual([{ gameId: 'codenames', name: 'Codenames', count: 2 }]);
    expect(hall.mvps[0]).toMatchObject({ count: 2 });
    expect(['Ana', 'Ben']).toContain(hall.mvps[0]!.name);
    expect(hall.previous.every((n) => n.mvp)).toBe(true);
  });
});

describe('linked nights ("Same crew, new game")', () => {
  /** A public Codenames room, then a back-room table continuing its night. */
  function linked() {
    t.open('pub', 'codenames');
    const first = t.play('pub');
    t.open('priv', 'nightfall', first.id);
    t.play('priv');
    return first.id;
  }

  it('merges the rooms that share a night key into one night', () => {
    const key = linked();
    const card = t.ask<RoomRecap>('pub', { scope: 'night' });
    expect(card.nightKey).toBe(key);
    expect(card.games.map((g) => [g.gameId, g.elsewhere ?? false])).toEqual([
      ['codenames', false],
      ['nightfall', true],
    ]);
    // The new table sees the same night, its own game at home.
    const there = t.ask<RoomRecap>('priv', { scope: 'night' });
    expect(there.nightKey).toBe(key);
    expect(there.games.map((g) => g.elsewhere ?? false)).toEqual([true, false]);
    expect(t.service.linkable(key, 'ana')?.sort()).toEqual(['priv', 'pub']);
    expect(t.service.linkable(key, 'stranger')).toBeNull();
  });

  it('shows a locked viewer only the public rooms, not even a count of the others', () => {
    const key = linked();
    t.play('priv', { end: false });
    const locked = t.ask<RoomRecap>('pub', { scope: 'night' }, false);
    expect(locked.games.map((g) => g.gameId)).toEqual(['codenames']);
    expect(locked.running).toBe(0);
    expect(JSON.stringify(locked)).not.toMatch(/nightfall|priv/i);
    const unlocked = t.ask<RoomRecap>('pub', { scope: 'night' }, true);
    expect(unlocked.games).toHaveLength(2);
    expect(unlocked.running).toBe(1);

    // Frozen, the card keeps a public-only variant for locked viewers.
    t.advance(30 * 60_000);
    t.finish('priv');
    expect(t.service.wrap('pub', 'ana', 0)).toMatchObject({ ok: true, data: key });
    const frozenLocked = t.ask<RoomRecap>('pub', { scope: 'night', nightKey: key }, false);
    expect(frozenLocked.games.map((g) => g.gameId)).toEqual(['codenames']);
    expect(JSON.stringify(frozenLocked)).not.toMatch(/nightfall/i);
    expect(t.ask<RoomRecap>('pub', { scope: 'night', nightKey: key }, true).games).toHaveLength(3);
    const hall = t.ask<HallOfFame>('pub', { scope: 'hall' }, false);
    expect(hall.previous.map((n) => n.games)).toEqual([1]);
    expect(JSON.stringify(hall)).not.toMatch(/nightfall/i);
  });

  it('names a back-room game by its title where one is set, else by its code name', () => {
    const key = linked();
    const names = (card: RoomRecap) => card.games.map((g) => g.name);
    expect(names(t.ask<RoomRecap>('pub', { scope: 'night' }))).toEqual(['Codenames', 'Nightfall']);
    t.titles.set('nightfall', 'Moonlit Village');
    // Public games keep their own name, whatever the settings say.
    t.titles.set('codenames', 'Not This');
    expect(names(t.ask<RoomRecap>('pub', { scope: 'night' }))).toEqual([
      'Codenames',
      'Moonlit Village',
    ]);
    const locked = t.ask<RoomRecap>('pub', { scope: 'night' }, false);
    expect(JSON.stringify(locked)).not.toMatch(/nightfall|moonlit/i);

    // A frozen card shows the title as it is now, set before or after the night was frozen.
    t.advance(30 * 60_000);
    expect(t.service.wrap('pub', 'ana', 0)).toMatchObject({ ok: true, data: key });
    t.titles.set('nightfall', 'Village After Dark');
    const frozen = t.ask<RoomRecap>('pub', { scope: 'night', nightKey: key });
    expect(names(frozen)).toEqual(['Codenames', 'Village After Dark']);
    expect(JSON.stringify(t.ask<HallOfFame>('pub', { scope: 'hall' }))).toContain(
      'Village After Dark',
    );
    expect(t.service.recent(5)[0]?.mix.map((m) => m.name)).toEqual([
      'Codenames',
      'Village After Dark',
    ]);
    const lockedHall = t.ask<HallOfFame>('pub', { scope: 'hall' }, false);
    expect(JSON.stringify(lockedHall)).not.toMatch(/nightfall|village/i);
    t.titles.clear();
    expect(names(t.ask<RoomRecap>('pub', { scope: 'night', nightKey: key }))).toEqual([
      'Codenames',
      'Nightfall',
    ]);
  });

  it('a night across three different games reads every room', () => {
    t.open('a', 'codenames');
    const first = t.play('a');
    t.open('b', 'masquerade', first.id);
    t.play('b');
    // A table opened from the second one carries the same night along.
    t.open('c', 'echo', first.id);
    t.play('c');
    for (const room of ['a', 'b', 'c']) {
      const card = t.ask<RoomRecap>(room, { scope: 'night' });
      expect(card.nightKey).toBe(first.id);
      expect(card.games.map((g) => g.gameId)).toEqual(['codenames', 'masquerade', 'echo']);
    }
  });
});
