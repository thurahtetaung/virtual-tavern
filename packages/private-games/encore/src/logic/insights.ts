import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { totalsOf } from './score.ts';
import { strengthOf } from './rules.ts';
import type { EncoreAction, EncoreState } from './types.ts';

/**
 * Stats only, read from the log entries this change added: every Show (its size and kind, what it
 * captured, whether it used a card recruited this round), every Recruit (from whose set), each round's
 * end and scores, and the game's result. Nothing says where a recruited card went or which way up.
 */
export function insights(
  before: EncoreState,
  after: EncoreState,
  _action: EncoreAction | null,
  by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  if (!g) return [];
  const events: InsightEvent[] = [];
  for (const e of after.log) {
    if (e.id <= before.seq) continue;
    const auto = e.auto !== undefined || by === null;
    switch (e.kind) {
      case 'show': {
        const s = strengthOf(e.cards);
        const recruited = g.players[e.by]?.recruited ?? [];
        events.push({
          type: 'show',
          playerId: e.by,
          props: {
            size: e.cards.length,
            kind: s?.kind ?? 'single',
            low: s?.low ?? 0,
            captured: e.beat.length,
            double: !!e.double,
            withRecruited: e.cards.some((c) => recruited.includes(c.id)),
            round: e.round,
            auto,
          },
        });
        break;
      }
      case 'recruit':
        events.push({
          type: 'recruit',
          playerId: e.by,
          props: {
            owner: e.owner,
            double: !!e.double,
            paid: !!e.paid,
            round: e.round,
            auto,
          },
        });
        break;
      case 'end': {
        const points = Object.values(e.points);
        events.push({
          type: 'round',
          playerId: e.ender,
          props: {
            round: e.round,
            how: e.how,
            players: g.order.length,
            negative: Object.entries(e.points).flatMap(([id, n]) => (n < 0 ? [id] : [])),
            ids: Object.keys(e.points),
            points: Object.values(e.points),
            best: Math.max(...points),
            worst: Math.min(...points),
          },
        });
        break;
      }
      default:
        break;
    }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    const totals = totalsOf(g);
    const ranking = [...g.order].sort((a, b) => totals[b]! - totals[a]!);
    events.push({
      type: 'outcome',
      winners: [...g.winners],
      props: {
        players: g.order.length,
        rounds: g.results.length,
        shared: g.winners.length > 1,
        ranking,
        scores: ranking.map((id) => totals[id]!),
      },
    });
  }
  return events;
}
