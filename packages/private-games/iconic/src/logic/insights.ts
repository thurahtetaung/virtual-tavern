import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { SETS, type Board, type IconicAction, type IconicState } from './types.ts';

/** Every icon with a piece on it, in board order. */
export function iconsOn(board: Board): number[] {
  const out = new Set<number>();
  for (const id of SETS) {
    const set = board[id];
    if (set.marker !== null) out.add(set.marker);
    for (const c of set.cubes) out.add(c.icon);
  }
  return [...out].sort((a, b) => a - b);
}

const sameRound = (before: IconicState, after: IconicState) =>
  before.gamesPlayed === after.gamesPlayed && before.game?.round.no === after.game?.round.no;

/**
 * Stats only: each finished word (`word`, once the reveal makes it public: level, how it ended,
 * who guessed it, how long it took, the pieces and icons used, the "close" marks) and the
 * result (`outcome`).
 */
export function insights(
  before: IconicState,
  after: IconicState,
  _action: IconicAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const events: InsightEvent[] = [];
  const g = after.game;
  const r = g?.round;
  const prev = sameRound(before, after) ? before.game?.round : null;
  if (g && r?.result && !prev?.result) {
    const res = r.result;
    const sets = SETS.filter((id) => r.board[id].marker !== null || r.board[id].cubes.length);
    const pieces = g.history.at(-1)?.pieces ?? 0;
    events.push({
      type: 'word',
      playerId: res.guesser,
      words: [{ kind: 'clue', word: res.word }],
      props: {
        no: r.no,
        word: res.word,
        level: res.level,
        outcome: res.outcome,
        how: res.how,
        ms: res.ms,
        pieces,
        sets: sets.length,
        guesses: r.guesses.length,
        givers: [...r.givers],
        helper: r.helper,
        closeBy: r.guesses.filter((x) => x.mark === 'close').map((x) => x.by),
        icons: iconsOn(r.board),
        marker: r.board.main.marker,
        auto: !!r.auto,
      },
    });
  }
  if (g && before.phase !== 'over' && after.phase === 'over') {
    const score = (id: string) =>
      after.settings.scoring ? (g.scores[id] ?? 0) : (g.guessed[id] ?? 0);
    const ranked = Object.keys(g.names).sort((a, b) => score(b) - score(a));
    events.push({
      type: 'outcome',
      winners: [...g.winners],
      props: {
        ranking: ranked,
        scores: ranked.map(score),
        words: g.wordsGuessed,
        rounds: g.history.length,
        scoring: after.settings.scoring,
        length: after.settings.length,
      },
    });
  }
  return events;
}
