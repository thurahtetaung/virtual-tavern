import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { codenames } from './game.ts';
import type { CardKind, CodenamesAction, CodenamesState, Team } from './types.ts';

export const LIST_WORDS = Array.from({ length: 30 }, (_, i) => `word${i}`);

export function content(
  lists: Record<string, string[]> = { default: LIST_WORDS },
): ContentProvider {
  return {
    wordLists: () =>
      Object.entries(lists).map(([id, w]) => ({ id, name: id, wordCount: w.length })),
    words: (ids) => ids.flatMap((id) => lists[id] ?? []),
  };
}

export const HOST = 'host';
export const NOW = 1_000_000;

export interface Harness {
  state: CodenamesState;
  /** Applies an action and returns the new state; throws on GameError. */
  act(action: CodenamesAction, by?: string, opts?: { now?: number }): CodenamesState;
  /** Applies an action expecting rejection; returns the error code. */
  reject(action: CodenamesAction, by?: string): string;
}

export function harness(
  players: string[] = [HOST, 'p2', 'p3', 'p4'],
  provider: ContentProvider = content(),
  seed = 1,
): Harness {
  const rng = createRng(seed);
  const h: Harness = {
    state: codenames.create(
      { now: NOW, rng, content: provider },
      players.map((id) => ({ id, name: id.toUpperCase() })),
    ),
    act(action, by = HOST, opts = {}) {
      const result = codenames.reduce(h.state, action, {
        by,
        isHost: by === HOST,
        now: opts.now ?? NOW,
        rng,
        content: provider,
      });
      if (result instanceof GameError) throw new Error(`${result.code}: ${result.message}`);
      h.state = result;
      return result;
    },
    reject(action, by = HOST) {
      const result = codenames.reduce(h.state, action, {
        by,
        isHost: by === HOST,
        now: NOW,
        rng,
        content: provider,
      });
      if (!(result instanceof GameError)) throw new Error(`expected ${action.type} to be rejected`);
      return result.code;
    },
  };
  return h;
}

/**
 * Seats: host = red spymaster, p2 = red operative, p3 = blue spymaster, p4 = blue operative.
 * Forces red to start so tests are predictable.
 */
export function startedGame(opts: { clueSeconds?: number; guessSeconds?: number } = {}) {
  const h = harness();
  h.state = { ...h.state, startingTeam: 'red' };
  h.act({ type: 'join-team', team: 'red', role: 'spymaster' }, HOST);
  h.act({ type: 'join-team', team: 'red', role: 'operative' }, 'p2');
  h.act({ type: 'join-team', team: 'blue', role: 'spymaster' }, 'p3');
  h.act({ type: 'join-team', team: 'blue', role: 'operative' }, 'p4');
  if (opts.clueSeconds || opts.guessSeconds) {
    h.act({
      type: 'update-settings',
      clueSeconds: opts.clueSeconds ?? null,
      guessSeconds: opts.guessSeconds ?? null,
    });
  }
  h.act({ type: 'start' });
  return h;
}

export const SPY: Record<Team, string> = { red: HOST, blue: 'p3' };
export const OP: Record<Team, string> = { red: 'p2', blue: 'p4' };

/** Indices of unrevealed cards of a kind. */
export function cardsOf(state: CodenamesState, kind: CardKind): number[] {
  return state.board.flatMap((c, i) => (c.kind === kind && !c.revealed ? [i] : []));
}

export function clue(h: Harness, team: Team, count = 1, word = 'hint') {
  return h.act({ type: 'give-clue', word, count }, SPY[team]);
}
