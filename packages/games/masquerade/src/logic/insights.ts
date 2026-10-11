import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import type { MasqueradeAction, MasqueradeState } from './types.ts';

/**
 * Stats only, reported once a round is revealed (when nothing is secret any more):
 * - `round`: the location (as a word), whether the spies won it, and how many spies and players;
 * - `spy`: each spy's outcome (escaped, stole, caught) and the votes they drew, with their guess;
 * - `vote`: each vote, whether it found a spy, and who it was for;
 * - `outcome`: the game's winners and rounds, when the last round ends.
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
          },
        });
      }
      for (const [voter, target] of Object.entries(result.votes)) {
        events.push({
          type: 'vote',
          playerId: voter,
          props: { hit: result.spies.includes(target), target },
        });
      }
    }
    if (before.phase !== 'over' && after.phase === 'over') {
      events.push({
        type: 'outcome',
        winners: after.winners,
        props: { rounds: after.round?.number ?? 0 },
      });
    }
    return events;
  };
}
