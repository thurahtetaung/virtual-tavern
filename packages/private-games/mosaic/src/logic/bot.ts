import type { BotCtx, PlayerId, Rng } from '@vt/game-sdk';
import {
  addTo,
  bestSpace,
  capacity,
  copyBoard,
  countOf,
  linesFor,
  place,
  previewWith,
} from './rules.ts';
import { gone, leftoverGroups, neighbours } from './specials.ts';
import {
  type Board,
  COLUMN_BONUS,
  type Counts,
  type MosaicAction,
  type MosaicView,
  type Move,
  ROW_BONUS,
  SIZE,
  type Source,
  type Special,
  type Split,
  TILES,
  type Target,
  type Tile,
} from './types.ts';

export type { Move };

/** The table as a move sees it: what is on the factories and in the centre. */
export interface Market {
  factories: Tile[][];
  centre: Counts;
  /** `centre`, or the id of the player who took it. */
  marker: string;
  /** With special factories: each factory's face (null: plain). */
  specials?: (Special | null)[] | null;
}

/** A group a player could take: a colour (or the jokers alone) with, maybe, the jokers there. */
export interface Group {
  source: Source;
  colour: Tile;
  /** Tiles of the colour (jokers, for `joker`). */
  count: number;
  /** Jokers taken with the colour. */
  jokers: number;
}

const tilesAt = (m: Market, source: Source): Tile[] =>
  source === 'centre'
    ? TILES.flatMap((t) => Array<Tile>(countOf(m.centre, t)).fill(t))
    : (m.factories[source] ?? []);

/**
 * Every group a player could take: each colour from a factory or the centre, the jokers alone,
 * and each colour with the jokers there.
 */
export function groups(m: Market): Group[] {
  const out: Group[] = [];
  const at = (source: Source) => {
    const tiles = tilesAt(m, source);
    const jokers = tiles.filter((t) => t === 'joker').length;
    for (const colour of TILES) {
      const count = tiles.filter((t) => t === colour).length;
      if (!count) continue;
      out.push({ source, colour, count, jokers: 0 });
      if (colour !== 'joker' && jokers) out.push({ source, colour, count, jokers });
    }
  };
  m.factories.forEach((_, i) => {
    if (!gone(m.specials, i)) at(i);
  });
  at('centre');
  return out;
}

/**
 * How good a move is for a board right now, in rough points: the floor it costs, what a line it
 * fills will score, progress on a line it doesn't fill, a little for the row and column bonuses
 * and for starting next round. Its one-line reading: greedy.
 */
export function moveValue(
  board: Board,
  colour: Tile,
  count: number,
  target: Target,
  marker: boolean,
  jokers = 0,
  grey = false,
) {
  const { preview: p, board: b } = previewWith(board, colour, count, target, marker, jokers, grey);
  if (p.problem) return -Infinity;
  let v = p.penalty + (p.markerOnFloor || marker ? 0.8 : 0);
  // A joker in a line costs that colour's bonus; a little less is fine.
  v -= jokers * 0.3;
  if (target === 'floor') return v;
  const line = b.lines[target]!;
  const best = bestSpace(b.wall, target, line, grey);
  if (!best) return v - 2;
  const wall = b.wall;
  const rowDone = wall[target]!.filter(Boolean).length === SIZE - 1 ? ROW_BONUS : 0;
  const colDone =
    wall.filter((r, i) => i === target || r[best.col]).length === SIZE ? COLUMN_BONUS * 0.6 : 0;
  if (p.fills) v += (p.points ?? best.points) + 0.6 + rowDone + colDone;
  else v += (line.count / capacity(target)) * (best.points + rowDone + colDone) * 0.7;
  return v;
}

/** The market after a group is taken (a special factory's effect included). */
export function marketAfter(m: Market, move: Pick<Move, 'source' | 'colour' | 'jokers' | 'split'>) {
  const { source, colour } = move;
  const centre = { ...m.centre };
  const factories = m.factories.map((f) => [...f]);
  const specials = m.specials ? m.specials.map((x) => (x ? { ...x } : null)) : null;
  const tiles = tilesAt(m, source);
  const withJokers = colour !== 'joker' && !!move.jokers;
  const rest = tiles.filter((t) => t !== colour && !(withJokers && t === 'joker'));
  if (source === 'centre') {
    if (colour === 'joker' || withJokers) centre.joker = 0;
    if (colour !== 'joker') centre[colour] = 0;
  } else {
    const sp = specials?.[source] ?? null;
    factories[source] = sp?.kind === 'sf3' ? rest : [];
    if (sp?.kind === 'sf4') {
      const { left, right } = neighbours(specials, factories.length, source);
      for (const t of rest) {
        const to = (move.split?.[t] ?? 'left') === 'left' ? (left ?? right) : (right ?? left);
        if (to !== null) factories[to]!.push(t);
      }
    } else if (sp?.kind !== 'sf3') for (const t of rest) addTo(centre, t);
    if (sp?.kind === 'sf5') specials![source] = { ...sp, holder: 'taken' };
  }
  return {
    factories,
    centre,
    marker: source === 'centre' ? 'taken' : m.marker,
    specials,
  } satisfies Market;
}

