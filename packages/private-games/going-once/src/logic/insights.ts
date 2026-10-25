import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { artOf } from './hints.ts';
import type { GoingOnceAction, GoingOnceState } from './types.ts';

/**
 * Stats only: every sale (price, value, buyer, artist, whether a screw forced it), unsold lots,
 * bids, screws, loans, drawings sent or missed, and the final money. Titles are private content
 * and never reported; drawings never leave the game.
 */
export function insights(
  before: GoingOnceState,
  after: GoingOnceState,
  action: GoingOnceAction | null,
  by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  const was = before.game;
  if (!g || after.phase === 'lobby') return [];
  const events: InsightEvent[] = [];
  const players = g.order.length;

  if (
    action?.type === 'draw' &&
    by &&
    g.items[action.item]?.drawing &&
    !was?.items[action.item]?.drawing
  )
    events.push({ type: 'drawing', playerId: by, props: { missed: false } });
  if (was?.stage === 'draw' && g.stage !== 'draw')
    for (const item of Object.values(g.items))
      if (item.drawer && !item.drawing)
        events.push({ type: 'drawing', playerId: item.drawer, props: { missed: true } });

  if (action?.type === 'bid' && by && g.auction && g.auction.seq !== was?.auction?.seq)
    events.push({ type: 'bid', playerId: by, props: { amount: action.amount } });

  if (
    action?.type === 'loan' &&
    action.take &&
    by &&
    g.players[by]!.loans > (was?.players[by]?.loans ?? 0)
  )
    events.push({ type: 'loan', playerId: by, props: { loans: g.players[by]!.loans } });

  for (const e of after.log) {
    if (e.id <= before.seq || e.kind !== 'screw') continue;
    events.push({
      type: 'screw',
      playerId: e.by,
      props: { target: e.target, outcome: e.outcome, amount: e.amount ?? null },
    });
  }

  // A lot's hammer fell in this change.
  for (const id of g.lots) {
    const sale = g.items[id]!.sale;
    if (!sale || was?.items[id]?.sale) continue;
    const item = g.items[id]!;
    const lot = g.lots.indexOf(id);
    if (!sale.buyer) {
      events.push({ type: 'unsold', props: { lot, value: item.value, house: !item.artist } });
      continue;
    }
    events.push({
      type: 'sale',
      playerId: sale.buyer,
      props: {
        lot,
        price: sale.price,
        value: item.value,
        profit: item.value - sale.price,
        artist: item.artist,
        house: !item.artist,
        own: item.artist === sale.buyer,
        commission: sale.commission,
        screwedBy: sale.screwedBy,
        players,
      },
    });
  }

  if (before.phase !== 'over' && after.phase === 'over') {
    const score = (id: PlayerId) => {
      const p = g.players[id]!;
      return p.cash + artOf(g, id) - p.debt;
    };
    const ranking = [...g.order].sort((x, y) => score(y) - score(x));
    events.push({
      type: 'outcome',
      winners: [...g.winners],
      props: {
        players,
        lots: g.lots.length,
        ranking,
        scores: ranking.map(score),
        cash: ranking.map((id) => g.players[id]!.cash),
        art: ranking.map((id) => artOf(g, id)),
        debt: ranking.map((id) => g.players[id]!.debt),
      },
    });
  }
  return events;
}
