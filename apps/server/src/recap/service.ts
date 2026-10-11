import type { AnyGameDefinition } from '@vt/game-sdk';
import type { Ack, AckWith, GameRecap, RecapQuery, RecapTone, RoomRecap } from '@vt/protocol';
import type { RoomLogger, RoomManager } from '../rooms/manager.ts';
import { FORGOTTEN } from '../stats/sqlite-store.ts';
import type { RecapSource } from '../stats/types.ts';
import { runEngine } from './engine.ts';
import { NIGHT_MAX_MS, currentNight } from './night.ts';
import { type RecapSettings, isTone, tzOffset } from './settings.ts';

/** Cached cards (one per room and tone; a new event replaces it). */
const CACHE_SIZE = 200;
/** How far back a night's names and events are read, before its latest game start. */
const LOOKBACK_MS = NIGHT_MAX_MS + 60 * 60_000;

const fail = <T>(code: string, message: string): AckWith<T> => ({
  ok: false,
  error: { code, message },
});
const failAck = (code: string, message: string): Ack => ({ ok: false, error: { code, message } });

export interface RecapServiceDeps {
  source: RecapSource;
  games: ReadonlyMap<string, AnyGameDefinition>;
  rooms: Pick<RoomManager, 'members' | 'wrap'>;
  settings: RecapSettings;
  /** Writes buffered stats events, so the recap sees the game that just ended. */
  flush: () => void;
  /** Usage counts (`recap.viewed`, `recap.shared`). */
  record: (
    type: 'recap.viewed' | 'recap.shared',
    at: { roomId: string; gameId: string; playerId: string; now: number },
    props?: Record<string, unknown>,
  ) => void;
  /** Sends everyone in the room a fresh snapshot (the tone is in it). */
  changed: (roomId: string) => void;
  logger: RoomLogger;
  now: () => number;
}

const RECAP_OFF = 'Night recaps are switched off.';

/**
 * Tavern night recaps for one room's members: reads the room's stats events, finds the current
 * night, and runs the award engine. Membership and the back-room unlock are checked by the
 * socket layer before any call reaches here; this checks membership again and the kill switch.
 */
export class RecapService {
  private readonly deps: RecapServiceDeps;
  private readonly cache = new Map<string, { key: string; recap: RoomRecap }>();

  constructor(deps: RecapServiceDeps) {
    this.deps = deps;
  }

  /** The room's recap settings for its snapshot. */
  meta(roomId: string): { recap: boolean; tone: RecapTone } {
    return { recap: this.deps.settings.enabled(), tone: this.deps.settings.room(roomId).tone };
  }

  recap(
    roomId: string,
    playerId: string,
    query: RecapQuery,
  ): AckWith<GameRecap | RoomRecap | null> {
    if (!this.deps.settings.enabled()) return fail('recap-off', RECAP_OFF);
    const room = this.deps.rooms.members(roomId);
    if (!room) return fail('no-room', 'Room not found.');
    if (!room.players.some((p) => p.id === playerId)) return fail('not-in-room', 'Join first.');
    let recap: RoomRecap;
    try {
      recap = this.night(roomId, room);
    } catch (err) {
      this.deps.logger.error({ roomId, err }, 'recap failed');
      return fail('recap-unavailable', "The recap isn't available right now.");
    }
    if (query.opened) {
      this.deps.record('recap.viewed', {
        roomId,
        gameId: room.gameId,
        playerId,
        now: this.deps.now(),
      });
    }
    if (query.scope === 'game') {
      // Only once the room's latest game is over: never anything about a game in play.
      const last = recap.running === 0 && room.phase === 'over' ? recap.games.at(-1) : undefined;
      return { ok: true, data: last ?? null };
    }
    return { ok: true, data: recap };
  }

  wrap(roomId: string, playerId: string, tz: unknown): AckWith<string> {
    if (!this.deps.settings.enabled()) return fail('recap-off', RECAP_OFF);
    const room = this.deps.rooms.members(roomId);
    if (!room) return fail('no-room', 'Room not found.');
    if (!room.players.some((p) => p.id === playerId)) return fail('not-in-room', 'Join first.');
    if (room.hostId !== playerId) return fail('not-host', 'Only the host can wrap up the night.');
    const recap = this.night(roomId, room);
    if (!recap.games.length) return fail('nothing-to-wrap', 'Finish a game first.');
    const offset = tzOffset(tz);
    if (offset !== null) this.deps.settings.update(roomId, { tzOffsetMin: offset });
    const res = this.deps.rooms.wrap(roomId, playerId, {
      tone: this.deps.settings.room(roomId).tone,
      ...(offset !== null && { tz: offset }),
    });
    if (!res.ok) return res;
    return { ok: true, data: recap.nightKey };
  }

