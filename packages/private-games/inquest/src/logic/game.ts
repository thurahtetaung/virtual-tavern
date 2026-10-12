import {
  type ActionCtx,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type PlayerId,
  type PlayerInfo,
  type Rng,
  createRng,
  timedOut,
} from '@vt/game-sdk';
import { inquestAwards } from './awards.ts';
import {
  CAUSE_TILE,
  CLUE_CARDS,
  EVENT_KINDS,
  EVENT_TILES,
  type EventKind,
  LOCATION_TILES,
  MEANS_CARDS,
  SCENE_SLOTS,
  SCENE_TILES,
  eventOfTile,
  isSceneTile,
} from './content.ts';
import { guide } from './guide.ts';
import { rolesFor, startProblem } from './setup.ts';
import { insights } from './insights.ts';
import { eventName } from './names.ts';
import {
  DEFAULT_HAND,
  DEFAULT_PRESENT_SECONDS,
  EVENT_TURN_SECONDS,
  type EndHow,
  type Game,
  type GameView,
  type InquestAction,
  type InquestState,
  type InquestView,
  MAX_NOTICES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type MyRole,
  NIGHT_SECONDS,
  type Player,
  REVERSAL_SECONDS,
  ROUNDS,
  type RoleId,
  type Seat,
  type SeatView,
  type Side,
  type Slot,
  USEFUL_CLUE_OPTIONS,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = InquestState | GameError;

const err = (code: string, message: string) => new GameError(code, message);

/**
 * End-to-end tests only: the events that go on top of the pile (in this order, and no others)
 * when the events are shuffled in, so a browser test can reach them. The server sets it from `INQUEST_TEST_EVENTS`
 * outside production; it is empty everywhere else.
 */
let testEventOrder: readonly EventKind[] = [];
export function setTestEventOrder(kinds: readonly EventKind[]) {
  testEventOrder = kinds.filter((k) => EVENT_KINDS.includes(k));
}

// ---- Small helpers ----

export const seated = (state: InquestState): PlayerId[] =>
  Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));

const newSeed = (rng: Rng) => rng.int(2 ** 32);

/** Randomness for deadlines and leavers, mixed with the hidden seed so the clock can't replay it. */
const hiddenRng = (state: InquestState, now: number) => createRng((state.seed ^ now) >>> 0);

const playerOf = (g: Game, id: PlayerId | null | undefined) =>
  g.players.find((p) => p.id === id) ?? null;

const roleHolder = (g: Game, role: RoleId) => g.players.find((p) => p.role === role) ?? null;

/** Who may still try to solve: everyone dealt in but the Forensic Scientists, still at the table. */
export const solvers = (g: Game) =>
  g.players.filter((p) => p.id !== g.fs && !g.formerFs.includes(p.id) && !p.gone);

/** The players who give presentations this round, starting left of the Forensic Scientist. */
function speakingOrder(g: Game): PlayerId[] {
  const i = g.players.findIndex((p) => p.id === g.fs);
  const ring = [...g.players.slice(i + 1), ...g.players.slice(0, Math.max(i, 0))];
  return ring.filter((p) => solvers(g).includes(p)).map((p) => p.id);
}

/** Going the other way round from the Forensic Scientist (Ruled Out Evidence). */
function counterOrder(g: Game): PlayerId[] {
  return speakingOrder(g).reverse();
}

const withGame = (state: InquestState, game: Game): InquestState => ({ ...state, game });

function notice(state: InquestState, text: string, now: number): InquestState {
  const g = state.game!;
  const n = state.noticeSeq + 1;
  return {
    ...state,
    noticeSeq: n,
    game: { ...g, notices: [...g.notices, { id: n, text, at: now }].slice(-MAX_NOTICES) },
  };
}

const sideOf = (role: RoleId): Side =>
  role === 'murderer' || role === 'accomplice' ? 'murderer' : 'investigators';

// ---- Lobby ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

function updateSettings(
  state: InquestState,
  action: Extract<InquestAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing')
    return err('in-progress', 'Settings can only change between games.');
  const s = { ...state.settings };
  if (action.fsMode !== undefined) s.fsMode = action.fsMode;
  if (action.fsPick !== undefined) {
    if (action.fsPick !== null && !state.seats[action.fsPick]?.playing)
      return err('not-seated', 'Pick someone who is playing.');
    s.fsPick = action.fsPick;
  }
  if (action.accomplice !== undefined) {
    s.accomplice = action.accomplice;
    // The Witness only plays alongside the Accomplice.
    if (!action.accomplice) s.witness = false;
  }
  if (action.witness !== undefined) {
    if (action.witness && !s.accomplice)
      return err('needs-accomplice', 'The Witness needs the Accomplice in the game.');
    s.witness = action.witness;
  }
  if (action.events !== undefined) s.events = action.events;
  if (action.hand !== undefined) s.hand = action.hand;
  if (action.presentSeconds !== undefined) s.presentSeconds = action.presentSeconds;
  if (action.presentMode !== undefined) s.presentMode = action.presentMode;
  return { ...state, settings: s };
}

function sit(state: InquestState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this room.');
  if (state.phase === 'playing') return err('in-progress', 'You can sit down between games.');
  if (seat.playing === playing) return state;
  if (playing && seated(state).length >= MAX_PLAYERS)
    return err('full', `At most ${MAX_PLAYERS} can play.`);
  const settings =
    !playing && state.settings.fsPick === ctx.by
      ? { ...state.settings, fsPick: null }
      : state.settings;
  return {
    ...state,
    settings,
    seats: { ...state.seats, [ctx.by]: { ...seat, playing, volunteer: playing && seat.volunteer } },
  };
}

