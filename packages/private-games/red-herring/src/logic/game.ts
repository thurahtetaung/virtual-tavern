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
import { redHerringAwards } from './awards.ts';
import { redHerringBot } from './bot.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  CATCH_VOTES,
  DECK_CARDS,
  DECK_IDS,
  DEFAULT_SETTINGS,
  type DeckId,
  type Game,
  HAND_SIZE,
  LEFT_BEAT_MS,
  MAX_PLAYERS,
  MAX_TOPIC,
  MAX_WORD,
  MIN_PLAYERS,
  PLAYS_EACH,
  POINTS,
  type RedHerringAction,
  type RedHerringState,
  type RedHerringView,
  type Round,
  type RoundResult,
  type RoundView,
  SEAT_COLORS,
  type Seat,
  type SeatView,
  type Settings,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = RedHerringState | GameError;
const err = (code: string, message: string) => new GameError(code, message);

// ---- Browser-test rig ----

/**
 * Browser tests only (`RED_HERRING_TEST_DEAL`, set by the server outside production): the deck
 * is dealt in card-number order with the first seat picking the first word, and the Conspirator
 * is the player this many seats after the word-picker. Null: the usual random deal.
 */
let testDeal: number | null = null;
export function setTestDeal(offset: number | null) {
  testDeal = offset !== null && Number.isInteger(offset) && offset > 0 ? offset : null;
}

// ---- Helpers ----

export function players(state: RedHerringState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

/** Rounds in a game: everyone picks the word once, or twice under 5 players or "twice around". */
export const roundsFor = (n: number, twice: boolean) => n * (twice || n < 5 ? 2 : 1);

/** Every card of the chosen decks. */
export const poolOf = (decks: Settings['decks']) =>
  DECK_IDS.filter((d) => decks[d]).flatMap((d) => DECK_CARDS[d]);

/** Cards a game needs: one for every play, so nobody's hand runs dry once draws stop. */
export const cardsNeeded = (n: number, twice: boolean) => PLAYS_EACH * n * roundsFor(n, twice);

const hiddenRng = (state: RedHerringState, now: number) => createRng((state.seed ^ now) >>> 0);
const newSeed = (rng: Rng) => rng.int(2 ** 32);
const copyLists = (m: Record<PlayerId, number[]>) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]));

/** A copy of the state that every change below may mutate (much cheaper than structuredClone). */
function draft(s: RedHerringState): RedHerringState {
  const g = s.game;
  return {
    ...s,
    settings: { ...s.settings, decks: { ...s.settings.decks } },
    seats: { ...s.seats },
    winners: [...s.winners],
    game: g && {
      ...g,
      players: [...g.players],
      names: { ...g.names },
      pickers: [...g.pickers],
      deck: [...g.deck],
      hands: copyLists(g.hands),
      tokens: copyLists(g.tokens),
      conspired: { ...g.conspired },
      left: { ...g.left },
      history: [...g.history],
      round: {
        ...g.round,
        order: [...g.round.order],
        plays: [...g.round.plays],
        explained: [...g.round.explained],
        votes: { ...g.round.votes },
        autoVotes: [...g.round.autoVotes],
        skipped: [...g.round.skipped],
      },
    },
  };
}

function nextColor(state: RedHerringState) {
  const used = new Set(Object.values(state.seats).map((s) => s.color));
  return SEAT_COLORS.find((c) => !used.has(c)) ?? SEAT_COLORS[0];
}

const total = (tokens: readonly number[] | undefined) => (tokens ?? []).reduce((a, b) => a + b, 0);

const present = (g: Game) => g.players.filter((id) => g.left[id] === undefined);

/** The order of card plays: everyone in round order, twice. */
const playOrder = (r: Round) => [...r.order, ...r.order];

/** Who votes: everyone but the word-picker, clockwise from their left. */
export const votersOf = (r: Pick<Round, 'order'>) => r.order.slice(1);

/** Whom `voter` may accuse: anyone at the table but themself and the word-picker. */
export const candidatesFor = (r: Pick<Round, 'order'>, voter: PlayerId) =>
  r.order.slice(1).filter((id) => id !== voter);

function secondsFor(settings: Settings, stage: Round['stage']): number | null {
  switch (stage) {
    case 'card':
    case 'word':
    case 'play':
    case 'vote':
      return settings.turnSeconds;
    case 'explain':
      return settings.talkSeconds;
    case 'discuss':
      return settings.discussSeconds;
    case 'reveal':
      return null;
  }
}