  setTone(roomId: string, playerId: string, tone: unknown, tz: unknown): Ack {
    if (!this.deps.settings.enabled()) return failAck('recap-off', RECAP_OFF);
    if (!isTone(tone)) return failAck('bad-request', 'Pick Cheeky or Wholesome.');
    const room = this.deps.rooms.members(roomId);
    if (!room) return failAck('no-room', 'Room not found.');
    if (room.hostId !== playerId)
      return failAck('not-host', 'Only the host can change the recap tone.');
    const offset = tzOffset(tz);
    this.deps.settings.update(roomId, { tone, ...(offset !== null && { tzOffsetMin: offset }) });
    this.deps.changed(roomId);
    return { ok: true };
  }

  shared(roomId: string, playerId: string, how: unknown): Ack {
    if (!this.deps.settings.enabled()) return failAck('recap-off', RECAP_OFF);
    const room = this.deps.rooms.members(roomId);
    if (!room?.players.some((p) => p.id === playerId)) return failAck('not-in-room', 'Join first.');
    this.deps.record(
      'recap.shared',
      { roomId, gameId: room.gameId, playerId, now: this.deps.now() },
      { how: how === 'share' ? 'share' : 'copy' },
    );
    return { ok: true };
  }

  /** A swept room's cached card goes with it. */
  forget(roomId: string): void {
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${roomId}:`)) this.cache.delete(k);
  }

  private night(
    roomId: string,
    room: { gameId: string; players: { id: string; name: string }[] },
  ): RoomRecap {
    this.deps.flush();
    const { source, settings } = this.deps;
    const { tone, tzOffsetMin } = settings.room(roomId);
    const last = source.lastGameStart(roomId);
    const events = last === null ? [] : source.roomEvents(roomId, last - LOOKBACK_MS);
    const people = source.roomPeople(roomId);
    const members = new Map(room.players.map((p) => [p.id, p.name]));
    const key = [
      events.at(-1)?.id ?? '',
      tzOffsetMin ?? '',
      [...members].map(([id, name]) => `${id}=${name}`).join(','),
      [...people.kicked].join(','),
    ].join('|');
    const cacheKey = `${roomId}:${tone}`;
    const hit = this.cache.get(cacheKey);
    if (hit?.key === key) return hit.recap;

    const night = currentNight(events);
    const exclude = new Set([...people.kicked].filter((id) => !members.has(id)));
    exclude.add(FORGOTTEN);
    const games = night?.games ?? [];
    const out = runEngine({
      roomId,
      nightKey: night?.key ?? '',
      lastEventId: events.at(-1)?.id ?? '',
      games,
      module: this.deps.games.get(room.gameId)?.awards,
      tone,
      tzOffsetMin,
      exclude,
    });
    const played = new Map<string, number>();
    for (const g of games)
      for (const p of g.players) if (!exclude.has(p)) played.set(p, (played.get(p) ?? 0) + 1);
    const nameOf = (id: string) => members.get(id) ?? people.names.get(id) ?? 'Someone';
    const recap: RoomRecap = {
      nightKey: night?.key ?? '',
      status: night?.wrapped ? 'wrapped' : 'live',
      tone,
      startedAt: night?.startedAt ?? 0,
      endedAt: night?.endedAt ?? 0,
      running: night?.running ?? 0,
      abandoned: night?.abandoned ?? 0,
      games: out.games,
      players: [...played].map(([id, n]) => ({
        id,
        name: nameOf(id),
        played: n,
        ...(!members.has(id) && { left: true }),
      })),
      audience: room.players
        .filter((p) => !played.has(p.id))
        .map((p) => ({ id: p.id, name: p.name })),
      ...(out.moment && { moment: out.moment }),
      ...(out.mvp && { mvp: out.mvp }),
      awards: out.awards,
      nuggets: out.nuggets,
      ...(tzOffsetMin !== null && { tzOffsetMin }),
    };
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, { key, recap });
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return recap;
  }
}
