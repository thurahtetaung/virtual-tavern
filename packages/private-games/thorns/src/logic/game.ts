import {
  type ActionCtx,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type PlayerId,
  type PlayerInfo,
  type Rng,
  createRng,
} from '@vt/game-sdk';
import { thornsAwards } from './awards.ts';
import { thornsBot } from './bot.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  type Auto,
  type Disc,
  type Game,
  type GameView,
  type LogEntry,
  MAX_LOG,
  MAX_PLAYERS,
  MIN_PLAYERS,
  POINTS_TO_WIN,
  type PlayerState,
  RESULT_MS,
  type Round,
  STARTER_MS,
  type Seat,
  type SeatView,
  START_DISCS,
  type ThornsAction,
  type ThornsState,
  type ThornsView,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = ThornsState | GameError;

const err = (code: string, message: string) => new GameError(code, message);
const draft = (s: ThornsState): ThornsState => structuredClone(s);
const hiddenRng = (state: ThornsState, now: number) => createRng((state.seed ^ now) >>> 0);
const newSeed = (rng: Rng) => rng.int(2 ** 32);

// ---- Reading the table ----

export function players(state: ThornsState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

/** Players still in the game, in seat order. */
export const alive = (g: Game) => g.order.filter((id) => !g.players[id]!.out);

/** Discs on all the mats: the most anyone may bid. */
export const total = (g: Game) => alive(g).reduce((n, id) => n + g.players[id]!.stack.length, 0);

/** The standing bid, if any. */
export const highBid = (round: Round) => round.bids.at(-1) ?? null;

/** The first player after `from` in seat order (wrapping, `from` itself last) who passes `ok`. */
function nextAfter(g: Game, from: PlayerId, ok: (id: PlayerId) => boolean): PlayerId | null {
  const at = g.order.indexOf(from);
  for (let i = 1; i <= g.order.length; i++) {
    const id = g.order[(at + i) % g.order.length]!;
    if (!g.players[id]!.out && ok(id)) return id;
  }
  return null;
}

/** Discs of `owner`'s stack turned over this round. */
export const flippedOf = (round: Round, owner: PlayerId) =>
  round.flips.filter((f) => f.owner === owner).length;

/** How many of their own discs the challenger must turn over before anyone else's. */
export const ownToFlip = (g: Game) => {
  const r = g.round;
  const by = r.challenger;
  return by ? Math.min(highBid(r)?.amount ?? 0, g.players[by]!.stack.length) : 0;
};

/** In the game and in the room (not away). */
const here = (g: Game) => (id: PlayerId) => !g.away.includes(id);

/** `from` if they are in and here, else the next player who is. */
const firstHere = (g: Game, from: PlayerId) =>
  !g.players[from]!.out && here(g)(from) ? from : (nextAfter(g, from, here(g)) ?? from);

/** Who the table is waiting on right now. */
export function awaited(g: Game): PlayerId[] {
  const r = g.round;
  switch (r.stage) {
    case 'place':
      return alive(g).filter((id) => g.players[id]!.stack.length === 0 && here(g)(id));
    case 'turns':
    case 'bid':
      return r.current ? [r.current] : [];
    case 'flip':
    case 'lose':
    case 'starter':
      return r.challenger ? [r.challenger] : [];
    case 'result':
      return [];
  }
}

/** Stacks the challenger may turn over next. */
export function flipTargets(g: Game): PlayerId[] {
  const r = g.round;
  const by = r.challenger;
  if (r.stage !== 'flip' || !by) return [];
  if (flippedOf(r, by) < ownToFlip(g)) return [by];
  return alive(g).filter((id) => id !== by && flippedOf(r, id) < g.players[id]!.stack.length);
}

// ---- Log ----

type NewLog = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, 'id' | 'round'>
    : never
  : never;

function log(s: ThornsState, entry: NewLog) {
  s.seq += 1;
  s.log.push({ ...entry, id: s.seq, round: s.game?.round.number ?? 0 });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

const autoOf = (auto?: Auto) => (auto ? { auto } : {});

// ---- Round flow ----

function beginRound(s: ThornsState, starter: PlayerId) {
  const g = s.game!;
  if (g.players[starter]?.out !== false) starter = nextAfter(g, starter, () => true) ?? starter;
  const number = g.round.number + 1;
  // A Last Chance disc lent for the round just played goes back to the supply.
  if (g.chance && (g.chance.round < number || g.players[g.chance.holder]?.out !== false))
    g.chance = null;
  for (const id of g.order) {
    const p = g.players[id]!;
    p.hand = p.out ? [] : [...p.discs];
    if (g.chance?.holder === id) p.hand.push('chance');
    p.stack = [];
  }
  g.round = {
    number,
    starter,
    stage: 'place',
    current: null,
    bids: [],
    passed: [],
    challenger: null,
    flips: [],
    result: null,
    shown: [],
    moves: 0,
  };
  log(s, { kind: 'round', starter });
}

function endGame(s: ThornsState, winners: PlayerId[], how: 'points' | 'last') {
  const g = s.game!;
  s.phase = 'over';
  g.winners = winners;
  g.how = how;
  g.clock = null;
  log(s, { kind: 'end', winners, how });
}

/** The decision clock restarts whenever the table waits on something new. */
function settle(s: ThornsState, now: number) {
  const g = s.game;
  if (!g) return;
  if (s.phase !== 'playing') {
    g.clock = null;
    return;
  }
  const r = g.round;
  const key = r.stage === 'place' ? `${r.number}:place` : `${r.number}:${r.stage}:${r.moves}`;
  if (g.clock?.key !== key) g.clock = { key, since: now, reminded: false };
}

function removeDisc(p: PlayerState, disc: Disc) {
  const at = p.discs.indexOf(disc);
  if (at >= 0) p.discs.splice(at, 1);
  p.lost.push(disc);
}

function place(s: ThornsState, by: PlayerId, disc: Disc, auto?: Auto): GameError | null {
  const g = s.game!;
  const r = g.round;
  const p = g.players[by];
  if (!p || p.out) return err('not-playing', 'You are not in this game.');
  if (r.stage === 'place') {
    if (p.stack.length > 0) return err('placed', 'Your first disc is down: wait for the others.');
  } else if (r.stage === 'turns') {
    if (r.current !== by) return err('not-your-turn', 'It’s not your turn.');
  } else return err('wrong-stage', 'You can’t add a disc now: the bidding has started.');
  const at = p.hand.indexOf(disc);
  if (at < 0) return err('not-in-hand', 'You have no such disc in hand.');
  p.hand.splice(at, 1);
  p.stack.push(disc);
  r.moves += 1;
  log(s, { kind: 'placed', by, ...autoOf(auto) });
  if (r.stage === 'place') placedAll(g);
  else r.current = nextAfter(g, by, here(g)) ?? r.current;
  return null;
}

/** Once everyone here has a first disc down, turns start from the first player (or the next one here). */
function placedAll(g: Game) {
  const r = g.round;
  if (r.stage !== 'place' || awaited(g).length > 0) return;
  r.stage = 'turns';
  r.current = firstHere(g, r.starter);
}

function startChallenge(s: ThornsState, by: PlayerId, amount: number) {
  const r = s.game!.round;
  r.stage = 'flip';
  r.current = by;
  r.challenger = by;
  log(s, { kind: 'challenge', by, amount });
}

/** After a bid or a pass: the next bidder, or the challenge once everyone else has passed. */
function nextBidder(s: ThornsState, from: PlayerId) {
  const g = s.game!;
  const r = g.round;
  const high = highBid(r)!;
  for (;;) {
    const next = nextAfter(g, from, (id) => id !== high.by && !r.passed.includes(id));
    if (!next) {
      startChallenge(s, high.by, high.amount);
      return;
    }
    if (here(g)(next)) {
      r.current = next;
      return;
    }
    // Away: skipped, which counts as a pass for this round.
    r.passed.push(next);
    log(s, { kind: 'pass', by: next, auto: 'left' });
    from = next;
  }
}

function bid(s: ThornsState, by: PlayerId, amount: number, auto?: Auto): GameError | null {
  const g = s.game!;
  const r = g.round;
  if (r.stage !== 'turns' && r.stage !== 'bid')
    return err(
      'wrong-stage',
      r.stage === 'place' ? 'Put your first disc down first.' : 'No bidding now.',
    );
  if (r.current !== by) return err('not-your-turn', 'It’s not your turn.');
  const max = total(g);
  const high = highBid(r);
  if (high && amount <= high.amount) return err('too-low', `Bid more than ${high.amount}.`);
  if (amount > max) return err('too-high', `There are only ${max} discs on the mats.`);
  r.bids.push({ by, amount });
  r.stage = 'bid';
  r.moves += 1;
  log(s, { kind: 'bid', by, amount, ...autoOf(auto) });
  if (amount === max) startChallenge(s, by, amount);
  else nextBidder(s, by);
  return null;
}

function pass(s: ThornsState, by: PlayerId, auto?: Auto): GameError | null {
  const r = s.game!.round;
  if (r.stage === 'turns' && r.current === by)
    return err('no-bid', 'Nobody has bid yet: add a disc or bid.');
  if (r.stage !== 'bid') return err('wrong-stage', 'There is no bid to pass on.');
  if (r.current !== by) return err('not-your-turn', 'It’s not your turn.');
  r.passed.push(by);
  r.moves += 1;
  log(s, { kind: 'pass', by, ...autoOf(auto) });
  nextBidder(s, by);
  return null;
}

function flip(
  s: ThornsState,
  by: PlayerId,
  owner: PlayerId,
  now: number,
  rng: Rng,
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const r = g.round;
  if (r.stage !== 'flip') return err('wrong-stage', 'There is nothing to turn over.');
  if (r.challenger !== by) return err('not-challenger', 'Only the challenger turns discs over.');
  const targets = flipTargets(g);
  if (!targets.includes(owner)) {
    if (targets.length === 1 && targets[0] === by)
      return err('own-first', 'Turn over your own discs first, from the top.');
    if (owner === by) return err('own-done', 'Your own are done: pick someone else’s stack.');
    return err('empty', 'Nothing left to turn over there.');
  }
  const p = g.players[owner]!;
  const disc = p.stack[p.stack.length - 1 - flippedOf(r, owner)]!;
  r.flips.push({ owner, disc });
  r.moves += 1;
  log(s, { kind: 'flip', by, owner, disc, ...autoOf(auto) });
  const amount = highBid(r)!.amount;
  if (disc === 'thorn') failed(s, owner, now, rng);
  else if (r.flips.length >= amount) won(s, now);
  return null;
}

function won(s: ThornsState, now: number) {
  const g = s.game!;
  const r = g.round;
  const by = r.challenger!;
  const amount = highBid(r)!.amount;
  const p = g.players[by]!;
  p.points += 1;
  log(s, { kind: 'won', by, amount, points: p.points });
  if (p.points >= POINTS_TO_WIN) {
    r.result = result(r, 'won', null, false, false, by, now);
    endGame(s, [by], 'points');
    return;
  }
  r.stage = 'result';
  r.current = null;
  r.result = result(r, 'won', null, false, false, by, now);
}

function result(
  r: Round,
  outcome: 'won' | 'failed',
  thornBy: PlayerId | null,
  lostDisc: boolean,
  eliminated: boolean,
  next: PlayerId | null,
  now: number,
) {
  return {
    outcome,
    challenger: r.challenger,
    bid: highBid(r)?.amount ?? 0,
    thornBy,
    lostDisc,
    eliminated,
    next,
    until: now + RESULT_MS,
  };
}

/** Whether `id` holds the Last Chance disc this round. */
export const holdsChance = (g: Game, id: PlayerId) =>
  g.chance?.holder === id && g.chance.round === g.round.number;

/**
 * A thorn ends the challenge. A Challenger holding the Last Chance disc loses it and their last
 * disc at once. Otherwise, hit by another player's thorn, the Challenger loses a disc at random;
 * hit by their own, they choose which (the `lose` stage).
 */
function failed(s: ThornsState, thornBy: PlayerId, now: number, rng: Rng) {
  const g = s.game!;
  const r = g.round;
  const by = r.challenger!;
  log(s, { kind: 'failed', by, thornBy });
  r.result = result(r, 'failed', thornBy, false, false, null, now);
  const p = g.players[by]!;
  if (holdsChance(g, by)) loseDisc(s, p.discs[0]!, false, now, undefined, true);
  else if (thornBy === by) r.stage = 'lose';
  else loseDisc(s, p.discs[rng.int(p.discs.length)]!, false, now);
}

/**
 * A thorn that was its owner's last disc knocks them out (the lone-thorn rule). Not while they
 * hold the Last Chance disc: they have two discs that round.
 */
function loneThorn(g: Game, owner: PlayerId) {
  return g.players[owner]!.discs.length === 1 && !holdsChance(g, owner);
}

function loseDisc(
  s: ThornsState,
  disc: Disc,
  chose: boolean,
  now: number,
  auto?: Auto,
  withChance = false,
) {
  const g = s.game!;
  const r = g.round;
  const by = r.challenger!;
  const p = g.players[by]!;
  removeDisc(p, disc);
  if (withChance) g.chance = null;
  log(s, {
    kind: 'lost',
    player: by,
    left: p.discs.length,
    chose,
    ...(withChance && { chance: true }),
    ...autoOf(auto),
  });
  const thornBy = r.result!.thornBy!;
  const eliminated = p.discs.length === 0;
  if (eliminated) {
    p.out = true;
    log(s, { kind: 'out', player: by, cause: 'thorn' });
  }
  const ownerOut = thornBy !== by && loneThorn(g, thornBy);
  if (ownerOut) {
    const o = g.players[thornBy]!;
    o.lost.push(...o.discs);
    o.discs = [];
    o.out = true;
    log(s, { kind: 'out', player: thornBy, cause: 'lone' });
  }
  const left = alive(g);
  // When the Challenger and the thorn's owner go out together and nobody else is left, the
  // thorn's owner wins.
  if (left.length <= 1) {
    r.result = { ...r.result!, lostDisc: true, eliminated };
    endGame(s, left.length ? left : [thornBy], 'last');
    return;
  }
  // Still in: the Challenger starts. Out by another's thorn: its owner (or, when the lone-thorn
  // rule took them too, the next player after them). Out by their own: they name who starts.
  const next = !eliminated
    ? by
    : thornBy === by
      ? null
      : ownerOut
        ? nextAfter(g, thornBy, () => true)
        : thornBy;
  // Down to one disc after a failed challenge: the Last Chance disc, for the next round only.
  if (
    !eliminated &&
    p.discs.length === 1 &&
    s.settings.lastChance !== false &&
    !g.hadChance.includes(by)
  ) {
    g.chance = { holder: by, round: r.number + 1 };
    g.hadChance.push(by);
    log(s, { kind: 'chance', player: by });
  }
  r.result = {
    ...r.result!,
    lostDisc: true,
    eliminated,
    next,
    until: now + (next === null ? STARTER_MS : RESULT_MS),
  };
  r.current = next === null ? by : null;
  r.stage = next === null ? 'starter' : 'result';
}

/** After a failed challenge, anyone may turn their own stack face up to show a bluff. */
function show(s: ThornsState, by: PlayerId): GameError | null {
  const g = s.game!;
  const r = g.round;
  if (r.result?.outcome !== 'failed' || !['lose', 'starter', 'result'].includes(r.stage))
    return err('wrong-stage', 'You can show your stack after a failed challenge.');
  const p = g.players[by];
  if (!p || p.stack.length === 0) return err('no-stack', 'You have no stack to show.');
  if (r.shown.includes(by)) return err('shown', 'Your stack is already showing.');
  r.shown.push(by);
  log(s, { kind: 'shown', player: by });
  return null;
}

function lose(s: ThornsState, by: PlayerId, disc: Disc, now: number, auto?: Auto) {
  const g = s.game!;
  const r = g.round;
  if (r.stage !== 'lose') return err('wrong-stage', 'There is no disc to give up now.');
  if (r.challenger !== by) return err('not-challenger', 'Only the challenger gives up a disc.');
  if (!g.players[by]!.discs.includes(disc)) return err('not-yours', 'You have no such disc.');
  loseDisc(s, disc, true, now, auto);
  return null;
}

function nameStarter(s: ThornsState, by: PlayerId, player: PlayerId, now: number, auto?: Auto) {
  const g = s.game!;
  const r = g.round;
  if (r.stage !== 'starter') return err('wrong-stage', 'Nobody needs to be named now.');
  if (r.challenger !== by) return err('not-challenger', 'Only the challenger names who starts.');
  if (!alive(g).includes(player)) return err('bad-player', 'Pick a player still in the game.');
  r.result = { ...r.result!, next: player, until: now + RESULT_MS };
  r.stage = 'result';
  r.current = null;
  log(s, { kind: 'starter', by, starter: player, ...autoOf(auto) });
  return null;
}

// ---- Moves made for a player ----

/**
 * The move made for a player who ran out of time, or when the host acts for them: never a disc
 * put down, except the round's mandatory first one (a random disc from their hand); before any
 * bid, open the bidding at the least (1); in the bidding, pass; as Challenger, turn over the top
 * disc of their own stack while it must be turned, then of the next stack clockwise; give up a
 * random disc; name the next player.
 */
function autoAct(s: ThornsState, who: PlayerId, why: Auto, now: number, rng: Rng): boolean {
  const g = s.game!;
  const r = g.round;
  const p = g.players[who];
  // A Challenger out by their own thorn still names who starts.
  if (!p || (p.out && r.stage !== 'starter') || !awaited(g).includes(who)) return false;
  let e: GameError | null = null;
  switch (r.stage) {
    case 'place':
      e = place(s, who, p.hand[rng.int(p.hand.length)]!, why);
      break;
    case 'turns':
      e = bid(s, who, 1, why);
      break;
    case 'bid':
      e = pass(s, who, why);
      break;
    case 'flip': {
      const targets = flipTargets(g);
      const next = targets.includes(who) ? who : nextAfter(g, who, (id) => targets.includes(id));
      e = next ? flip(s, who, next, now, rng, why) : err('stuck', 'Nothing to turn over.');
      break;
    }
    case 'lose':
      e = lose(s, who, p.discs[rng.int(p.discs.length)]!, now, why);
      break;
    case 'starter':
      // The next player still in after the Challenger.
      e = nameStarter(
        s,
        who,
        nextAfter(g, who, () => true)!,
        now,
        why,
      );
      break;
    case 'result':
      return false;
  }
  return !e;
}

// ---- Lobby ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

function seatWaiting(s: ThornsState) {
  let free = MAX_PLAYERS - players(s).length;
  for (const seat of Object.values(s.seats)) {
    if (free <= 0) break;
    if (!seat.waiting || seat.playing) continue;
    delete seat.waiting;
    seat.playing = true;
    free -= 1;
  }
}

function sit(state: ThornsState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this room.');
  if (state.phase === 'playing' && state.game?.players[ctx.by])
    return err('in-progress', 'You can sit down or stand up between games.');
  if (seat.playing === playing && !seat.waiting) return state;
  if (playing && !seat.playing && players(state).length >= MAX_PLAYERS)
    return err('full', `Only ${MAX_PLAYERS} can play.`);
  const s = draft(state);
  const mine = s.seats[ctx.by]!;
  delete mine.waiting;
  // Mid-game, a newcomer who wants to play waits for the next game.
  if (s.phase === 'playing' && playing) mine.waiting = true;
  else mine.playing = playing;
  return s;
}

/** Players still away when a game ends have left the room: their seats go. */
function dropAway(s: ThornsState) {
  for (const id of s.game?.away ?? []) delete s.seats[id];
}

function deal(state: ThornsState, ctx: Ctx): Result {
  const s = draft(state);
  dropAway(s);
  seatWaiting(s);
  const order = players(s);
  if (order.length < MIN_PLAYERS) return err('too-few', `${MIN_PLAYERS} players are needed.`);
  if (order.length > MAX_PLAYERS) return err('too-many', `At most ${MAX_PLAYERS} can play.`);
  const pl: Record<PlayerId, PlayerState> = {};
  for (const id of order)
    pl[id] = { discs: [...START_DISCS], hand: [], stack: [], lost: [], points: 0, out: false };
  s.phase = 'playing';
  s.gamesPlayed += 1;
  s.log = [];
  s.game = {
    order,
    players: pl,
    names: Object.fromEntries(order.map((id) => [id, s.seats[id]!.name])),
    left: [],
    away: [],
    round: {
      number: 0,
      starter: order[0]!,
      stage: 'place',
      current: null,
      bids: [],
      passed: [],
      challenger: null,
      flips: [],
      result: null,
      shown: [],
      moves: 0,
    },
    clock: null,
    chance: null,
    hadChance: [],
    winners: [],
    how: null,
  };
  beginRound(s, order[ctx.rng.int(order.length)]!);
  s.seed = newSeed(ctx.rng);
  settle(s, ctx.now);
  return s;
}

function updateSettings(
  state: ThornsState,
  action: Extract<ThornsAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Settings change between games.');
  const s = draft(state);
  if (action.seconds !== undefined) s.settings.seconds = action.seconds;
  if (action.timerMode !== undefined) s.settings.timerMode = action.timerMode;
  if (action.lastChance !== undefined) s.settings.lastChance = action.lastChance;
  return s;
}

function backToLobby(state: ThornsState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'lobby') return err('wrong-phase', 'No game to leave.');
  const s = draft(state);
  dropAway(s);
  s.phase = 'lobby';
  s.game = null;
  s.log = [];
  seatWaiting(s);
  return s;
}

// ---- In play ----

function inPlay(state: ThornsState, ctx: Ctx, fn: (s: ThornsState) => GameError | null): Result {
  if (state.phase !== 'playing' || !state.game) return err('not-playing', 'No game in play.');
  const s = draft(state);
  const e = fn(s);
  if (e) return e;
  settle(s, ctx.now);
  return s;
}

function reduce(state: ThornsState, action: ThornsAction, ctx: Ctx): Result {
  const by = ctx.by;
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'start': {
      const e = requireHost(ctx);
      if (e) return e;
      if (state.phase === 'playing') return err('in-progress', 'A game is already running.');
      return deal(state, ctx);
    }
    case 'play-again': {
      const e = requireHost(ctx);
      if (e) return e;
      if (state.phase !== 'over') return err('wrong-phase', 'Finish the game first.');
      return deal(state, ctx);
    }
    case 'back-to-lobby':
      return backToLobby(state, ctx);
    case 'place':
      return inPlay(state, ctx, (s) => place(s, by, action.disc));
    case 'bid':
      return inPlay(state, ctx, (s) => bid(s, by, action.amount));
    case 'pass':
      return inPlay(state, ctx, (s) => pass(s, by));
    case 'flip':
      return inPlay(state, ctx, (s) => flip(s, by, action.owner, ctx.now, ctx.rng));
    case 'lose':
      return inPlay(state, ctx, (s) => lose(s, by, action.disc, ctx.now));
    case 'starter':
      return inPlay(state, ctx, (s) => nameStarter(s, by, action.player, ctx.now));
    case 'show':
      return inPlay(state, ctx, (s) => show(s, by));
    case 'remove': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) => remove(s, action.player, ctx.now, ctx.rng));
    }
    case 'act-for': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) => {
        if (!awaited(s.game!).includes(action.player))
          return err('not-waiting', 'The table isn’t waiting on that player.');
        return autoAct(s, action.player, 'host', ctx.now, ctx.rng)
          ? null
          : err('stuck', 'Nothing to do for them.');
      });
    }
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): ThornsState {
  let state: ThornsState = {
    phase: 'lobby',
    settings: { seconds: null, timerMode: 'soft', lastChance: true },
    seed: newSeed(ctx.rng),
    seats: {},
    game: null,
    log: [],
    seq: 0,
    gamesPlayed: 0,
  };
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: ThornsState, player: PlayerInfo): ThornsState {
  const s = draft(state);
  const existing = s.seats[player.id];
  if (existing) {
    existing.name = player.name;
    const g = s.game;
    if (g?.names[player.id]) g.names[player.id] = player.name;
    // Back from being away: they carry on from here.
    if (g?.away.includes(player.id)) {
      g.away = g.away.filter((id) => id !== player.id);
      log(s, { kind: 'back', player: player.id });
    }
    return s;
  }
  const playing = s.phase !== 'playing' && players(s).length < MAX_PLAYERS;
  const seat: Seat = { name: player.name, playing, ...(!playing && { waiting: true }) };
  s.seats[player.id] = seat;
  return s;
}

