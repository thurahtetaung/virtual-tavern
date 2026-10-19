import { GameError, type PlayerId } from '@vt/game-sdk';
import type { Round, RoundResult, ShowKind, Shown } from './types.ts';

/** Players still at the table this round (not gone from the room). */
export const present = (round: Round) => round.players.filter((id) => !round.gone.includes(id));

const isShown = (round: Round, pos: number) => round.shown.some((s) => s.pos === pos);

/** A player's crosses no Scout has shown yet: their "crosses left to confirm". */
export const unshown = (round: Round, id: PlayerId) =>
  (round.marks[id] ?? []).filter((pos) => !isShown(round, pos));

/** Who may be the Scout: still here, not fallen, with a cross left to confirm. */
export const canScout = (round: Round, id: PlayerId) =>
  !round.gone.includes(id) && !round.fallen.includes(id) && unshown(round, id).length > 0;

/**
 * The next Scout: the first player on the left of `from` (clockwise, in seat order) who may
 * scout, going right round to `from` itself; null when nobody may, which ends the Reveal.
 */
export function nextScout(round: Round, from: PlayerId): PlayerId | null {
  const order = round.players;
  const i = order.indexOf(from);
  for (let k = 1; k <= order.length; k++) {
    const id = order[(i + k) % order.length]!;
    if (canScout(round, id)) return id;
  }
  return null;
}

/** The Announce: everyone's count is public, and a player alone in the lead is in the Dark. */
export function announce(round: Round): Round {
  const ids = present(round);
  const counts = Object.fromEntries(ids.map((id) => [id, (round.marks[id] ?? []).length]));
  const top = Math.max(...Object.values(counts));
  const leaders = ids.filter((id) => counts[id] === top);
  const opened: Round = {
    ...round,
    stage: 'reveal',
    counts,
    dark: leaders.length === 1 ? leaders[0]! : null,
  };
  const scout = canScout(opened, round.first) ? round.first : nextScout(opened, round.first);
  return scout === null ? finish(opened) : { ...opened, scout };
}

/**
 * The Scout shows one of their crosses. Every other player who marked it (fallen ones and
 * players who left included) counts: two or more make a Spark (2 stars each), exactly one a
 * Super-Spark (3 stars each), none and the Scout falls. Fallen markers fill no stars.
 */
export function show(round: Round, pos: number, by: PlayerId, auto = false): Round | GameError {
  if (round.stage !== 'reveal') return new GameError('wrong-stage', "It's not time to show cards.");
  if (round.scout !== by) return new GameError('not-scout', "You're not the Scout right now.");
  if (isShown(round, pos))
    return new GameError('already-shown', 'That card has already been shown this round.');
  if (!(round.marks[by] ?? []).includes(pos))
    return new GameError('not-marked', 'Show a card you marked on your slate.');
  const i = round.players.indexOf(by);
  const after = [...round.players.slice(i + 1), ...round.players.slice(0, i)];
  const others = after.filter((id) => (round.marks[id] ?? []).includes(pos));
  const markers = [by, ...others];
  const kind: ShowKind = others.length >= 2 ? 'spark' : others.length === 1 ? 'super' : 'fall';
  const each = kind === 'spark' ? 2 : kind === 'super' ? 3 : 0;
  const stars = Object.fromEntries(
    markers.map((id) => [id, round.fallen.includes(id) || round.gone.includes(id) ? 0 : each]),
  );
  const shown: Shown = {
    pos,
    card: round.board[pos]!,
    scout: by,
    markers,
    kind,
    stars,
    ...(auto && { auto }),
  };
  const next: Round = {
    ...round,
    shown: [...round.shown, shown],
    fallen: kind === 'fall' ? [...round.fallen, by] : round.fallen,
  };
  const scout = nextScout(next, by);
  return scout === null ? finish(next) : { ...next, scout };
}

/** Stars a player has filled this round so far. */
export const starsOf = (round: Round, id: PlayerId) =>
  round.shown.reduce((n, s) => n + (s.stars[id] ?? 0), 0);

/**
 * Scoring: a point per star. A player in the Dark who fell loses one point for each Spark and
 * Super-Spark box they filled (a Super-Spark's bonus star still counts).
 */
export function finish(round: Round): Round {
  const results: Record<PlayerId, RoundResult> = {};
  for (const id of present(round)) {
    const stars = starsOf(round, id);
    const boxes = round.shown.filter((s) => (s.stars[id] ?? 0) > 0).length;
    const dark = round.dark === id;
    const fell = round.fallen.includes(id);
    results[id] = { stars, boxes, dark, fell, points: dark && fell ? stars - boxes : stars };
  }
  return { ...round, stage: 'done', scout: null, deadline: null, results };
}
