import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { clued, noKnowledge } from './clues.ts';
import type { SkyfireAction, SkyfireState } from './types.ts';

/**
 * Stats only, read from the log entries this change added: every clue (colour or number, how many
 * cards it touched), every play (whether it worked, whether a clue had touched the card and whose
 * clue it was, whether it came in the last round), every discard, and the show's result.
 */
export function insights(
  before: SkyfireState,
  after: SkyfireState,
  _action: SkyfireAction | null,
  by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  if (!g) return [];
  const b = before.game && before.gamesPlayed === after.gamesPlayed ? before.game : null;
  const events: InsightEvent[] = [];
  for (const e of after.log) {
    if (e.id <= before.seq) continue;
    const auto = e.auto !== undefined || by === null;
    switch (e.kind) {
      case 'clue':
        events.push({
          type: 'clue',
          playerId: e.by,
          props: {
            to: e.to,
            kind: e.rank !== undefined ? 'number' : 'colour',
            value: e.rank !== undefined ? String(e.rank) : (e.colour ?? ''),
            touched: e.touched.length,
            turn: e.turn,
            auto,
          },
        });
        break;
      case 'play': {
        const from = b?.cluedBy[e.card];
        events.push({
          type: 'play',
          playerId: e.by,
          props: {
            suit: e.suit,
            rank: e.rank,
            ok: e.ok,
            completed: !!e.completed,
            clued: clued(b?.know[e.card] ?? noKnowledge()),
            clueBy: from?.by ?? null,
            clueTurn: from?.turn ?? null,
            lastRound: b?.finalTurns !== null && b?.finalTurns !== undefined,
            auto,
          },
        });
        break;
      }
      case 'discard':
        events.push({
          type: 'discard',
          playerId: e.by,
          props: {
            suit: e.suit,
            rank: e.rank,
            clued: clued(b?.know[e.card] ?? noKnowledge()),
            auto,
          },
        });
        break;
      default:
        break;
    }
  }
  if (before.phase !== 'over' && after.phase === 'over' && g.result) {
    const r = g.result;
    events.push({
      type: 'outcome',
      ...(r.win && { winners: [...g.order] }),
      props: {
        players: g.order.length,
        how: r.how,
        score: r.score,
        reached: r.reached,
        max: r.max,
        win: r.win,
        multi: after.settings.multi,
        black: after.settings.black,
        expert: after.settings.expert,
        fuses: g.fuses,
        turns: g.turn,
      },
    });
  }
  return events;
}
