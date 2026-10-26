import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { typeOf, variantOf } from './cards.ts';
import type { ConveyorAction, ConveyorState } from './types.ts';

/**
 * Stats only, read from the log entries this change added: wasabi triples, cards a neighbour
 * took from under someone, spoons, copies, takeout boxes, uramaki places, miso clashes, every
 * player's round score by dish, the desserts and the game's result. Never a hand or a pick.
 */
export function insights(
  before: ConveyorState,
  after: ConveyorState,
  _action: ConveyorAction | null,
  by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  if (!g) return [];
  const events: InsightEvent[] = [];
  for (const e of after.log) {
    if (e.id <= before.seq) continue;
    const auto = e.auto !== undefined || by === null;
    switch (e.kind) {
      case 'wasabi':
        events.push({
          type: 'wasabi',
          playerId: e.by,
          props: { k: e.k, points: (variantOf(e.k).points ?? 0) * 3, round: e.round },
        });
        break;
      case 'steal':
        events.push({
          type: 'steal',
          playerId: e.by,
          props: { from: e.from, k: e.k, worth: e.worth, round: e.round },
        });
        break;
      case 'spoon':
        events.push({
          type: 'spoon',
          playerId: e.by,
          props: { hit: !!e.k, from: e.from ?? '', k: e.k ?? '', round: e.round, auto },
        });
        break;
      case 'copy':
        if (e.k) events.push({ type: 'copy', playerId: e.by, props: { k: e.k, round: e.round } });
        break;
      case 'chop':
        events.push({ type: 'chop', playerId: e.by, props: { k: e.k, round: e.round, auto } });
        break;
      case 'takeout':
        events.push({
          type: 'takeout',
          playerId: e.by,
          props: { flipped: e.ks.length, round: e.round, auto },
        });
        break;
      case 'uramaki':
        for (const c of e.claims)
          events.push({
            type: 'uramaki',
            playerId: c.by,
            props: { points: c.points, icons: c.icons, round: e.round },
          });
        break;
      case 'miso':
        events.push({ type: 'miso', props: { players: [...new Set(e.by)], round: e.round } });
        break;
      case 'reveal':
        for (const p of e.plays)
          if (typeOf(p.k) === 'order' && p.copy)
            events.push({ type: 'copy', playerId: p.by, props: { k: p.copy, round: e.round } });
        break;
      case 'end': {
        const result = g.results.find((r) => r.round === e.round);
        for (const row of result?.rows ?? []) {
          const best = [...row.parts].sort((a, b) => b.points - a.points)[0];
          events.push({
            type: 'round',
            playerId: row.id,
            props: {
              round: e.round,
              points: row.points,
              best: best?.key ?? '',
              bestPoints: best?.points ?? 0,
              rolls: row.parts
                .filter((p) => p.key === 'maki' || p.key === 'temaki' || p.key === 'uramaki')
                .reduce((sum, p) => sum + p.points, 0),
              players: g.order.length,
            },
          });
        }
        break;
      }
      default:
        break;
    }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    for (const row of g.dessertRows ?? [])
      events.push({
        type: 'desserts',
        playerId: row.id,
        props: { count: g.players[row.id]?.desserts.length ?? 0, points: row.points },
      });
    const sign = after.settings.golf ? -1 : 1;
    const ranking = [...g.order].sort((a, b) => sign * (g.players[b]!.score - g.players[a]!.score));
    events.push({
      type: 'outcome',
      winners: [...g.winners],
      props: {
        players: g.order.length,
        golf: after.settings.golf,
        menu: g.preset ?? 'custom',
        shared: g.winners.length > 1,
        ranking,
        scores: ranking.map((id) => g.players[id]!.score),
      },
    });
  }
  return events;
}