function volunteer(state: InquestState, on: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat?.playing) return err('not-seated', 'Take a seat first.');
  if (state.phase === 'playing') return err('in-progress', 'You can volunteer between games.');
  const settings =
    !on && state.settings.fsMode === 'host-volunteers' && state.settings.fsPick === ctx.by
      ? { ...state.settings, fsPick: null }
      : state.settings;
  return { ...state, settings, seats: { ...state.seats, [ctx.by]: { ...seat, volunteer: on } } };
}

function start(state: InquestState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'A game is already running.');
  const seatViews = Object.entries(state.seats).map(([id, s]) => ({ id, ...s }));
  const problem = startProblem(state.settings, seatViews);
  if (problem) return err('cannot-start', problem);
  const ids = seated(state);
  const rng = ctx.rng;
  const volunteers = ids.filter((id) => state.seats[id]!.volunteer);
  const s = state.settings;
  const fs =
    s.fsMode === 'random'
      ? ids[rng.int(ids.length)]!
      : s.fsMode === 'volunteers'
        ? volunteers[rng.int(volunteers.length)]!
        : s.fsPick!;
  const others = rng.shuffle(ids.filter((id) => id !== fs));
  const roles = rolesFor(ids.length, s).slice(1);
  const roleById = new Map<PlayerId, RoleId>([[fs, 'forensic']]);
  others.forEach((id, i) => roleById.set(id, roles[i]!));
  const clue = rng.shuffle(CLUE_CARDS);
  const means = rng.shuffle(MEANS_CARDS);
  const players: Player[] = ids.map((id) => {
    const role = roleById.get(id)!;
    const dealt = role !== 'forensic';
    return {
      id,
      name: state.seats[id]!.name,
      role,
      clue: dealt ? clue.splice(0, s.hand) : [],
      means: dealt ? means.splice(0, s.hand) : [],
      ruledOut: [],
      badges: dealt ? 1 : 0,
      gone: false,
    };
  });
  const game: Game = {
    players,
    fs,
    formerFs: [],
    stage: 'night',
    round: 1,
    finalRound: ROUNDS,
    countdown: false,
    deadline: ctx.now + NIGHT_SECONDS * 1000,
    solution: null,
    autoCrime: false,
    slots: [],
    removed: [],
    pile: rng.shuffle(SCENE_TILES),
    events: [],
    eventsIn: false,
    bullets: [],
    lastMark: ctx.now,
    step: null,
    roundTileDone: false,
    event: null,
    present: null,
    attempts: [],
    reversal: null,
    result: null,
    notices: [],
    twist: null,
    startedAt: ctx.now,
  };
  return {
    ...state,
    phase: 'playing',
    seed: newSeed(rng),
    gamesPlayed: state.gamesPlayed + 1,
    game,
  };
}

function backToLobby(state: InquestState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  return { ...state, phase: 'lobby', game: null };
}

// ---- Night ----

function commitCrime(state: InquestState, clue: number, means: number, ctx: Ctx): Result {
  const g = state.game;
  if (!g || g.stage !== 'night') return err('wrong-stage', 'The crime has already been chosen.');
  const me = playerOf(g, ctx.by);
  if (me?.role !== 'murderer') return err('not-murderer', 'Only the Murderer chooses the crime.');
  if (!me.clue.includes(clue) || !me.means.includes(means))
    return err('not-yours', 'Pick one of your own Clue cards and one of your own Means cards.');
  return beginCollect(withGame(state, { ...g, solution: { clue, means } }), ctx.now);
}

function beginCollect(state: InquestState, now: number): InquestState {
  const g = state.game!;
  return withGame(state, {
    ...g,
    stage: 'collect',
    deadline: null,
    step: { kind: 'pick-location' },
    lastMark: now,
  });
}

// ---- Collecting evidence ----

function requireFs(g: Game | null, by: PlayerId): GameError | null {
  if (!g) return err('not-playing', 'No game in progress.');
  if (g.fs !== by) return err('not-fs', 'Only the Forensic Scientist can do that.');
  return null;
}

function pickLocation(state: InquestState, tile: number, ctx: Ctx): Result {
  const g = state.game;
  const e = requireFs(g, ctx.by);
  if (e) return e;
  if (g!.stage !== 'collect' || g!.step?.kind !== 'pick-location')
    return err('wrong-stage', 'The Location tile is already chosen.');
  if (!LOCATION_TILES.includes(tile)) return err('bad-tile', 'Pick one of the Location tiles.');
  const pile = [...g!.pile];
  const scenes = pile.splice(0, 4);
  const slots: Slot[] = [CAUSE_TILE, tile, ...scenes].map((t) => ({ tile: t, bullet: null }));
  return withGame(state, {
    ...g!,
    slots,
    pile,
    step: { kind: 'bullets' },
    lastMark: ctx.now,
  });
}

function placeBullet(state: InquestState, slot: number, item: number, ctx: Ctx): Result {
  const g = state.game;
  const e = requireFs(g, ctx.by);
  if (e) return e;
  if (g!.stage !== 'collect' || g!.step?.kind !== 'bullets')
    return err('wrong-stage', "It isn't time to place a bullet.");
  const target = g!.slots[slot];
  if (!target) return err('bad-slot', 'No such tile.');
  if (target.bullet !== null)
    return err('has-bullet', 'That tile already has its bullet, and bullets never move.');
  const slots = g!.slots.map((s, i) => (i === slot ? { ...s, bullet: item } : s));
  const bullet = {
    seq: g!.bullets.length + 1,
    slot,
    tile: target.tile,
    item,
    round: g!.round,
    at: ctx.now,
    gapMs: Math.max(0, ctx.now - g!.lastMark),
  };
  return advance(
    withGame(state, { ...g!, slots, bullets: [...g!.bullets, bullet], lastMark: ctx.now }),
    ctx.now,
    ctx.rng,
  );
}

