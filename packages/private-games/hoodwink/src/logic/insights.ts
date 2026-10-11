import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { awards, multiplier, rankedScores } from './game.ts';
import type { HoodwinkAction, HoodwinkState, Round } from './types.ts';

/** The round this change revealed, if any (none when a game started). */
function revealedRound(before: HoodwinkState, after: HoodwinkState): Round | null {
  const round = after.round;
  if (after.gamesPlayed !== before.gamesPlayed || !round || round.stage !== 'reveal') return null;
  const was = before.round;
  return was && was.number === round.number && was.stage === 'reveal' ? null : round;
}

function roundEvents(round: Round, rounds: number): InsightEvent[] {
  const pickedBy = (i: number) =>
    Object.entries(round.votes).flatMap(([id, pick]) => (pick === i ? [id] : []));
  const truthIndex = round.options.findIndex((o) => o.truth);
  const lies: InsightEvent[] = round.options.flatMap((option, i) =>
    option.truth || option.house
      ? []
      : [
          {
            type: 'lie',
            playerId: option.authors[0] ?? null,
            words: [{ kind: 'guess' as const, word: option.text }],
            props: {
              fooled: pickedBy(i).length,
              authors: option.authors,
              auto: option.auto.length > 0,
              autoAuthors: option.auto,
            },
          },
        ],
  );
  const votes: InsightEvent[] = Object.entries(round.votes).map(([voter, pick]) => ({
    type: 'vote',
    playerId: voter,
    props: {
      foundTruth: pick === truthIndex,
      // Who wrote the answer they picked, and whether it was one of the house's: public now.
      authors: round.options[pick]?.authors ?? [],
      house: round.options[pick]?.house ?? false,
    },
  }));
  const scored = Object.entries(round.points).filter(([, p]) => p > 0);
  return [
    ...lies,
    ...votes,
    {
      type: 'round',
      props: {
        questionId: round.question.id,
        deckId: round.question.deckId,
        truthFound: truthIndex < 0 ? 0 : pickedBy(truthIndex).length,
        liesCount: lies.length,
        house: round.options.filter((o) => o.house).length,
        double: multiplier(round, rounds) > 1,
        pointsTo: scored.map(([id]) => id),
        points: scored.map(([, p]) => p),
      },
    },
  ];
}

/** Rounds revealed so far: a round cut short by leavers doesn't count. */
function roundsPlayed(state: HoodwinkState): number {
  const round = state.round;
  if (!round) return 0;
  return round.stage === 'reveal' ? round.number : round.number - 1;
}

/**
 * Stats only: at each reveal, every lie (with how many it fooled), every vote (whether it found the
 * truth) and the round itself; at the end, the top scorers. A game that ends for lack of players
 * credits nobody.
 */
export function insights(
  before: HoodwinkState,
  after: HoodwinkState,
  _action: HoodwinkAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const round = revealedRound(before, after);
  const events = round ? roundEvents(round, after.settings.rounds) : [];
  if (before.phase !== 'over' && after.phase === 'over') {
    const ranked = rankedScores(after);
    events.push({
      type: 'outcome',
      winners: after.endReason === 'finished' ? awards(ranked).winners : [],
      props: {
        rounds: roundsPlayed(before),
        endReason: after.endReason,
        ranking: ranked.map((s) => s.id),
        scores: ranked.map((s) => s.score),
        fooled: ranked.map((s) => s.fooled),
        truths: ranked.map((s) => s.truths),
      },
    });
  }
  return events;
}
