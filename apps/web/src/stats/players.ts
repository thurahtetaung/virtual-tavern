import type { PlayerSummary } from '@vt/protocol';

export type SortKey = 'games' | 'wins' | 'minutes' | 'lastSeen';

/** Sorts a copy of the leaderboard by a column, biggest (or most recent) first; ties by name. */
export function sortPlayers(players: readonly PlayerSummary[], key: SortKey): PlayerSummary[] {
  return [...players].sort((a, b) => b[key] - a[key] || a.name.localeCompare(b.name));
}
