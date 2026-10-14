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
import { tavernBrawlAwards } from './awards.ts';
import { tavernBrawlBot } from './bot.ts';
import { ENABLED_HEROES, HEROES, deckList } from './cards.ts';
import {
  type Env,
  answer,
  autoAct,
  awaited,
  emptyTally,
  endGame,
  hasLasting,
  pointsOf,
  log,
  playCard,
  removePlayer,
  settle,
  startTurn,
} from './engine.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  type CardId,
  type CardRef,
  DEFAULT_SECONDS,
  type Game,
  type GameView,
  HAND_START,
  HP_START,
  type HeroId,
  type Inst,
  LEFT_BEAT_MS,
  MAX_PLAYERS,
  type SetId,
  ZONE_PLAYERS,
  MIN_PLAYERS,
  NUDGE_MS,
  type PlayerView,
  type Seat,
  type SeatView,
  type TavernBrawlAction,
  type TavernBrawlState,
  type TavernBrawlView,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = TavernBrawlState | GameError;

const err = (code: string, message: string) => new GameError(code, message);

const newSeed = (rng: Rng) => rng.int(2 ** 32);
const hiddenRng = (state: TavernBrawlState, now: number) =>
  createRng((state.seed ^ now ^ state.seq) >>> 0);

const draft = (state: TavernBrawlState): TavernBrawlState => structuredClone(state);

export const players = (state: Pick<TavernBrawlState, 'seats'>): PlayerId[] =>
  Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));

// ---- Browser tests only ----

interface TestRig {
  /** Cards to put on top of a hero's deck (top first) when a game starts. */
  decks?: Partial<Record<HeroId, CardId[]>>;
  /** The first seat always goes first. */
  firstSeat?: boolean;
  /** Starting hit points by player count, so a spec's full games end in a few rounds. */
  hp?: Partial<Record<number, number>>;
}
let testRig: TestRig = {};

/** Browser tests only: stacks decks, fixes the first player and lowers hit points (never set in production). */
export function setTestRig(rig: TestRig) {
  testRig = rig;
}

// ---- Lobby ----

const requireHost = (ctx: Ctx) =>
  ctx.isHost ? null : err('not-host', 'Only the host can do that.');

/** The heroes random picks draw from: those in the host's chosen sets (all by default). */
const inSets = (sets: SetId[] | undefined) =>
  ENABLED_HEROES.filter((h) => !sets || sets.includes(HEROES[h].set));

function takenHeroes(state: TavernBrawlState, except?: PlayerId): Set<HeroId> {
  return new Set(
    Object.entries(state.seats).flatMap(([id, s]) =>
      s.playing && s.hero && id !== except ? [s.hero] : [],
    ),
  );
}

function seatWaiting(state: TavernBrawlState) {
  let free = MAX_PLAYERS - players(state).length;
  for (const seat of Object.values(state.seats)) {
    if (free <= 0) break;
    if (!seat.waiting || seat.playing) continue;
    delete seat.waiting;
    seat.playing = true;
    free -= 1;
  }
}

function sit(state: TavernBrawlState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this room.');
  if (state.phase === 'playing' && seat.playing !== playing)
    return err('in-progress', 'You can sit down or stand up between games.');
  const s = draft(state);
  const mine = s.seats[ctx.by]!;
  if (mine.playing === playing) {
    delete mine.waiting;
    return s;
  }
  if (playing && players(s).length >= MAX_PLAYERS)
    return err('full', `Only ${MAX_PLAYERS} can play at once.`);
  delete mine.waiting;
  mine.playing = playing;
  if (!playing || (mine.hero && takenHeroes(s, ctx.by).has(mine.hero))) mine.hero = null;
  return s;
}

