import type { AnyGameDefinition } from '@vt/game-sdk';
import type {
  Ack,
  AckWith,
  GameRecap,
  HallOfFame,
  NightSummary,
  RecapQuery,
  RecapTone,
  RecentNight,
  RoomRecap,
} from '@vt/protocol';
import { isPrivate } from '../games/registry.ts';
import type { RoomLogger, RoomManager, RoomObservation } from '../rooms/manager.ts';
import { FORGOTTEN } from '../stats/sqlite-store.ts';
import type { RecapSource, StatsEvent } from '../stats/types.ts';
import { type EngineOutput, runEngine } from './engine.ts';
import type { AwardRow, FrozenCard, FrozenNight, RecapStore, RecordRow } from './hall.ts';
import { ALL_NIGHT_RULES } from './night-awards.ts';
import { NIGHT_MAX_MS, type Night, currentNight, nights } from './night.ts';
import { type RecapSettings, isTone, tzOffset } from './settings.ts';

/** Cached cards (one per room, tone and visibility; a new event replaces it). */
const CACHE_SIZE = 200;
/** How far back a night's names and events are read, before its latest game start. */
const LOOKBACK_MS = NIGHT_MAX_MS + 60 * 60_000;
/** Hall of fame lists (MVPs, favourites, records, previous nights). */
const HALL_LIST = 8;
const TONES: readonly RecapTone[] = ['cheeky', 'wholesome'];

const fail = <T>(code: string, message: string): AckWith<T> => ({
  ok: false,
  error: { code, message },
});
const failAck = (code: string, message: string): Ack => ({ ok: false, error: { code, message } });

export interface RecapServiceDeps {
  source: RecapSource;
  /** Frozen nights, their awards and the rooms' records. */
  store: RecapStore;
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
  /** Test rooms (`x-vt-test`) never freeze a night. */
  isTestRoom?: (roomId: string) => boolean;
}

/** Who is asking: back-room games only count for a viewer with the back room (unlock or admin). */
export interface Viewer {
  unlocked: boolean;
}

type Members = NonNullable<ReturnType<RoomManager['members']>>;

const RECAP_OFF = 'Night recaps are switched off.';

/**
 * Tavern night recaps for one room's members: reads the room's stats events (and those of rooms
 * linked to it with "Same crew, new game"), finds the current night, and runs the award engine.
 * A night is frozen when the host wraps it up or the room's next night begins; a frozen card is
 * served as it was and never recomputed. Membership and the back-room unlock are checked by the
 * socket layer before any call reaches here; this checks membership again and the kill switch.
 */