/** When the current step's timer runs out (shown to everyone; strict only where it can act). */
export function deadlineOf(settings: Settings, r: Round): number | null {
  const secs = secondsFor(settings, r.stage);
  return secs === null ? null : r.since + secs * 1000;
}

// ---- Lobby ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

function updateSettings(
  state: RedHerringState,
  action: Extract<RedHerringAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  const settings: Settings = { ...state.settings };
  // The sound may change at any time; everything else between games.
  const { type: _t, sound, ...rest } = action;
  if (sound !== undefined) settings.sound = sound;
  if (Object.values(rest).some((v) => v !== undefined) && state.phase === 'playing')
    return err('in-progress', 'Settings can only change between games.');
  if (action.decks) {
    if (!DECK_IDS.some((d) => action.decks![d]))
      return err('no-deck', 'Pick at least one deck of cards.');
    settings.decks = { ...action.decks };
  }
  if (action.twice !== undefined) settings.twice = action.twice;
  if (action.openVote !== undefined) settings.openVote = action.openVote;
  if (action.noDiscussion !== undefined) settings.noDiscussion = action.noDiscussion;
  if (action.scoring !== undefined) settings.scoring = action.scoring;
  if (action.balanced !== undefined) settings.balanced = action.balanced;
  if (action.topic !== undefined) {
    const topic = action.topic.trim().replace(/\s+/g, ' ');
    if (topic.length > MAX_TOPIC)
      return err('topic-long', `Keep the topic to ${MAX_TOPIC} characters.`);
    settings.topic = topic;
  }
  if (action.turnSeconds !== undefined) settings.turnSeconds = action.turnSeconds;
  if (action.talkSeconds !== undefined) settings.talkSeconds = action.talkSeconds;
  if (action.discussSeconds !== undefined) settings.discussSeconds = action.discussSeconds;
  if (action.timerMode !== undefined) settings.timerMode = action.timerMode;
  return { ...state, settings };
}

function sit(state: RedHerringState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this room.');
  if (seat.playing === playing) return state;
  if (state.phase === 'playing')
    return err('in-progress', 'You can sit down or stand up between games.');
  if (playing && players(state).length >= MAX_PLAYERS)
    return err('full', `Only ${MAX_PLAYERS} can play at once.`);
  return { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, playing } } };
}

const DECK_NAMES: Record<DeckId, string> = {
  base: 'the Classic deck',
  noir: 'the Noir deck',
  ours: 'our picture cards',
};

/** Why the host can't start yet, or null. */
export function startProblem(state: Pick<RedHerringState, 'seats' | 'settings'>): string | null {
  const n = Object.values(state.seats).filter((s) => s.playing).length;
  if (n < MIN_PLAYERS) return `${MIN_PLAYERS} players are needed.`;
  if (n > MAX_PLAYERS) return `At most ${MAX_PLAYERS} can play.`;
  const { decks, twice } = state.settings;
  if (!DECK_IDS.some((d) => decks[d])) return 'Pick at least one deck of cards.';
  const need = cardsNeeded(n, twice);
  const have = poolOf(decks).length;
  if (have < need) {
    const add = DECK_IDS.filter((d) => !decks[d]).find((d) => have + DECK_CARDS[d].length >= need);
    return `${n} players need ${need} cards and the chosen decks have ${have}: ${
      add ? `add ${DECK_NAMES[add]}` : 'add more decks'
    }${twice ? ' or play once around' : ''}.`;
  }
  return null;
}

function start(state: RedHerringState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'A game is already running.');
  const problem = startProblem(state);
  if (problem) return err('cannot-start', problem);
  const seated = players(state);
  const pool = poolOf(state.settings.decks);
  const deck = testDeal ? [...pool] : ctx.rng.shuffle(pool);
  const hands: Record<PlayerId, number[]> = {};
  for (const id of seated) hands[id] = deck.splice(0, HAND_SIZE);
  const firstAt = testDeal ? 0 : ctx.rng.int(seated.length);
  const ring = [...seated.slice(firstAt), ...seated.slice(0, firstAt)];
  const rounds = roundsFor(seated.length, state.settings.twice);
  const pickers = Array.from({ length: rounds }, (_, i) => ring[i % ring.length]!);
  const game: Game = {
    players: seated,
    names: Object.fromEntries(seated.map((id) => [id, state.seats[id]!.name])),
    pickers: pickers.slice(1),
    rounds,
    deck,
    hands,
    tokens: Object.fromEntries(seated.map((id) => [id, []])),
    conspired: Object.fromEntries(seated.map((id) => [id, 0])),
    left: {},
    round: newRound(seated, pickers[0]!, 1, ctx.now),
    history: [],
  };
  return {
    ...state,
    phase: 'playing',
    seed: newSeed(ctx.rng),
    game,
    winners: [],
    endReason: null,
    gamesPlayed: state.gamesPlayed + 1,
  };
}

