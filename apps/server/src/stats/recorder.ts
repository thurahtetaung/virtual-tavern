import { randomBytes } from 'node:crypto';
import type { InsightEvent } from '@vt/game-sdk';
import type { RoomLogger, RoomObservation, RoomObserver } from '../rooms/manager.ts';
import type { RoomRecord } from '../rooms/store.ts';
import { dayOf } from './days.ts';
import type { PlayerSighting, StatsEvent, StatsStore } from './types.ts';

/** How long buffered events wait before they are written. */
export const FLUSH_EVERY_MS = 2_000;
/** A buffer this large is written at once. */
const FLUSH_AT = 500;
/** "Recently online" means seen within this long. */
export const RECENT_MS = 5 * 60_000;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = -1;
let lastRandom: number[] = [];

/**
 * A ULID: 48-bit time then 80 random bits, Crockford base32. Monotonic within a process (ids made
 * in the same millisecond count up), so events sort in the order they happened.
 */
export function ulid(now: number): string {
  if (now <= lastTime) {
    // Same (or an earlier) millisecond: keep the time and add one to the random part.
    let i = lastRandom.length - 1;
    while (i >= 0 && lastRandom[i] === 31) lastRandom[i--] = 0;
    if (i >= 0) lastRandom[i]! += 1;
  } else {
    lastTime = now;
    lastRandom = [...randomBytes(16)].map((b) => b % 32);
  }
  let time = '';
  let t = lastTime;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  return time + lastRandom.map((d) => CROCKFORD[d]).join('');
}

interface StateShape {
  phase?: unknown;
  settings?: unknown;
  seats?: unknown;
  gamesPlayed?: unknown;
  stage?: unknown;
  round?: unknown;
  cardsLeft?: unknown;
  turn?: { stage?: unknown; phase?: unknown; team?: unknown; guesser?: unknown; round?: unknown };
}

const shape = (state: unknown): StateShape =>
  state !== null && typeof state === 'object' ? state : {};
const phaseOf = (state: unknown) => {
  const p = shape(state).phase;
  return typeof p === 'string' ? p : null;
};

/** Who is playing (not watching): seated on a team, or sitting in; else everyone in the room. */
export function participants(record: RoomRecord): string[] {
  const seats = shape(record.state).seats;
  if (seats !== null && typeof seats === 'object') {
    const ids = Object.entries(seats as Record<string, { team?: unknown; playing?: unknown }>)
      .filter(([, seat]) =>
        seat.team !== undefined
          ? seat.team !== null
          : seat.playing !== undefined
            ? seat.playing === true
            : true,
      )
      .map(([id]) => id);
    if (ids.length) return ids;
  }
  return record.players.map((p) => p.id);
}

const SETTING_KEYS: Record<string, string> = { wordListIds: 'wordList', sets: 'cardSet' };

/** The game's settings as `key=value` strings; lists become one entry per item. */
export function settingsOf(state: unknown): string[] {
  const settings = shape(state).settings;
  if (settings === null || typeof settings !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(settings as Record<string, unknown>)) {
    const name = SETTING_KEYS[k] ?? k;
    const values = Array.isArray(v) ? v : [v];
    for (const item of values) {
      if (item === null) out.push(`${name}=off`);
      else if (['string', 'number', 'boolean'].includes(typeof item))
        out.push(`${name}=${String(item as string | number | boolean).slice(0, 80)}`);
    }
  }
  return out;
}

/** Changes whenever play moves to a new step, which restarts the time-to-act clock. */
function stageKey(state: unknown): string {
  const s = shape(state);
  const t = s.turn ?? {};
  return JSON.stringify([
    s.phase,
    s.stage,
    s.round,
    s.cardsLeft,
    t.stage,
    t.phase,
    t.team,
    t.guesser,
    t.round,
  ]);
}

interface ActiveGame {
  startedAt: number;
  players: string[];
}

export interface StatsRecorderOptions {
  store: StatsStore;
  logger: RoomLogger;
  flushEveryMs?: number;
}