function pickHero(state: TavernBrawlState, hero: HeroId | 'random' | null, ctx: Ctx): Result {
  if (state.phase === 'playing') return err('in-progress', 'Heroes are picked between games.');
  const seat = state.seats[ctx.by];
  if (!seat?.playing) return err('not-playing', 'Take a seat to pick a hero.');
  const taken = takenHeroes(state, ctx.by);
  let pick = hero;
  if (pick === 'random') {
    const offered = inSets(state.settings.sets);
    const free = offered.filter((h) => !taken.has(h) && h !== seat.hero);
    const pool = free.length > 0 ? free : offered.filter((h) => !taken.has(h));
    pick = pool[ctx.rng.int(pool.length)] ?? null;
    if (!pick) return err('no-hero', 'Every hero is taken.');
  }
  if (pick && !ENABLED_HEROES.includes(pick)) return err('bad-hero', "That hero isn't available.");
  if (pick && taken.has(pick)) return err('taken', 'Someone else has that hero.');
  const s = draft(state);
  s.seats[ctx.by]!.hero = pick;
  return s;
}

function randomHeroes(state: TavernBrawlState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Heroes are picked between games.');
  const s = draft(state);
  const offered = inSets(state.settings.sets);
  const heroes = ctx.rng.shuffle(offered.length >= players(s).length ? offered : ENABLED_HEROES);
  players(s).forEach((p, i) => (s.seats[p]!.hero = heroes[i] ?? null));
  return s;
}

function updateSettings(
  state: TavernBrawlState,
  action: Extract<TavernBrawlAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Settings change between games.');
  const s = draft(state);
  if (action.seconds !== undefined) s.settings.seconds = action.seconds;
  if (action.timerMode !== undefined) s.settings.timerMode = action.timerMode;
  if (action.sets !== undefined) s.settings.sets = [...new Set(action.sets)];
  return s;
}

function newInstanceIds(rng: Rng, n: number, taken: Set<string>): Inst[] {
  const out: Inst[] = [];
  while (out.length < n) {
    const id = (rng.int(36 ** 4) * 36 ** 4 + rng.int(36 ** 4)).toString(36).padStart(8, '0');
    if (taken.has(id)) continue;
    taken.add(id);
    out.push(id);
  }
  return out;
}

/** Deals a new game to the seated players and their heroes; the first player is random. */
function deal(state: TavernBrawlState, ctx: Ctx): Result {
  dropLeavers(state);
  seatWaiting(state);
  const seated = players(state);
  if (seated.length < MIN_PLAYERS) return err('too-few', `${MIN_PLAYERS} players are needed.`);
  if (seated.length > MAX_PLAYERS) return err('too-many', `At most ${MAX_PLAYERS} can play.`);
  const missing = seated.filter((p) => !state.seats[p]!.hero);
  if (missing.length > 0) return err('no-hero', 'Everyone needs a hero first.');
  const rng = ctx.rng;
  const taken = new Set<string>();
  const g: Game = {
    order: seated,
    names: Object.fromEntries(seated.map((p) => [p, state.seats[p]!.name])),
    players: {},
    cards: {},
    first: seated[0]!,
    turn: { player: seated[0]!, number: 0, debt: 0, played: [], bonus: 0, fresh: [], plays: 0 },
    lasting: [],
    frames: [],
    choice: null,
    clock: null,
    left: {},
    nudges: {},
    knockouts: [],
    winners: [],
    endReason: null,
    passes: 0,
    tally: {},
    zone: seated.length >= ZONE_PLAYERS,
    bones: [],
  };
  for (const p of seated) {
    const hero = state.seats[p]!.hero!;
    const list = deckList(hero);
    const ids = newInstanceIds(rng, list.length, taken);
    ids.forEach((id, i) => (g.cards[id] = { card: list[i]!, owner: p }));
    let deck = rng.shuffle(ids);
    const top = testRig.decks?.[hero] ?? [];
    if (top.length > 0) {
      const picked: Inst[] = [];
      for (const card of top) {
        const inst = deck.find((i) => g.cards[i]!.card === card && !picked.includes(i));
        if (inst) picked.push(inst);
      }
      deck = [...picked, ...deck.filter((i) => !picked.includes(i))];
    }
    g.players[p] = {
      hero,
      hp: testRig.hp?.[seated.length] ?? HP_START,
      deck: deck.slice(HAND_START),
      hand: deck.slice(0, HAND_START),
      discard: [],
      shields: [],
      form: null,
      out: false,
    };
    g.tally[p] = emptyTally();
  }
  const first = testRig.firstSeat ? seated[0]! : seated[rng.int(seated.length)]!;
  g.first = first;
  state.phase = 'playing';
  state.game = g;
  state.log = [];
  state.gamesPlayed += 1;
  state.seed = newSeed(rng);
  const env: Env = { now: ctx.now, rng };
  // The turn before the first: startTurn counts from here.
  startTurn(state, env, first);
  settle(state, ctx.now);
  return state;
}