/**
 * Someone left the room for good. Mid-game they keep their place: away, skipped when placing and
 * bidding (a skipped bidder has passed), their discs still on the mat, until they come back or
 * the host removes them. A Challenger who is away is waited for.
 */
function playerLeft(state: ThornsState, playerId: PlayerId, now: number): ThornsState {
  if (!state.seats[playerId]) return state;
  const s = draft(state);
  const g = s.game;
  const p = g?.players[playerId];
  if (s.phase !== 'playing' || !g || !p || p.out) {
    delete s.seats[playerId];
    if (s.phase !== 'playing') seatWaiting(s);
    return s;
  }
  if (g.away.includes(playerId)) return s;
  g.away.push(playerId);
  log(s, { kind: 'away', player: playerId });
  const r = g.round;
  if (r.stage === 'place') placedAll(g);
  else if (r.stage === 'turns' && r.current === playerId)
    r.current = nextAfter(g, playerId, here(g)) ?? r.current;
  else if (r.stage === 'bid' && r.current === playerId) {
    r.passed.push(playerId);
    log(s, { kind: 'pass', by: playerId, auto: 'left' });
    nextBidder(s, playerId);
  }
  settle(s, now);
  return s;
}

/**
 * The host removes a player who left: they are out and their discs leave the table. If their
 * discs were in play (the first discs, the turns, the bidding or the flip), the round is called
 * off: everyone takes their discs back and it starts again, with nobody winning or losing
 * anything. Once a thorn has been hit, the round finishes as it would have (a removed Challenger's
 * choices are made for them first). With one player left, they win.
 */
