import type { BotCtx, PlayerId, Rng } from '@vt/game-sdk';
import { capacity, columnOf, copyBoard, linesFor, place, previewOf, scoreAt } from './rules.ts';
import {
  type Board,
  COLOURS,
  COLUMN_BONUS,
  type Colour,
  type Counts,
  type MosaicAction,
  type MosaicView,
  ROW_BONUS,
  type Source,
  type Target,
} from './types.ts';

export interface Move {
  source: Source;
  colour: Colour;
  target: Target;
}

/** The table as a move sees it: what is on the factories and in the centre. */
export interface Market {
  factories: Colour[][];
  centre: Counts;
  /** `centre`, or the id of the player who took it. */
  marker: string;
}

/** Every group a player could take: a colour from a factory or the centre, with its size. */
export function groups(m: Market): { source: Source; colour: Colour; count: number }[] {
  const out: { source: Source; colour: Colour; count: number }[] = [];
  m.factories.forEach((f, i) => {
    for (const colour of COLOURS) {
      const count = f.filter((t) => t === colour).length;
      if (count) out.push({ source: i, colour, count });
    }
  });
  for (const colour of COLOURS)
    if (m.centre[colour]) out.push({ source: 'centre', colour, count: m.centre[colour] });
  return out;
}

/**
 * How good a move is for a board right now, in rough points: the floor it costs, what a line it
 * fills will score, progress on a line it doesn't fill, a little for the row and column bonuses
 * and for starting next round. Its one-line reading: greedy.
 */
export function moveValue(
  board: Board,
  colour: Colour,
  count: number,
  target: Target,
  marker: boolean,
) {
  const p = previewOf(board, colour, count, target, marker);
  if (p.problem) return -Infinity;
  let v = p.penalty + (p.markerOnFloor || marker ? 0.8 : 0);
  if (target === 'floor') return v;
  const col = columnOf(target, colour);
  const wall = board.wall.map((r) => [...r]);
  wall[target]![col] = colour;
  const potential = scoreAt(wall, target, col).points;
  const rowDone = wall[target]!.every(Boolean) ? ROW_BONUS : 0;
  const colDone = wall.every((r) => r[col]) ? COLUMN_BONUS * 0.6 : 0;
  if (p.fills) v += (p.points ?? potential) + 0.6 + rowDone + colDone;
  else {
    const line = board.lines[target]!;
    const filled = (line.count + p.toLine) / capacity(target);
    v += filled * (potential + rowDone + colDone) * 0.7;
  }
  return v;
}

/** The best greedy value a board can get from a market (for the one-move look-ahead). */
function bestValue(board: Board, m: Market): number {
  let best = -Infinity;
  for (const g of groups(m)) {
    const marker = g.source === 'centre' && m.marker === 'centre';
    for (const target of [...linesFor(board, g.colour), 'floor' as const])
      best = Math.max(best, moveValue(board, g.colour, g.count, target, marker));
  }
  return best;
}

/** The market after a group is taken. */
export function marketAfter(m: Market, source: Source, colour: Colour): Market {
  const centre = { ...m.centre };
  const factories = m.factories.map((f) => [...f]);
  if (source === 'centre') centre[colour] = 0;
  else {
    for (const t of factories[source]!) if (t !== colour) centre[t] += 1;
    factories[source] = [];
  }
  return { factories, centre, marker: source === 'centre' ? 'taken' : m.marker };
}

/**
 * The bot's pick: greedy, then, for the best dozen, a look at the next player's best reply on
 * what this move leaves (so it won't hand them an easy line, and likes leaving them a mess).
 * With an rng, near-equal moves are picked between at random; without one (the safe move made
 * for a player out of time), it is always the same.
 */
export function bestMove(view: MosaicView, me: PlayerId, rng: Rng | null): Move | null {
  const g = view.game;
  if (!g) return null;
  const mine = g.players.find((p) => p.id === me);
  if (!mine) return null;
  const market: Market = { factories: g.factories, centre: g.centre, marker: g.marker };
  const options: { move: Move; value: number }[] = [];
  for (const grp of groups(market)) {
    const marker = grp.source === 'centre' && market.marker === 'centre';
    for (const target of [...linesFor(mine, grp.colour), 'floor' as const])
      options.push({
        move: { source: grp.source, colour: grp.colour, target },
        value: moveValue(mine, grp.colour, grp.count, target, marker),
      });
  }
  if (!options.length) return null;
  options.sort((a, b) => b.value - a.value);
  // The next player still in the game.
  const playing = g.players.filter((p) => !p.removed);
  const at = playing.findIndex((p) => p.id === me);
  const next = playing.length > 1 ? playing[(at + 1) % playing.length] : undefined;
  const scored = options.slice(0, 12).map((o) => {
    let value = o.value;
    if (next) {
      const after = marketAfter(market, o.move.source, o.move.colour);
      const reply = bestValue(next, after);
      if (Number.isFinite(reply)) value -= 0.35 * reply;
    }
    if (rng) value += rng.next() * 0.3;
    return { ...o, value };
  });
  scored.sort((a, b) => b.value - a.value);
  return scored[0]!.move;
}

/** A board after a move, for tests and previews. */
export function boardAfter(
  board: Board,
  colour: Colour,
  count: number,
  target: Target,
  marker: boolean,
) {
  const b = copyBoard(board);
  place(b, colour, count, target, marker);
  return b;
}

/**
 * A playtest bot, from its own view only: on its turn, the best move as above; during the
 * wall-tiling, ready once.
 */
export function mosaicBot(view: MosaicView, ctx: BotCtx): MosaicAction | null {
  const g = view.game;
  if (view.phase !== 'playing' || !g) return null;
  if (!g.players.some((p) => p.id === ctx.me)) return null;
  if (g.stage === 'tiling') return g.ready.includes(ctx.me) ? null : { type: 'ready' };
  if (g.current !== ctx.me) return null;
  const move = bestMove(view, ctx.me, ctx.rng);
  return move ? { type: 'take', ...move } : null;
}