export class RecapService {
  private readonly deps: RecapServiceDeps;
  private readonly cache = new Map<string, { key: string; built: Built }>();

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
    viewer: Viewer = { unlocked: true },
  ): AckWith<GameRecap | RoomRecap | HallOfFame | null> {
    if (!this.deps.settings.enabled()) return fail('recap-off', RECAP_OFF);
    const room = this.deps.rooms.members(roomId);
    if (!room) return fail('no-room', 'Room not found.');
    if (!room.players.some((p) => p.id === playerId)) return fail('not-in-room', 'Join first.');
    const unlocked = viewer.unlocked || this.private(room.gameId);
    let data: GameRecap | RoomRecap | HallOfFame | null;
    try {
      if (query.scope === 'hall') data = this.hall(roomId, room, unlocked);
      else if (query.nightKey) {
        const frozen = this.deps.store.night(roomId, query.nightKey);
        if (!frozen) return fail('no-night', 'That night is not in the hall of fame.');
        data = this.served(frozen, this.deps.settings.room(roomId).tone, unlocked);
      } else {
        const recap = this.current(roomId, room, unlocked);
        if (query.scope === 'game') {
          // Only once the room's latest game is over: never anything about a game in play.
          const last =
            recap.running === 0 && room.phase === 'over'
              ? recap.games.findLast((g) => !g.elsewhere)
              : undefined;
          data = last ?? null;
        } else data = recap;
      }
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
    return { ok: true, data };
  }

  wrap(roomId: string, playerId: string, tz: unknown): AckWith<string> {
    if (!this.deps.settings.enabled()) return fail('recap-off', RECAP_OFF);
    const room = this.deps.rooms.members(roomId);
    if (!room) return fail('no-room', 'Room not found.');
    if (!room.players.some((p) => p.id === playerId)) return fail('not-in-room', 'Join first.');
    if (room.hostId !== playerId) return fail('not-host', 'Only the host can wrap up the night.');
    const recap = this.current(roomId, room, true);
    if (!recap.games.length) return fail('nothing-to-wrap', 'Finish a game first.');
    if (recap.frozen) return fail('already-wrapped', 'This night is already wrapped up.');
    const offset = tzOffset(tz);
    if (offset !== null) this.deps.settings.update(roomId, { tzOffsetMin: offset });
    const res = this.deps.rooms.wrap(roomId, playerId, {
      tone: this.deps.settings.room(roomId).tone,
      ...(offset !== null && { tz: offset }),
    });
    if (!res.ok) return res;
    // The recorder has written the wrap: freeze the night everywhere it was played.
    this.safely(roomId, () => {
      for (const r of this.load(roomId).rooms) this.freezeNight(r, recap.nightKey);
    });
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
      { how: how === 'share' || how === 'image' ? how : 'copy' },
    );
    return { ok: true };
  }

  /**
   * "Same crew, new game": whether `playerId` may open a table continuing `nightKey` (they are in
   * a room of that night). Returns the rooms they are in, to tell the others; null if not.
   */
  linkable(nightKey: string, playerId: string): string[] | null {
    this.deps.flush();
    const rooms = this.deps.source
      .nightRooms([nightKey])
      .filter((r) => this.deps.rooms.members(r)?.players.some((p) => p.id === playerId));
    return rooms.length ? rooms : null;
  }

  /** Room-host observations: a game starting freezes the night before; a sweep forgets all. */
  observe(o: RoomObservation): void {
    if (o.kind === 'room.swept') {
      this.forget(o.roomId);
      return;
    }
    if (o.kind !== 'action' && o.kind !== 'deadline') return;
    const phase = (s: unknown) => (s as { phase?: unknown } | null)?.phase;
    if (phase(o.after?.state) !== 'playing' || phase(o.before?.state) === 'playing') return;
    this.safely(o.roomId, () => this.freezeBefore(o.roomId, o.now));
  }

  /** A swept room's cards and recaps go with it. */
  forget(roomId: string): void {
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${roomId}:`)) this.cache.delete(k);
    this.deps.store.forgetRoom(roomId);
  }

  // ---- The admin's view ----

  /** The latest frozen nights across the tavern (a linked night once), newest first. */
  recent(limit: number): RecentNight[] {
    const seen = new Set<string>();
    const out: RecentNight[] = [];
    for (const n of this.deps.store.recent(limit * 3)) {
      if (seen.has(n.nightKey)) continue;
      seen.add(n.nightKey);
      const summary = this.summary(n, true);
      if (summary) out.push({ ...summary, roomId: n.roomId });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** A frozen card as it was frozen, for the admin (read-only). */
  frozenCard(roomId: string, nightKey: string): RoomRecap | null {
    const n = this.deps.store.night(roomId, nightKey);
    return n ? this.served(n, n.tone, true) : null;
  }

  // ---- Building cards ----

  private private(gameId: string): boolean {
    return isPrivate(this.deps.games.get(gameId));
  }

  /** Never lets a recap problem reach play. */
  private safely(roomId: string, run: () => void) {
    try {
      run();
    } catch (err) {
      this.deps.logger.error({ roomId, err }, 'recap freeze failed');
    }
  }

  /**
   * The room's events and those of the rooms linked with it, from `since` on (default: the
   * lookback before the room's latest game, or a linked room's when it has none yet).
   */
  private load(roomId: string, since?: number): Loaded {
    this.deps.flush();
    const { source } = this.deps;
    const own = source.lastGameStart(roomId);
    const link = source.roomLink(roomId);
    const first = since ?? (own ?? this.deps.now()) - LOOKBACK_MS;
    const keys = [...source.gameStarts(roomId, first), ...(link ? [link] : [])];
    const rooms = [...new Set([roomId, ...source.nightRooms(keys)])];
    let from = first;
    if (since === undefined && own === null) {
      // A new table opened for a night: read that night from the rooms it was played in.
      const latest = Math.max(
        ...rooms.map((r) => source.lastGameStart(r) ?? Number.NEGATIVE_INFINITY),
      );
      if (Number.isFinite(latest)) from = latest - LOOKBACK_MS;
    }
    const events: StatsEvent[] = [];
    for (const r of rooms) events.push(...source.roomEvents(r, from));
    events.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    const roomGame = new Map(events.map((e) => [e.roomId, e.gameId]));
    return { events, rooms, link, roomGame };
  }

  /**
   * The night as a viewer may see it: a locked viewer never learns a back-room table existed,
   * not even as a count, so its games, running games and rooms are left out.
   */
  private visible(night: Night | null, loaded: Loaded, unlocked: boolean): Night | null {
    if (!night || unlocked) return night;
    const open = (roomId: string) => !this.private(loaded.roomGame.get(roomId) ?? '');
    const keep = night.games.map((_, i) => open(night.gameRooms[i]!));
    const runningRooms = night.runningRooms.filter(open);
    const abandonedRooms = night.abandonedRooms.filter(open);
    return {
      ...night,
      games: night.games.filter((_, i) => keep[i]),
      gameRooms: night.gameRooms.filter((_, i) => keep[i]),
      rooms: new Set([...night.rooms].filter(open)),
      runningRooms,
      abandonedRooms,
      running: runningRooms.length,
      abandoned: abandonedRooms.length,
    };
  }

  /** The room's current night, live or (once frozen) as it was frozen. */
  private current(roomId: string, room: Members, unlocked: boolean): RoomRecap {
    const tone = this.deps.settings.room(roomId).tone;
    const loaded = this.load(roomId);
    const night = currentNight(loaded.events, { roomId, link: loaded.link });
    const frozen = night && this.deps.store.night(roomId, night.key);
    const previous = this.previous(roomId, unlocked, night?.key);
    if (frozen) return { ...this.served(frozen, tone, unlocked), previous };
    const shown = this.visible(night, loaded, unlocked);
    const built = this.build(roomId, room, tone, loaded, shown, `${unlocked}`);
    return { ...built.recap, ...(night && { nightKey: night.key }), previous };
  }

  /** One card for a night (cached until the room's events or members change). */
  private build(
    roomId: string,
    room: Members,
    tone: RecapTone,
    loaded: Loaded,
    night: Night | null,
    variant: string,
  ): Built {
    const { source, settings, store } = this.deps;
    const { tzOffsetMin } = settings.room(roomId);
    const people = source.roomPeople(roomId);
    const members = new Map(room.players.map((p) => [p.id, p.name]));
    const lastEventId = loaded.events.reduce((m, e) => (e.id > m ? e.id : m), '');
    const key = [
      night?.key ?? '',
      lastEventId,
      tzOffsetMin ?? '',
      [...members].map(([id, name]) => `${id}=${name}`).join(','),
      [...people.kicked].join(','),
      night?.games.length ?? 0,
    ].join('|');
    const cacheKey = `${roomId}:${tone}:${variant}`;
    const hit = this.cache.get(cacheKey);
    if (hit?.key === key) return hit.built;

    const exclude = new Set([...people.kicked].filter((id) => !members.has(id)));
    exclude.add(FORGOTTEN);
    const games = night?.games ?? [];
    const out = runEngine({
      roomId,
      nightKey: night?.key ?? '',
      lastEventId,
      games,
      modules: (gameId) => this.deps.games.get(gameId)?.awards,
      tone,
      tzOffsetMin,
      exclude,
      history: night ? store.history(roomId, night.key) : undefined,
      records: new Map([...store.records(roomId)].map(([id, r]) => [id, r.value])),
    });
    // Names: this room's members first, then whatever the night's rooms last called them.
    const names = new Map(people.names);
    for (const r of night?.rooms ?? [])
      if (r !== roomId) for (const [id, n] of source.roomPeople(r).names) names.set(id, n);
    const played = new Map<string, number>();
    for (const g of games)
      for (const p of g.players) if (!exclude.has(p)) played.set(p, (played.get(p) ?? 0) + 1);
    const nameOf = (id: string) => members.get(id) ?? names.get(id) ?? 'Someone';
    const elsewhere = new Set(
      (night?.gameRooms ?? []).flatMap((r, i) => (r === roomId ? [] : [i])),
    );
    const recap: RoomRecap = {
      nightKey: night?.key ?? '',
      status: night?.wrapped ? 'wrapped' : 'live',
      tone,
      startedAt: night?.startedAt ?? 0,
      endedAt: night?.endedAt ?? 0,
      running: night?.running ?? 0,
      abandoned: night?.abandoned ?? 0,
      games: out.games.map((g, i) => ({
        ...g,
        name: this.deps.games.get(g.gameId)?.name ?? g.gameId,
        ...(elsewhere.has(i) && { elsewhere: true }),
      })),
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
      nuggets: out.nuggets.map((n) => ({
        emoji: n.emoji,
        text: n.text,
        ...(n.record && { record: true }),
      })),
      ...(tzOffsetMin !== null && { tzOffsetMin }),
    };
    const built = { recap, out };
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, { key, built });
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return built;
  }

  /** A frozen card for this viewer: in the room's tone, public-only for a locked viewer. */
  private served(frozen: FrozenNight, tone: RecapTone, unlocked: boolean): RoomRecap {
    const cards = frozen.card.cards[tone] ?? frozen.card.cards[frozen.tone];
    return { ...(unlocked || !cards.open ? cards.full : cards.open), tone };
  }

  // ---- Freezing ----

  /** Freezes the room's night `nightKey` (if complete and not frozen yet). */
  private freezeNight(roomId: string, nightKey: string, since?: number): void {
    if (this.deps.store.isFrozen(roomId, nightKey)) return;
    const room = this.deps.rooms.members(roomId);
    if (!room) return;
    const full = this.load(roomId, since);
    const night = nights(full.events).find((n) => n.key === nightKey);
    if (!night || night.running || !night.games.length) return;
    this.freeze(roomId, room, full, night);
  }

  /** A game just started: every earlier night of the room (and its linked rooms) is final now. */
  private freezeBefore(roomId: string, startedAt: number): void {
    const prev = this.deps.source.lastGameStart(roomId, startedAt);
    if (prev === null) return;
    // The night before ends with (or after) the previous start, so it began within 16 h of it.
    const since = prev - NIGHT_MAX_MS;
    const { rooms } = this.load(roomId, since);
    for (const r of rooms) {
      const room = this.deps.rooms.members(r);
      if (!room) continue;
      const loaded = this.load(r, since);
      const all = nights(loaded.events);
      for (const night of all.slice(0, -1)) {
        const mine = night.rooms.has(r) || night.key === loaded.link;
        if (!mine || night.running || !night.games.length || night.startedAt < since) continue;
        if (!this.deps.store.isFrozen(r, night.key)) this.freeze(r, room, loaded, night);
      }
    }
  }

  private freeze(roomId: string, room: Members, loaded: Loaded, night: Night): void {
    if (this.deps.isTestRoom?.(roomId)) return;
    // A public room whose night reached the back room keeps a public-only card as well.
    const open = this.visible(night, loaded, false)!;
    const split = !this.private(room.gameId) && open.games.length !== night.games.length;
    const cards = {} as FrozenCard['cards'];
    let main: Built | null = null;
    const tone = this.deps.settings.room(roomId).tone;
    const final = (r: RoomRecap): RoomRecap => ({
      ...r,
      nightKey: night.key,
      status: 'wrapped',
      frozen: true,
    });
    for (const t of TONES) {
      const built = this.build(roomId, room, t, loaded, night, 'freeze');
      const openCard = split
        ? final(this.build(roomId, room, t, loaded, open, 'freeze-open').recap)
        : undefined;
      cards[t] = { full: final(built.recap), ...(openCard && { open: openCard }) };
      if (t === tone) main = built;
    }
    const recap = main!.recap;
    const wrapped = night.wrapped
      ? loaded.events.find((e) => e.type === 'room.wrapped' && e.ts >= night.endedAt)
      : undefined;
    const frozen: FrozenNight = {
      roomId,
      nightKey: night.key,
      startedAt: night.startedAt,
      endedAt: night.endedAt,
      wrappedAt: wrapped?.ts ?? null,
      games: night.games.length,
      tone,
      card: { v: 1, cards },
    };
    this.deps.store.freeze(frozen, awardRows(recap), recordRows(main!.out));
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${roomId}:`)) this.cache.delete(k);
  }

  // ---- Hall of fame ----

  private summary(frozen: FrozenNight, unlocked: boolean): NightSummary | null {
    const card = this.served(frozen, frozen.tone, unlocked);
    if (!card.games.length) return null;
    const mix = new Map<string, { gameId: string; name: string; count: number }>();
    for (const g of card.games) {
      const m = mix.get(g.gameId) ?? { gameId: g.gameId, name: g.name ?? g.gameId, count: 0 };
      m.count += 1;
      mix.set(g.gameId, m);
    }
    const names = new Map(card.players.map((p) => [p.id, p.name]));
    const mvp = card.mvp?.players[0];
    return {
      nightKey: frozen.nightKey,
      startedAt: card.startedAt,
      endedAt: card.endedAt,
      games: card.games.length,
      mix: [...mix.values()].sort((a, b) => b.count - a.count),
      ...(mvp && names.get(mvp) && { mvp: names.get(mvp) }),
    };
  }

  /** The room's frozen nights other than `except`, newest first. */
  private previous(roomId: string, unlocked: boolean, except?: string): NightSummary[] {
    return this.deps.store
      .nights(roomId)
      .filter((n) => n.nightKey !== except)
      .map((n) => this.summary(n, unlocked))
      .filter((n): n is NightSummary => n !== null);
  }

  private hall(roomId: string, room: Members, unlocked: boolean): HallOfFame {
    const { store, source } = this.deps;
    const frozen = store.nights(roomId);
    const people = source.roomPeople(roomId);
    const members = new Map(room.players.map((p) => [p.id, p.name]));
    const gone = (id: string) => id === FORGOTTEN || (people.kicked.has(id) && !members.has(id));
    // Names: the latest each frozen card used, then the room's own.
    const names = new Map<string, string>();
    for (const n of [...frozen].reverse())
      for (const p of this.served(n, n.tone, true).players) names.set(p.id, p.name);
    for (const [id, n] of people.names) names.set(id, n);
    for (const [id, n] of members) names.set(id, n);
    const nameOf = (id: string) => names.get(id) ?? 'Someone';

    const summaries = frozen
      .map((n) => this.summary(n, unlocked))
      .filter((n): n is NightSummary => n !== null);
    const shown = new Set(summaries.map((s) => s.nightKey));
    const rows = store
      .awards(roomId)
      .filter(
        (a) =>
          shown.has(a.nightKey) &&
          a.playerId &&
          !gone(a.playerId) &&
          (unlocked || !a.gameId || !this.private(a.gameId)),
      );

    const mvpCount = new Map<string, number>();
    for (const a of rows)
      if (a.slot === 'mvp') mvpCount.set(a.playerId, (mvpCount.get(a.playerId) ?? 0) + 1);
    const mvps = [...mvpCount]
      .sort((a, b) => b[1] - a[1] || nameOf(a[0]).localeCompare(nameOf(b[0])))
      .slice(0, HALL_LIST)
      .map(([playerId, count]) => ({ playerId, name: nameOf(playerId), count }));

    // Each player's most-won award, counted once a night.
    const won = new Map<string, Map<string, Set<string>>>();
    for (const a of rows) {
      if (a.slot === 'mvp') continue;
      const mine = won.get(a.playerId) ?? new Map<string, Set<string>>();
      const nightsOf = mine.get(a.awardId) ?? new Set<string>();
      nightsOf.add(a.nightKey);
      mine.set(a.awardId, nightsOf);
      won.set(a.playerId, mine);
    }
    const tone = this.deps.settings.room(roomId).tone;
    const favourites = [...won]
      .flatMap(([playerId, awards]) => {
        const [awardId, nightsOf] = [...awards].sort(
          (a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]),
        )[0]!;
        const info = this.awardInfo(awardId, tone);
        return nightsOf.size >= 2 && info
          ? [{ playerId, name: nameOf(playerId), awardId, ...info, count: nightsOf.size }]
          : [];
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, HALL_LIST);

    const records = [...store.records(roomId).values()]
      .filter((r) => unlocked || !this.private(r.gameId))
      .sort((a, b) => b.at - a.at)
      .slice(0, HALL_LIST)
      .map((r) => ({ id: r.recordId, emoji: r.emoji, text: r.text, at: r.at }));

    // Tonight counts once it has a finished game that is not frozen yet.
    const live = this.current(roomId, room, unlocked);
    const tonight = live.games.length && !live.frozen ? 1 : 0;
    return {
      nights: summaries.length + tonight,
      mvps,
      favourites,
      records,
      previous: summaries,
    };
  }

  /** An award's emoji and title, from the games' rules or the night rules. */
  private awardInfo(awardId: string, tone: RecapTone): { emoji: string; title: string } | null {
    const rules = [
      ...ALL_NIGHT_RULES,
      ...[...this.deps.games.values()].flatMap((g) => g.awards?.rules ?? []),
    ];
    const rule = rules.find((r) => r.id === awardId);
    if (!rule) return null;
    return {
      emoji: rule.emoji,
      title: tone === 'wholesome' ? (rule.wholesomeTitle ?? rule.title) : rule.title,
    };
  }
}

