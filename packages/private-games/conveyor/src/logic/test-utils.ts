import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { type TypeId } from './cards.ts';
import { conveyor } from './game.ts';
import type { Card, ConveyorAction, ConveyorState, Played } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

export const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: ConveyorState;
  now: number;
  act(by: string, action: ConveyorAction): ConveyorState;
  refuse(by: string, action: ConveyorAction): string;
  /** Runs the deadline due next (moving the clock to it). */
  tick(): ConveyorState;
  rig(fn: (s: ConveyorState) => void): void;
}

export function harness(
  n = 3,
  seed = 7,
  settings: Partial<ConveyorState['settings']> = {},
): Harness {
  const rng = createRng(seed);
  const run = (state: ConveyorState, action: ConveyorAction, by: string) =>
    conveyor.reduce(state, action, { by, isHost: by === HOST, now: h.now, rng, content });
  const h: Harness = {
    now: NOW,
    state: conveyor.create(
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
      const at = conveyor.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = conveyor.onDeadline!(h.state, h.now);
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

let next = 0;
/** A card with a readable id: `c<n>` (or the id given). */
export const card = (k: string, id = `c${++next}`): Card => ({ id, k });
/** A card in front of someone, played on `turn`. */
export const tray = (k: string, turn = 1, extra: Partial<Played> = {}): Played => ({
  id: `t${++next}`,
  k,
  turn,
  ...extra,
});

/**
 * A game in play with this menu, at `turn`, with these hands (variant lists by seat; card ids are
 * `<seat>-<index>`) and trays.
 */
export function playing(
  n: number,
  opts: {
    menu?: TypeId[];
    hands?: Record<string, string[]>;
    trays?: Record<string, Played[]>;
    turn?: number;
    seed?: number;
    settings?: Partial<ConveyorState['settings']>;
  } = {},
) {
  const menu = opts.menu ?? ['maki', 'tempura', 'sashimi', 'miso', 'wasabi', 'tea', 'icecream'];
  const h = harness(n, opts.seed ?? 7, { menu: 'custom', custom: menu, ...opts.settings });
  h.act(HOST, { type: 'start' });
  h.rig((s) => {
    const g = s.game!;
    g.turn = opts.turn ?? 1;
    for (const [id, ks] of Object.entries(opts.hands ?? {}))
      g.players[id]!.hand = ks.map((k, i) => ({ id: `${id}-${i}`, k }));
    for (const [id, cards] of Object.entries(opts.trays ?? {})) g.players[id]!.tray = cards;
  });
  return h;
}

export const game = (h: Harness) => h.state.game!;
export const player = (h: Harness, id: string) => h.state.game!.players[id]!;
export const ks = (cards: readonly { k: string }[]) => cards.map((c) => c.k);

/** Everyone picks the first card of their hand (or the card given). */
export function pickAll(
  h: Harness,
  picks: Record<string, Partial<{ card: string; target: string; bonus: string }>> = {},
) {
  for (const id of h.state.game!.order) {
    const p = picks[id];
    h.act(id, {
      type: 'pick',
      card: p?.card ?? h.state.game!.players[id]!.hand[0]!.id,
      ...(p?.target && { target: p.target }),
      ...(p?.bonus && { bonus: p.bonus }),
    });
  }
}
