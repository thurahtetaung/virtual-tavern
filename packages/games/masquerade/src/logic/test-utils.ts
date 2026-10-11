import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { defineMasquerade } from './game.ts';
import { masquerade } from './index.ts';
import type { MasqueradeAction, MasqueradeState, Round } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';
export const FOUR = [HOST, 'ana', 'ben', 'cy'];
export const SEVEN = [HOST, 'ana', 'ben', 'cy', 'dee', 'eve', 'fin'];

const content: ContentProvider = { wordLists: () => [], words: () => [] };

/** A small two-edition game, like the back-room one. */
export const twoEditions = defineMasquerade({
  id: 'masquerade-test',
  name: 'Test',
  description: 'test',
  pack: {
    editions: [
      { id: 'e1', label: 'Edition 1', locations: ['a', 'b', 'c'] },
      { id: 'e2', label: 'Edition 2', locations: ['x', 'y'] },
    ],
  },
  guide: masquerade.guide,
});

type Def = typeof masquerade;

export interface Harness {
  state: MasqueradeState;
  def: Def;
  act(action: MasqueradeAction, by?: string, now?: number): MasqueradeState;
  reject(action: MasqueradeAction, by?: string): string;
}

export function harness(ids = FOUR, seed = 7, def: Def = masquerade): Harness {
  const rng = createRng(seed);
  const run = (state: MasqueradeState, action: MasqueradeAction, by: string, now: number) =>
    def.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
  const h: Harness = {
    def,
    state: def.create(
      { now: NOW, rng, content },
      ids.map((id) => ({ id, name: id.toUpperCase() })),
    ),
    act(action, by = HOST, now = NOW) {
      const r = run(h.state, action, by, now);
      if (r instanceof GameError)
        throw new Error(`${action.type} by ${by}: ${r.code}: ${r.message}`);
      h.state = r;
      return r;
    },
    reject(action, by = HOST) {
      const r = run(h.state, action, by, NOW);
      if (!(r instanceof GameError))
        throw new Error(`expected ${action.type} by ${by} to be rejected`);
      return r.code;
    },
  };
  return h;
}

export function startedGame(
  ids = FOUR,
  settings: Omit<Extract<MasqueradeAction, { type: 'update-settings' }>, 'type'> = {},
  def: Def = masquerade,
) {
  const h = harness(ids, 7, def);
  if (Object.keys(settings).length) h.act({ type: 'update-settings', ...settings });
  h.act({ type: 'start' });
  return h;
}

/** Fixes who the spies are and where the round is. */
export function rig(h: Harness, patch: Partial<Round>) {
  h.state = { ...h.state, round: { ...h.state.round!, ...patch } };
  return h;
}

export const round = (h: Harness) => h.state.round!;

/** Everyone taps "Ready to vote". */
export function allReady(h: Harness) {
  for (const p of round(h).players) h.act({ type: 'ready-to-vote', ready: true }, p);
  return h;
}

/** Casts the given votes (voter -> target). */
export function votes(h: Harness, v: Record<string, string>) {
  for (const [from, to] of Object.entries(v)) h.act({ type: 'vote', target: to }, from);
  return h;
}

export function leave(h: Harness, id: string, now = NOW) {
  h.state = h.def.playerLeft(h.state, id, now);
  return h;
}

export function deadline(h: Harness) {
  const due = h.def.nextDeadline!(h.state)!;
  h.state = h.def.onDeadline!(h.state, due);
  return h;
}
