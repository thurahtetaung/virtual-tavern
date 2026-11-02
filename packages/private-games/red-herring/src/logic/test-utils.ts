import { GameError, createRng } from '@vt/game-sdk';
import { redHerring } from './game.ts';
import type { RedHerringAction, RedHerringState, Settings } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';
export const FOUR = [HOST, 'ana', 'ben', 'cy'];
export const SIX = [HOST, 'ana', 'ben', 'cy', 'dee', 'eve'];

const content = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: RedHerringState;
  now: number;
  act(
    action: RedHerringAction,
    by?: string,
    extra?: { connected?: (id: string) => boolean },
  ): RedHerringState;
  reject(
    action: RedHerringAction,
    by?: string,
    extra?: { connected?: (id: string) => boolean },
  ): string;
  /** Moves the clock and fires any deadline that has passed. */
  tick(ms: number): RedHerringState;
}

export function harness(ids = FOUR, seed = 3, settings: Partial<Settings> = {}): Harness {
  const rng = createRng(seed);
  const run = (
    state: RedHerringState,
    action: RedHerringAction,
    by: string,
    now: number,
    connected?: (id: string) => boolean,
  ) =>
    redHerring.reduce(state, action, {
      by,
      isHost: by === HOST,
      now,
      rng,
      content,
      ...(connected && { connected }),
    });
  const h: Harness = {
    state: redHerring.create(
      { now: NOW, rng, content },
      ids.map((id) => ({ id, name: id.toUpperCase() })),
    ),
    now: NOW,
    act(action, by = HOST, extra) {
      const r = run(h.state, action, by, h.now, extra?.connected);
      if (r instanceof GameError)
        throw new Error(`${action.type} by ${by}: ${r.code}: ${r.message}`);
      h.state = r;
      return r;
    },
    reject(action, by = HOST, extra) {
      const r = run(h.state, action, by, h.now, extra?.connected);
      if (!(r instanceof GameError))
        throw new Error(`expected ${action.type} by ${by} to be rejected`);
      return r.code;
    },
    tick(ms) {
      h.now += ms;
      for (let i = 0; i < 50; i++) {
        const due = redHerring.nextDeadline!(h.state);
        if (due === null || due > h.now) break;
        h.state = redHerring.onDeadline!(h.state, h.now);
      }
      return h.state;
    },
  };
  if (Object.keys(settings).length) h.act({ type: 'update-settings', ...settings });
  return h;
}

export function startedGame(ids = FOUR, seed = 3, settings: Partial<Settings> = {}) {
  const h = harness(ids, seed, settings);
  h.act({ type: 'start' });
  return h;
}

export const game = (h: Harness) => h.state.game!;
export const round = (h: Harness) => h.state.game!.round;

/** The current turn's player plays the first card in their hand. */
export function playFirst(h: Harness) {
  const by = round(h).turn!;
  h.act({ type: 'play', card: game(h).hands[by]![0]! }, by);
}

/** The word-picker plays a card and writes `word`. */
export function setWord(h: Harness, word = 'Lighthouse') {
  playFirst(h);
  h.act({ type: 'word', word }, round(h).picker);
}

/** Everyone plays both cards. */
export function playAll(h: Harness) {
  while (round(h).stage === 'play') playFirst(h);
}

/** The host ends the talk and starts the vote. */
export function talkAll(h: Harness) {
  if (round(h).stage === 'discuss') h.act({ type: 'end-discussion' });
}

/** Everyone votes: `pick(voter)` names the accused (default: the first allowed). */
export function voteAll(h: Harness, pick?: (voter: string) => string) {
  const r = round(h);
  for (const v of r.order.slice(1)) {
    if (round(h).stage !== 'vote') break;
    const target = pick?.(v) ?? r.order.slice(1).find((id) => id !== v)!;
    h.act({ type: 'vote', player: target }, v);
  }
}

/** A whole round, everyone voting with `pick`. */
export function playRound(h: Harness, pick?: (voter: string) => string, word?: string) {
  setWord(h, word);
  playAll(h);
  talkAll(h);
  voteAll(h, pick);
}

/** The player leaves the room for good. */
export function leave(h: Harness, id: string) {
  h.state = redHerring.playerLeft(h.state, id, h.now);
  return h;
}