function backToLobby(state: RedHerringState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  return { ...state, phase: 'lobby', game: null, winners: [], endReason: null };
}

// ---- A round ----

function newRound(seated: readonly PlayerId[], picker: PlayerId, no: number, now: number): Round {
  const i = seated.indexOf(picker);
  return {
    no,
    picker,
    order: [...seated.slice(i), ...seated.slice(0, i)],
    stage: 'card',
    word: null,
    conspirator: null,
    plays: [],
    turn: picker,
    explained: [],
    votes: {},
    autoVotes: [],
    skipped: [],
    since: now,
    result: null,
  };
}

/** The game, if one is being played and `by` is in it. */
function playing(state: RedHerringState, by: PlayerId): Game | GameError {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return err('not-playing', 'No game in progress.');
  if (!g.players.includes(by)) return err('watching', 'You’re watching this game.');
  return g;
}

function draw(g: Game, id: PlayerId) {
  const card = g.deck.shift();
  if (card !== undefined) g.hands[id]!.push(card);
}

/** Puts `card` from `by`'s hand on the table and moves the round on. Mutates `g`. */
function playCard(s: RedHerringState, g: Game, by: PlayerId, card: number, auto: boolean) {
  const r = g.round;
  const hand = g.hands[by]!;
  hand.splice(hand.indexOf(card), 1);
  const lap = r.plays.filter((p) => p.by === by).length === 0 ? 1 : 2;
  r.plays.push({ by, card, lap, ...(auto && { auto: true }) });
  draw(g, by);
  if (r.stage === 'card') {
    r.stage = 'word';
    return;
  }
  const next = playOrder(r)[r.plays.length];
  if (next !== undefined) {
    r.turn = next;
    return;
  }
  // Everyone has two cards out.
  if (s.settings.noDiscussion) startVote(s, r);
  else {
    r.stage = 'explain';
    r.turn = r.order[0]!;
  }
}

function startVote(s: RedHerringState, r: Round) {
  r.stage = 'vote';
  r.turn = s.settings.openVote ? votersOf(r)[0]! : null;
}

function play(s: RedHerringState, by: PlayerId, card: number, now: number): GameError | null {
  const g = s.game!;
  const r = g.round;
  if (r.stage !== 'card' && r.stage !== 'play')
    return err('wrong-stage', 'Cards aren’t being played now.');
  if (r.turn !== by)
    return err(
      'not-your-turn',
      r.stage === 'card' ? 'The word-picker plays first.' : 'Wait for your turn.',
    );
  if (!g.hands[by]!.includes(card)) return err('not-in-hand', 'That card isn’t in your hand.');
  playCard(s, g, by, card, false);
  r.since = now;
  return null;
}

/** The Conspirator: anyone at the table but the word-picker and players who left. */
function dealConspirator(s: RedHerringState, g: Game, rng: Rng): PlayerId {
  const r = g.round;
  if (testDeal) return r.order[testDeal % r.order.length || 1]!;
  const here = r.order.slice(1).filter((id) => g.left[id] === undefined);
  let pool = here.length ? here : r.order.slice(1);
  if (s.settings.balanced) {
    const fewest = Math.min(...pool.map((id) => g.conspired[id] ?? 0));
    pool = pool.filter((id) => (g.conspired[id] ?? 0) === fewest);
  }
  return pool[rng.int(pool.length)]!;
}

/** The word as typed: trimmed, inner spaces folded. */
export const cleanWord = (word: string) => word.trim().replace(/\s+/g, ' ');

