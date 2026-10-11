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
    for (const [voter, index] of Object.entries(turn.votes)) {
      events.push({
        type: 'vote',
        playerId: voter,
        props: {
          found: results[voter]?.foundIt ?? false,
          // Whose card the vote went to: public from the reveal on.
          owner: turn.table[index]?.owner ?? null,
        },
      });
    }
    // Everyone's points this turn and their running total (scores are public at the reveal).
    for (const [id, r] of Object.entries(results)) {
      events.push({
        type: 'score',
        playerId: id,
        props: {
          round: turn.round,
          points: r.points,
          votesReceived: r.votesReceived,
          total: after.seats[id]?.score ?? 0,
          storyteller: id === turn.storyteller,
        },
      });
    }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    events.push({
      type: 'outcome',
      winners: after.winners,
      props: {
        target: after.settings.targetScore,
        endReason: after.endReason,
        ...rankedScores(after),
      },
    });
  }
  return events;
}

/** Seated players by final score, highest first, with their scores. */
function rankedScores(state: ReverieState): { ranking: string[]; scores: number[] } {
  const seated = Object.entries(state.seats)
    .filter(([, s]) => s.playing)
    .sort((a, b) => b[1].score - a[1].score);
  return { ranking: seated.map(([id]) => id), scores: seated.map(([, s]) => s.score) };
}
