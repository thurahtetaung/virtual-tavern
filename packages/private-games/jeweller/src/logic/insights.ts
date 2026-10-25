import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { cardOf } from './cards.ts';
import { pointsOf, totalOf } from './rules.ts';
import type { JewellerAction, JewellerState } from './types.ts';

/**
 * Stats only, read from the log entries this change added. A blind reserve never names its card
 * (nobody else saw it): every take, reserve, purchase with what it cost and how much gold went
 * into it, pieces handed back, noble visits, the end trigger and the game's result.
 */
export function insights(
  before: JewellerState,
  after: JewellerState,
  _action: JewellerAction | null,
  by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  if (!g) return [];
  const events: InsightEvent[] = [];
  for (const e of after.log) {
    if (e.id <= before.seq) continue;
    const auto = e.auto !== undefined || by === null;
    switch (e.kind) {
      case 'take':
        events.push({
          type: 'take',
          playerId: e.by,
          props: {
            count: e.gems.length,
            double: e.gems.length === 2 && e.gems[0] === e.gems[1],
            auto,
          },
        });
        break;
      case 'reserve':
        events.push({
          type: 'reserve',
          playerId: e.by,
          props: { level: e.level, blind: e.blind, gold: e.gold, auto },
        });
        break;
      case 'buy': {
        const card = cardOf(e.card);
        const paid = totalOf(e.paid);
        events.push({
          type: 'buy',
          playerId: e.by,
          props: {
            level: card.level,
            points: card.points,
            bonus: card.bonus,
            paid,
            gold: e.paid.gold,
            free: paid === 0,
            fromReserve: e.fromReserve,
            auto,
          },
        });
        break;
      }
      case 'return':
        events.push({
          type: 'return',
          playerId: e.by,
          props: { count: totalOf(e.tokens), auto },
        });
        break;
      case 'noble':
        events.push({ type: 'noble', playerId: e.by, props: { turn: e.turn, auto } });
        break;
      case 'final':
        events.push({ type: 'final', playerId: e.by, props: { points: e.points, turn: e.turn } });
        break;
      default:
        break;
    }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    const score = (id: PlayerId) => pointsOf(g.players[id]!.cards, g.players[id]!.nobles);
    const ranking = [...g.order].sort(
      (a, b) =>
        Number(g.winners.includes(b)) - Number(g.winners.includes(a)) ||
        score(b) - score(a) ||
        g.players[a]!.cards.length - g.players[b]!.cards.length,
    );
    const top = Math.max(...g.order.map(score));
    events.push({
      type: 'outcome',
      winners: [...g.winners],
      props: {
        players: g.order.length,
        rounds: Math.ceil(g.turns / g.order.length),
        target: after.settings.target,
        // The tie on points was broken by fewest cards.
        tiebreak: g.order.filter((id) => score(id) === top).length > g.winners.length,
        shared: g.winners.length > 1,
        ranking,
        scores: ranking.map(score),
        cards: ranking.map((id) => g.players[id]!.cards.length),
        nobles: ranking.map((id) => g.players[id]!.nobles.length),
      },
    });
  }
  return events;
}
