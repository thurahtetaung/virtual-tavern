import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { enigma } from './game.ts';
import type { Code, EnigmaAction, EnigmaState, Flow, Team } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';
export const RED = [HOST, 'r2', 'r3'];
export const BLUE = ['b1', 'b2', 'b3'];

/** Made-up keywords without digits, so they never trip the number check on clues. */
const LETTERS = 'bcdfghjklmnpqrstvwxz';
const WORDS = Array.from(
  { length: 40 },
  (_, i) => `k${LETTERS[i % 20]}${LETTERS[Math.floor(i / 20)]}u`,
);

export function content(words = WORDS): ContentProvider {
  return {
    wordLists: () => [{ id: 'default', name: 'Default', wordCount: words.length }],
    words: (ids) => (ids.includes('default') ? words : []),
  };
}

export interface Harness {
  state: EnigmaState;
  act(action: EnigmaAction, by?: string, now?: number): EnigmaState;
  reject(action: EnigmaAction, by?: string): string;
}

export function harness(players = [...RED, ...BLUE], provider = content(), seed = 7): Harness {
  const rng = createRng(seed);
  const run = (state: EnigmaState, action: EnigmaAction, by: string, now: number) =>
    enigma.reduce(state, action, { by, isHost: by === HOST, now, rng, content: provider });
  const h: Harness = {
    state: enigma.create(
      { now: NOW, rng, content: provider },
      players.map((id) => ({ id, name: id.toUpperCase() })),
    ),
    act(action, by = HOST, now = NOW) {
      const result = run(h.state, action, by, now);
      if (result instanceof GameError)
        throw new Error(`${action.type} by ${by}: ${result.code}: ${result.message}`);
      h.state = result;
      return result;
    },
    reject(action, by = HOST) {
      const result = run(h.state, action, by, NOW);
      if (!(result instanceof GameError))
        throw new Error(`expected ${action.type} by ${by} to be rejected`);
      return result.code;
    },
  };
  return h;
}

/** Red = host, r2, r3; Blue = b1, b2, b3; Red transmits first. */
export function startedGame(
  opts: {
    flow?: Flow;
    clueSeconds?: number;
    guessSeconds?: number;
    timerMode?: 'soft' | 'strict';
  } = {},
) {
  const h = harness();
  h.state = { ...h.state, startingTeam: 'red' };
  for (const id of RED) h.act({ type: 'join-team', team: 'red' }, id);
  for (const id of BLUE) h.act({ type: 'join-team', team: 'blue' }, id);
  h.act({
    type: 'update-settings',
    flow: opts.flow ?? 'simultaneous',
    clueSeconds: opts.clueSeconds ?? null,
    guessSeconds: opts.guessSeconds ?? null,
    timerMode: opts.timerMode ?? 'soft',
  });
  h.act({ type: 'start' });
  return h;
}

export const tx = (h: Harness, team: Team) => h.state.transmissions.find((t) => t.team === team)!;
export const members = (team: Team) => (team === 'red' ? RED : BLUE);

/** Three fresh clues per round (a team may only give a clue once per game). */
const NATO =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray'.split(
    ' ',
  );
export const cluesFor = (round: number) => NATO.slice((round - 1) * 3, round * 3);

/** The active Encryptor for `team` sends three clues. */
export function sendClues(h: Harness, team: Team, now = NOW) {
  return h.act({ type: 'give-clues', clues: cluesFor(h.state.round) }, tx(h, team).encryptor, now);
}

/** Every listed player picks `code` and locks it in for the transmission sent by `team`. */
export function vote(h: Harness, team: Team, players: string[], code: Code) {
  for (const p of players) {
    h.act({ type: 'set-guess', team, draft: code }, p);
    h.act({ type: 'lock-guess', team }, p);
  }
}

export const decoders = (h: Harness, team: Team) =>
  members(team).filter((p) => p !== tx(h, team).encryptor);

/** A code that is definitely wrong for this transmission. */
export function wrongCode(code: Code): Code {
  return [code[1]!, code[2]!, code[0]!];
}
