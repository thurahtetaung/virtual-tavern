import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { clueKey, meansKey } from './content.ts';
import type { Game, InquestAction, InquestState } from './types.ts';

/**
 * Stats only. Nothing secret is reported while it is still secret: bullets, events and solve
 * attempts are public the moment they happen, and the crime, the roles and the Reversal are only
 * reported in `outcome`, once the game is over.
 * - `bullet` (by the Forensic Scientist): tile, item, its place in the order, the round, and
 *   whether an event moved it (no timings: the table talks between bullets, so they measure that);
 * - `event`: which event came up (`kind`, `tile`), and the round;
 * - `solve`: who tried, on whose cards (`target`, `clue`/`means` as card ids), right or wrong,
 *   how many bullets had been placed (`bulletsDownAtSolve`, moves not counted) and whether the
 *   round's bullets were all in (`allBulletsIn`: false while the Forensic Scientist is still
 *   placing them, or before the new tile's bullet in rounds 2 and 3), and whether it was a final
 *   accusation (`final`);
 * - `outcome`: the winning side and how (`solved`, `time`, `badges`, `reversal`, `final`), the
 *   round, who solved, how fast and whether in the final accusations (`solvedFinal`), the Forensic Scientist(s), Murderer, Accomplice and Witness, whether the
 *   Reversal found the Witness, the crime (`clue`/`means` card ids), and a few counts.
 * Card ids are `clue-<n>`/`means-<n>`, which the browser names from the private manifest.
 */
export function insights(
  before: InquestState,
  after: InquestState,
  _action: InquestAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  if (!g) return [];
  const was = before.game && before.game.startedAt === g.startedAt ? before.game : null;
  const events: InsightEvent[] = [];
  for (const b of g.bullets.slice(was?.bullets.length ?? 0)) {
    events.push({
      type: 'bullet',
      playerId: g.fs,
      props: {
        tile: b.tile,
        item: b.item,
        seq: b.seq,
        round: b.round,
        moved: b.movedFrom !== undefined,
      },
    });
  }
  for (const kind of g.events.slice(was?.events.length ?? 0)) {
    events.push({ type: 'event', props: { kind, round: g.round } });
  }
  for (const a of g.attempts.slice(was?.attempts.length ?? 0)) {
    events.push({
      type: 'solve',
      playerId: a.by,
      props: {
        bulletsDownAtSolve: placedBy(g, a.at),
        allBulletsIn: (was ?? g).stage !== 'collect',
        target: a.target,
        clue: clueKey(a.clue),
        means: meansKey(a.means),
        correct: a.correct,
        round: a.round,
        final: a.final === true,
      },
    });
  }
  if (before.phase !== 'over' && after.phase === 'over' && g.result) events.push(outcome(g));
  return events;
}

/** Bullets placed (not moved) up to `at`. */
const placedBy = (g: Game, at: number) =>
  g.bullets.filter((b) => b.at <= at && b.movedFrom === undefined).length;

function outcome(g: Game): InsightEvent {
  const r = g.result!;
  const holder = (role: string) => g.players.find((p) => p.role === role)?.id ?? null;
  const right = g.attempts.find((a) => a.correct);
  const wrong = g.attempts.filter((a) => !a.correct);
  const murderer = holder('murderer');
  const murderSide = g.players
    .filter((p) => p.role === 'murderer' || p.role === 'accomplice')
    .map((p) => p.id);
  return {
    type: 'outcome',
    winners: r.winners,
    props: {
      winner: r.winner,
      how: r.how,
      round: g.round,
      finalRound: g.finalRound,
      players: g.players.length,
      solvedBy: r.solvedBy,
      solvedRound: right?.round ?? null,
      solvedFinal: right?.final === true,
      solveS: right ? Math.round((right.at - g.startedAt) / 1000) : null,
      firstTry: right ? g.attempts.filter((a) => a.by === right.by).length === 1 : false,
      fs: g.fs,
      fsIds: [...g.formerFs, g.fs],
      murderer,
      accomplice: holder('accomplice'),
      witness: holder('witness'),
      witnessFound: r.witnessFound,
      reversalPick: r.reversalPick,
      clue: g.solution ? clueKey(g.solution.clue) : null,
      means: g.solution ? meansKey(g.solution.means) : null,
      bullets: g.bullets.length,
      bulletsBeforeSolve: right ? g.bullets.filter((b) => b.at <= right.at).length : null,
      bulletsDownAtSolve: right ? placedBy(g, right.at) : null,
      wrong: wrong.length,
      wrongBeforeSolve: right ? wrong.filter((a) => a.at <= right.at).length : null,
      // Wrong attempts on the Murderer's own cards ("barking up the right tree, wrong branch").
      nearMisses: wrong.filter((a) => a.target === murderer).map((a) => a.by),
      // A final accusation is everyone's duty, so a culprit's one there isn't a bold bluff.
      bluffers: [
        ...new Set(wrong.filter((a) => murderSide.includes(a.by) && !a.final).map((a) => a.by)),
      ],
      finalAccusations: g.attempts.filter((a) => a.final).length,
      events: g.events.length,
      countdown: g.countdown,
    },
  };
}
