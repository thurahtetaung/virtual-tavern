import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { mosaic } from './game.ts';
import { columnOf, noCounts } from './rules.ts';
import type { Board, Colour, Counts, MosaicAction, MosaicState } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

export const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: MosaicState;
  now: number;
  act(by: string, action: MosaicAction): MosaicState;
  refuse(by: string, action: MosaicAction): string;
  /** Runs the deadline due next (moving the clock to it). */
  tick(): MosaicState;
  /** Changes the state directly (a rig). */
  rig(fn: (s: MosaicState) => void): void;
}

export function harness(n = 2, seed = 7, settings: Partial<MosaicState['settings']> = {}): Harness {
  const rng = createRng(seed);
  const run = (state: MosaicState, action: MosaicAction, by: string) =>
    mosaic.reduce(state, action, { by, isHost: by === HOST, now: h.now, rng, content });
  const h: Harness = {
    now: NOW,
    state: mosaic.create(
      { now: NOW, rng, content },
      ids(n).map((id) => ({ id, name: id.toUpperCase() })),
    ),
    act(by, action) {
      const r = run(h.state, action, by);
      if (r instanceof GameError)
        throw new Error(`${action.type} by ${by}: ${r.code}: ${r.message}`);
      h.state = r;
      return r;
    },
    refuse(by, action) {
      const r = run(h.state, action, by);
      if (!(r instanceof GameError))
        throw new Error(`expected ${action.type} by ${by} to be refused`);
      return r.code;
    },
    tick() {
      const at = mosaic.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = mosaic.onDeadline!(h.state, h.now);
      return h.state;
    },
    rig(fn) {
      const s = structuredClone(h.state);
      fn(s);
      h.state = s;
    },
  };
  if (Object.keys(settings).length) h.act(HOST, { type: 'update-settings', ...settings });
  return h;
}

/** A started game in seat order, p1 starting. */
export function started(
  n = 2,
  opts: { seed?: number; settings?: Partial<MosaicState['settings']> } = {},
) {
  const h = harness(n, opts.seed ?? 7, opts.settings);
  h.act(HOST, { type: 'start' });
  h.rig((s) => {
    s.game!.starter = 'p1';
    s.game!.current = 'p1';
  });
  return h;
}

export const counts = (c: Partial<Counts>): Counts => ({ ...noCounts(), ...c });

/**
 * Sets the table: the factories and the centre. The tiles that were there go back to the bag so
 * the set of 100 stays whole.
 */
export function setTable(h: Harness, factories: Colour[][], centre: Partial<Counts> = {}) {
  h.rig((s) => {
    const g = s.game!;
    const out = [
      ...g.factories.flat(),
      ...(Object.entries(g.centre) as [Colour, number][]).flatMap(([c, n]) =>
        Array<Colour>(n).fill(c),
      ),
    ];
    g.bag.push(...out);
    const want = [
      ...factories.flat(),
      ...(Object.entries(centre) as [Colour, number][]).flatMap(([c, n]) =>
        Array<Colour>(n ?? 0).fill(c),
      ),
    ];
    for (const c of want) {
      const at = g.bag.indexOf(c);
      if (at >= 0) g.bag.splice(at, 1);
    }
    g.factories = factories.map((f) => [...f]);
    g.centre = counts(centre);
  });
}

/** Puts tiles on a player's wall (by row) and sets lines, floor and score. */
export function setBoard(
  h: Harness,
  id: string,
  b: {
    wall?: Record<number, Colour[]>;
    lines?: Board['lines'];
    floor?: Board['floor'];
    score?: number;
  },
) {
  h.rig((s) => {
    const g = s.game!;
    const board = g.players[id]!;
    // The tiles come out of the bag, so the set of 100 stays whole.
    const draw = (c: Colour) => {
      const at = g.bag.indexOf(c);
      if (at >= 0) g.bag.splice(at, 1);
    };
    for (const [row, cs] of Object.entries(b.wall ?? {}))
      for (const c of cs) {
        board.wall[Number(row)]![columnOf(Number(row), c)] = c;
        draw(c);
      }
    if (b.lines) {
      board.lines = structuredClone(b.lines);
      for (const l of b.lines) for (let i = 0; i < l.count; i++) draw(l.colour!);
    }
    if (b.floor) {
      board.floor = [...b.floor];
      for (const f of b.floor) if (f !== 'first') draw(f);
    }
    if (b.score !== undefined) board.score = b.score;
  });
}

export const game = (h: Harness) => h.state.game!;
export const board = (h: Harness, id: string) => h.state.game!.players[id]!;

/** Every tile in the game: bag, lid, table, lines, floors and walls. Always 100. */
export function tileCount(s: MosaicState): number {
  const g = s.game!;
  const sum = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);
  let n = g.bag.length + sum(g.lid) + g.factories.flat().length + sum(g.centre);
  for (const id of g.order) {
    const b = g.players[id]!;
    n += b.lines.reduce((a, l) => a + l.count, 0);
    n += b.floor.filter((f) => f !== 'first').length;
    n += b.wall.flat().filter(Boolean).length;
  }
  return n;
}
