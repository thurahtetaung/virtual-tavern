import { type ContentProvider, GameError, type InsightEvent, createRng } from '@vt/game-sdk';
import { roundTable } from './game.ts';
import { insights } from './insights.ts';
import type { Game, RoleId, RoundTableAction, RoundTableState, RoundTableView } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';
export const ids = (n: number) =>
  [HOST, 'ana', 'ben', 'cy', 'dee', 'eve', 'fin', 'gus', 'hal', 'ivy'].slice(0, n);

const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Harness {
  state: RoundTableState;
  act(action: RoundTableAction, by?: string, now?: number): RoundTableState;
  reject(action: RoundTableAction, by?: string): string;
  view(viewer: string | null): RoundTableView;
}

export function harness(players = ids(5), seed = 7): Harness {
  const rng = createRng(seed);
  const run = (state: RoundTableState, action: RoundTableAction, by: string, now: number) =>
    roundTable.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
  const h: Harness = {
    state: roundTable.create(
      { now: NOW, rng, content },
      players.map((id) => ({ id, name: id.toUpperCase() })),
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
    view: (viewer) => roundTable.view(h.state, viewer),
  };
  return h;
}

export const game = (h: Harness) => h.state.game!;

/**
 * Starts a game with the given roles, dealt in seat order (seat i gets roles[i]), and `leader`
 * (default the host) leading. With `ready`, everyone has read their card.
 */
export function rigged(
  roles: RoleId[],
  opts: {
    leader?: string;
    lady?: boolean;
    targeting?: boolean;
    oberonHidden?: boolean;
    ready?: boolean;
    settings?: Omit<Extract<RoundTableAction, { type: 'update-settings' }>, 'type'>;
  } = {},
): Harness {
  const players = ids(roles.length);
  const h = harness(players);
  h.act({
    type: 'update-settings',
    roles,
    lady: opts.lady ?? false,
    targeting: opts.targeting ?? false,
    oberonHidden: opts.oberonHidden ?? false,
    ...opts.settings,
  });
  h.act({ type: 'start' });
  const g = game(h);
  const leader = opts.leader ?? HOST;
  const li = players.indexOf(leader);
  const roleMap = Object.fromEntries(players.map((p, i) => [p, roles[i]!])) as Game['roles'];
  const assassin =
    players.find((p) => roleMap[p] === 'assassin') ??
    (roles.includes('merlin')
      ? (players.find(
          (p) => roleMap[p] !== 'oberon' && ['morgana', 'mordred', 'minion'].includes(roleMap[p]!),
        ) ?? null)
      : null);
  const holder = players[(li - 1 + players.length) % players.length]!;
  h.state = {
    ...h.state,
    game: {
      ...g,
      roles: roleMap,
      leader,
      firstLeader: leader,
      assassin,
      designated: assassin !== null && roleMap[assassin] !== 'assassin',
      ladyState: g.ladyState ? { holder, holders: [holder], checks: [] } : null,
    },
  };
  if (opts.ready !== false) for (const p of players) h.act({ type: 'ready' }, p);
  return h;
}

/** The leader proposes `team` (for the current or given quest). */
export function propose(h: Harness, team: string[], slot?: number) {
  h.act({ type: 'propose', team, ...(slot !== undefined ? { slot } : {}) }, game(h).leader);
}

/** Everyone votes; `no` lists the rejecters. */
export function voteAll(h: Harness, no: string[] = []) {
  for (const p of game(h).players) h.act({ type: 'vote', approve: !no.includes(p) }, p);
}

/** The team plays; `fail` lists who plays Fail. */
export function playAll(h: Harness, fail: string[] = []) {
  for (const p of game(h).team)
    h.act({ type: 'play', card: fail.includes(p) ? 'fail' : 'success' }, p);
}

/** One whole round: propose, approve, play. */
export function questRound(h: Harness, team: string[], fail: string[] = [], slot?: number) {
  propose(h, team, slot);
  voteAll(h);
  playAll(h, fail);
}

export function deadline(h: Harness) {
  const due = roundTable.nextDeadline!(h.state)!;
  h.state = roundTable.onDeadline!(h.state, due);
  return h;
}

export function leave(h: Harness, id: string, now = NOW) {
  h.state = roundTable.playerLeft(h.state, id, now);
  return h;
}

/** Records every insight event the harness's actions produce (as the room host would). */
export function recording(h: Harness): { events: InsightEvent[] } {
  const log = { events: [] as InsightEvent[] };
  const act = h.act.bind(h);
  h.act = (action, by, now) => {
    const before = h.state;
    const after = act(action, by, now);
    log.events.push(...insights(before, after, action, by ?? HOST));
    return after;
  };
  return log;
}
