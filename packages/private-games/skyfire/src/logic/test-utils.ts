import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { type Card, SUIT_LETTER } from './cards.ts';
import { noKnowledge } from './clues.ts';
import { skyfire } from './game.ts';
import type { SkyfireAction, SkyfireState } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

export const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: SkyfireState;
  now: number;
  act(by: string, action: SkyfireAction): SkyfireState;
  refuse(by: string, action: SkyfireAction): string;
  /** Runs the deadline due next (moving the clock to it). */
  tick(): SkyfireState;
  rig(fn: (s: SkyfireState) => void): void;
}

export function harness(
  n = 3,
  seed = 7,
  settings: Partial<SkyfireState['settings']> = {},
): Harness {
  const rng = createRng(seed);
  const run = (state: SkyfireState, action: SkyfireAction, by: string) =>
    skyfire.reduce(state, action, { by, isHost: by === HOST, now: h.now, rng, content });
  const h: Harness = {
    now: NOW,
    state: skyfire.create(
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
      const at = skyfire.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = skyfire.onDeadline!(h.state, h.now);
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

/** "r1 y5 k3": cards by suit letter and number. */
export const faces = (text: string): Card[] =>
  text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ({ suit: SUIT_LETTER[t[0]!]!, rank: Number(t.slice(1)) as Card['rank'] }));

/**
 * A game in play with these hands (by seat, left to right), this deck (top first), p1 to move
 * and everything else as dealt. Card ids are `h<seat>-<slot>` and `d<n>`.
 */
export function playing(
  n: number,
  hands: Record<string, string>,
  opts: {
    deck?: string;
    seed?: number;
    settings?: Partial<SkyfireState['settings']>;
    current?: string;
    fireworks?: Partial<Record<Card['suit'], number>>;
    discards?: string;
    clues?: number;
    fuses?: number;
  } = {},
) {
  const h = harness(n, opts.seed ?? 7, opts.settings);
  h.act(HOST, { type: 'start' });
  h.rig((s) => {
    const g = s.game!;
    g.cards = {};
    g.know = {};
    for (const id of g.order) {
      const cards = faces(hands[id] ?? '');
      g.hands[id] = cards.map((c, i) => {
        const cid = `h${id}-${i}`;
        g.cards[cid] = c;
        g.know[cid] = noKnowledge();
        return cid;
      });
    }
    g.deck = faces(opts.deck ?? '').map((c, i) => {
      const cid = `d${i}`;
      g.cards[cid] = c;
      return cid;
    });
    g.discards = faces(opts.discards ?? '').map((c, i) => {
      const cid = `x${i}`;
      g.cards[cid] = c;
      return cid;
    });
    for (const [suit, height] of Object.entries(opts.fireworks ?? {}))
      g.fireworks[suit as Card['suit']] = height;
    if (opts.clues !== undefined) g.clues = opts.clues;
    if (opts.fuses !== undefined) g.fuses = opts.fuses;
    g.current = opts.current ?? 'p1';
    g.clock = { key: `${g.turn}:${g.current}`, since: h.now, reminded: false };
  });
  return h;
}

export const game = (h: Harness) => h.state.game!;
/** A hand's faces as "r1 y2". */
export const handOf = (h: Harness, id: string) =>
  game(h)
    .hands[id]!.map((c) => {
      const f = game(h).cards[c]!;
      return `${Object.entries(SUIT_LETTER).find(([, s]) => s === f.suit)![0]}${f.rank}`;
    })
    .join(' ');