/** Takes the tile in `slot` off the table (keeping it under "removed") and puts `tile` there. */
function swapTile(g: Game, slot: number, tile: number): Game {
  const old = g.slots[slot]!;
  return {
    ...g,
    slots: g.slots.map((s, i) => (i === slot ? { tile, bullet: null } : s)),
    removed: [...g.removed, old],
  };
}

/** The next scene tile in the pile (events stay where they are), or null. */
function takeScene(g: Game): { tile: number | null; pile: number[] } {
  const i = g.pile.findIndex(isSceneTile);
  if (i < 0) return { tile: null, pile: g.pile };
  return { tile: g.pile[i]!, pile: g.pile.filter((_, k) => k !== i) };
}

function replaceTile(state: InquestState, slot: number, ctx: Ctx): Result {
  const g = state.game;
  const e = requireFs(g, ctx.by);
  if (e) return e;
  if (!SCENE_SLOTS.includes(slot))
    return err('special-tile', 'The Cause of Death and Location tiles always stay.');
  if (g!.stage === 'collect' && g!.step?.kind === 'replace') {
    const next = { ...swapTile(g!, slot, g!.step.drawn), roundTileDone: true, step: null };
    return advance(withGame(state, next), ctx.now, ctx.rng);
  }
  const ev = g!.event;
  if (ev?.kind === 'countdown' && ev.drawn.length) {
    if (g!.slots[slot]!.bullet === null)
      return err('just-placed', 'Replace a different tile: that one has just come in.');
    const [tile, ...rest] = ev.drawn;
    const next = swapTile(g!, slot, tile!);
    const done = rest.length === 0;
    return advance(
      withGame(state, {
        ...next,
        event: done ? null : { ...ev, drawn: rest },
        step: done ? null : next.step,
      }),
      ctx.now,
      ctx.rng,
    );
  }
  return err('wrong-stage', 'There is no tile to put down.');
}

/**
 * Moves the collection on: waits for missing bullets or an open event; otherwise draws this
 * round's tile (rounds 2 and 3, resolving any events it turns up), then starts the presentations.
 */
function advance(state: InquestState, now: number, rng: Rng): InquestState {
  let s = state;
  for (let guard = 0; guard < 40; guard++) {
    const g = s.game!;
    if (g.stage !== 'collect' || g.event) return s;
    if (g.step?.kind === 'pick-location' || g.step?.kind === 'replace') return s;
    if (g.slots.some((slot) => slot.bullet === null))
      return withGame(s, { ...g, step: { kind: 'bullets' } });
    if (g.round === 1 || g.roundTileDone) return startPresent(s, now);
    let pile = g.pile;
    let eventsIn = g.eventsIn;
    if (!eventsIn) {
      eventsIn = true;
      if (s.settings.events) {
        const witness = !!roleHolder(g, 'witness');
        const kinds = EVENT_KINDS.filter((k) => k !== 'testimony' || witness);
        const top = testEventOrder.filter((k) => kinds.includes(k));
        // With a test order set, only the events it names come up.
        const rest = testEventOrder.length
          ? []
          : kinds.filter((k) => !top.includes(k)).map((k) => EVENT_TILES[k]);
        pile = [...top.map((k) => EVENT_TILES[k]), ...rng.shuffle([...pile, ...rest])];
      }
    }
    const [tile, ...rest] = pile;
    if (tile === undefined) {
      s = withGame(s, { ...g, pile: rest, eventsIn, roundTileDone: true });
      s = notice(s, 'The pile has run out of tiles, so no new tile this round.', now);
      continue;
    }
    const kind = eventOfTile(tile);
    const drawn: Game = { ...g, pile: rest, eventsIn };
    if (!kind) return withGame(s, { ...drawn, step: { kind: 'replace', drawn: tile } });
    s = startEvent(withGame(s, { ...drawn, events: [...g.events, kind] }), kind, now);
  }
  return s;
}

// ---- Events ----

function startEvent(state: InquestState, kind: EventKind, now: number): InquestState {
  const g = state.game!;
  const tile = EVENT_TILES[kind];
  const s = notice(state, `Event: ${eventName(kind)}.`, now);
  const base = s.game!;
  const step = { kind: 'event' as const };
  switch (kind) {
    case 'useful-clue': {
      const options: number[] = [];
      let pile = base.pile;
      while (options.length < USEFUL_CLUE_OPTIONS) {
        const next = takeScene({ ...base, pile });
        if (next.tile === null) break;
        options.push(next.tile);
        pile = next.pile;
      }
      if (!options.length) return notice(s, 'No scene tiles were left to choose from.', now);
      return withGame(s, { ...base, pile, step, event: { kind, tile, options } });
    }
    case 'good-twist': {
      const winner = solvers(g).find((p) => p.id === state.lastSolver);
      if (!winner)
        return notice(s, 'Nobody solved the last case here, so another tile is drawn.', now);
      const players = base.players.map((p) =>
        p.id === winner.id ? { ...p, badges: p.badges + 1 } : p,
      );
      return notice(
        withGame(s, { ...base, players, twist: winner.id }),
        `${winner.name} solved the last case, so they get an extra attempt.`,
        now,
      );
    }
    case 'ruled-out': {
      const order = counterOrder(g).filter((id) => {
        const p = playerOf(g, id)!;
        return p.clue.some((c) => !p.ruledOut.includes(c));
      });
      if (!order.length) return s;
      return withGame(s, {
        ...base,
        step,
        event: { kind, tile, order, index: 0, deadline: now + EVENT_TURN_SECONDS * 1000 },
      });
    }
    case 'erroneous':
      if (!SCENE_SLOTS.some((i) => base.slots[i]?.bullet !== null)) return s;
      return withGame(s, { ...base, step, event: { kind, tile } });
    case 'countdown': {
      const drawn: number[] = [];
      let pile = base.pile;
      while (drawn.length < 2) {
        const next = takeScene({ ...base, pile });
        if (next.tile === null) break;
        drawn.push(next.tile);
        pile = next.pile;
      }
      const marked = { ...base, pile, countdown: true, finalRound: base.round };
      if (!drawn.length) return withGame(s, marked);
      return withGame(s, { ...marked, step, event: { kind, tile, drawn } });
    }
    case 'testimony':
      if (!roleHolder(g, 'witness')) return s;
      return withGame(s, {
        ...base,
        step,
        event: { kind, tile, deadline: now + EVENT_TURN_SECONDS * 1000 },
      });
  }
}

