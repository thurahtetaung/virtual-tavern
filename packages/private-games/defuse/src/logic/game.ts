import {
  type ActionCtx,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type PlayerId,
  type PlayerInfo,
  tableVolumeAction,
} from '@vt/game-sdk';
import { z } from 'zod';
import { defuseAwards } from './awards.ts';
import { act, createBomb, nextAt, runTo, solvableCount, solvedCount } from './bomb.ts';
import { defuseBot } from './bot.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  type Action,
  type DefuserMode,
  NEEDY,
  type PageId,
  SOLVABLE,
  type Settings,
  type State,
} from './types.ts';
import { type DefuseView, view } from './view.ts';

export const MIN_PLAYERS = 2;
/** One defuser and up to 11 experts (owner, 2026-10-27); the rest watch. */
export const MAX_SEATED = 12;
export const MAX_NOTE = 500;
/** How far back a timed press may be dated (the client's server-clock estimate). */
export const PAST_MS = 500;

export const DEFAULT_SETTINGS: Settings = {
  time: 300,
  modules: 3,
  hardcore: false,
  needy: false,
  vetoes: [],
  defuserMode: 'rotate',
  expertsSeeClock: false,
  table: 'manual',
};

const err = (code: string, message: string) => new GameError(code, message);
const draft = (s: State): State => structuredClone(s);

// ---- Test rig ----

/** Browser tests only: every bomb uses this seed, so its modules and edgework are known. */
let testSeed: number | null = null;
export function setTestSeed(seed: number | null) {
  testSeed = seed;
}

// ---- Seats ----

const seated = (s: State, id: PlayerId) => s.seats.some((p) => p.id === id);

function fillSeats(s: State) {
  while (s.seats.length < MAX_SEATED && s.watchers.length) s.seats.push(s.watchers.shift()!);
}

/** The next defuser after `after` in seat order (the first seat when they have gone). */
function nextSeat(s: State, after: PlayerId | null): PlayerId | null {
  if (!s.seats.length) return null;
  const at = after === null ? -1 : s.seats.findIndex((p) => p.id === after);
  return s.seats[(at + 1) % s.seats.length]!.id;
}

// ---- Settings ----

const settingsSchema = z
  .object({
    time: z.number().int().min(30).max(600).multipleOf(30),
    modules: z.number().int().min(3).max(11),
    hardcore: z.boolean(),
    needy: z.boolean(),
    vetoes: z.array(z.enum(SOLVABLE)).max(3),
    defuserMode: z.enum(['rotate', 'random', 'volunteer']),
    expertsSeeClock: z.boolean(),
    table: z.enum(['manual', 'bomb']),
  })
  .partial();

const pageSchema = z.enum([...SOLVABLE, ...NEEDY, 'appendix']);
const dirSchema = z.enum(['up', 'right', 'down', 'left']);
const opSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('cut'), wire: z.number().int().min(0).max(5) }),
  z.object({ op: z.literal('down') }),
  z.object({ op: z.literal('up') }),
  z.object({ op: z.literal('tap') }),
  z.object({ op: z.literal('press'), button: z.number().int().min(0).max(5) }),
  z.object({ op: z.literal('dial'), by: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ op: z.literal('tx') }),
  z.object({ op: z.literal('next') }),
  z.object({ op: z.literal('back') }),
  z.object({ op: z.literal('move'), dir: dirSchema }),
  z.object({
    op: z.literal('spin'),
    column: z.number().int().min(0).max(4),
    by: z.union([z.literal(1), z.literal(-1)]),
  }),
  z.object({ op: z.literal('submit') }),
  z.object({ op: z.literal('answer'), yes: z.boolean() }),
  z.object({ op: z.literal('turn') }),
]);