function writeWord(s: RedHerringState, by: PlayerId, raw: string, ctx: Ctx): GameError | null {
  const g = s.game!;
  const r = g.round;
  if (r.stage !== 'word')
    return err(
      'wrong-stage',
      r.stage === 'card' ? 'Play your first card first.' : 'The word is written.',
    );
  if (r.picker !== by) return err('not-picker', 'Only the word-picker writes the word.');
  const word = cleanWord(raw);
  if (!word) return err('no-word', 'Write a word first.');
  if (word.length > MAX_WORD) return err('word-long', `Keep it to ${MAX_WORD} characters.`);
  r.word = word;
  r.conspirator = dealConspirator(s, g, ctx.rng);
  g.conspired[r.conspirator] = (g.conspired[r.conspirator] ?? 0) + 1;
  r.stage = 'play';
  r.turn = r.order[1]!;
  r.since = ctx.now;
  return null;
}

/** The explainer is done (or the host, a timer or their leaving ends it). */
function finishExplaining(r: Round, skipped: boolean, now: number) {
  const who = r.turn!;
  r.explained.push(who);
  if (skipped) r.skipped.push(who);
  const next = r.order[r.explained.length];
  r.since = now;
  if (next !== undefined) {
    r.turn = next;
    return;
  }
  r.stage = 'discuss';
  r.turn = null;
}

function done(s: RedHerringState, ctx: Ctx): GameError | null {
  const r = s.game!.round;
  if (r.stage !== 'explain') return err('wrong-stage', 'Nobody is explaining now.');
  if (r.turn !== ctx.by && !ctx.isHost)
    return err('not-your-turn', 'It isn’t your turn to explain.');
  finishExplaining(r, r.turn !== ctx.by, ctx.now);
  return null;
}

function endDiscussion(s: RedHerringState, now: number) {
  const r = s.game!.round;
  startVote(s, r);
  r.since = now;
}

/** Points for the round, by the room's scoring. */
export function scoreRound(
  r: Pick<Round, 'picker' | 'conspirator' | 'votes'>,
  scoring: Settings['scoring'],
): RoundResult {
  const conspirator = r.conspirator!;
  const votes = { ...r.votes };
  const finders = Object.keys(votes).filter((v) => votes[v] === conspirator && v !== conspirator);
  const against = finders.length;
  const caught = against >= CATCH_VOTES;
  const points: Record<PlayerId, number> = {};
  if (scoring !== 'fun') {
    if (scoring === 'rulebook' || caught) for (const f of finders) points[f] = POINTS.detective;
    if (!caught) {
      points[conspirator] = POINTS.conspirator;
      points[r.picker] = POINTS.picker;
    }
  }
  return { conspirator, against, caught, points, votes };
}

function reveal(s: RedHerringState, g: Game, now: number) {
  const r = g.round;
  const result = scoreRound(r, s.settings.scoring);
  r.result = result;
  r.stage = 'reveal';
  r.turn = null;
  r.since = now;
  for (const [id, n] of Object.entries(result.points)) g.tokens[id]?.push(n);
  g.history.push({ ...result, no: r.no, picker: r.picker, word: r.word ?? '' });
}

function castVote(
  s: RedHerringState,
  voter: PlayerId,
  target: PlayerId,
  auto: boolean,
  now: number,
) {
  const g = s.game!;
  const r = g.round;
  r.votes[voter] = target;
  if (auto) r.autoVotes.push(voter);
  const voters = votersOf(r);
  if (voters.every((v) => r.votes[v] !== undefined)) {
    reveal(s, g, now);
    return;
  }
  if (s.settings.openVote) {
    r.turn = voters.find((v) => r.votes[v] === undefined) ?? null;
    r.since = now;
  }
}

function vote(s: RedHerringState, by: PlayerId, target: PlayerId, now: number): GameError | null {
  const r = s.game!.round;
  if (r.stage !== 'vote') return err('wrong-stage', 'It isn’t time to vote.');
  if (by === r.picker) return err('picker', 'The word-picker doesn’t vote.');
  if (r.votes[by] !== undefined) return err('voted', 'You have voted.');
  if (s.settings.openVote && r.turn !== by)
    return err('not-your-turn', 'Wait for your turn to vote.');
  if (target === by) return err('self', 'You can’t accuse yourself.');
  if (target === r.picker) return err('picker-target', 'The word-picker can’t be the Conspirator.');
  if (!r.order.includes(target)) return err('not-player', 'That player isn’t at the table.');
  castVote(s, by, target, false, now);
  return null;
}

