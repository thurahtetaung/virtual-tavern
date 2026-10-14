import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { PILLARS } from './cards.ts';
import { seance } from './game.ts';
import type { Game, Psychic, PsychicColor, SeanceAction, SeanceState, Settings } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';
export const IDS = ['host', 'ana', 'ben', 'cy', 'dee', 'eve', 'fay', 'gus'];

const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: SeanceState;
  now: number;
  act(action: SeanceAction, by?: string, at?: number): SeanceState;
  reject(action: SeanceAction, by?: string): string;
  tick(ms: number): SeanceState;
  game(): Game;
  psychic(id: string): Psychic;
}

export function harness(count = 4, seed = 7): Harness {
  const rng = createRng(seed);
  const run = (state: SeanceState, action: SeanceAction, by: string, now: number) =>
    seance.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
  const h: Harness = {
    now: NOW,
    state: seance.create(
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
    tick(ms) {
      h.now += ms;
      const due = seance.nextDeadline!(h.state);
      if (due !== null && h.now >= due) h.state = seance.onDeadline!(h.state, h.now);
      return h.state;
    },
    game: () => h.state.game!,
    psychic: (id) => h.game().psychics.find((p) => p.id === id)!,
  };
  return h;
}

/** A started game: `host` is the ghost, everyone else a psychic in seat order. */
export function startedGame(
  count = 4,
  settings: Partial<Omit<Settings, 'ghostPick'>> = {},
  seed = 7,
) {
  const h = harness(count, seed);
  h.act({ type: 'update-settings', ghostMode: 'host', ghostPick: HOST, ...settings });
  h.act({ type: 'start' });
  return h;
}

export const colorOf = (h: Harness, id: string): PsychicColor => h.psychic(id).color;

/** The ghost sends every psychic still searching (and at the table) the first card of the hand. */
export function sendAll(h: Harness) {
  for (const p of h.game().psychics) {
    if (p.gone || p.retired || p.step >= 3 || h.game().sent.includes(p.color)) continue;
    h.act({ type: 'send', to: p.color, cards: [h.game().hand[0]!] }, HOST);
  }
}

/** Every psychic still searching guesses: right for those in `right`, wrong for the others. */
export function guessAll(h: Harness, right: readonly string[] | 'all' = 'all') {
  for (const p of h.game().psychics) {
    if (p.gone || p.retired || p.step >= 3) continue;
    const pillar = PILLARS[p.step]!;
    const target = p.targets[p.step]!;
    const good = right === 'all' || right.includes(p.id);
    const card = good ? target : h.game().table[pillar].find((c) => c !== target)!;
    h.act({ type: 'intuition', card }, p.id);
  }
}

/** Everyone the hour waits on taps Ready (the hour then locks). */
export function readyAll(h: Harness) {
  for (const p of h.game().psychics) {
    if (p.gone || p.retired || h.game().stage !== 'visions') continue;
    if (p.step >= 3) continue;
    if (!p.ready) h.act({ type: 'ready', on: true }, p.id);
  }
}

/** One whole hour: visions, guesses, ready, and the clock moves on. */
export function playHour(h: Harness, right: readonly string[] | 'all' = 'all') {
  sendAll(h);
  guessAll(h, right);
  readyAll(h);
  h.act({ type: 'continue' }, HOST);
}

/** Plays until everyone has found their three cards (all right every hour): the final starts. */
export function toFinal(h: Harness) {
  while (h.game().stage !== 'shared') playHour(h);
}
