import { type ContentProvider, GameError, type InsightEvent, createRng } from '@vt/game-sdk';
import { hydra } from './game.ts';
import { insights } from './insights.ts';
import type { Game, HydraAction, HydraState, HydraView, Policy, Role } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';
export const ids = (n: number) =>
  [HOST, 'ana', 'ben', 'cy', 'dee', 'eve', 'fin', 'gus', 'hal', 'ivy'].slice(0, n);

const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: HydraState;
  now: number;
  act(action: HydraAction, by?: string): HydraState;
  reject(action: HydraAction, by?: string): string;
  view(viewer: string | null): HydraView;
  game(): Game;
}

export function harness(players = ids(5), seed = 7): Harness {
  const rng = createRng(seed);
  const run = (state: HydraState, action: HydraAction, by: string, now: number) =>
    hydra.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
  const h: Harness = {
    now: NOW,
    state: hydra.create(
      { now: NOW, rng, content },
      players.map((id) => ({ id, name: id.toUpperCase() })),
    ),
    act(action, by = HOST) {
      const r = run(h.state, action, by, h.now);
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
    view: (viewer) => hydra.view(h.state, viewer),
    game: () => h.state.game!,
  };
  return h;
}

/**
 * A started game with the given roles in seat order (seat i gets roles[i]), `president` (default
 * the host) as the first candidate, and everyone ready. `deck` (top first) replaces the deck's top.
 */
export function rigged(
  roles: Role[],
  opts: {
    president?: string;
    deck?: Policy[];
    ready?: boolean;
    settings?: Omit<Extract<HydraAction, { type: 'update-settings' }>, 'type'>;
    seed?: number;
  } = {},
): Harness {
  const players = ids(roles.length);
  const h = harness(players, opts.seed ?? 7);
  if (opts.settings) h.act({ type: 'update-settings', ...opts.settings });
  h.act({ type: 'start' });
  const g = h.game();
  const president = opts.president ?? HOST;
  let deck = g.deck;
  if (opts.deck) {
    const rest = [...g.deck];
    for (const c of opts.deck) rest.splice(rest.indexOf(c), 1);
    deck = [...opts.deck, ...rest];
  }
  h.state = {
    ...h.state,
    game: {
      ...g,
      roles: Object.fromEntries(players.map((p, i) => [p, roles[i]!])),
      president,
      rotation: president,
      deck,
    },
  };
  if (opts.ready !== false) for (const p of players) h.act({ type: 'ready' }, p);
  return h;
}

/** Stacks the deck's top (keeping every card in play). */
export function stack(h: Harness, top: Policy[]) {
  const g = h.game();
  const rest = [...g.deck, ...g.discard];
  for (const c of top) rest.splice(rest.indexOf(c), 1);
  const deck = [...top, ...rest.slice(0, Math.max(0, g.deck.length - top.length))];
  const discard = rest.slice(Math.max(0, g.deck.length - top.length));
  h.state = { ...h.state, game: { ...g, deck, discard } };
}

/** Everyone alive votes; `no` lists the players voting no. */
export function voteAll(h: Harness, no: string[] = []) {
  const g = h.game();
  for (const p of g.players.filter((x) => !g.dead.includes(x)))
    if (h.state.stage === 'vote') h.act({ type: 'vote', ballot: no.includes(p) ? 'no' : 'yes' }, p);
}

/** The President nominates `chancellor` and the vote passes (or fails with `no`). */
export function elect(h: Harness, chancellor: string, no: string[] = []) {
  h.act({ type: 'nominate', player: chancellor }, h.game().president);
  voteAll(h, no);
  if (h.state.stage === 'leader-check') deadline(h);
}

/** The session: the President discards a card unlike `enact` if possible, the Chancellor enacts `enact`. */
export function legislate(h: Harness, enact: Policy) {
  const g = h.game();
  const keep = g.hand.indexOf(enact);
  if (keep < 0) throw new Error(`no ${enact} card in ${g.hand.join(',')}`);
  const other = g.hand.findIndex((c, i) => i !== keep && c !== enact);
  const drop = other >= 0 ? other : g.hand.findIndex((_, i) => i !== keep);
  h.act({ type: 'discard', index: drop }, g.president);
  const g2 = h.game();
  h.act({ type: 'enact', index: g2.hand.indexOf(enact) }, g2.chancellor!);
}

/** Everyone the table waits on claims honestly-looking defaults. */
export function claimAll(h: Harness) {
  for (const n of [...h.game().needs]) {
    if (n.kind === 'president') h.act({ type: 'claim', blues: 1, discarded: 'red' }, n.by);
    else if (n.kind === 'chancellor') h.act({ type: 'claim', blues: 1 }, n.by);
    else if (n.kind === 'peek') h.act({ type: 'claim', cards: ['red', 'red', 'blue'] }, n.by);
    else h.act({ type: 'claim', team: 'blue' }, n.by);
  }
}

/** One whole round with the deck stacked: elect, enact, claim. */
export function round(h: Harness, chancellor: string, enact: Policy) {
  stack(h, [enact, enact === 'red' ? 'blue' : 'red', enact]);
  elect(h, chancellor);
  legislate(h, enact);
  if (h.state.stage === 'claim') claimAll(h);
}

export function deadline(h: Harness) {
  const due = hydra.nextDeadline!(h.state);
  if (due === null) throw new Error('no deadline');
  h.now = Math.max(h.now, due);
  h.state = hydra.onDeadline!(h.state, h.now);
  return h;
}

export function leave(h: Harness, id: string) {
  h.state = hydra.playerLeft(h.state, id, h.now);
  return h;
}

/** Records every insight event the harness's actions produce (as the room host would). */
export function recording(h: Harness): { events: InsightEvent[] } {
  const log = { events: [] as InsightEvent[] };
  const act = h.act.bind(h);
  h.act = (action, by) => {
    const before = h.state;
    const after = act(action, by);
    log.events.push(...insights(before, after, action, by ?? HOST));
    return after;
  };
  return log;
}
