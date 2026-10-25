import {
  type ContentProvider,
  type Drawing,
  GameError,
  createRng,
  encodeDrawing,
} from '@vt/game-sdk';
import { goingOnce } from './definition.ts';
import type { HintKind } from './types.ts';
import type { GoingOnceAction, GoingOnceState } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** Made-up title groups (the real ones are private and never committed). */
export const GROUPS = [
  {
    id: 'g-fruit',
    titles: ['Apple', 'Pear', 'Quince', 'Green ball', 'Lumpy apple', 'Plum', 'Fig', 'Medlar'],
  },
  {
    id: 'g-hats',
    titles: ['Top hat', 'Bowler', 'Chimney', 'Tall can', 'Fez', 'Stovepipe', 'Bucket', 'Drum'],
    house: ['h0', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'],
  },
  {
    id: 'g-fish',
    titles: ['Trout', 'Salmon', 'Carp', 'Pike', 'Perch', 'Eel', 'Cod'],
  },
];

export function packContent(
  groups: unknown = GROUPS,
  lines: Partial<Record<HintKind, string[]>> = {},
  host: Record<string, string[]> | null = null,
): ContentProvider {
  return {
    wordLists: () => [],
    words: () => [],
    contentPacks: (kind) =>
      kind === 'groups'
        ? [{ id: 'pack1', name: 'Test groups', data: groups }]
        : kind === 'lines'
          ? [{ id: 'pack2', name: 'Test lines', data: lines }]
          : kind === 'host' && host
            ? [{ id: 'pack3', name: 'Test host', data: host }]
            : [],
  };
}

export const SQUIGGLE: Drawing = encodeDrawing([
  { c: 0, w: 1, points: [100, 100, 300, 400, 500, 200] },
]);

export interface Harness {
  state: GoingOnceState;
  now: number;
  content: ContentProvider;
  act(by: string, action: GoingOnceAction): GoingOnceState;
  refuse(by: string, action: GoingOnceAction): { code: string; message: string };
  /** Runs the deadline due next (moving the clock to it). */
  tick(): GoingOnceState;
  /** Moves the clock on without running a deadline. */
  wait(ms: number): void;
}

export function harness(n = 3, seed = 7, content: ContentProvider = packContent()): Harness {
  const rng = createRng(seed);
  const run = (state: GoingOnceState, action: GoingOnceAction, by: string) =>
    goingOnce.reduce(state, action, { by, isHost: by === HOST, now: h.now, rng, content });
  const h: Harness = {
    now: NOW,
    content,
    state: goingOnce.create(
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
      return { code: r.code, message: r.message };
    },
    tick() {
      const at = goingOnce.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = goingOnce.onDeadline!(h.state, h.now);
      return h.state;
    },
    wait(ms) {
      h.now += ms;
    },
  };
  return h;
}

/** A started game in its drawing stage, at the Normal pace (whatever the table size). */
export function started(n = 3, seed = 7, content?: ContentProvider) {
  const h = harness(n, seed, content);
  h.act(HOST, { type: 'update-settings', pace: 'normal' });
  h.act(HOST, { type: 'start' });
  return h;
}

/** Everyone sends both drawings: the auction's first lot opens. */
export function drawAll(h: Harness, skip: string[] = []) {
  const g = h.state.game!;
  for (const id of g.order) {
    if (skip.includes(id)) continue;
    for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
  }
}

/** A game at its first lot. */
export function auctioning(n = 3, seed = 7, content?: ContentProvider) {
  const h = started(n, seed, content);
  drawAll(h);
  return h;
}

export const game = (h: Harness) => h.state.game!;
export const lot = (h: Harness) => {
  const g = h.state.game!;
  return g.items[g.lots[g.auction!.lot]!]!;
};

/** Bids for `by` at the given amount (or the lowest step) on the price on screen. */
export function bid(h: Harness, by: string, amount?: number) {
  const a = h.state.game!.auction!;
  const steps = a.bid ? [a.bid.amount + 100] : [400];
  h.wait(400);
  return h.act(by, { type: 'bid', amount: amount ?? steps[0]!, seq: a.seq });
}

/** Lets the clock run until the current lot is sold (or unsold). */
export function hammer(h: Harness) {
  for (let i = 0; i < 10 && h.state.game!.stage === 'auction'; i++) h.tick();
}

/** Runs deadlines until the next lot opens (or the game ends), declining any loans. */
export function nextLot(h: Harness) {
  const from = h.state.game!.auction?.lot ?? -1;
  for (let i = 0; i < 40; i++) {
    const g = h.state.game!;
    if (h.state.phase === 'over') return;
    if (g.stage === 'auction' && g.auction!.lot !== from) return;
    h.tick();
  }
  throw new Error('stuck');
}
