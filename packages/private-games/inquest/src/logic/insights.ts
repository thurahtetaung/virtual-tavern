import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { clueKey, meansKey } from './content.ts';
import type { Game, InquestAction, InquestState } from './types.ts';

/**
 * Stats only. Nothing secret is reported while it is still secret: bullets, events and solve
 * attempts are public the moment they happen, and the crime, the roles and the Reversal are only
 * reported in `outcome`, once the game is over.
 * - `bullet` (by the Forensic Scientist): tile, item, its place in the order, the pause before it
 *   (`gapS`), the round, and whether an event moved it;
 * - `event`: which event came up (`kind`, `tile`), and the round;
 * - `solve`: who tried, on whose cards (`target`, `clue`/`means` as card ids), right or wrong;
 * - `outcome`: the winning side and how (`solved`, `time`, `badges`, `reversal`), the round, who
 *   solved and how fast, the Forensic Scientist(s), Murderer, Accomplice and Witness, whether the
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
        gapS: Math.round(b.gapMs / 100) / 10,
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
        target: a.target,
        clue: clueKey(a.clue),
        means: meansKey(a.means),
        correct: a.correct,
        round: a.round,
      },
    });
  }
  if (before.phase !== 'over' && after.phase === 'over' && g.result) events.push(outcome(g));
  return events;
}

function outcome(g: Game): InsightEvent {
  const r = g.result!;
  const holder = (role: string) => g.players.find((p) => p.role === role)?.id ?? null;
  const right = g.attempts.find((a) => a.correct);
  const wrong = g.attempts.filter((a) => !a.correct);
  // Pauses between bullets in the same collection (the first bullet of a round waits on talk).
  const gaps = g.bullets.filter((b, i) => i > 0 && g.bullets[i - 1]!.round === b.round);
  const maxGapMs = gaps.length ? Math.max(...gaps.map((b) => b.gapMs)) : 0;
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
      wrong: wrong.length,
      wrongBeforeSolve: right ? wrong.filter((a) => a.at <= right.at).length : null,
      // Wrong attempts on the Murderer's own cards ("barking up the right tree, wrong branch").
      nearMisses: wrong.filter((a) => a.target === murderer).map((a) => a.by),
      bluffers: [...new Set(wrong.filter((a) => murderSide.includes(a.by)).map((a) => a.by))],
      events: g.events.length,
      maxGapS: Math.round(maxGapMs / 100) / 10,
      countdown: g.countdown,
    },
  };
}