function endEvent(state: InquestState, game: Game, now: number, rng: Rng): InquestState {
  return advance(withGame(state, { ...game, event: null, step: null }), now, rng);
}

function usefulPick(state: InquestState, tile: number, slot: number, ctx: Ctx): Result {
  const g = state.game;
  const e = requireFs(g, ctx.by);
  if (e) return e;
  const ev = g!.event;
  if (ev?.kind !== 'useful-clue') return err('wrong-stage', 'There is nothing to choose from.');
  if (!ev.options.includes(tile)) return err('bad-tile', 'Pick one of the drawn tiles.');
  if (!SCENE_SLOTS.includes(slot))
    return err('special-tile', 'The Cause of Death and Location tiles always stay.');
  return endEvent(state, swapTile(g!, slot, tile), ctx.now, ctx.rng);
}

function ruleOutCard(
  state: InquestState,
  by: PlayerId,
  clue: number,
  now: number,
  rng: Rng,
): Result {
  const g = state.game!;
  const ev = g.event;
  if (ev?.kind !== 'ruled-out') return err('wrong-stage', 'Nobody is flipping cards now.');
  if (ev.order[ev.index] !== by) return err('not-your-turn', "It isn't your turn to flip a card.");
  const me = playerOf(g, by)!;
  if (!me.clue.includes(clue) || me.ruledOut.includes(clue))
    return err('bad-card', 'Flip one of your own Clue cards that is still face up.');
  // Neutral on purpose: only the Murderer ever sees this, and it must not sound special.
  if (me.role === 'murderer' && g.solution?.clue === clue)
    return err('pick-another', 'Pick a different card.');
  const players = g.players.map((p) =>
    p.id === by ? { ...p, ruledOut: [...p.ruledOut, clue] } : p,
  );
  const next = nextFlipper({ ...g, players }, ev.index + 1);
  if (next === null) return endEvent(state, { ...g, players }, now, rng);
  return withGame(state, {
    ...g,
    players,
    event: { ...ev, index: next, deadline: now + EVENT_TURN_SECONDS * 1000 },
  });
}

/** The next index in the flipping order of a player still at the table, or null when done. */
function nextFlipper(g: Game, from: number): number | null {
  const ev = g.event;
  if (ev?.kind !== 'ruled-out') return null;
  for (let i = from; i < ev.order.length; i++) {
    const p = playerOf(g, ev.order[i]);
    if (p && !p.gone && p.id !== g.fs) return i;
  }
  return null;
}

/** A Clue card the player may flip (never the Murderer's Key Evidence). */
function flippable(g: Game, p: Player): number[] {
  return p.clue.filter(
    (c) => !p.ruledOut.includes(c) && !(p.role === 'murderer' && g.solution?.clue === c),
  );
}

function moveBullet(state: InquestState, slot: number, item: number, ctx: Ctx): Result {
  const g = state.game;
  const e = requireFs(g, ctx.by);
  if (e) return e;
  if (g!.event?.kind !== 'erroneous') return err('wrong-stage', 'Bullets never move.');
  if (!SCENE_SLOTS.includes(slot)) return err('special-tile', 'Move a bullet on a scene tile.');
  const target = g!.slots[slot]!;
  if (target.bullet === null) return err('no-bullet', 'That tile has no bullet yet.');
  if (target.bullet === item) return err('same-item', 'Move it to a different item.');
  const slots = g!.slots.map((s, i) => (i === slot ? { ...s, bullet: item } : s));
  const bullet = {
    seq: g!.bullets.length + 1,
    slot,
    tile: target.tile,
    item,
    round: g!.round,
    at: ctx.now,
    gapMs: Math.max(0, ctx.now - g!.lastMark),
    movedFrom: target.bullet,
  };
  return endEvent(
    state,
    { ...g!, slots, bullets: [...g!.bullets, bullet], lastMark: ctx.now },
    ctx.now,
    ctx.rng,
  );
}

