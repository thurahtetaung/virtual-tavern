import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { goalNow, membersOf } from './game.ts';
import type { CliffhangerAction, CliffhangerState, TeamId } from './types.ts';

/** The genres of the goal a collection holds (counted once each). */
const filled = (state: CliffhangerState, team: TeamId) => {
  const goal = goalNow(state);
  return new Set(
    state.collections[team].map((c) => c.genre).filter((g) => goal.genres.includes(g)),
  );
};

/**
 * Stats only: each face-off as it is decided (its category as a clue word), each title got as a
 * team's turn ends (as a guess word, with its style and whether it was stolen), each turn, each
 * three-for-one, each genre a team fills for the first time, and the outcome. Everything reported
 * is public by then.
 */
export function insights(
  before: CliffhangerState,
  after: CliffhangerState,
  _action: CliffhangerAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const events: InsightEvent[] = [];
  const was = before.round;
  const round = after.round;
  const same =
    was && round && was.number === round.number && before.gamesPlayed === after.gamesPlayed;
  if (round?.faceoffResult && !(same && was.faceoffResult)) {
    const r = round.faceoffResult;
    events.push({
      type: 'faceoff',
      playerId: r.winner,
      ...(round.category && { words: [{ kind: 'clue' as const, word: round.category.text }] }),
      props: {
        round: round.number,
        loser: r.loser,
        answers: r.answers,
        ms: r.ms,
        how: r.how,
        suddenDeath: round.suddenDeath,
      },
    });
  }
  const turnsBefore = same ? was.results.length : 0;
  for (const result of round?.results.slice(turnsBefore) ?? []) {
    for (const got of result.got) {
      events.push({
        type: 'got',
        playerId: result.describer,
        words: [{ kind: 'guess', word: got.card.title }],
        props: {
          round: round!.number,
          team: result.team,
          style: got.style,
          steal: got.steal,
          genre: got.card.genre,
          ms: got.ms,
        },
      });
    }
    const own = result.got.filter((g) => !g.steal).length;
    events.push({
      type: 'turn',
      playerId: result.describer,
      props: {
        round: round!.number,
        team: result.team,
        got: result.got.length,
        own,
        steals: result.got.length - own,
        missed: result.missed.length,
        clean: own === 3,
      },
    });
  }
  const stealsBefore = same ? was.steals.length : 0;
  for (const s of round?.steals.slice(stealsBefore) ?? []) {
    events.push({
      type: 'steal3',
      playerId: s.by,
      props: { round: round!.number, team: s.team, gave: s.gave, took: s.took.genre },
    });
  }
  if (after.gamesPlayed === before.gamesPlayed && after.phase !== 'lobby') {
    for (const team of ['a', 'b'] as const) {
      const old = filled(before, team);
      for (const genre of filled(after, team)) {
        if (old.has(genre)) continue;
        events.push({ type: 'genre', props: { round: round?.number ?? 0, team, genre } });
      }
    }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    const winner = after.winner;
    events.push({
      type: 'outcome',
      winners: winner ? membersOf(after, winner) : [],
      props: {
        rounds: round?.number ?? 0,
        endReason: after.endReason,
        winner,
        goal: after.goal,
        // A comeback: the winners once trailed by two genres or more.
        comeback: winner ? after.behind[winner] >= 2 : false,
        behind: winner ? after.behind[winner] : 0,
        collectedA: after.collections.a.length,
        collectedB: after.collections.b.length,
      },
    });
  }
  return events;
}
