import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { inquest } from './game.ts';
import type { Game, InquestAction, InquestState, RoleId, Settings } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';
export const IDS = [
  'host',
  'ana',
  'ben',
  'cy',
  'dee',
  'eve',
  'fay',
  'gus',
  'hal',
  'ivy',
  'jo',
  'kai',
];

const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: InquestState;
  now: number;
  act(action: InquestAction, by?: string, at?: number): InquestState;
  reject(action: InquestAction, by?: string): string;
  /** The refusal's message. */
  refusal(action: InquestAction, by?: string): string;
  tick(ms: number): InquestState;
  game(): Game;
}

export function harness(count = 4, seed = 7): Harness {
  const rng = createRng(seed);
  const run = (state: InquestState, action: InquestAction, by: string, now: number) =>
    inquest.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
  const h: Harness = {
    now: NOW,
    state: inquest.create(
      { now: NOW, rng, content },
      IDS.slice(0, count).map((id) => ({ id, name: id[0]!.toUpperCase() + id.slice(1) })),
    ),
    act(action, by = HOST, at = h.now) {
      const r = run(h.state, action, by, at);
      if (r instanceof GameError)
        throw new Error(`${action.type} by ${by}: ${r.code}: ${r.message}`);
      h.state = r;
      return r;
    },
    reject(action, by = HOST) {
      const r = run(h.state, action, by, h.now);
      if (!(r instanceof GameError))
        throw new Error(`expected ${action.type} by ${by} to be rejected`);
      return r.code;
    },
    refusal(action, by = HOST) {
      const r = run(h.state, action, by, h.now);
      if (!(r instanceof GameError))
        throw new Error(`expected ${action.type} by ${by} to be rejected`);
      return r.message;
    },
    tick(ms) {
      h.now += ms;
      const due = inquest.nextDeadline!(h.state);
      if (due !== null && h.now >= due) h.state = inquest.onDeadline!(h.state, h.now);
      return h.state;
    },
    game: () => h.state.game!,
  };
  return h;
}

/**
 * A started game with fixed roles: `host` is the Forensic Scientist, then the roles given (by
 * default ana is the Murderer), everyone else an Investigator.
 */
export function startedGame(
  count = 4,
  roles: Partial<Record<Exclude<RoleId, 'forensic' | 'investigator'>, string>> = {},
  settings: Partial<Settings> = {},
  seed = 7,
) {
  const h = harness(count, seed);
  h.act({ type: 'update-settings', fsMode: 'host', fsPick: HOST, ...settings });
  h.act({ type: 'start' });
  const want: Record<string, RoleId> = { [roles.murderer ?? 'ana']: 'murderer' };
  if (roles.accomplice) want[roles.accomplice] = 'accomplice';
  if (roles.witness) want[roles.witness] = 'witness';
  // Re-deal the hidden roles to the fixed seats (the cards stay where they were dealt).
  const g = h.game();
  const players = g.players.map((p) => ({
    ...p,
    role: p.id === HOST ? ('forensic' as const) : (want[p.id] ?? ('investigator' as const)),
  }));
  h.state = { ...h.state, game: { ...g, players } };
  return h;
}

export const player = (h: Harness, id: string) => h.game().players.find((p) => p.id === id)!;
export const holder = (h: Harness, role: RoleId) => h.game().players.find((p) => p.role === role)!;

/** The Murderer commits their first Clue and Means card. */
export function commit(h: Harness) {
  const m = holder(h, 'murderer');
  h.act({ type: 'commit-crime', clue: m.clue[0]!, means: m.means[0]! }, m.id);
  return { murderer: m.id, clue: m.clue[0]!, means: m.means[0]! };
}

/** Night, location and the six round-1 bullets: the game is then at the first presentation. */
export function toPresentations(h: Harness, step = 5000) {
  const crime = commit(h);
  h.act({ type: 'pick-location', tile: 2 }, h.game().fs);
  for (let slot = 0; slot < 6; slot++) {
    h.now += step;
    h.act({ type: 'place-bullet', slot, item: slot % 6 }, h.game().fs);
  }
  return crime;
}

/** Everyone presents in turn until the round's presentations end. */
export function presentAll(h: Harness) {
  const round = h.game().round;
  while (h.state.phase === 'playing' && h.game().stage === 'present' && h.game().round === round) {
    const p = h.game().present!;
    h.act({ type: 'done-presenting' }, p.order[p.index]);
  }
}

/**
 * Puts a known order on the draw pile (top first), followed by the scene tiles not yet used.
 * Events count as already shuffled in, so only the ones listed here come up.
 */
export function stackPile(h: Harness, tiles: number[]) {
  const g = h.game();
  const used = new Set([...g.slots, ...g.removed].map((s) => s.tile));
  const rest = g.pile.filter((t) => !tiles.includes(t) && !used.has(t) && t < 27);
  h.state = { ...h.state, game: { ...g, eventsIn: true, pile: [...tiles, ...rest] } };
}