export const actionSchema: z.ZodType<Action> = z.union([
  z.object({ type: z.literal('settings'), settings: settingsSchema }),
  z.object({ type: z.literal('set-defuser'), player: z.string().max(100) }),
  z.object({ type: z.literal('volunteer'), on: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.intersection(
    z.object({
      type: z.literal('act'),
      module: z.string().max(8),
      at: z.number().finite().optional(),
    }),
    opSchema,
  ),
  z.object({ type: z.literal('claim'), page: pageSchema, on: z.boolean() }),
  z.object({ type: z.literal('note'), page: pageSchema, text: z.string().max(MAX_NOTE) }),
  z.object({ type: z.literal('hand-over'), player: z.string().max(100) }),
  z.object({
    type: z.literal('look'),
    mode: z.enum(['3d', '2d']),
    pose: z.enum(['desk', 'held', 'module']),
    yaw: z.number().int().min(-36_000).max(36_000).multipleOf(90),
    settle: z.number().int().min(-90).max(90),
    module: z.string().max(8).nullable(),
  }),
  tableVolumeAction,
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('lobby') }),
  z.object({ type: z.literal('ponder') }),
]);

// ---- Flow ----

function create(ctx: CreateCtx, players: readonly PlayerInfo[]): State {
  let s: State = {
    phase: 'lobby',
    stage: 'lobby',
    settings: { ...DEFAULT_SETTINGS },
    seats: [],
    watchers: [],
    defuser: null,
    volunteers: [],
    bombNo: 0,
    bomb: null,
    claims: {},
    notes: {},
    history: [],
    seed: ctx.rng.int(2 ** 32),
  };
  for (const p of players) s = playerJoined(s, p);
  return s;
}

/** Who defuses the next bomb, by the host's choice of mode; null when it isn't settled yet. */
function chooseDefuser(s: State, ctx: ActionCtx): PlayerId | null {
  const mode: DefuserMode = s.settings.defuserMode;
  if (mode === 'random') return s.seats[ctx.rng.int(s.seats.length)]!.id;
  if (mode === 'volunteer') {
    const vs = s.volunteers.filter((v) => seated(s, v));
    if (vs.length === 1) return vs[0]!;
    return s.defuser && vs.includes(s.defuser) ? s.defuser : null;
  }
  return s.defuser && seated(s, s.defuser) ? s.defuser : ctx.isHost ? ctx.by : nextSeat(s, null);
}

function startBomb(s: State, ctx: ActionCtx): State | GameError {
  if (s.seats.length < MIN_PLAYERS) return err('too-few', 'A bomb needs a defuser and an expert.');
  const defuser = chooseDefuser(s, ctx);
  if (!defuser)
    return err(
      'no-defuser',
      s.volunteers.length ? 'Pick one of the volunteers first.' : 'Nobody has volunteered yet.',
    );
  s.bombNo++;
  const seed = testSeed ?? ctx.rng.int(2 ** 32);
  s.bomb = createBomb(s.bombNo, seed, s.settings, ctx.now);
  s.defuser = defuser;
  s.volunteers = [];
  s.claims = {};
  s.notes = {};
  s.look = null;
  s.stage = 'bomb';
  s.phase = 'playing';
  return s;
}

/** The bomb has gone off or been defused: the results, and the next defuser to propose. */
function finish(s: State) {
  const b = s.bomb;
  if (!b?.end || s.stage !== 'bomb') return;
  s.history.push({
    no: b.no,
    defuser: s.defuser ?? '',
    how: b.end.how,
    left: Math.round(b.end.left),
    strikes: b.strikes + (b.end.how === 'strikes' ? 1 : 0),
    modules: solvableCount(b),
    solved: solvedCount(b),
  });
  if (s.history.length > 50) s.history.splice(0, s.history.length - 50);
  s.stage = 'result';
  s.phase = 'over';
  s.defuser = s.settings.defuserMode === 'rotate' ? nextSeat(s, s.defuser) : null;
  s.volunteers = [];
}