/**
 * Where a special factory's leftovers go: each colour to the neighbour that holds less of it, so
 * nobody gets a big group handed to them (the left on a tie).
 */
export function splitFor(m: Market, source: Source, colour: Tile, withJokers: boolean): Split {
  if (source === 'centre' || m.specials?.[source]?.kind !== 'sf4') return {};
  const { left, right } = neighbours(m.specials, m.factories.length, source);
  const rest = m.factories[source]!.filter(
    (t) => t !== colour && !(withJokers && colour !== 'joker' && t === 'joker'),
  );
  const split: Split = {};
  for (const { tile } of leftoverGroups(rest)) {
    const n = (i: number | null) =>
      i === null ? Infinity : m.factories[i]!.filter((t) => t === tile).length;
    split[tile] = n(right) < n(left) ? 'right' : 'left';
  }
  return split;
}

/** The best greedy value a board can get from a market (for the one-move look-ahead). */
function bestValue(board: Board, m: Market, grey: boolean): number {
  let best = -Infinity;
  for (const g of groups(m)) {
    const marker = g.source === 'centre' && m.marker === 'centre';
    for (const target of [...linesFor(board, g.colour, grey), 'floor' as const])
      best = Math.max(
        best,
        moveValue(board, g.colour, g.count, target, marker, g.jokers, grey) +
          (shields(m, g.source) ? 1 : 0),
      );
  }
  return best;
}

const shields = (m: Market, source: Source) =>
  source !== 'centre' && m.specials?.[source]?.kind === 'sf5';

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
  const grey = !!view.settings.grey;
  const market: Market = {
    factories: g.factories,
    centre: g.centre,
    marker: g.marker,
    specials: g.specials,
  };
  const options: { move: Move; value: number }[] = [];
  for (const grp of groups(market)) {
    const marker = grp.source === 'centre' && market.marker === 'centre';
    const split = splitFor(market, grp.source, grp.colour, grp.jokers > 0);
    for (const target of [...linesFor(mine, grp.colour, grey), 'floor' as const])
      options.push({
        move: {
          source: grp.source,
          colour: grp.colour,
          target,
          ...(grp.jokers > 0 && { jokers: true }),
          ...(Object.keys(split).length > 0 && { split }),
        },
        value:
          moveValue(mine, grp.colour, grp.count, target, marker, grp.jokers, grey) +
          (shields(market, grp.source) ? 1 : 0),
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
      const reply = bestValue(next, marketAfter(market, o.move), grey);
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
  colour: Tile,
  count: number,
  target: Target,
  marker: boolean,
  jokers = 0,
) {
  const b = copyBoard(board);
  place(b, colour, count, target, marker, jokers);
  return b;
}

/** Where the bot puts its waiting line's tile on the wall: the best-scoring space (leftmost on a tie). */
export function wallChoice(view: MosaicView, me: PlayerId): { row: number; col: number } | null {
  const g = view.game;
  const w = g?.walls?.[me];
  const board = g?.players.find((p) => p.id === me);
  if (!w || w.row === null || !board) return null;
  const best = bestSpace(board.wall, w.row, board.lines[w.row]!, !!view.settings.grey);
  return best ? { row: w.row, col: best.col } : null;
}

/**
 * A playtest bot, from its own view only: on its turn, the best move as above; in the wall
 * stage, the best space; during the wall-tiling, ready once.
 */
export function mosaicBot(view: MosaicView, ctx: BotCtx): MosaicAction | null {
  const g = view.game;
  if (view.phase !== 'playing' || !g) return null;
  if (!g.players.some((p) => p.id === ctx.me)) return null;
  if (g.stage === 'tiling') return g.ready.includes(ctx.me) ? null : { type: 'ready' };
  if (g.stage === 'wall') {
    const c = wallChoice(view, ctx.me);
    return c ? { type: 'wall', ...c } : null;
  }
  if (g.current !== ctx.me) return null;
  const move = bestMove(view, ctx.me, ctx.rng);
  return move ? { type: 'take', ...move } : null;
}
