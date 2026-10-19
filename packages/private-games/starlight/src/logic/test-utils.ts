import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { starlight } from './game.ts';
import type { StarlightAction, StarlightState } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';
export const FOUR = [HOST, 'ana', 'ben', 'cy'];

/** Made-up word cards: some with a second word, some without. */
export const WORDS = ['Moon / Tide', 'Lantern', 'Harbour / Kite', 'Velvet', 'Thunder / Honey'];

export const content: ContentProvider = {
  wordLists: () => [{ id: 'test', name: 'Test words', wordCount: WORDS.length }],
  words: (ids) => (ids.includes('test') ? WORDS : []),
};

/** One-word cards only, so a round opens straight on marking. */
export const plainContent: ContentProvider = {
  wordLists: () => [{ id: 'plain', name: 'Plain words', wordCount: 4 }],
  words: (ids) => (ids.includes('plain') ? ['Lantern', 'Velvet', 'Meadow', 'Clock'] : []),
};

export interface Harness {
  state: StarlightState;
  act(action: StarlightAction, by?: string, now?: number): StarlightState;
  reject(action: StarlightAction, by?: string): string;
}

export function harness(ids = FOUR, seed = 3, words = plainContent): Harness {
  const rng = createRng(seed);
  const run = (state: StarlightState, action: StarlightAction, by: string, now: number) =>
    starlight.reduce(state, action, { by, isHost: by === HOST, now, rng, content: words });
  const h: Harness = {
    state: starlight.create(
      { now: NOW, rng, content: words },
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

export function startedGame(ids = FOUR, seed = 3, words = plainContent) {
  const h = harness(ids, seed, words);
  h.act({ type: 'start' });
  return h;
}

/** Everyone marks the given positions and locks, in seat order. */
export function markAll(h: Harness, marks: Record<string, number[]>) {
  for (const [id, positions] of Object.entries(marks)) h.act({ type: 'mark', positions }, id);
  for (const id of Object.keys(marks)) h.act({ type: 'lock' }, id);
}

export const round = (h: Harness) => h.state.round!;
export const scout = (h: Harness) => h.state.round!.scout!;

/** The round's players with the First Scout first, clockwise. */
export function fromFirst(h: Harness): string[] {
  const r = round(h);
  const i = r.players.indexOf(r.first);
  return [...r.players.slice(i), ...r.players.slice(0, i)];
}

/** The player leaves the room for good. */
export function leave(h: Harness, id: string, now = NOW) {
  h.state = starlight.playerLeft(h.state, id, now);
  return h;
}
