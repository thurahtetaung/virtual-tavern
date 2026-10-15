import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { type Deal, dealGame, nightfall, startNight } from './game.ts';
import { linesInPlay } from './narration.ts';
import type { RoleId } from './roles.ts';
import type {
  NightAction,
  NightfallAction,
  NightfallState,
  NightfallView,
  Settings,
} from './types.ts';

export const NOW = 1_000_000;
const content: ContentProvider = { wordLists: () => [], words: () => [] };

export interface Table {
  /** One role per seat; seats are named A, B, C… (left of A is B). */
  players: RoleId[];
  center?: RoleId[];
  wolf?: RoleId;
  settings?: Partial<Settings>;
  seed?: number;
  /** The narrator's line lengths, as the server reads them from the manifest at the deal. */
  lengths?: Record<string, number>;
}

export const seatName = (i: number) => String.fromCharCode(65 + i);

export interface Harness {
  state: NightfallState;
  now: number;
  ids: string[];
  act(action: NightfallAction, by?: string): NightfallState;
  reject(action: NightfallAction, by?: string): string;
  /** Runs the clock out on the current step (or phase). */
  tick(): void;
  /** Runs the clock until `stepId` is the current step. */
  toStep(stepId: string): void;
  /** The current step's id, or null outside the night. */
  step(): string | null;
  /** A night action in the current step. */
  night(by: string, pick: Omit<NightAction, 'type' | 'step'>): void;
  nightReject(by: string, pick: Omit<NightAction, 'type' | 'step'>): string;
  /** Runs the night out to the day. */
  dawn(): void;
  /** Everyone is ready to vote, then everyone votes (`X: Y`). */
  vote(votes: Record<string, string>): void;
  view(id: string | null): NightfallView;
  role(seat: string): RoleId;
}

/** A dealt table, rigged card by card, with the night about to begin. */
export function table(t: Table): Harness {
  const ids = t.players.map((_, i) => seatName(i));
  const center = t.center ?? ['villager', 'villager', 'villager'];
  const roles = [...t.players, ...center, ...(t.wolf ? [t.wolf] : [])];
  const rng = createRng(t.seed ?? 7);
  let state = nightfall.create(
    { now: NOW, rng, content },
    ids.map((id) => ({ id, name: id })),
  );
  state = {
    ...state,
    seed: t.seed ?? 7,
    settings: { ...state.settings, roles, ...t.settings },
  };
  const deal: Deal = { players: t.players, center, ...(t.wolf ? { wolf: t.wolf } : {}) };
  state = dealGame(state, deal, ids);
  if (t.lengths) state.round!.lengths = linesInPlay(roles, t.lengths);
  state = startNight(state, NOW);
  const run = (s: NightfallState, action: NightfallAction, by: string, now: number) =>
    nightfall.reduce(s, action, { by, isHost: by === 'A', now, rng, content });
  const h: Harness = {
    state,
    now: NOW,
    ids,
    act(action, by = 'A') {
      const r = run(h.state, action, by, h.now);
      if (r instanceof GameError)
        throw new Error(`${action.type} by ${by}: ${r.code}: ${r.message}`);
      h.state = r;
      return r;
    },
    reject(action, by = 'A') {
      const r = run(h.state, action, by, h.now);
      if (!(r instanceof GameError)) throw new Error(`expected ${action.type} by ${by} to fail`);
      return r.code;
    },
    tick() {
      const due = nightfall.nextDeadline!(h.state);
      if (due === null) throw new Error(`no deadline in ${h.state.stage}`);
      h.now = due;
      h.state = nightfall.onDeadline!(h.state, due);
    },
    step() {
      const n = h.state.round?.night;
      return h.state.stage === 'night' && n && n.index >= 0 ? n.plan[n.index]! : null;
    },
    toStep(stepId) {
      const plan = h.state.round!.night!.plan;
      if (!plan.includes(stepId))
        throw new Error(`${stepId} is not in the plan: ${plan.join(', ')}`);
      for (let i = 0; i < 100 && h.step() !== stepId; i++) h.tick();
      if (h.step() !== stepId) throw new Error(`never reached ${stepId}`);
    },
    night(by, pick) {
      h.act({ type: 'night', step: h.state.round!.night!.index, ...pick }, by);
    },
    nightReject(by, pick) {
      return h.reject({ type: 'night', step: h.state.round!.night!.index, ...pick }, by);
    },
    dawn() {
      for (let i = 0; i < 100 && h.state.stage === 'night'; i++) h.tick();
    },
    vote(votes) {
      if (h.state.stage === 'night') h.dawn();
      for (const id of ids) h.act({ type: 'ready-to-vote', ready: true }, id);
      for (const [from, to] of Object.entries(votes)) h.act({ type: 'vote', target: to }, from);
      if (h.state.stage === 'vote') h.tick();
    },
    view: (id) => nightfall.view(h.state, id),
    role: (seat) => h.state.round!.cards[seat]!.role,
  };
  return h;
}

/** Shorthand for votes: "B,C,D→A; A→C" style is spelled out as an object in tests. */
export const votes = (spec: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of spec.split(';')) {
    const [from, to] = part.split('>').map((s) => s.trim()) as [string, string];
    for (const v of from.split(',')) out[v.trim()] = to;
  }
  return out;
};

export const winners = (h: Harness) => [...h.state.round!.result!.winners].sort().join('');
export const dead = (h: Harness) =>
  h.state
    .round!.result!.deaths.map((d) => d.player)
    .sort()
    .join('');