function testify(state: InquestState, by: PlayerId, slot: number, now: number, rng: Rng): Result {
  const g = state.game!;
  if (g.event?.kind !== 'testimony') return err('wrong-stage', 'Nobody is testifying now.');
  if (playerOf(g, by)?.role !== 'witness')
    return err('not-witness', 'Only the Witness can do that.');
  if (!SCENE_SLOTS.includes(slot))
    return err('special-tile', 'Pick a scene tile (not the Cause of Death or Location).');
  const next = takeScene(g);
  if (next.tile === null)
    return endEvent(
      notice(state, 'A tile was pointed out, but no tile was left to replace it.', now),
      g,
      now,
      rng,
    );
  const swapped = swapTile({ ...g, pile: next.pile }, slot, next.tile);
  return endEvent(
    notice(state, 'The Witness pointed out a tile, and a new one replaces it.', now),
    swapped,
    now,
    rng,
  );
}

// ---- Presentations ----

function startPresent(state: InquestState, now: number): InquestState {
  const g = state.game!;
  const order = speakingOrder(g);
  if (!order.length) return endOfRound(state, now);
  return withGame(state, {
    ...g,
    stage: 'present',
    step: null,
    present: { order, index: 0, deadline: now + state.settings.presentSeconds * 1000 },
  });
}

/** The next speaker still at the table, or the end of the round. */
function nextSpeaker(state: InquestState, now: number): InquestState {
  const g = state.game!;
  const p = g.present!;
  const live = solvers(g).map((x) => x.id);
  for (let i = p.index + 1; i < p.order.length; i++) {
    if (live.includes(p.order[i]!))
      return withGame(state, {
        ...g,
        present: { ...p, index: i, deadline: now + state.settings.presentSeconds * 1000 },
      });
  }
  return endOfRound(state, now);
}

function endOfRound(state: InquestState, now: number): InquestState {
  const g = state.game!;
  if (g.round >= g.finalRound) return finish(state, 'murderer', 'time', now);
  return withGame(state, {
    ...g,
    stage: 'collect',
    round: g.round + 1,
    present: null,
    step: null,
    roundTileDone: false,
    lastMark: now,
  });
}

function donePresenting(state: InquestState, ctx: Ctx, skip: boolean): Result {
  const g = state.game;
  if (!g || g.stage !== 'present' || !g.present)
    return err('wrong-stage', 'Nobody is presenting now.');
  const speaker = g.present.order[g.present.index];
  if (skip) {
    if (!ctx.isHost && ctx.by !== g.fs)
      return err('not-host', 'Only the host or the Forensic Scientist can skip a speaker.');
  } else if (speaker !== ctx.by) return err('not-speaker', "It isn't your turn to present.");
  return advance(nextSpeaker(state, ctx.now), ctx.now, ctx.rng);
}

// ---- Solving ----

function solve(
  state: InquestState,
  action: Extract<InquestAction, { type: 'solve' }>,
  ctx: Ctx,
): Result {
  const g = state.game;
  if (!g || state.phase !== 'playing') return err('not-playing', 'No game in progress.');
  const open = (g.stage === 'collect' && g.bullets.length > 0) || g.stage === 'present';
  if (!open)
    return err(
      'not-now',
      g.stage === 'collect'
        ? 'You can solve once the first bullet is down.'
        : "You can't solve right now.",
    );
  const me = playerOf(g, ctx.by);
  if (!me || !solvers(g).includes(me))
    return err('cannot-solve', 'Only players at the table (not the Forensic Scientist) can solve.');
  if (me.badges <= 0) return err('no-badge', 'You have already used your attempt.');
  const target = playerOf(g, action.target);
  if (!target || target.id === g.fs || !target.clue.length)
    return err('bad-target', "Pick a suspect's cards.");
  if (!target.clue.includes(action.clue) || !target.means.includes(action.means))
    return err('bad-cards', "Pick one Clue card and one Means card from the same suspect's cards.");
  if (target.ruledOut.includes(action.clue))
    return err('ruled-out', 'That Clue card has been ruled out.');
  const murderer = roleHolder(g, 'murderer')!;
  const correct =
    target.id === murderer.id &&
    g.solution?.clue === action.clue &&
    g.solution.means === action.means;
  const attempt = {
    by: ctx.by,
    target: target.id,
    clue: action.clue,
    means: action.means,
    correct,
    round: g.round,
    at: ctx.now,
  };
  const players = correct
    ? g.players
    : g.players.map((p) => (p.id === ctx.by ? { ...p, badges: p.badges - 1 } : p));
  const next: Game = { ...g, players, attempts: [...g.attempts, attempt] };
  if (correct) {
    const solved = { ...state, lastSolver: ctx.by };
    if (roleHolder(g, 'witness'))
      return withGame(solved, {
        ...next,
        stage: 'reversal',
        step: null,
        present: null,
        event: null,
        deadline: ctx.now + REVERSAL_SECONDS * 1000,
        reversal: {
          deadline: ctx.now + REVERSAL_SECONDS * 1000,
          murdererTap: null,
          accompliceTap: null,
          solvedBy: ctx.by,
        },
      });
    return finish(withGame(solved, next), 'investigators', 'solved', ctx.now, ctx.by);
  }
  return checkBadges(withGame(state, next), ctx.now);
}

/** Every solver has used their attempt: the Murderer's side wins at once. */
function checkBadges(state: InquestState, now: number): InquestState {
  const g = state.game!;
  if (state.phase !== 'playing' || g.stage === 'reversal' || g.stage === 'done') return state;
  if (g.stage === 'night') return state;
  if (solvers(g).some((p) => p.badges > 0)) return state;
  return finish(state, 'murderer', 'badges', now);
}

// ---- The Reversal ----

const reversalCandidates = (g: Game) =>
  g.players.filter(
    (p) =>
      p.id !== g.fs &&
      !g.formerFs.includes(p.id) &&
      p.role !== 'murderer' &&
      p.role !== 'accomplice',
  );

