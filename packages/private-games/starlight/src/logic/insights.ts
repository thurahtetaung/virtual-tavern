import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { wordOf } from './switch.ts';
import type { Round, StarlightAction, StarlightState } from './types.ts';

const sameRound = (before: StarlightState, after: StarlightState) =>
  before.gamesPlayed === after.gamesPlayed && before.round?.no === after.round?.no;

/**
 * Stats only: each round's word and the Announce (`word`), every card a Scout showed (`show`),
 * each player's round (`round`) and the result (`outcome`). Only public facts: counts, shown
 * cards and who marked them, scores.
 */
export function insights(
  before: StarlightState,
  after: StarlightState,
  _action: StarlightAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const events: InsightEvent[] = [];
  const round = after.round;
  const prev = sameRound(before, after) ? before.round : null;
  if (round && round.counts && !prev?.counts) events.push(announced(round));
  if (round) {
    for (const s of round.shown.slice(prev?.shown.length ?? 0)) {
      events.push({
        type: 'show',
        playerId: s.scout,
        props: {
          round: round.no,
          kind: s.kind,
          others: s.markers.length - 1,
          markers: s.markers,
          card: s.card,
          auto: !!s.auto,
        },
      });
    }
    if (round.results && !prev?.results) {
      for (const [id, r] of Object.entries(round.results)) {
        events.push({
          type: 'round',
          playerId: id,
          props: {
            round: round.no,
            points: r.points,
            stars: r.stars,
            boxes: r.boxes,
            dark: r.dark,
            fell: r.fell,
            marks: round.marks[id]?.length ?? 0,
            total: (after.seats[id]?.rounds ?? []).reduce((a, b) => a + b, 0),
          },
        });
      }
    }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    const seated = Object.entries(after.seats)
      .filter(([, s]) => s.playing)
      .map(([id, s]) => [id, s.rounds.reduce((a, b) => a + b, 0)] as const)
      .sort((a, b) => b[1] - a[1]);
    events.push({
      type: 'outcome',
      winners: after.winners,
      props: {
        endReason: after.endReason,
        ranking: seated.map(([id]) => id),
        scores: seated.map(([, n]) => n),
      },
    });
  }
  return events;
}

function announced(round: Round): InsightEvent {
  const word = wordOf(round) ?? '';
  const ids = Object.keys(round.counts ?? {});
  return {
    type: 'word',
    playerId: round.first,
    words: word ? [{ kind: 'clue', word }] : [],
    props: {
      round: round.no,
      word,
      flipped: round.side === 1,
      dark: round.dark,
      players: ids,
      counts: ids.map((id) => round.counts![id]!),
    },
  };
}
