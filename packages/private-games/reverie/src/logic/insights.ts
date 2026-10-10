import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import type { ReverieAction, ReverieState } from './types.ts';

/**
 * Stats only: the storyteller's clue and how each voter did, at each reveal, and the result.
 * Only ever shown on the admin stats page.
 */
export function insights(
  before: ReverieState,
  after: ReverieState,
  _action: ReverieAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const events: InsightEvent[] = [];
  const turn = after.turn;
  const revealed =
    turn?.phase === 'reveal' &&
    !(
      before.turn?.phase === 'reveal' &&
      before.turn.round === turn.round &&
      before.gamesPlayed === after.gamesPlayed
    );
  if (turn && revealed) {
    const results = turn.results ?? {};
    events.push({
      type: 'story',
      playerId: turn.storyteller,
      words: turn.clue === null ? [] : [{ kind: 'story', word: turn.clue }],
      props: {
        clue: turn.clue,
        allOrNone: turn.allOrNone,
        round: turn.round,
        found: Object.values(results).filter((r) => r.foundIt).length,
        voters: Object.keys(turn.votes).length,
      },
    });
    for (const voter of Object.keys(turn.votes)) {
      events.push({
        type: 'vote',
        playerId: voter,
        props: { found: results[voter]?.foundIt ?? false },
      });
    }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    events.push({
      type: 'outcome',
      winners: after.winners,
      props: { target: after.settings.targetScore, endReason: after.endReason },
    });
  }
  return events;
}