function reduce(state: State, action: Action, ctx: ActionCtx): State | GameError {
  const me = ctx.by;
  const between = state.stage !== 'bomb';
  switch (action.type) {
    case 'settings': {
      if (!ctx.isHost) return err('not-host', 'Only the host changes the settings.');
      if (!between) return err('bomb-live', 'Settings change between bombs.');
      const s = draft(state);
      s.settings = { ...s.settings, ...action.settings };
      if (s.settings.vetoes.length > 3)
        return err('vetoes', 'At most three kinds can be left out.');
      if (
        action.settings.defuserMode &&
        action.settings.defuserMode !== state.settings.defuserMode
      ) {
        s.volunteers = [];
        if (s.settings.defuserMode !== 'rotate') s.defuser = null;
      }
      return s;
    }
    case 'set-defuser': {
      if (!ctx.isHost) return err('not-host', 'Only the host picks the defuser.');
      if (!between) return err('bomb-live', 'The defuser is picked between bombs.');
      if (!seated(state, action.player)) return err('not-seated', 'Pick someone at the table.');
      if (state.settings.defuserMode === 'random')
        return err('random', 'The defuser is drawn at random for each bomb.');
      if (state.settings.defuserMode === 'volunteer' && !state.volunteers.includes(action.player))
        return err('not-volunteer', 'Pick one of the volunteers.');
      const s = draft(state);
      s.defuser = action.player;
      return s;
    }
    case 'volunteer': {
      if (!between) return err('bomb-live', 'Volunteer between bombs.');
      if (state.settings.defuserMode !== 'volunteer')
        return err('not-volunteering', 'The host picks the defuser in this room.');
      if (!seated(state, me)) return err('not-seated', 'Take a seat first.');
      const s = draft(state);
      s.volunteers = s.volunteers.filter((v) => v !== me);
      if (action.on) s.volunteers.push(me);
      // One volunteer defuses; with several the host settles it.
      s.defuser = s.volunteers.length === 1 ? s.volunteers[0]! : null;
      return s;
    }
    case 'start':
    case 'next': {
      if (!ctx.isHost) return err('not-host', 'Only the host starts a bomb.');
      if (!between) return err('bomb-live', 'A bomb is already ticking.');
      return startBomb(draft(state), ctx);
    }
    case 'lobby': {
      if (!ctx.isHost) return err('not-host', 'Only the host can do that.');
      if (state.stage !== 'result') return err('not-now', 'Not now.');
      const s = draft(state);
      s.stage = 'lobby';
      s.phase = 'lobby';
      s.bomb = null;
      return s;
    }
    case 'act': {
      if (state.stage !== 'bomb' || !state.bomb) return err('no-bomb', 'No bomb is ticking.');
      if (me !== state.defuser) return err('not-defuser', 'Only the defuser touches the bomb.');
      const s = draft(state);
      const b = s.bomb!;
      const { type: _t, module, at, ...op } = action;
      // A timed press is judged when the defuser made it: up to half a second back, never ahead,
      // and never before what the bomb has already played.
      const t = Math.max(b.at, Math.min(ctx.now, Math.max(ctx.now - PAST_MS, at ?? ctx.now)));
      runTo(b, t);
      const result = b.end ? 'ignored' : act(b, module, op, t);
      if (result === 'missing') return err('no-module', 'There is no such module.');
      runTo(b, ctx.now);
      finish(s);
      return s;
    }
    case 'look': {
      // Only what a table screen showing the bomb follows; nothing about the bomb changes.
      if (state.stage !== 'bomb' || me !== state.defuser) return err('not-defuser', 'Not now.');
      const { type: _t, ...look } = action;
      const s = draft(state);
      s.look = look;
      return s;
    }
    case 'table-volume': {
      // The host's sliders for the table screen's sound: any time, mid-bomb too.
      if (!ctx.isHost) return err('not-host', 'Only the host sets the table screen’s volume.');
      const s = draft(state);
      s.tableVolumes = { ...s.tableVolumes, ...action.volumes };
      return s;
    }
    case 'claim': {
      if (!seated(state, me)) return err('not-seated', 'Take a seat to claim pages.');
      if (state.stage === 'bomb' && me === state.defuser)
        return err('defuser', 'The defuser never sees the manual.');
      const s = draft(state);
      const page = action.page;
      const list = (s.claims[page] ?? []).filter((p) => p !== me);
      if (action.on) list.push(me);
      if (list.length) s.claims[page] = list;
      else delete s.claims[page];
      return s;
    }
    case 'note': {
      if (!seated(state, me)) return err('not-seated', 'Take a seat to write notes.');
      if (state.stage === 'bomb' && me === state.defuser)
        return err('defuser', 'The defuser never sees the manual.');
      const s = draft(state);
      const text = action.text.slice(0, MAX_NOTE);
      if (text.trim()) s.notes[action.page] = text;
      else delete s.notes[action.page];
      return s;
    }
    case 'ponder':
      return err('ponder', 'Still thinking.');
    case 'hand-over': {
      if (!ctx.isHost) return err('not-host', 'Only the host hands the bomb over.');
      if (state.stage !== 'bomb') return err('no-bomb', 'No bomb is ticking.');
      if (!seated(state, action.player) || action.player === state.defuser)
        return err('not-seated', 'Pick an expert at the table.');
      const s = draft(state);
      runTo(s.bomb!, ctx.now);
      s.defuser = action.player;
      s.look = null;
      for (const k of Object.keys(s.claims) as PageId[]) {
        const list = s.claims[k]!.filter((p) => p !== action.player);
        if (list.length) s.claims[k] = list;
        else delete s.claims[k];
      }
      finish(s);
      return s;
    }
  }
}