function reversalTap(state: InquestState, target: PlayerId, ctx: Ctx): Result {
  const g = state.game;
  if (!g || g.stage !== 'reversal' || !g.reversal) return err('wrong-stage', 'No Reversal now.');
  const me = playerOf(g, ctx.by);
  if (me?.role !== 'murderer' && me?.role !== 'accomplice')
    return err('not-yours', 'Only the Murderer and the Accomplice choose here.');
  if (!reversalCandidates(g).some((p) => p.id === target))
    return err('bad-target', 'Pick one of the other players.');
  const key = me.role === 'murderer' ? 'murdererTap' : 'accompliceTap';
  return withGame(state, { ...g, reversal: { ...g.reversal, [key]: target } });
}

function reversalConfirm(state: InquestState, ctx: Ctx): Result {
  const g = state.game;
  if (!g || g.stage !== 'reversal' || !g.reversal) return err('wrong-stage', 'No Reversal now.');
  if (playerOf(g, ctx.by)?.role !== 'murderer')
    return err('not-murderer', 'Only the Murderer makes the final choice.');
  if (!g.reversal.murdererTap) return err('no-pick', 'Tap a player first.');
  return resolveReversal(state, g.reversal.murdererTap, ctx.now);
}

function resolveReversal(state: InquestState, pick: PlayerId, now: number): InquestState {
  const g = state.game!;
  const found = playerOf(g, pick)?.role === 'witness';
  return finish(
    state,
    found ? 'murderer' : 'investigators',
    'reversal',
    now,
    g.reversal?.solvedBy ?? null,
    pick,
  );
}

// ---- The end ----

function finish(
  state: InquestState,
  winner: Side,
  how: EndHow,
  now: number,
  solvedBy: PlayerId | null = null,
  reversalPick: PlayerId | null = null,
): InquestState {
  const g = state.game!;
  const winners = g.players.filter((p) => sideOf(p.role) === winner).map((p) => p.id);
  const witnessFound = how === 'reversal' ? playerOf(g, reversalPick)?.role === 'witness' : null;
  return {
    ...state,
    phase: 'over',
    game: {
      ...g,
      stage: 'done',
      deadline: null,
      step: null,
      event: null,
      present: null,
      result: { winner, how, solvedBy, reversalPick, witnessFound, winners },
      lastMark: now,
    },
  };
}

// ---- Handing over ----

function handOver(state: InquestState, rng: Rng, now: number, auto: boolean): Result {
  const g = state.game;
  if (!g || state.phase !== 'playing') return err('not-playing', 'No game in progress.');
  // Only a plain Investigator can take over, so nothing about the hidden roles leaks.
  const candidates = g.players.filter((p) => p.role === 'investigator' && !p.gone && p.id !== g.fs);
  if (!candidates.length)
    return err('no-candidate', 'There is no Investigator left who could take over.');
  const next = candidates[rng.int(candidates.length)]!;
  const old = playerOf(g, g.fs)!;
  let s = withGame(state, { ...g, fs: next.id, formerFs: [...g.formerFs, old.id] });
  // The new Forensic Scientist no longer presents or flips cards: both turn orders skip them.
  const after = s.game!;
  if (after.present && after.present.order[after.present.index] === next.id)
    s = advance(nextSpeaker(s, now), now, rng);
  const ev = s.game!.event;
  if (ev?.kind === 'ruled-out' && ev.order[ev.index] === next.id) {
    const i = nextFlipper(s.game!, ev.index + 1);
    s =
      i === null
        ? endEvent(s, s.game!, now, rng)
        : withGame(s, {
            ...s.game!,
            event: { ...ev, index: i, deadline: now + EVENT_TURN_SECONDS * 1000 },
          });
  }
  s = notice(
    s,
    `${next.name} is now the Forensic Scientist. ${next.name}’s cards stay on the table, but ${next.name} knows the answer, can’t solve or present, and wins with the Investigators.`,
    now,
  );
  s = notice(
    s,
    auto
      ? `${old.name} left, so ${next.name} took over.`
      : `If ${old.name} comes back, they watch as a spectator who knows the answer.`,
    now,
  );
  return checkBadges(s, now);
}

// ---- Reduce ----

