import { type ActionCtx, GameError, createRng } from '@vt/game-sdk';
import { defuse } from './game.ts';
import type { Action, Settings, State } from './types.ts';

export const ANA = 'ana';
export const BEN = 'ben';
export const CHO = 'cho';

export interface Table {
  state: State;
  now: number;
  seed: number;
}

export function table(players = [ANA, BEN], seed = 1, settings: Partial<Settings> = {}): Table {
  const rng = createRng(seed);
  let state = defuse.create({ now: 0, rng, content: { wordLists: () => [], words: () => [] } }, players.map((id) => ({ id, name: id.toUpperCase() })));
  const t: Table = { state, now: 1000, seed };
  if (Object.keys(settings).length) {
    state = must(t, ANA, { type: 'settings', settings });
  }
  return t;
}

export function ctx(t: Table, by: string, isHost = by === ANA): ActionCtx {
  return {
    now: t.now,
    rng: createRng((t.seed * 7919 + Math.floor(t.now)) >>> 0),
    content: { wordLists: () => [], words: () => [] },
    by,
    isHost,
  };
}

export function send(t: Table, by: string, action: Action): State | GameError {
  const parsed = defuse.actionSchema.safeParse(action);
  if (!parsed.success) throw new Error(`bad action ${JSON.stringify(action)} on ${JSON.stringify(t.state.bomb?.modules.find((m) => m.id === (action as { module?: string }).module))}`);
  const r = defuse.reduce(t.state, parsed.data, ctx(t, by));
  if (!(r instanceof GameError)) t.state = r;
  return r;
}

export function must(t: Table, by: string, action: Action): State {
  const r = send(t, by, action);
  if (r instanceof GameError) throw new Error(`${r.code}: ${r.message}`);
  return r;
}

/** Moves the clock on, running every deadline that falls due on the way. */
export function wait(t: Table, ms: number) {
  const until = t.now + ms;
  for (let guard = 0; guard < 100_000; guard++) {
    const due = defuse.nextDeadline!(t.state);
    if (due === null || due > until) break;
    if (due <= t.now - 1) throw new Error(`deadline in the past: ${due} < ${t.now}`);
    t.now = Math.max(t.now, due);
    t.state = defuse.onDeadline!(t.state, t.now);
  }
  t.now = until;
}

export const bomb = (t: Table) => t.state.bomb!;
export const mod = <K extends State['bomb'] extends null ? never : NonNullable<State['bomb']>['modules'][number]['kind']>(t: Table, kind: K) =>
  bomb(t).modules.find((m) => m.kind === kind) as Extract<NonNullable<State['bomb']>['modules'][number], { kind: K }>;
