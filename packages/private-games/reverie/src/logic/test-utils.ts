import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { reverie } from './game.ts';
import type { ReverieAction, ReverieState } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';
export const FOUR = [HOST, 'ana', 'ben', 'cy'];

const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: ReverieState;
  act(action: ReverieAction, by?: string, now?: number): ReverieState;
  reject(action: ReverieAction, by?: string): string;
}

export function harness(ids = FOUR, seed = 3): Harness {
  const rng = createRng(seed);
  const run = (state: ReverieState, action: ReverieAction, by: string, now: number) =>
    reverie.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
  const h: Harness = {
    state: reverie.create(
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

export function startedGame(ids = FOUR, settings: Partial<ReverieState['settings']> = {}) {
  const h = harness(ids);
  if (Object.keys(settings).length) h.act({ type: 'update-settings', ...settings });
  h.act({ type: 'start' });
  return h;
}

export const storyteller = (h: Harness) => h.state.turn!.storyteller;
export const hand = (h: Harness, id: string) => h.state.seats[id]!.hand;
export const othersOf = (h: Harness) =>
  Object.entries(h.state.seats)
    .filter(([id, s]) => s.playing && id !== storyteller(h))
    .map(([id]) => id);

/** Storyteller tells with their first card; everyone else gives their first card(s). */
export function tellAndGive(h: Harness, clue = 'moonlight') {
  const st = storyteller(h);
  h.act({ type: 'tell', card: hand(h, st)[0]!, clue }, st);
  const need =
    h.state.seats && Object.values(h.state.seats).filter((s) => s.playing).length === 3 ? 2 : 1;
  for (const id of othersOf(h)) h.act({ type: 'give', cards: hand(h, id).slice(0, need) }, id);
  return h;
}

/** Table index of the storyteller's card. */
export const storyIndex = (h: Harness) =>
  h.state.turn!.table.findIndex((t) => t.owner === storyteller(h));

/** Table index of some card not owned by `id` and not the storyteller's. */
export const decoyIndexFor = (h: Harness, id: string) =>
  h.state.turn!.table.findIndex((t) => t.owner !== id && t.owner !== storyteller(h));

/** Casts votes: `finders` vote for the story card, everyone else for a decoy. */
export function voteAll(h: Harness, finders: string[]) {
  for (const id of othersOf(h)) {
    h.act({ type: 'vote', index: finders.includes(id) ? storyIndex(h) : decoyIndexFor(h, id) }, id);
  }
  return h;
}