/** Ends the game: most points; a tie goes to more scoring rounds, then is shared. */
function endGame(s: RedHerringState, reason: RedHerringState['endReason']) {
  const g = s.game!;
  s.phase = 'over';
  s.endReason = reason;
  if (s.settings.scoring === 'fun') {
    s.winners = [];
    return;
  }
  const rank = (id: PlayerId) => [total(g.tokens[id]), g.tokens[id]?.length ?? 0] as const;
  let best: readonly [number, number] = [-1, -1];
  let winners: PlayerId[] = [];
  for (const id of g.players) {
    const [p, t] = rank(id);
    if (p > best[0] || (p === best[0] && t > best[1])) {
      best = [p, t];
      winners = [id];
    } else if (p === best[0] && t === best[1]) winners.push(id);
  }
  s.winners = best[0] > 0 ? winners : [];
}

/** The next round, or the end. Mutates `s`. */
function advance(s: RedHerringState, now: number) {
  const g = s.game!;
  // A word-picker who left gives up their turn: the game is that much shorter.
  while (g.pickers.length && g.left[g.pickers[0]!] !== undefined) {
    g.pickers.shift();
    g.rounds--;
  }
  if (present(g).length < MIN_PLAYERS) return endGame(s, 'too-few');
  const picker = g.pickers.shift();
  if (picker === undefined) return endGame(s, 'rounds');
  g.round = newRound(g.players, picker, g.round.no + 1, now);
}

function nextRound(s: RedHerringState, ctx: Ctx): GameError | null {
  const e = requireHost(ctx);
  if (e) return e;
  if (s.game!.round.stage !== 'reveal') return err('wrong-stage', 'Finish this round first.');
  advance(s, ctx.now);
  return null;
}

/** The safe move for `id`, if the table is waiting on them. */
function autoMove(s: RedHerringState, id: PlayerId, rng: Rng, now: number): boolean {
  const g = s.game!;
  const r = g.round;
  switch (r.stage) {
    case 'card':
    case 'play': {
      if (r.turn !== id) return false;
      const hand = g.hands[id]!;
      if (!hand.length) return false;
      playCard(s, g, id, hand[rng.int(hand.length)]!, true);
      r.since = now;
      return true;
    }
    case 'explain':
      if (r.turn !== id) return false;
      finishExplaining(r, true, now);
      return true;
    case 'vote': {
      if (r.votes[id] !== undefined || !votersOf(r).includes(id)) return false;
      if (s.settings.openVote && r.turn !== id) return false;
      const options = candidatesFor(r, id);
      castVote(s, id, options[rng.int(options.length)]!, true, now);
      return true;
    }
    default:
      return false;
  }
}

function actFor(s: RedHerringState, id: PlayerId, ctx: Ctx): GameError | null {
  const e = requireHost(ctx);
  if (e) return e;
  return autoMove(s, id, ctx.rng, ctx.now)
    ? null
    : err('not-waiting', 'The table isn’t waiting on that player for a move the app can make.');
}

/** A word-picker who leaves before writing the word: the round is dropped. Mutates `s`. */
function dropRound(s: RedHerringState, now: number) {
  const g = s.game!;
  const r = g.round;
  g.rounds--;
  // The first card (if any) leaves the table with the round.
  advance(s, now);
  if (s.phase === 'playing') g.round.no = r.no;
}

function markLeft(s: RedHerringState, id: PlayerId, now: number) {
  const g = s.game!;
  if (g.left[id] !== undefined) return;
  g.left[id] = now;
  const r = g.round;
  if (r.picker === id && (r.stage === 'card' || r.stage === 'word')) dropRound(s, now);
}

function remove(s: RedHerringState, id: PlayerId, ctx: Ctx): GameError | null {
  const e = requireHost(ctx);
  if (e) return e;
  const g = s.game!;
  if (!g.players.includes(id)) return err('not-player', 'That player isn’t in the game.');
  if (g.left[id] !== undefined) return err('gone', 'That player has already left.');
  if (ctx.connected?.(id) !== false)
    return err('not-away', 'Only a player who has dropped out can be taken out of play.');
  markLeft(s, id, ctx.now);
  return null;
}

/** Runs a change on a copy of the game in play. */
function inPlay(
  state: RedHerringState,
  ctx: Ctx,
  change: (s: RedHerringState) => GameError | null,
): Result {
  const g = playing(state, ctx.by);
  if (g instanceof GameError && !(ctx.isHost && state.phase === 'playing' && state.game)) return g;
  const s = draft(state);
  const e = change(s);
  return e ?? s;
}

