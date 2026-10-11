import { type GameEvents, type RecapEvent, gameEvents } from '@vt/game-sdk';
import type { StatsEvent } from '../stats/types.ts';

/** A new game this long after the last one ended starts a new night. */
export const NIGHT_GAP_MS = 3 * 60 * 60_000;
/** A night never spans longer than this, first start to last end. */
export const NIGHT_MAX_MS = 16 * 60 * 60_000;

/** One game in a room's event stream, finished or not. */
export interface PlayedGame {
  /** The id of its `game.started` event (ULID, sortable). */
  key: string;
  roomId: string;
  startedAt: number;
  /** Null while it is still being played. */
  endedAt: number | null;
  finished: boolean;
  game: GameEvents;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * Pairs each `game.started` with its `game.ended` and collects the game's insights in between
 * (`insight.` stripped), room by room (a linked night reads several rooms). A start without an
 * end is a game still in play; a start that follows another unended start in the same room
 * closes the earlier one as abandoned. Games come back in the order they started.
 */
export function splitGames(events: readonly StatsEvent[]): {
  games: PlayedGame[];
  wraps: number[];
} {
  const byRoom = new Map<string, StatsEvent[]>();
  for (const e of events) {
    const list = byRoom.get(e.roomId);
    if (list) list.push(e);
    else byRoom.set(e.roomId, [e]);
  }
  const games: PlayedGame[] = [];
  const wraps: number[] = [];
  for (const list of byRoom.values()) {
    const one = splitRoom(list);
    games.push(...one.games);
    wraps.push(...one.wraps);
  }
  games.sort((a, b) => a.startedAt - b.startedAt || a.key.localeCompare(b.key));
  return { games, wraps: wraps.sort((a, b) => a - b) };
}

function splitRoom(events: readonly StatsEvent[]): { games: PlayedGame[]; wraps: number[] } {
  const games: PlayedGame[] = [];
  const wraps: number[] = [];
  let open: { start: StatsEvent; events: RecapEvent[] } | null = null;
  const close = (end: StatsEvent | null) => {
    if (!open) return;
    const { start } = open;
    const players = strings(end?.props.players).length
      ? strings(end?.props.players)
      : strings(start.props.players);
    const gameNo = start.props.gameNo;
    const finished = end !== null && end.props.finished === true;
    games.push({
      key: start.id,
      roomId: start.roomId,
      startedAt: start.ts,
      endedAt: end ? end.ts : null,
      finished,
      game: gameEvents({
        gameId: start.gameId,
        gameNo: typeof gameNo === 'number' ? gameNo : games.length + 1,
        startedAt: start.ts,
        endedAt: end?.ts ?? start.ts,
        players,
        winners: strings(end?.props.winners),
        finished,
        events: open.events,
      }),
    });
    open = null;
  };
  for (const e of events) {
    if (e.type === 'game.started') {
      // Its end never made it (an old crash): call it abandoned at its last event.
      if (open) close({ ...open.start, ts: open.events.at(-1)?.ts ?? open.start.ts, props: {} });
      open = { start: e, events: [] };
    } else if (e.type === 'game.ended') {
      close(e);
    } else if (e.type === 'room.wrapped') {
      wraps.push(e.ts);
    } else if (open && e.type.startsWith('insight.')) {
      open.events.push({
        type: e.type.slice('insight.'.length),
        ts: e.ts,
        playerId: e.playerId,
        props: e.props,
      });
    }
  }
  if (open) {
    const { start } = open;
    games.push({
      key: start.id,
      roomId: start.roomId,
      startedAt: start.ts,
      endedAt: null,
      finished: false,
      game: gameEvents({
        gameId: start.gameId,
        gameNo: typeof start.props.gameNo === 'number' ? start.props.gameNo : games.length + 1,
        startedAt: start.ts,
        endedAt: start.ts,
        players: strings(start.props.players),
        winners: [],
        finished: false,
        events: [],
      }),
    });
  }
  return { games, wraps };
}

export interface Night {
  /** The night's first game start event id. */
  key: string;
  /** Finished games, in order: the only ones that count. */
  games: GameEvents[];
  /** The room each of `games` was played in. */
  gameRooms: string[];
  /** Every room with a game in this night (finished, running or abandoned). */
  rooms: Set<string>;
  /** The room of each game still in play, and of each abandoned game. */
  runningRooms: string[];
  abandonedRooms: string[];
  /** Games that ended early. */
  abandoned: number;
  /** Games still in play (at most one per room). */
  running: number;
  startedAt: number;
  endedAt: number;
  /** The host wrapped it up after its last game. */
  wrapped: boolean;
}

/**
 * Splits a room's games into nights: a night is a run of games where each starts less than
 * three hours after the last one ended, no wrap-up falls in between, and the whole run spans at
 * most 16 hours. Returns every night, oldest first.
 */
export function nights(events: readonly StatsEvent[]): Night[] {
  const { games, wraps } = splitGames(events);
  const out: Night[] = [];
  let current: PlayedGame[] = [];
  const flush = () => {
    if (!current.length) return;
    const first = current[0]!;
    const ended = current.filter((g) => g.endedAt !== null);
    const endedAt = Math.max(first.startedAt, ...ended.map((g) => g.endedAt!));
    const running = current.length - ended.length;
    const finished = current.filter((g) => g.finished);
    out.push({
      key: first.key,
      games: finished.map((g) => g.game),
      gameRooms: finished.map((g) => g.roomId),
      rooms: new Set(current.map((g) => g.roomId)),
      runningRooms: current.filter((g) => g.endedAt === null).map((g) => g.roomId),
      abandonedRooms: ended.filter((g) => !g.finished).map((g) => g.roomId),
      abandoned: ended.filter((g) => !g.finished).length,
      running,
      startedAt: first.startedAt,
      endedAt,
      wrapped: running === 0 && wraps.some((w) => w >= endedAt),
    });
    current = [];
  };
  for (const g of games) {
    if (current.length) {
      // Linked rooms can play side by side: the night so far ends with its latest game.
      const prevEnd = Math.max(...current.map((p) => p.endedAt ?? p.startedAt));
      const wrappedBetween = wraps.some((w) => w >= prevEnd && w <= g.startedAt);
      const end = g.endedAt ?? g.startedAt;
      if (
        g.startedAt - prevEnd > NIGHT_GAP_MS ||
        wrappedBetween ||
        end - current[0]!.startedAt > NIGHT_MAX_MS
      )
        flush();
    }
    current.push(g);
  }
  flush();
  return out;
}

/**
 * The room's latest night, or null when it has never played. With `roomId` (a linked night's
 * events from several rooms): the latest night with a game in that room, else the night the room
 * was opened to continue (`link`).
 */
export function currentNight(
  events: readonly StatsEvent[],
  opts: { roomId?: string; link?: string | null } = {},
): Night | null {
  const all = nights(events);
  if (opts.roomId === undefined) return all.at(-1) ?? null;
  const here = all.findLast((n) => n.rooms.has(opts.roomId!));
  if (here) return here;
  return (opts.link && all.find((n) => n.key === opts.link)) || null;
}
