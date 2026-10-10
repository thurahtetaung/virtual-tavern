import {
  type GameStats,
  type LiveStats,
  type PlayerProfile,
  STATS_RESET_CONFIRM,
  type StatsFun,
  type StatsOverview,
  type StatsPlayers,
  type StatsWords,
  type WordKind,
} from '@vt/protocol';
import { api } from '../lib/api.ts';

// The one place the stats page talks to the server. Every call takes the query string built by
// `apiQuery()` (range, from, to, bucket). In dev, VITE_STATS_FIXTURES=1 serves the typed fixtures
// instead, so the page can be worked on without a server that has recorded anything; production
// builds drop that branch (and the fixtures) entirely.

const BASE = '/api/admin/stats';

async function get<T>(path: string): Promise<T> {
  if (import.meta.env.DEV && import.meta.env.VITE_STATS_FIXTURES) {
    const { fixtureFor } = await import('./fixtures.ts');
    await new Promise((r) => setTimeout(r, 250));
    return fixtureFor(path) as T;
  }
  return api<T>(path);
}

const withQuery = (path: string, query: string) => (query ? `${path}?${query}` : path);

export const statsApi = {
  live: () => get<LiveStats>(`${BASE}/live`),
  overview: (query: string) => get<StatsOverview>(withQuery(`${BASE}/overview`, query)),
  game: (gameId: string, query: string) =>
    get<GameStats>(withQuery(`${BASE}/games/${encodeURIComponent(gameId)}`, query)),
  players: (query: string) => get<StatsPlayers>(withQuery(`${BASE}/players`, query)),
  player: (playerId: string) =>
    get<PlayerProfile>(`${BASE}/players/${encodeURIComponent(playerId)}`),
  words: (gameId: string, kind: WordKind, query: string, limit = 60) => {
    const q = new URLSearchParams(query);
    q.delete('bucket');
    q.set('game', gameId);
    q.set('kind', kind);
    q.set('limit', String(limit));
    return get<StatsWords>(`${BASE}/words?${q.toString()}`);
  },
  fun: (query: string) => get<StatsFun>(withQuery(`${BASE}/fun`, query)),
  /**
   * A download link: the browser saves the NDJSON straight from the server, sending the admin
   * cookie. Takes `exportQuery()` (from/to days), not the range query.
   */
  exportUrl: (query: string) => withQuery(`${BASE}/export`, query),
  reset: () =>
    api<{ ok: true }>(`${BASE}/reset`, { method: 'POST', body: { confirm: STATS_RESET_CONFIRM } }),
};
