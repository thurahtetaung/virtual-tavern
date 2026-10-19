import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { thorns } from './game.ts';
import type { Disc, ThornsAction, ThornsState } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: ThornsState;
  now: number;
  act(by: string, action: ThornsAction): ThornsState;
  refuse(by: string, action: ThornsAction): string;
  /** Runs the deadline due next (moving the clock to it). */
  tick(): ThornsState;
}

export function harness(n = 3, seed = 7, settings: Partial<ThornsState['settings']> = {}): Harness {
  const rng = createRng(seed);
  const run = (state: ThornsState, action: ThornsAction, by: string) =>
    thorns.reduce(state, action, { by, isHost: by === HOST, now: h.now, rng, content });
  const h: Harness = {
    now: NOW,
    state: thorns.create(
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
      const at = thorns.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = thorns.onDeadline!(h.state, h.now);
      return h.state;
    },
  };
  if (Object.keys(settings).length) h.act(HOST, { type: 'update-settings', ...settings });
  return h;
}

/** A started game, with `first` as the first player. */
export function started(
  n = 3,
  opts: { first?: string; seed?: number; settings?: Partial<ThornsState['settings']> } = {},
) {
  const h = harness(n, opts.seed ?? 7, opts.settings);
  h.act(HOST, { type: 'start' });
  if (opts.first) {
    const s = structuredClone(h.state);
    s.game!.round.starter = opts.first;
    h.state = s;
  }
  return h;
}

/**
 * Puts the given stacks down for this round (each player's first disc is the first of theirs),
 * playing every placement through the game: first discs at once, then the rest in turn order.
 */
export function placeAll(h: Harness, stacks: Record<string, Disc[]>) {
  for (const [id, discs] of Object.entries(stacks)) h.act(id, { type: 'place', disc: discs[0]! });
  const rest = Object.fromEntries(Object.entries(stacks).map(([id, d]) => [id, d.slice(1)]));
  for (let guard = 0; guard < 40; guard++) {
    const r = h.state.game!.round;
    const cur = r.current!;
    const next = rest[cur]?.shift();
    if (next === undefined) return;
    h.act(cur, { type: 'place', disc: next });
  }
}

export const game = (h: Harness) => h.state.game!;
export const round = (h: Harness) => h.state.game!.round;

/** Gives players these discs for the round about to be placed (before anyone has put one down). */
export function setDiscs(h: Harness, discs: Record<string, Disc[]>) {
  const s = structuredClone(h.state);
  for (const [id, d] of Object.entries(discs)) {
    const p = s.game!.players[id]!;
    p.discs = [...d];
    p.hand = [
      ...d,
      ...(s.game!.chance?.holder === id && s.game!.chance.round === s.game!.round.number
        ? (['chance'] as Disc[])
        : []),
    ];
    p.stack = [];
  }
  h.state = s;
}

/**
 * Puts these stacks (bottom first) straight on the mats, takes the discs out of hand, and hands
 * the turn to `current` before any bid: a rig for testing the bidding and the flip.
 */
export function rigStacks(h: Harness, stacks: Record<string, Disc[]>, current: string) {
  const s = structuredClone(h.state);
  const g = s.game!;
  for (const [id, stack] of Object.entries(stacks)) {
    const p = g.players[id]!;
    p.stack = [...stack];
    for (const d of stack) {
      const at = p.hand.indexOf(d);
      if (at < 0) throw new Error(`${id} has no ${d} in hand`);
      p.hand.splice(at, 1);
    }
  }
  g.round.stage = 'turns';
  g.round.current = current;
  h.state = s;
}