/** Seats of players who left during the last game go once it's over. */
function dropLeavers(state: TavernBrawlState) {
  for (const p of Object.keys(state.game?.left ?? {})) delete state.seats[p];
}

function start(state: TavernBrawlState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'A game is already running.');
  return deal(draft(state), ctx);
}

function backToLobby(state: TavernBrawlState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase !== 'over') return err('wrong-phase', 'Finish the game first.');
  const s = draft(state);
  s.phase = 'lobby';
  dropLeavers(s);
  s.game = null;
  s.log = [];
  seatWaiting(s);
  return s;
}

// ---- In play ----

function inGame(state: TavernBrawlState): Game | GameError {
  if (state.phase !== 'playing' || !state.game) return err('not-playing', 'No game in play.');
  return state.game;
}

function withEnv(
  state: TavernBrawlState,
  ctx: Ctx,
  fn: (s: TavernBrawlState, env: Env) => GameError | null,
): Result {
  const s = draft(state);
  const env: Env = { now: ctx.now, rng: ctx.rng };
  const e = fn(s, env);
  if (e) return e;
  settle(s, ctx.now);
  return s;
}

function actFor(state: TavernBrawlState, player: PlayerId, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  const g = inGame(state);
  if (g instanceof GameError) return g;
  if (awaited(g) !== player) return err('not-waiting', 'The table isn’t waiting on that player.');
  return withEnv(state, ctx, (s, env) =>
    autoAct(s, env, player, 'host') ? null : err('stuck', 'Nothing to do for them.'),
  );
}

function nudge(state: TavernBrawlState, player: PlayerId, ctx: Ctx): Result {
  const g = inGame(state);
  if (g instanceof GameError) return g;
  if (player === ctx.by) return err('self', 'You can’t nudge yourself.');
  if (awaited(g) !== player) return err('not-waiting', 'The table isn’t waiting on that player.');
  const last = g.nudges[player];
  if (last !== undefined && ctx.now - last < NUDGE_MS)
    return err('too-soon', 'They were just nudged.');
  const s = draft(state);
  s.game!.nudges[player] = ctx.now;
  return s;
}

function remove(state: TavernBrawlState, player: PlayerId, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  const g = inGame(state);
  if (g instanceof GameError) return g;
  if (g.left[player] === undefined) return err('not-left', 'Only players who left can be removed.');
  if (g.players[player]?.out) return err('already-out', 'They are already out.');
  if (g.frames.length > 0) return err('resolving', 'Wait for the card being played.');
  return withEnv(state, ctx, (s, env) => {
    removePlayer(s, env, player);
    return null;
  });
}