interface Loaded {
  events: StatsEvent[];
  /** Every room read: this one and the ones linked with it. */
  rooms: string[];
  link: string | null;
  /** Each room's game. */
  roomGame: Map<string, string>;
}

interface Built {
  recap: RoomRecap;
  out: EngineOutput;
}

/** The award rows a frozen card leaves for the Hall of fame. */
function awardRows(recap: RoomRecap): AwardRow[] {
  const rows: AwardRow[] = [];
  const add = (line: RoomRecap['awards'][number], slot: AwardRow['slot']) => {
    const players = line.players.length ? line.players : [''];
    for (const p of players)
      if (!rows.some((r) => r.awardId === line.awardId && r.playerId === p))
        rows.push({
          awardId: line.awardId,
          playerId: p,
          gameId: line.gameId ?? null,
          slot,
          value: null,
        });
  };
  if (recap.moment) add(recap.moment, 'moment');
  if (recap.mvp) add(recap.mvp, 'mvp');
  for (const a of recap.awards) add(a, 'award');
  return rows;
}

/** The record candidates of a frozen night's numbers. */
function recordRows(out: EngineOutput): RecordRow[] {
  return out.recordables.flatMap((n) =>
    n.recordKey && n.value !== undefined && n.better && n.gameId
      ? [
          {
            recordId: n.recordKey,
            value: n.value,
            better: n.better,
            gameId: n.gameId,
            emoji: n.emoji,
            text: n.text,
          },
        ]
      : [],
  );
}
