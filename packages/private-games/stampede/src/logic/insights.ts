import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { rankedScores } from './game.ts';
import { groupLabel } from './match.ts';
import type { Round, StampedeAction, StampedeState } from './types.ts';

/** The round this change finished (its reveal), if any. */
function revealedRound(before: StampedeState, after: StampedeState): Round | null {
  const round = after.round;
  if (after.gamesPlayed !== before.gamesPlayed || round?.stage !== 'reveal') return null;
  const was = before.round;
  return was?.number === round.number && was.stage === 'reveal' ? null : round;
}

function roundEvents(round: Round): InsightEvent[] {
  const result = round.result!;
  const groups = round.groups.filter((g) => g.members.length > 0);
  const herd = groups.find((g) => g.id === result.herd);
  const answers: InsightEvent[] = groups.flatMap((g) =>
    g.members.map((id) => ({
      type: 'answer',
      playerId: id,
      words: [{ kind: 'guess' as const, word: round.answers[id] ?? '' }],
      props: {
        round: round.number,
        group: g.members.length,
        herd: g.id === result.herd,
        alone: g.members.length === 1,
        // Who else gave the same answer (public at the reveal).
        with: g.members.filter((m) => m !== id),
      },
    })),
  );
  const events: InsightEvent[] = [
    ...answers,
    {
      type: 'round',
      props: {
        round: round.number,
        players: round.players.length,
        answered: groups.reduce((n, g) => n + g.members.length, 0),
        blanks: result.blanks.length,
        groups: groups.length,
        sizes: groups.map((g) => g.members.length).sort((a, b) => b - a),
        herd: herd ? groupLabel(herd, round.answers) : null,
        herdSize: herd?.members.length ?? 0,
        tie: result.tie,
        scorers: result.scorers,
        loners: result.loners.length,
        merges: round.merges.filter((m) => m.kind !== 'reset').length,
        skipped: round.skipped,
        raisedTo: result.raisedTo,
      },
    },
  ];
  if (result.pinkTo !== result.pinkFrom) {
    events.push({
      type: 'pink',
      playerId: result.pinkTo,
      props: { round: round.number, from: result.pinkFrom, how: result.pinkHow },
    });
  }
  return events;
}

/**
 * Stats only: at each reveal, every answer (with its group's size, whether it was the herd or
 * alone), the round itself (group sizes, the host's merges) and any Pink Cow move; at the end, the
 * ranking. Answers are only ever reported once they are public.
 */
export function insights(
  before: StampedeState,
  after: StampedeState,
  _action: StampedeAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const round = revealedRound(before, after);
  const events = round ? roundEvents(round) : [];
  if (before.phase !== 'over' && after.phase === 'over') {
    const ranked = rankedScores(after);
    events.push({
      type: 'outcome',
      winners: after.endReason === 'won' ? after.winners : [],
      props: {
        rounds: after.history.at(-1)?.number ?? 0,
        endReason: after.endReason,
        target: after.target,
        pinkCow: after.pinkCow,
        ranking: ranked.map((s) => s.id),
        cows: ranked.map((s) => s.cows),
      },
    });
  }
  return events;
}
