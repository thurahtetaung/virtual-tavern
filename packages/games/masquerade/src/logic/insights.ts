import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import type { MasqueradeAction, MasqueradeState } from './types.ts';

/**
 * Stats only, reported once a round is revealed (when nothing is secret any more):
 * - `round`: the location (as a word), whether the spies won it, and how many spies and players;
 * - `spy`: each spy's outcome (escaped, stole, caught) and the votes they drew, with their guess;
 * - `vote`: each vote, whether it found a spy, and who it was for;
 * - `outcome`: the game's winners and rounds, when the last round ends.
 *
 * For the night recap, `round` also names who the vote named, who started the asking and the
 * points it scored (`pointsTo`/`points`, aligned); `spy` and `vote` carry the round number; and
 * `outcome` carries the final standings (`ranking` by score, with `scores` aligned).
 */
export function insightsFor(locationName: (id: string) => string) {
  return function insights(
    before: MasqueradeState,
    after: MasqueradeState,
    _action: MasqueradeAction | null,
    _by: PlayerId | null,
  ): InsightEvent[] {
    const events: InsightEvent[] = [];
    const round = after.round;
    const was = before.round;
    const revealed =
      round?.stage === 'reveal' &&
      round.result !== null &&
      (was?.deal !== round.deal || was.stage !== 'reveal');
    if (revealed) {
      const result = round.result!;
      const location = locationName(result.location);
      const spyWon = result.spyResults.some((s) => s.outcome !== 'caught');
      const received = new Map<PlayerId, number>();
      for (const t of Object.values(result.votes)) received.set(t, (received.get(t) ?? 0) + 1);
      events.push({
        type: 'round',
        words: [{ kind: 'clue', word: location }],
        props: {
          location,
          spyWon,
          spies: result.spies.length,
          players: round.players.length,
          round: round.number,
          named: [...result.named],
          starter: round.starter,
          pointsTo: Object.keys(result.points),
          points: Object.values(result.points),
        },
      });
      for (const s of result.spyResults) {
        events.push({
          type: 'spy',
          playerId: s.id,
          ...(s.guess ? { words: [{ kind: 'guess' as const, word: locationName(s.guess) }] } : {}),
          props: {
            outcome: s.outcome,
            votes: received.get(s.id) ?? 0,
            location,
            round: round.number,
          },
        });
      }
      for (const [voter, target] of Object.entries(result.votes)) {
        events.push({
          type: 'vote',
          playerId: voter,
          props: { hit: result.spies.includes(target), target, round: round.number },
        });
      }
    }
    if (before.phase !== 'over' && after.phase === 'over') {
      // Everyone who played, best score first (seat order breaks ties).
      const ranked = Object.entries(after.seats)
        .filter(([id, s]) => s.playing || after.winners.includes(id))
        .sort(([, a], [, b]) => b.score - a.score);
      events.push({
        type: 'outcome',
        winners: after.winners,
        props: {
          rounds: after.round?.number ?? 0,
          ranking: ranked.map(([id]) => id),
          scores: ranked.map(([, s]) => s.score),
        },
      });
    }
    return events;
  };
}
