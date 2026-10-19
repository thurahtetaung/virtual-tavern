import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { alive } from './game.ts';
import type { ThornsAction, ThornsState } from './types.ts';

/**
 * Stats only, read from the public log entries this change added, so nothing hidden (which disc
 * anyone put down, which disc a loser lost) is ever reported: every bid, every challenge with how
 * it ended and whose thorn stopped it, knock-outs, and the game's result.
 */
export function insights(
  before: ThornsState,
  after: ThornsState,
  _action: ThornsAction | null,
  by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  if (!g) return [];
  const events: InsightEvent[] = [];
  const r = g.round;
  const players = alive(g).length;
  const roundBids = (round: number) => (r.number === round ? r.bids : []);
  const totalOf = (round: number) =>
    r.number === round ? g.order.reduce((n, id) => n + g.players[id]!.stack.length, 0) : 0;
  for (const e of after.log) {
    if (e.id <= before.seq) continue;
    const auto = e.auto !== undefined || by === null;
    switch (e.kind) {
      case 'bid':
        events.push({
          type: 'bid',
          playerId: e.by,
          props: {
            amount: e.amount,
            total: totalOf(e.round),
            opening:
              roundBids(e.round)[0]?.by === e.by && roundBids(e.round)[0]?.amount === e.amount,
            auto,
          },
        });
        break;
      case 'won':
        events.push({
          type: 'challenge',
          playerId: e.by,
          props: {
            round: e.round,
            success: true,
            bid: e.amount,
            total: totalOf(e.round),
            points: e.points,
            players,
          },
        });
        break;
      case 'failed': {
        const bids = roundBids(e.round);
        events.push({
          type: 'challenge',
          playerId: e.by,
          props: {
            round: e.round,
            success: false,
            bid: bids.at(-1)?.amount ?? 0,
            total: totalOf(e.round),
            thornBy: e.thornBy,
            own: e.thornBy === e.by,
            // The thorn's owner had bid this round too: a bluff that worked.
            bluffed: e.thornBy !== e.by && bids.some((b) => b.by === e.thornBy),
            flips: r.number === e.round ? r.flips.length : 0,
            players,
          },
        });
        break;
      }
      case 'out':
        if (e.cause === 'left') break;
        events.push({
          type: 'elimination',
          playerId: e.player,
          props: {
            round: e.round,
            by: r.number === e.round ? (r.result?.thornBy ?? null) : null,
          },
        });
        break;
      default:
        break;
    }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    const ranking = [...g.order].sort((a, b) => {
      const pa = g.players[a]!;
      const pb = g.players[b]!;
      return (
        Number(g.winners.includes(b)) - Number(g.winners.includes(a)) ||
        pb.points - pa.points ||
        pb.discs.length - pa.discs.length
      );
    });
    events.push({
      type: 'outcome',
      winners: [...g.winners],
      props: {
        players: g.order.length,
        rounds: r.number,
        how: g.how,
        ranking,
        discs: ranking.map((id) => g.players[id]!.discs.length),
        points: ranking.map((id) => g.players[id]!.points),
      },
    });
  }
  return events;
}
