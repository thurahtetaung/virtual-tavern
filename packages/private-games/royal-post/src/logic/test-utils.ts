import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { royalPost } from './game.ts';
import type { Edition, Role, RoundPlayer, RoyalPostAction, RoyalPostState } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';
export const THREE = [HOST, 'ana', 'ben'];
export const FOUR = [HOST, 'ana', 'ben', 'cy'];

const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: RoyalPostState;
  act(action: RoyalPostAction, by?: string, now?: number): RoyalPostState;
  reject(action: RoyalPostAction, by?: string): string;
}

export function harness(ids = THREE, seed = 7): Harness {
  const rng = createRng(seed);
  const run = (state: RoyalPostState, action: RoyalPostAction, by: string, now: number) =>
    royalPost.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
  const h: Harness = {
    state: royalPost.create(
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
  ids = THREE,
  edition: Edition = 'classic',
  settings: Partial<RoyalPostState['settings']> = {},
  seed = 7,
) {
  const h = harness(ids, seed);
  h.act({ type: 'update-settings', edition, ...settings });
  h.act({ type: 'start' });
  return h;
}

export interface Rig {
  /** Hands by player; the current player should hold two cards. */
  hands: Record<string, Role[]>;
  /** The draw pile, top first. */
  deck?: Role[];
  current?: string;
  setAside?: Role | null;
  discards?: Record<string, Role[]>;
  protected?: string[];
  out?: string[];
}

/**
 * Sets up the round exactly: hands, deck and whose turn it is. Players not mentioned keep
 * whatever they hold. The deck defaults to a few Guards so the round doesn't end by itself.
 */
export function rig(h: Harness, r: Rig) {
  const round = h.state.round!;
  const players: Record<string, RoundPlayer> = {};
  for (const [id, p] of Object.entries(round.players)) {
    players[id] = {
      ...p,
      hand: r.hands[id] ?? p.hand,
      discards: r.discards?.[id] ?? [],
      protected: r.protected?.includes(id) ?? false,
      out: r.out?.includes(id) ?? false,
    };
    if (players[id].out) players[id].hand = [];
  }
  const current = r.current ?? round.order[0]!;
  h.state = {
    ...h.state,
    round: {
      ...round,
      players,
      deck: r.deck ?? ['guard', 'guard', 'guard', 'guard'],
      setAside: r.setAside === undefined ? 'priest' : r.setAside,
      current,
      stage: 'play',
      result: null,
    },
  };
  return h;
}

export const hand = (h: Harness, id: string) => h.state.round!.players[id]!.hand;
export const isOut = (h: Harness, id: string) => h.state.round!.players[id]!.out;
export const current = (h: Harness) => h.state.round!.current;
export const order = (h: Harness) => h.state.round!.order;

/** The player leaves the room for good. */
export function leave(h: Harness, id: string, now = NOW) {
  h.state = royalPost.playerLeft(h.state, id, now);
  return h;
}

/** Every card in the round, wherever it is: the deck never gains or loses cards. */
export const cardsEverywhere = (h: Harness): Role[] => {
  const round = h.state.round!;
  return [
    ...round.deck,
    ...(round.setAside ? [round.setAside] : []),
    ...round.faceUp,
    ...Object.values(round.players).flatMap((p) => [...p.hand, ...p.discards]),
  ];
};