function reduce(state: RedHerringState, action: RedHerringAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'start':
      return start(state, ctx);
    case 'play-again':
      if (state.phase !== 'over') return err('wrong-stage', 'The game isn’t over.');
      return start(state, ctx);
    case 'back-to-lobby':
      return backToLobby(state, ctx);
    case 'play':
      return inPlay(state, ctx, (s) => {
        const g = playing(s, ctx.by);
        return g instanceof GameError ? g : play(s, ctx.by, action.card, ctx.now);
      });
    case 'word':
      return inPlay(state, ctx, (s) => writeWord(s, ctx.by, action.word, ctx));
    case 'done':
      return inPlay(state, ctx, (s) => done(s, ctx));
    case 'end-discussion':
      return inPlay(state, ctx, (s) => {
        const e = requireHost(ctx);
        if (e) return e;
        if (s.game!.round.stage !== 'discuss')
          return err('wrong-stage', 'Nobody is discussing now.');
        endDiscussion(s, ctx.now);
        return null;
      });
    case 'vote':
      return inPlay(state, ctx, (s) => {
        const g = playing(s, ctx.by);
        return g instanceof GameError ? g : vote(s, ctx.by, action.player, ctx.now);
      });
    case 'next-round':
      return inPlay(state, ctx, (s) => nextRound(s, ctx));
    case 'act-for':
      return inPlay(state, ctx, (s) => actFor(s, action.player, ctx));
    case 'remove':
      return inPlay(state, ctx, (s) => remove(s, action.player, ctx));
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): RedHerringState {
  let state: RedHerringState = {
    phase: 'lobby',
    settings: structuredClone(DEFAULT_SETTINGS),
    seed: newSeed(ctx.rng),
    seats: {},
    game: null,
    winners: [],
    endReason: null,
    gamesPlayed: 0,
  };
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: RedHerringState, player: PlayerInfo): RedHerringState {
  const existing = state.seats[player.id];
  if (existing) {
    const s = draft(state);
    s.seats[player.id] = {
      ...existing,
      name: player.name,
      color: player.color ?? existing.color,
    };
    const g = s.game;
    if (g?.players.includes(player.id)) {
      g.names[player.id] = player.name;
      if (s.phase === 'playing') delete g.left[player.id];
    }
    return s;
  }
  // Between games newcomers sit straight down (if there's room); mid-game they watch.
  const seat: Seat = {
    name: player.name,
    color: player.color ?? nextColor(state),
    playing: state.phase !== 'playing' && players(state).length < MAX_PLAYERS,
  };
  return { ...state, seats: { ...state.seats, [player.id]: seat } };
}

/**
 * Someone left for good. Between games their seat goes; mid-game they stay at the table, away:
 * the table makes their moves after a short beat, and their own turn to pick the word is skipped.
 */
function playerLeft(state: RedHerringState, id: PlayerId, now: number): RedHerringState {
  if (!state.seats[id]) return state;
  const s = draft(state);
  if (s.phase === 'playing' && s.game?.players.includes(id)) {
    markLeft(s, id, now);
    return s;
  }
  delete s.seats[id];
  return s;
}

// ---- Timers ----

type Due = { at: number; why: 'left' | 'timer'; who: PlayerId | null };

/** Who the table is waiting on now. */
export function waitingOn(r: Pick<Round, 'stage' | 'turn' | 'order' | 'votes'>): PlayerId[] {
  switch (r.stage) {
    case 'card':
    case 'word':
    case 'play':
    case 'explain':
      return r.turn ? [r.turn] : [];
    case 'vote':
      return r.turn ? [r.turn] : votersOf(r).filter((v) => r.votes[v] === undefined);
    default:
      return [];
  }
}

function deadlines(state: RedHerringState): Due[] {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return [];
  const r = g.round;
  const out: Due[] = [];
  for (const id of waitingOn(r)) {
    const gone = g.left[id];
    if (gone !== undefined && r.stage !== 'word')
      out.push({ at: Math.max(r.since, gone) + LEFT_BEAT_MS, why: 'left', who: id });
  }
  // The word can't be written for anyone, so its timer is only ever a reminder.
  const at = deadlineOf(state.settings, r);
  if (
    at !== null &&
    state.settings.timerMode === 'strict' &&
    r.stage !== 'word' &&
    r.stage !== 'reveal'
  )
    out.push({ at, why: 'timer', who: null });
  return out.sort((a, b) => a.at - b.at);
}