function reduce(state: TavernBrawlState, action: TavernBrawlAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'pick-hero':
      return pickHero(state, action.hero, ctx);
    case 'random-heroes':
      return randomHeroes(state, ctx);
    case 'start':
      return start(state, ctx);
    case 'play':
      return withEnv(state, ctx, (s, env) => playCard(s, env, ctx.by, action.card));
    case 'choose':
      return withEnv(state, ctx, (s, env) => answer(s, env, ctx.by, action.choice, action.pick));
    case 'act-for':
      return actFor(state, action.player, ctx);
    case 'nudge':
      return nudge(state, action.player, ctx);
    case 'remove':
      return remove(state, action.player, ctx);
    case 'play-again': {
      const e = requireHost(ctx);
      if (e) return e;
      if (state.phase !== 'over') return err('wrong-phase', 'Finish the game first.');
      return deal(draft(state), ctx);
    }
    case 'back-to-lobby':
      return backToLobby(state, ctx);
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): TavernBrawlState {
  let state: TavernBrawlState = {
    phase: 'lobby',
    settings: { seconds: DEFAULT_SECONDS, timerMode: 'soft' },
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

function playerJoined(state: TavernBrawlState, player: PlayerInfo): TavernBrawlState {
  const s = draft(state);
  const existing = s.seats[player.id];
  if (existing) {
    existing.name = player.name;
    // Back after leaving: they play their own seat again.
    if (s.game?.left[player.id] !== undefined) delete s.game.left[player.id];
    return s;
  }
  const playing = s.phase !== 'playing' && players(s).length < MAX_PLAYERS;
  const seat: Seat = { name: player.name, playing, hero: null, ...(!playing && { waiting: true }) };
  s.seats[player.id] = seat;
  return s;
}

/**
 * Someone left for good. Between games their seat goes; mid-game they keep it, marked as gone,
 * and the table plays their turns and choices for them (after a short beat) until the host
 * removes them or the game ends.
 */
function playerLeft(state: TavernBrawlState, playerId: PlayerId, now: number): TavernBrawlState {
  const seat = state.seats[playerId];
  if (!seat) return state;
  const s = draft(state);
  const g = s.game;
  if (s.phase === 'playing' && g?.players[playerId]) {
    // They keep their seat (and name) until the game ends; the table plays for them.
    g.left[playerId] = now;
    if (!g.players[playerId].out) log(s, { kind: 'left', player: playerId });
    return s;
  }
  delete s.seats[playerId];
  if (s.phase !== 'playing') seatWaiting(s);
  return s;
}

// ---- Timers ----

function deadlines(
  state: TavernBrawlState,
): { at: number; why: 'social' | 'left' | 'timer' | 'remind' }[] {
  const g = state.game;
  if (state.phase !== 'playing' || !g?.clock) return [];
  const out: { at: number; why: 'social' | 'left' | 'timer' | 'remind' }[] = [];
  const c = g.clock;
  if (g.choice?.deadline !== undefined) out.push({ at: g.choice.deadline, why: 'social' });
  const gone = g.left[c.who];
  if (gone !== undefined) out.push({ at: Math.max(c.since, gone) + LEFT_BEAT_MS, why: 'left' });
  const secs = state.settings.seconds;
  if (secs !== null && g.choice?.deadline === undefined) {
    const at = c.since + secs * 1000;
    if (state.settings.timerMode === 'strict') out.push({ at, why: 'timer' });
    else if (!c.reminded) out.push({ at, why: 'remind' });
  }
  return out.sort((a, b) => a.at - b.at);
}

function nextDeadline(state: TavernBrawlState): number | null {
  return deadlines(state)[0]?.at ?? null;
}

function onDeadline(state: TavernBrawlState, now: number): TavernBrawlState {
  const due = deadlines(state)[0];
  if (!due || now < due.at) return state;
  const s = draft(state);
  const g = s.game!;
  const who = g.clock!.who;
  const rng = hiddenRng(state, now);
  const env: Env = { now, rng };
  if (due.why === 'remind') {
    g.clock!.reminded = true;
    return s;
  }
  const why = due.why === 'social' ? 'timer' : due.why;
  const before = g.clock!.key;
  autoAct(s, env, who, why);
  settle(s, now);
  if (s.phase === 'playing' && s.game!.clock?.key === before) {
    // Nothing could be done for them: end the turn so the game always moves on.
    endGame(s, 'stalled', []);
  }
  s.seed = newSeed(rng);
  return s;
}

// ---- Views ----

const ref = (g: Game, id: Inst): CardRef => ({
  id,
  card: g.cards[id]!.card,
  owner: g.cards[id]!.owner,
});

function gameView(state: TavernBrawlState, g: Game, viewer: PlayerId | null): GameView {
  const over = state.phase === 'over';
  const playersView: PlayerView[] = g.order.map((id) => {
    const p = g.players[id]!;
    return {
      id,
      name: state.seats[id]?.name ?? g.names[id] ?? 'Gone',
      hero: p.hero,
      hp: p.hp,
      out: p.out,
      left: g.left[id] !== undefined || !state.seats[id],
      handCount: p.hand.length,
      deckCount: p.deck.length,
      discard: p.discard.map((i) => ref(g, i)),
      shields: p.shields.map((sh) => ({
        ...ref(g, sh.id),
        damage: sh.damage,
        left: pointsOf(g, sh) - sh.damage,
        ...(sh.copyOf && { copyOf: sh.copyOf }),
      })),
      form: p.form ? { kind: p.form.kind, card: ref(g, p.form.id) } : null,
      disguised: hasLasting(g, 'disguise', id),
      ghost: p.ghost === true,
      controls: hasLasting(g, 'control', id),
      allOpps: hasLasting(g, 'allOpps', id),
    };
  });
  const secs = state.settings.seconds;
  const clock = g.clock
    ? {
        who: g.clock.who,
        since: g.clock.since,
        deadline: g.choice?.deadline ?? (secs === null ? null : g.clock.since + secs * 1000),
        reminded: g.clock.reminded,
      }
    : null;
  const c = g.choice;
  return {
    order: [...g.order],
    zone: g.zone === true,
    players: playersView,
    first: g.first,
    turn: {
      player: g.turn.player,
      number: g.turn.number,
      debt: g.turn.debt,
      played: g.turn.played.map((i) => ref(g, i)),
      bonus: g.turn.bonus,
      plays: g.turn.plays,
    },
    resolving: g.frames.flatMap((f) => (g.cards[f.id] ? [ref(g, f.id)] : [])),
    choice: c
      ? {
          id: c.id,
          kind: c.kind,
          chooser: c.chooser,
          source: g.cards[c.source] ? ref(g, c.source) : null,
          card: c.card ?? g.cards[c.source]?.card ?? null,
          ...(c.flavour && { flavour: c.flavour }),
          ...(c.attacker && { attacker: c.attacker }),
          options: viewer === c.chooser ? [...c.options] : [],
          ...(c.amount !== undefined && { amount: c.amount }),
          ...(c.target !== undefined && { target: c.target }),
          ...(c.deadline !== undefined && { deadline: c.deadline }),
        }
      : null,
    clock,
    nudges: { ...g.nudges },
    knockouts: g.knockouts.map((k) => ({ ...k })),
    winners: [...g.winners],
    endReason: g.endReason,
    tally: structuredClone(g.tally),
    hands: over
      ? Object.fromEntries(g.order.map((id) => [id, g.players[id]!.hand.map((i) => ref(g, i))]))
      : null,
  };
}

function view(state: TavernBrawlState, viewer: PlayerId | null): TavernBrawlView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
    hero: s.hero,
    ...(s.waiting && { waiting: true }),
  }));
  const me = viewer === null ? null : (seats.find((s) => s.id === viewer) ?? null);
  const g = state.game;
  const hand =
    g && viewer !== null && g.players[viewer] ? g.players[viewer].hand.map((i) => ref(g, i)) : [];
  return {
    phase: state.phase,
    settings: { ...state.settings },
    seats,
    me,
    game: g ? gameView(state, g, viewer) : null,
    hand,
    log: state.log.map((e) => ({ ...e })),
  };
}

export const tavernBrawl: GameDefinition<TavernBrawlState, TavernBrawlAction, TavernBrawlView> = {
  id: 'tavern-brawl',
  name: 'Tavern Brawl',
  description: 'Hero card brawl: hit, shield, heal and chain cards to be the last one standing.',
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
  awards: tavernBrawlAwards,
  bot: tavernBrawlBot,
};