function playerJoined(state: State, player: PlayerInfo): State {
  const s = draft(state);
  const known = [...s.seats, ...s.watchers].find((p) => p.id === player.id);
  if (known) {
    known.name = player.name;
    return s;
  }
  const p = { id: player.id, name: player.name };
  if (s.seats.length < MAX_SEATED) s.seats.push(p);
  else s.watchers.push(p);
  return s;
}

function playerLeft(state: State, id: PlayerId): State {
  if (![...state.seats, ...state.watchers].some((p) => p.id === id)) return state;
  const s = draft(state);
  const live = s.stage === 'bomb';
  s.seats = s.seats.filter((p) => p.id !== id);
  s.watchers = s.watchers.filter((p) => p.id !== id);
  s.volunteers = s.volunteers.filter((v) => v !== id);
  for (const k of Object.keys(s.claims) as PageId[]) {
    const list = s.claims[k]!.filter((p) => p !== id);
    if (list.length) s.claims[k] = list;
    else delete s.claims[k];
  }
  // A defuser who leaves mid-bomb keeps it: the clock runs on until the host hands it over.
  if (!live && s.defuser === id)
    s.defuser = s.settings.defuserMode === 'rotate' ? nextSeat(s, null) : null;
  fillSeats(s);
  return s;
}

function nextDeadline(state: State): number | null {
  if (state.stage !== 'bomb' || !state.bomb) return null;
  return nextAt(state.bomb);
}

function onDeadline(state: State, now: number): State {
  if (state.stage !== 'bomb' || !state.bomb) return state;
  const s = draft(state);
  runTo(s.bomb!, now);
  finish(s);
  return s;
}

export const defuse: GameDefinition<State, Action, DefuseView> = {
  id: 'defuse',
  name: 'Defuse',
  description: 'One of you holds a ticking bomb, everyone else holds the manual. Talk fast.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: 30,
  maxSeated: MAX_SEATED,
  access: 'private',
  guide,
  actionSchema,
  create,
  reduce,
  playerJoined,
  playerLeft,
  // Browser tests (the seed rig is on): the defuser's 3D view offers its test hooks.
  view: (s, viewer) => (testSeed === null ? view(s, viewer) : { ...view(s, viewer), test: true }),
  nextDeadline,
  onDeadline,
  insights,
  awards: defuseAwards,
  bot: defuseBot,
  botInfo: {
    note: 'A bot defuser solves what it sees; bot experts only claim pages.',
    retry: (code) => code === 'ponder' || code === 'ignored',
  },
};