function reduce(state: InquestState, action: InquestAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'volunteer':
      return volunteer(state, action.on, ctx);
    case 'start':
      return start(state, ctx);
    case 'play-again':
      if (state.phase !== 'over') return err('in-progress', 'Finish this game first.');
      return start(state, ctx);
    case 'back-to-lobby':
      return backToLobby(state, ctx);
    case 'commit-crime':
      return commitCrime(state, action.clue, action.means, ctx);
    case 'pick-location':
      return pickLocation(state, action.tile, ctx);
    case 'place-bullet':
      return placeBullet(state, action.slot, action.item, ctx);
    case 'replace-tile':
      return replaceTile(state, action.slot, ctx);
    case 'useful-pick':
      return usefulPick(state, action.tile, action.slot, ctx);
    case 'rule-out':
      if (!state.game) return err('not-playing', 'No game in progress.');
      return ruleOutCard(state, ctx.by, action.clue, ctx.now, ctx.rng);
    case 'move-bullet':
      return moveBullet(state, action.slot, action.item, ctx);
    case 'testify':
      if (!state.game) return err('not-playing', 'No game in progress.');
      return testify(state, ctx.by, action.slot, ctx.now, ctx.rng);
    case 'done-presenting':
      return donePresenting(state, ctx, false);
    case 'skip-speaker':
      return donePresenting(state, ctx, true);
    case 'solve':
      return solve(state, action, ctx);
    case 'reversal-tap':
      return reversalTap(state, action.target, ctx);
    case 'reversal-confirm':
      return reversalConfirm(state, ctx);
    case 'hand-over': {
      const e = requireHost(ctx);
      if (e) return e;
      return handOver(state, ctx.rng, ctx.now, false);
    }
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, players: readonly PlayerInfo[]): InquestState {
  let state: InquestState = {
    phase: 'lobby',
    settings: {
      fsMode: 'random',
      fsPick: null,
      accomplice: true,
      witness: true,
      events: true,
      hand: DEFAULT_HAND,
      presentSeconds: DEFAULT_PRESENT_SECONDS,
      presentMode: 'soft',
    },
    seed: newSeed(ctx.rng),
    table: ctx.rng.int(2 ** 31),
    seats: {},
    game: null,
    gamesPlayed: 0,
    lastSolver: null,
    noticeSeq: 0,
  };
  for (const p of players) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: InquestState, player: PlayerInfo): InquestState {
  const existing = state.seats[player.id];
  if (existing) {
    const game = state.game && {
      ...state.game,
      players: state.game.players.map((p) =>
        p.id === player.id ? { ...p, name: player.name, gone: false } : p,
      ),
    };
    return {
      ...state,
      game,
      seats: { ...state.seats, [player.id]: { ...existing, name: player.name } },
    };
  }
  // Someone who left mid-game and comes back finds their cards again.
  const inGame = state.game?.players.find((p) => p.id === player.id);
  const playing = inGame ? true : state.phase !== 'playing' && seated(state).length < MAX_PLAYERS;
  const seat: Seat = { name: player.name, playing, volunteer: false };
  const game = inGame
    ? {
        ...state.game!,
        players: state.game!.players.map((p) =>
          p.id === player.id ? { ...p, name: player.name, gone: false } : p,
        ),
      }
    : state.game;
  return { ...state, game, seats: { ...state.seats, [player.id]: seat } };
}

function playerLeft(state: InquestState, playerId: PlayerId, now: number): InquestState {
  if (!state.seats[playerId]) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  const settings =
    state.settings.fsPick === playerId ? { ...state.settings, fsPick: null } : state.settings;
  let s: InquestState = { ...state, seats, settings };
  const g = s.game;
  if (state.phase !== 'playing' || !g || !playerOf(g, playerId)) return s;
  s = withGame(s, {
    ...g,
    players: g.players.map((p) => (p.id === playerId ? { ...p, gone: true } : p)),
  });
  const rng = hiddenRng(state, now);
  const me = playerOf(s.game!, playerId)!;
  // A departed Murderer at night: the crime is picked for them, and they can still be caught.
  if (s.game!.stage === 'night' && me.role === 'murderer') return autoCrime(s, now, rng);
  if (s.game!.fs === playerId) {
    const r = handOver(s, rng, now, true);
    if (!(r instanceof GameError)) s = r;
  }
  const after = s.game!;
  if (after.stage === 'present' && after.present?.order[after.present.index] === playerId)
    s = advance(nextSpeaker(s, now), now, rng);
  const ev = s.game!.event;
  if (ev?.kind === 'ruled-out' && ev.order[ev.index] === playerId) {
    const i = nextFlipper(s.game!, ev.index + 1);
    s =
      i === null
        ? endEvent(s, s.game!, now, rng)
        : withGame(s, {
            ...s.game!,
            event: { ...ev, index: i, deadline: now + EVENT_TURN_SECONDS * 1000 },
          });
  }
  return checkBadges(s, now);
}

// ---- Timers ----

function autoCrime(state: InquestState, now: number, rng: Rng): InquestState {
  const g = state.game!;
  const m = roleHolder(g, 'murderer')!;
  const clue = m.clue[rng.int(m.clue.length)]!;
  const means = m.means[rng.int(m.means.length)]!;
  return beginCollect(withGame(state, { ...g, solution: { clue, means }, autoCrime: true }), now);
}

function nextDeadline(state: InquestState): number | null {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return null;
  if (g.stage === 'night' || g.stage === 'reversal') return g.deadline;
  if (g.event?.kind === 'ruled-out' || g.event?.kind === 'testimony') return g.event.deadline;
  if (g.stage === 'present' && state.settings.presentMode === 'hard')
    return g.present?.deadline ?? null;
  return null;
}

function onDeadline(state: InquestState, now: number): InquestState {
  const due = nextDeadline(state);
  const g = state.game;
  if (due === null || now < due || !g) return state;
  const rng = hiddenRng(state, now);
  if (g.stage === 'night') return autoCrime(state, now, rng);
  if (g.stage === 'reversal') {
    const r = g.reversal!;
    const options = reversalCandidates(g);
    const pick = r.murdererTap ?? options[rng.int(options.length)]?.id ?? null;
    if (!pick) return finish(state, 'investigators', 'solved', now, r.solvedBy);
    return resolveReversal(
      notice(state, timedOut('the Reversal’s choice was made for the Murderer'), now),
      pick,
      now,
    );
  }
  const ev = g.event;
  if (ev?.kind === 'ruled-out') {
    const p = playerOf(g, ev.order[ev.index])!;
    const options = flippable(g, p);
    const s = notice(state, timedOut(`a Clue card was flipped for ${p.name}`), now);
    if (!options.length) {
      const i = nextFlipper(g, ev.index + 1);
      return i === null
        ? endEvent(s, s.game!, now, rng)
        : withGame(s, {
            ...s.game!,
            event: { ...ev, index: i, deadline: now + EVENT_TURN_SECONDS * 1000 },
          });
    }
    const r = ruleOutCard(s, p.id, options[rng.int(options.length)]!, now, rng);
    return r instanceof GameError ? s : r;
  }
  if (ev?.kind === 'testimony') {
    const slot = SCENE_SLOTS[rng.int(SCENE_SLOTS.length)]!;
    const s = notice(state, timedOut('a tile was picked for the Witness'), now);
    const witness = roleHolder(g, 'witness')!;
    const r = testify(s, witness.id, slot, now, rng);
    return r instanceof GameError ? s : r;
  }
  if (g.stage === 'present' && g.present) {
    const speaker = playerOf(g, g.present.order[g.present.index]);
    const s = notice(state, timedOut(`${speaker?.name ?? 'the speaker'}’s turn passed`), now);
    return advance(nextSpeaker(s, now), now, rng);
  }
  return state;
}

