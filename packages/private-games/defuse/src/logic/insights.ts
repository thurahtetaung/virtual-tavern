import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { solvableCount, solvedCount } from './bomb.ts';
import { type Action, type State, isNeedy } from './types.ts';

/**
 * Stats only, when a bomb ends (nothing about it is secret any more): the bomb (how it ended, time
 * left, strikes, its modules), each module (kind, solved, strikes it gave, seconds to solve from
 * the lights) and each expert's page claims. A defused bomb credits everyone at the table.
 */
export function insights(
  before: State,
  after: State,
  _action: Action | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const b = after.bomb;
  if (before.stage !== 'bomb' || after.stage !== 'result' || !b?.end) return [];
  const defuser = after.history.at(-1)?.defuser ?? '';
  const players = after.seats.map((p) => p.id);
  const events: InsightEvent[] = [];
  for (const m of b.modules) {
    const needy = isNeedy(m.kind);
    events.push({
      type: 'module',
      playerId: defuser,
      props: {
        kind: m.kind,
        needy,
        solved: m.solved,
        strikes: m.strikes,
        seconds: m.solvedAt ? Math.round((m.solvedAt - b.activeAt) / 100) / 10 : null,
      },
    });
  }
  for (const e of b.log)
    if (e.what === 'strike')
      events.push({ type: 'strike', playerId: defuser, props: { kind: e.kind, module: e.module } });
  for (const p of players) {
    if (p === defuser) continue;
    const pages = Object.values(before.claims).filter((list) => list?.includes(p)).length;
    events.push({ type: 'expert', playerId: p, props: { pages } });
  }
  events.push({
    type: 'outcome',
    playerId: defuser,
    ...(b.end.how === 'defused' && { winners: players }),
    props: {
      how: b.end.how,
      defused: b.end.how === 'defused',
      left: Math.round(b.end.left),
      total: b.total,
      strikes: b.strikes + (b.end.how === 'strikes' ? 1 : 0),
      limit: b.strikeLimit,
      modules: solvableCount(b),
      solved: solvedCount(b),
      players: players.length,
      bomb: b.no,
    },
  });
  return events;
}