/**
 * Turns what the room host does into stats events. It never throws into the host, and play
 * never waits on it: events are buffered and written every couple of seconds (and on close).
 */
export class StatsRecorder implements RoomObserver {
  private readonly store: StatsStore;
  private readonly logger: RoomLogger;
  private readonly flushEveryMs: number;
  private events: StatsEvent[] = [];
  private sightings: PlayerSighting[] = [];
  private gamesPlayed = new Map<string, number>();
  private readonly active = new Map<string, ActiveGame>();
  /** When each room last moved to a new step (or reported an insight). */
  private readonly anchors = new Map<string, number>();
  private readonly recent = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;

  constructor(opts: StatsRecorderOptions) {
    this.store = opts.store;
    this.logger = opts.logger;
    this.flushEveryMs = opts.flushEveryMs ?? FLUSH_EVERY_MS;
  }

  observe(o: RoomObservation): void {
    try {
      this.handle(o);
    } catch (err) {
      this.logger.error({ roomId: o.roomId, kind: o.kind, err }, 'stats recording failed');
    }
  }

  /** Players seen (any activity) since `since`. */
  recentPlayers(since: number): string[] {
    const out: string[] = [];
    for (const [id, at] of this.recent) {
      if (at >= since) out.push(id);
      else this.recent.delete(id);
    }
    return out;
  }

