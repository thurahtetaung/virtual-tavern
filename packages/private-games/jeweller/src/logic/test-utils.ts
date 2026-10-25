import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { jeweller } from './game.ts';
import { noPieces } from './rules.ts';
import type { JewellerAction, JewellerState, Level, Pieces, PlayerState } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

export const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: JewellerState;
  now: number;
  act(by: string, action: JewellerAction): JewellerState;
  refuse(by: string, action: JewellerAction): string;
  /** Runs the deadline due next (moving the clock to it). */
  tick(): JewellerState;
  /** Changes the state directly (a rig). */
  rig(fn: (s: JewellerState) => void): void;
}

export function harness(
  n = 2,
  seed = 7,
  settings: Partial<JewellerState['settings']> = {},
): Harness {
  const rng = createRng(seed);
  const run = (state: JewellerState, action: JewellerAction, by: string) =>
    jeweller.reduce(state, action, { by, isHost: by === HOST, now: h.now, rng, content });
  const h: Harness = {
    now: NOW,
    state: jeweller.create(
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
      const at = jeweller.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = jeweller.onDeadline!(h.state, h.now);
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

/** A started game in seat order (p1 first). */
export function started(
  n = 2,
  opts: { seed?: number; settings?: Partial<JewellerState['settings']> } = {},
) {
  const h = harness(n, opts.seed ?? 7, opts.settings);
  h.act(HOST, { type: 'start' });
  h.rig((s) => {
    s.game!.order = ids(n);
    s.game!.current = 'p1';
  });
  return h;
}

export const pieces = (p: Partial<Pieces>): Pieces => ({ ...noPieces(), ...p });

/** Sets a player's pieces, bought cards, reserves or nobles. */
export function setPlayer(h: Harness, id: string, p: Partial<PlayerState>) {
  h.rig((s) => {
    Object.assign(s.game!.players[id]!, structuredClone(p));
  });
}

/** Puts these cards face up in a level's row (taking them out of the decks). */
export function setMarket(h: Harness, level: Level, cards: (string | null)[]) {
  h.rig((s) => {
    const g = s.game!;
    for (const l of [1, 2, 3] as const) {
      g.decks[l] = g.decks[l].filter((c) => !cards.includes(c));
      for (const c of g.market[l]) if (c && !cards.includes(c) && l === level) g.decks[l].push(c);
    }
    g.market[level] = [...cards];
  });
}

export const game = (h: Harness) => h.state.game!;
export const player = (h: Harness, id: string) => h.state.game!.players[id]!;
