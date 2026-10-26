import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { fullColours, fullColumns, fullRows } from './rules.ts';
import type { LogEntry, MosaicAction, MosaicState } from './types.ts';

/**
 * Stats only, read from the log entries this change added (nothing in the game is secret but the
 * bag's order): every take with what it cost, each player's wall-tiling per round, and the result.
 */
export function insights(
  before: MosaicState,
  after: MosaicState,
  _action: MosaicAction | null,
  by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  if (!g) return [];
  const events: InsightEvent[] = [];
  for (const e of after.log) {
    if (e.id <= before.seq) continue;
    const auto = e.auto !== undefined || by === null;
    if (e.kind === 'take')
      events.push({
        type: 'take',
        playerId: e.by,
        props: {
          colour: e.colour,
          count: e.count,
          source: e.source === 'centre' ? 'centre' : 'factory',
          line: e.target === 'floor' ? -1 : e.target,
          toFloor: e.toFloor,
          penalty: e.penalty,
          marker: e.marker,
          dumped: e.dumped,
          leftover: e.leftover,
          jokers: e.jokers ?? 0,
          special: e.special ?? null,
          shielded: !!e.shielded,
          auto,
        },
      });
    if (e.kind === 'round' && g.scoring?.round === e.round)
      for (const [id, s] of Object.entries(g.scoring.players)) {
        const points = s.placed.reduce((n, p) => n + p.points, 0);
        events.push({
          type: 'tiling',
          playerId: id,
          props: {
            round: e.round,
            placed: s.placed.length,
            points,
            penalty: s.penalty,
            best: Math.max(0, ...s.placed.map((p) => p.points)),
            floor: s.floor.length,
            perfect: s.floor.length === 0 && s.placed.length > 0,
            fell: s.fell?.length ?? 0,
            jokers: s.placed.filter((p) => p.colour === 'joker').length,
          },
        });
      }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    const inGame = g.order.filter((id) => !g.removed.includes(id));
    const score = (id: PlayerId) => g.players[id]!.score;
    const rows = (id: PlayerId) => fullRows(g.players[id]!.wall);
    const ranking = [...inGame].sort(
      (a, b) =>
        Number(g.winners.includes(b)) - Number(g.winners.includes(a)) ||
        score(b) - score(a) ||
        rows(b) - rows(a),
    );
    const top = Math.max(...inGame.map(score));
    const end = [...after.log]
      .reverse()
      .find((e): e is Extract<LogEntry, { kind: 'end' }> => e.kind === 'end');
    events.push({
      type: 'outcome',
      winners: [...g.winners],
      props: {
        players: g.order.length,
        rounds: g.round,
        how: end?.how ?? 'row',
        // The tie on points was broken by full rows.
        tiebreak: inGame.filter((id) => score(id) === top).length > g.winners.length,
        shared: g.winners.length > 1,
        ranking,
        scores: ranking.map(score),
        rows: ranking.map(rows),
        columns: ranking.map((id) => fullColumns(g.players[id]!.wall)),
        colours: ranking.map((id) => fullColours(g.players[id]!.wall)),
        bonus: ranking.map((id) => g.scoring?.players[id]?.bonus?.points ?? 0),
      },
    });
  }
  return events;
}
