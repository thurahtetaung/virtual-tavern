import type { PlayerId } from '@vt/game-sdk';
import type { Game } from './types.ts';

/** Each player's total over the finished rounds. */
export function totalsOf(g: Pick<Game, 'order' | 'results'>): Record<PlayerId, number> {
  const out: Record<PlayerId, number> = Object.fromEntries(g.order.map((id) => [id, 0]));
  for (const r of g.results)
    for (const row of r.rows) out[row.id] = (out[row.id] ?? 0) + row.points;
  return out;
}