// ---- Views ----

function myRoleOf(g: Game, viewer: PlayerId | null): MyRole {
  if (viewer === null) return null;
  if (g.formerFs.includes(viewer)) return 'former-forensic';
  if (g.fs === viewer) return 'forensic';
  return playerOf(g, viewer)?.role ?? null;
}

function gameView(state: InquestState, g: Game, viewer: PlayerId | null): GameView {
  const over = g.stage === 'done';
  const myRole = myRoleOf(g, viewer);
  const isFs = viewer !== null && g.fs === viewer;
  const murderer = roleHolder(g, 'murderer');
  const accomplice = roleHolder(g, 'accomplice');
  const inTheKnow =
    over ||
    myRole === 'murderer' ||
    myRole === 'accomplice' ||
    myRole === 'forensic' ||
    myRole === 'former-forensic';
  const solution =
    inTheKnow && g.solution && murderer
      ? { murderer: murderer.id, clue: g.solution.clue, means: g.solution.means }
      : null;
  const partner =
    myRole === 'murderer'
      ? (accomplice?.id ?? null)
      : myRole === 'accomplice'
        ? (murderer?.id ?? null)
        : null;
  const witnessPair =
    playerOf(g, viewer)?.role === 'witness' && murderer && accomplice
      ? [murderer.id, accomplice.id].sort()
      : null;
  const ev = g.event;
  const event: GameView['event'] = !ev
    ? null
    : ev.kind === 'useful-clue'
      ? { kind: ev.kind, tile: ev.tile, options: isFs ? [...ev.options] : null }
      : ev.kind === 'ruled-out'
        ? { ...ev, order: [...ev.order], current: ev.order[ev.index] ?? null }
        : ev.kind === 'countdown'
          ? {
              kind: ev.kind,
              tile: ev.tile,
              drawn: isFs ? [...ev.drawn] : null,
              left: ev.drawn.length,
            }
          : { ...ev };
  const step: GameView['step'] = !g.step
    ? null
    : g.step.kind === 'replace'
      ? { kind: 'replace', drawn: isFs ? g.step.drawn : null }
      : { ...g.step };
  const sideKnows = myRole === 'murderer' || myRole === 'accomplice';
  return {
    stage: g.stage,
    round: g.round,
    finalRound: g.finalRound,
    countdown: g.countdown,
    deadline: g.deadline,
    players: g.players.map((p) => ({
      id: p.id,
      name: p.name,
      clue: [...p.clue],
      means: [...p.means],
      ruledOut: [...p.ruledOut],
      badges: p.badges,
      gone: p.gone,
      isFs: p.id === g.fs,
      formerFs: g.formerFs.includes(p.id),
      role: over || p.id === viewer ? p.role : null,
    })),
    fs: g.fs,
    formerFs: [...g.formerFs],
    myRole,
    solution,
    partner,
    witnessPair,
    autoCrime: (myRole === 'murderer' || over) && g.autoCrime,
    slots: g.slots.map((s) => ({ ...s })),
    removed: g.removed.map((s) => ({ ...s })),
    pileCount: g.pile.length,
    bullets: g.bullets.map((b) => ({ ...b })),
    step,
    event,
    events: [...g.events],
    present: g.present ? { ...g.present, order: [...g.present.order] } : null,
    attempts: g.attempts.map((a) => ({ ...a })),
    reversal: g.reversal
      ? {
          deadline: g.reversal.deadline,
          murdererTap: sideKnows || over ? g.reversal.murdererTap : null,
          accompliceTap: sideKnows || over ? g.reversal.accompliceTap : null,
        }
      : null,
    result: g.result ? { ...g.result, winners: [...g.result.winners] } : null,
    notices: g.notices.map((n) => ({ ...n })),
    twist: g.twist,
    roles: over ? Object.fromEntries(g.players.map((p) => [p.id, p.role])) : null,
  };
}

function view(state: InquestState, viewer: PlayerId | null): InquestView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
    volunteer: s.volunteer,
  }));
  return {
    phase: state.phase,
    table: state.table,
    gameNo: state.gamesPlayed,
    settings: { ...state.settings },
    seats,
    me: viewer === null ? null : (seats.find((s) => s.id === viewer) ?? null),
    game: state.game ? gameView(state, state.game, viewer) : null,
    lastSolver: state.lastSolver,
  };
}

export const inquest: GameDefinition<InquestState, InquestAction, InquestView> = {
  id: 'inquest',
  name: 'Inquest',
  description:
    'A murder at the scene: the Forensic Scientist knows who did it and can only point with bullets.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: 30,
  access: 'private',
  guide,
  actionSchema,
  create,
  reduce,
  playerJoined,
  playerLeft,
  view,
  nextDeadline,
  onDeadline,
  insights,
  awards: inquestAwards,
};
