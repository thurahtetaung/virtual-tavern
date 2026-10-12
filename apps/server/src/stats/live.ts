import type { LiveStats } from '@vt/protocol';
import type { LiveRoomInfo } from '../rooms/manager.ts';
import { RECENT_MS } from './recorder.ts';

const MINUTE = 60_000;
const HOUR_POINTS = 60;

export interface LiveDeps {
  rooms: () => LiveRoomInfo[];
  /** Open socket connections (never those in test rooms). */
  sockets: () => number;
  /** Admin playtests with someone in them (never counted as rooms). */
  playtests?: () => number;
  /** Players with any activity since the given time. */
  recentPlayers: (since: number) => string[];
  /** A game's display name (private games included: only admins read this). */
  gameName?: (id: string) => string;
  now: () => number;
}

/** What is happening right now, from memory; nothing here is stored. */
export class LiveTracker {
  private readonly deps: LiveDeps;
  /** Minute start -> most players seen online during that minute. */
  private readonly samples = new Map<number, number>();

  constructor(deps: LiveDeps) {
    this.deps = deps;
  }

  /** Notes how many players are online this minute (called every minute and on each read). */
  sample(rooms = this.deps.rooms()): number {
    const online = onlineIds(rooms).size;
    const now = this.deps.now();
    const minute = Math.floor(now / MINUTE) * MINUTE;
    this.samples.set(minute, Math.max(this.samples.get(minute) ?? 0, online));
    for (const m of this.samples.keys())
      if (m <= minute - HOUR_POINTS * MINUTE) this.samples.delete(m);
    return online;
  }

  snapshot(): LiveStats {
    const now = this.deps.now();
    const rooms = this.deps.rooms().sort((a, b) => b.updatedAt - a.updatedAt);
    this.sample(rooms);
    const online = onlineIds(rooms);
    const recent = new Set([...online, ...this.deps.recentPlayers(now - RECENT_MS)]);
    const byGame = new Map<
      string,
      { gameId: string; rooms: number; playing: number; players: number }
    >();
    for (const r of rooms) {
      const g = byGame.get(r.gameId) ?? { gameId: r.gameId, rooms: 0, playing: 0, players: 0 };
      g.rooms += 1;
      if (r.phase === 'playing') g.playing += 1;
      g.players += r.players.filter((p) => p.connected).length;
      byGame.set(r.gameId, g);
    }
    const minute = Math.floor(now / MINUTE) * MINUTE;
    return {
      now,
      sockets: this.deps.sockets(),
      playtests: this.deps.playtests?.() ?? 0,
      playersOnline: online.size,
      playersRecent: recent.size,
      rooms,
      byGame: [...byGame.values()].sort((a, b) => b.players - a.players),
      lastHour: Array.from({ length: HOUR_POINTS }, (_, i) => {
        const ts = minute - (HOUR_POINTS - 1 - i) * MINUTE;
        return { ts, players: this.samples.get(ts) ?? 0 };
      }),
      games: [...new Set(rooms.map((r) => r.gameId))].map((id) => ({
        id,
        name: this.deps.gameName?.(id) ?? id,
      })),
    };
  }
}

function onlineIds(rooms: LiveRoomInfo[]) {
  const ids = new Set<string>();
  for (const r of rooms) for (const p of r.players) if (p.connected) ids.add(p.id);
  return ids;
}
