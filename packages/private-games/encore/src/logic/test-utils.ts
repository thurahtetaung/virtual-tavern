import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { encore, parseCards } from './game.ts';
import type { EncoreAction, EncoreState, HandCard } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

export const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: EncoreState;
  now: number;
  act(by: string, action: EncoreAction): EncoreState;
  refuse(by: string, action: EncoreAction): string;
  /** Runs the deadline due next (moving the clock to it). */
  tick(): EncoreState;
  rig(fn: (s: EncoreState) => void): void;
}

export function harness(n = 3, seed = 7, settings: Partial<EncoreState['settings']> = {}): Harness {
  const rng = createRng(seed);
  const run = (state: EncoreState, action: EncoreAction, by: string) =>
    encore.reduce(state, action, { by, isHost: by === HOST, now: h.now, rng, content });
  const h: Harness = {
    now: NOW,
    state: encore.create(
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
      const at = encore.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = encore.onDeadline!(h.state, h.now);
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

/** "1/2 3/8": cards written up-number first. */
export const cards = (text: string): HandCard[] => parseCards(text);

/** Everyone keeps their hand: play begins. */
export function keepAll(h: Harness) {
  for (const id of h.state.game!.order) {
    if (h.state.game!.stage !== 'flip') break;
    if (h.state.game!.players[id]!.flip === null) h.act(id, { type: 'flip', flip: false });
  }
}

/**
 * A game in play with these hands (by seat), the first seat to move and an empty table (or the
 * one given, owned by `owner`).
 */
export function playing(
  n: number,
  hands: Record<string, string>,
  opts: {
    seed?: number;
    settings?: Partial<EncoreState['settings']>;
    current?: string;
    table?: string;
    owner?: string;
  } = {},
) {
  const h = harness(n, opts.seed ?? 7, opts.settings);
  h.act(HOST, { type: 'start' });
  keepAll(h);
  h.rig((s) => {
    const g = s.game!;
    for (const [id, text] of Object.entries(hands)) g.players[id]!.hand = cards(text);
    g.current = opts.current ?? 'p1';
    g.starter = g.current;
    g.table = opts.table ? { cards: cards(opts.table), owner: opts.owner ?? 'p2' } : null;
  });
  return h;
}

export const game = (h: Harness) => h.state.game!;
export const player = (h: Harness, id: string) => h.state.game!.players[id]!;
export const ups = (hand: readonly HandCard[]) => hand.map((c) => c.up).join(' ');