function remove(s: ThornsState, player: PlayerId, now: number, rng: Rng): GameError | null {
  const g = s.game!;
  const p = g.players[player];
  if (!p || !g.away.includes(player))
    return err('not-away', 'Only a player who has left can be removed.');
  const r = g.round;
  if (awaited(g).includes(player) && (r.stage === 'lose' || r.stage === 'starter'))
    autoAct(s, player, 'left', now, rng);
  const inPlay = p.stack.length > 0 && ['place', 'turns', 'bid', 'flip'].includes(r.stage);
  g.away = g.away.filter((id) => id !== player);
  delete s.seats[player];
  if (s.phase !== 'playing' || p.out) return null;
  p.out = true;
  p.discs = [];
  g.left.push(player);
  log(s, { kind: 'out', player, cause: 'left' });
  const left = alive(g);
  if (left.length <= 1) {
    endGame(s, left, 'last');
    return null;
  }
  if (inPlay) {
    log(s, { kind: 'void', player });
    beginRound(s, r.starter);
    return null;
  }
  if (r.result?.next === player) r.result.next = nextAfter(g, player, () => true);
  if (r.stage === 'place') placedAll(g);
  else if (r.current === player && r.stage === 'turns')
    r.current = nextAfter(g, player, here(g)) ?? r.current;
  else if (r.current === player && r.stage === 'bid') nextBidder(s, player);
  return null;
}