  /** Writes everything buffered. Safe to call at any time; failures are logged and dropped. */
  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    const events = this.events;
    const sightings = this.sightings;
    const games = this.gamesPlayed;
    this.events = [];
    this.sightings = [];
    this.gamesPlayed = new Map();
    try {
      this.store.append(events);
      this.store.upsertPlayers(sightings, games);
    } catch (err) {
      this.logger.error({ err, events: events.length }, 'stats flush failed; events dropped');
    }
  }

  /** Forgets anything buffered or in progress (after an admin reset). */
  reset(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.events = [];
    this.sightings = [];
    this.gamesPlayed = new Map();
    this.active.clear();
    this.anchors.clear();
  }

  close(): void {
    this.flush();
  }

  private handle(o: RoomObservation) {
    const { now, by, roomId } = o;
    if (by) this.recent.set(by, now);
    const emit = (type: string, playerId: string | null, props: Record<string, unknown> = {}) =>
      this.push({
        id: ulid(now),
        ts: now,
        day: dayOf(now),
        type,
        gameId: o.gameId,
        roomId,
        playerId,
        props,
      });
    switch (o.kind) {
      case 'player.connected':
      case 'player.disconnected':
        return;
      case 'room.created':
        emit('room.created', by);
        return;
      case 'room.swept':
        this.sweep(o);
        return;
      case 'player.joined':
      case 'player.renamed':
        emit(o.kind, by, { name: o.name ?? '' });
        if (by)
          this.sightings.push({
            playerId: by,
            name: o.name ?? '',
            now,
            joinedRoom: o.kind === 'player.joined',
          });
        break;
      case 'player.left':
      case 'player.kicked':
        emit(o.kind, by);
        break;
      case 'action': {
        const type = (o.action as { type?: unknown } | null)?.type;
        emit('action', by, typeof type === 'string' ? { action: type } : {});
        break;
      }
      case 'host.changed':
      case 'deadline':
        break;
    }
    const { before, after } = o;
    if (!before || !after) return;
    if (before.hostId !== after.hostId) emit('host.changed', after.hostId, { from: before.hostId });
    if (before.state !== after.state) this.lifecycle(o, before, after, emit);
  }

  private lifecycle(
    o: RoomObservation,
    before: RoomRecord,
    after: RoomRecord,
    emit: (type: string, playerId: string | null, props?: Record<string, unknown>) => void,
  ) {
    const { now, roomId } = o;
    const was = phaseOf(before.state);
    const is = phaseOf(after.state);
    if (is === 'playing' && was !== 'playing') this.start(o, after, emit);

    let insights: InsightEvent[] = [];
    if ((o.kind === 'action' || o.kind === 'deadline') && o.game?.insights) {
      try {
        insights = o.game.insights(
          before.state,
          after.state,
          o.kind === 'action' ? o.action : null,
          o.kind === 'action' ? o.by : null,
        );
      } catch (err) {
        this.logger.warn({ roomId, gameId: o.gameId, err }, 'game insights failed');
      }
    }
    const anchor = this.anchors.get(roomId);
    const winners = new Set<string>();
    for (const ev of Array.isArray(insights) ? insights : []) {
      const props: Record<string, unknown> = { ...ev.props };
      if (ev.words?.length) props.words = ev.words;
      if (ev.winners?.length) {
        props.winners = ev.winners;
        for (const w of ev.winners) winners.add(w);
      }
      if (o.kind === 'action' && ev.playerId && ev.playerId === o.by && anchor !== undefined)
        props.actMs = now - anchor;
      emit(`insight.${ev.type}`, ev.playerId ?? null, props);
    }

    if (was === 'playing' && is !== 'playing') {
      this.end(o, before, is === 'over', [...winners], emit);
    }
    if (insights.length || stageKey(before.state) !== stageKey(after.state))
      this.anchors.set(roomId, now);
  }

  private start(
    o: RoomObservation,
    after: RoomRecord,
    emit: (type: string, playerId: string | null, props?: Record<string, unknown>) => void,
  ) {
    const players = participants(after);
    const gamesPlayed = shape(after.state).gamesPlayed;
    emit('game.started', null, {
      players,
      settings: settingsOf(after.state),
      ...(typeof gamesPlayed === 'number' ? { gameNo: gamesPlayed } : {}),
    });
    this.active.set(o.roomId, { startedAt: o.now, players });
    const names = new Map(after.players.map((p) => [p.id, p.name]));
    for (const id of players) {
      this.sightings.push({
        playerId: id,
        name: names.get(id) ?? '',
        now: o.now,
        joinedRoom: false,
      });
      this.gamesPlayed.set(id, (this.gamesPlayed.get(id) ?? 0) + 1);
    }
  }

  private end(
    o: RoomObservation,
    before: RoomRecord,
    finished: boolean,
    winners: string[],
    emit: (type: string, playerId: string | null, props?: Record<string, unknown>) => void,
  ) {
    const game = this.active.get(o.roomId) ?? this.reopen(o.roomId);
    this.active.delete(o.roomId);
    emit('game.ended', null, {
      finished,
      durationMs: game ? Math.max(0, o.now - game.startedAt) : 0,
      players: game?.players ?? participants(before),
      winners,
    });
  }

  /** A game started before a restart: its start is in the store. */
  private reopen(roomId: string): ActiveGame | null {
    const open = this.store.openGame(roomId);
    if (!open) return null;
    const players = Array.isArray(open.props.players)
      ? open.props.players.filter((p): p is string => typeof p === 'string')
      : [];
    return { startedAt: open.ts, players };
  }

  private sweep(o: RoomObservation) {
    const open = this.active.has(o.roomId) ? null : this.store.openGame(o.roomId);
    const game = this.active.get(o.roomId) ?? (open && this.reopen(o.roomId));
    this.active.delete(o.roomId);
    this.anchors.delete(o.roomId);
    // A room that was not loaded only names its game through its last start.
    const gameId = o.gameId || open?.gameId;
    if (!gameId) return;
    const emit = (type: string, props: Record<string, unknown>) =>
      this.push({
        id: ulid(o.now),
        ts: o.now,
        day: dayOf(o.now),
        type,
        gameId,
        roomId: o.roomId,
        playerId: null,
        props,
      });
    if (game) {
      // Left mid-game and never came back: abandoned, timed up to the room's last change.
      const lastChange = o.before?.updatedAt ?? game.startedAt;
      emit('game.ended', {
        finished: false,
        durationMs: Math.max(0, lastChange - game.startedAt),
        players: game.players,
        winners: [],
        reason: 'swept',
      });
    }
    emit('room.swept', {});
  }

  private push(e: StatsEvent) {
    this.events.push(e);
    if (this.events.length >= FLUSH_AT) {
      this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushEveryMs);
      this.timer.unref();
    }
  }
}