function nextDeadline(state: RedHerringState): number | null {
  return deadlines(state)[0]?.at ?? null;
}

function onDeadline(state: RedHerringState, now: number): RedHerringState {
  const due = deadlines(state)[0];
  if (!due || now < due.at) return state;
  const s = draft(state);
  const g = s.game!;
  const r = g.round;
  const rng = hiddenRng(state, now);
  if (due.who) autoMove(s, due.who, rng, now);
  else if (r.stage === 'discuss') endDiscussion(s, now);
  else if (r.stage === 'vote' && !s.settings.openVote) {
    for (const id of waitingOn(r)) if (g.round.stage === 'vote') autoMove(s, id, rng, now);
  } else {
    const who = waitingOn(r)[0];
    if (!who || !autoMove(s, who, rng, now)) r.since = now;
  }
  s.seed = newSeed(rng);
  return s;
}

// ---- Views ----

/** Whether the word has been said out loud to the whole table. */
const wordIsOut = (r: Round, settings: Settings) =>
  r.stage === 'explain' ||
  r.stage === 'discuss' ||
  r.stage === 'reveal' ||
  (r.stage === 'vote' && !settings.noDiscussion);

const copyResult = (r: RoundResult): RoundResult => ({
  conspirator: r.conspirator,
  against: r.against,
  caught: r.caught,
  points: { ...r.points },
  votes: { ...r.votes },
});

function roundView(state: RedHerringState, g: Game, viewer: PlayerId | null): RoundView {
  const r = g.round;
  const over = state.phase === 'over';
  const atTable = viewer !== null && r.order.includes(viewer);
  const sees = over || wordIsOut(r, state.settings) || (viewer === r.picker && r.word !== null);
  const open = state.settings.openVote || r.stage === 'reveal' || over;
  return {
    no: r.no,
    picker: r.picker,
    order: [...r.order],
    stage: r.stage,
    word: sees ? r.word : null,
    notebook:
      atTable && viewer !== r.picker && r.word !== null
        ? { word: viewer === r.conspirator ? null : r.word }
        : null,
    plays: r.plays.map((p) => ({ ...p })),
    turn: r.turn,
    explained: [...r.explained],
    skipped: [...r.skipped],
    voted: votersOf(r).filter((v) => r.votes[v] !== undefined),
    myVote: viewer === null ? null : (r.votes[viewer] ?? null),
    votes: open ? { ...r.votes } : null,
    autoVotes: [...r.autoVotes],
    since: r.since,
    deadline: state.phase === 'playing' ? deadlineOf(state.settings, r) : null,
    result: r.result ? copyResult(r.result) : null,
  };
}

function view(state: RedHerringState, viewer: PlayerId | null): RedHerringView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    color: s.color,
    playing: s.playing,
  }));
  const g = state.game;
  return {
    phase: state.phase,
    settings: { ...state.settings, decks: { ...state.settings.decks } },
    seats,
    me: viewer === null ? null : (seats.find((s) => s.id === viewer) ?? null),
    game: g
      ? {
          players: g.players.map((id) => ({
            id,
            name: state.seats[id]?.name ?? g.names[id] ?? 'Gone',
            left: g.left[id] !== undefined || !state.seats[id],
            score: total(g.tokens[id]),
            tokens: g.tokens[id]?.length ?? 0,
            hand: g.hands[id]?.length ?? 0,
          })),
          rounds: g.rounds,
          hand: viewer !== null && g.hands[viewer] ? [...g.hands[viewer]] : [],
          deck: g.deck.length,
          round: roundView(state, g, viewer),
          history: g.history.map((h) => ({
            ...copyResult(h),
            no: h.no,
            picker: h.picker,
            word: h.word,
          })),
        }
      : null,
    winners: [...state.winners],
    endReason: state.endReason,
  };
}

export const redHerring: GameDefinition<RedHerringState, RedHerringAction, RedHerringView> = {
  id: 'red-herring',
  name: 'Red Herring',
  description:
    'Everyone gets the secret word but one: play picture cards that fit it, explain them, and find the player bluffing blind.',
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
  awards: redHerringAwards,
  bot: redHerringBot,
};