// ---- Timers ----

type Due = { at: number; why: 'result' | 'starter' | 'timer' | 'remind' };

function deadlines(state: ThornsState): Due[] {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return [];
  const out: Due[] = [];
  const r = g.round;
  if (r.stage === 'result' && r.result) out.push({ at: r.result.until, why: 'result' });
  if (r.stage === 'starter' && r.result) out.push({ at: r.result.until, why: 'starter' });
  const secs = state.settings.seconds;
  if (secs !== null && g.clock && awaited(g).length > 0) {
    const at = g.clock.since + secs * 1000;
    if (state.settings.timerMode === 'strict') out.push({ at, why: 'timer' });
    else if (!g.clock.reminded) out.push({ at, why: 'remind' });
  }
  return out.sort((a, b) => a.at - b.at);
}

function nextDeadline(state: ThornsState): number | null {
  return deadlines(state)[0]?.at ?? null;
}

function onDeadline(state: ThornsState, now: number): ThornsState {
  const due = deadlines(state)[0];
  if (!due || now < due.at) return state;
  const s = draft(state);
  const g = s.game!;
  const rng = hiddenRng(state, now);
  if (due.why === 'remind') g.clock!.reminded = true;
  else if (due.why === 'result') beginRound(s, g.round.result!.next ?? g.round.starter);
  else if (due.why === 'starter') autoAct(s, g.round.challenger!, 'timer', now, rng);
  else for (const who of awaited(g)) autoAct(s, who, 'timer', now, rng);
  settle(s, now);
  s.seed = newSeed(rng);
  return s;
}

// ---- Views ----

function gameView(state: ThornsState, g: Game): GameView {
  const r = g.round;
  const secs = state.settings.seconds;
  const who = state.phase === 'playing' ? awaited(g) : [];
  return {
    order: [...g.order],
    players: g.order.map((id) => {
      const p = g.players[id]!;
      return {
        id,
        name: state.seats[id]?.name ?? g.names[id] ?? 'Gone',
        discs: p.discs.length,
        hand: p.hand.length,
        stack: p.stack.length,
        flipped: r.flips.filter((f) => f.owner === id).map((f) => f.disc),
        // The Last Chance disc is marked: everyone sees which disc it is.
        chanceAt: p.stack.includes('chance') ? p.stack.indexOf('chance') : null,
        shown: r.shown.includes(id) ? [...p.stack].reverse() : null,
        points: p.points,
        out: p.out,
        left: g.left.includes(id),
        away: g.away.includes(id),
      };
    }),
    round: {
      number: r.number,
      starter: r.starter,
      stage: r.stage,
      current: r.current,
      bids: r.bids.map((b) => ({ ...b })),
      passed: [...r.passed],
      challenger: r.challenger,
      flips: r.flips.map((f) => ({ ...f })),
      total: total(g),
      placed: r.stage === 'place' ? alive(g).filter((id) => g.players[id]!.stack.length > 0) : [],
      result: r.result ? { ...r.result } : null,
    },
    clock:
      g.clock && who.length > 0
        ? {
            who,
            since: g.clock.since,
            deadline: secs === null ? null : g.clock.since + secs * 1000,
            reminded: g.clock.reminded,
          }
        : null,
    chance: g.chance ? { ...g.chance } : null,
    winners: [...g.winners],
    how: g.how,
  };
}

function view(state: ThornsState, viewer: PlayerId | null): ThornsView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
    ...(s.waiting && { waiting: true }),
  }));
  const g = state.game;
  const own = viewer !== null ? g?.players[viewer] : undefined;
  return {
    phase: state.phase,
    settings: { ...state.settings },
    seats,
    me: seats.find((s) => s.id === viewer) ?? null,
    game: g ? gameView(state, g) : null,
    mine: own
      ? { discs: [...own.discs], hand: [...own.hand], stack: [...own.stack], lost: [...own.lost] }
      : null,
    reveal:
      g && state.phase === 'over'
        ? g.order.map((id) => {
            const p = g.players[id]!;
            return {
              id,
              discs: [...p.discs],
              hand: [...p.hand],
              stack: [...p.stack],
              lost: [...p.lost],
            };
          })
        : null,
    log: state.log.map((e) => ({ ...e })),
  };
}

export const thorns: GameDefinition<ThornsState, ThornsAction, ThornsView> = {
  id: 'thorns',
  name: 'Thorns',
  description: 'Hide a thorn among your roses, bid on how many you can turn over, and bluff.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: 30,
  maxSeated: MAX_PLAYERS,
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
  awards: thornsAwards,
  bot: thornsBot,
  botInfo: {},
};
