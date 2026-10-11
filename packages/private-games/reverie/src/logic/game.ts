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
import { guide } from './guide.ts';
import { reverieAwards } from './awards.ts';
import { insights } from './insights.ts';
import {
  CARD_SETS,
  type EndReason,
  HAND_SIZE,
  HAND_SIZE_THREE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type ReverieAction,
  type ReverieState,
  type ReverieView,
  SEAT_COLORS,
  type Seat,
  type SeatView,
  type Turn,
  type TurnResult,
  actionSchema,
  cardsIn,
} from './types.ts';

type Ctx = ActionCtx;
type Result = ReverieState | GameError;

const deadline = (seconds: number | null, now: number) =>
  seconds === null ? null : now + seconds * 1000;

export function players(state: ReverieState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

export const handSize = (state: ReverieState) =>
  players(state).length === 3 ? HAND_SIZE_THREE : HAND_SIZE;

/** Cards each non-storyteller gives: two with three players, so the table still has five. */
export const cardsToGive = (playerCount: number) => (playerCount === 3 ? 2 : 1);

const others = (state: ReverieState) =>
  players(state).filter((id) => id !== state.turn?.storyteller);

/** The lowest unused seat colour, so players keep their colour when someone leaves. */
function nextColor(state: ReverieState) {
  const used = new Set(Object.values(state.seats).map((s) => s.color));
  return SEAT_COLORS.find((c) => !used.has(c)) ?? SEAT_COLORS[0];
}

/**
 * The first playing seat after `from` in seating order, going round the table. If `from` has no
 * seat any more the search starts from the first seat.
 */
function playingAfter(state: ReverieState, from: PlayerId): PlayerId | undefined {
  const ids = Object.keys(state.seats);
  const idx = ids.indexOf(from);
  const order = idx < 0 ? ids : [...ids.slice(idx + 1), ...ids.slice(0, idx)];
  return order.find((id) => id !== from && state.seats[id]!.playing);
}

/** Who tells next: the player noted when the turn began, or the next one still playing. */
function nextStorytellerOf(state: ReverieState, turn: Turn): PlayerId {
  if (state.seats[turn.nextStoryteller]?.playing) return turn.nextStoryteller;
  return playingAfter(state, turn.nextStoryteller) ?? turn.storyteller;
}

/**
 * Randomness for moments that come without an rng (leavers, deadlines). Mixing in the hidden seed
 * means the public clock alone can't reproduce the shuffle.
 */
const hiddenRng = (state: ReverieState, now: number) => createRng((state.seed ^ now) >>> 0);

const newSeed = (rng: Rng) => rng.int(2 ** 32);

// ---- Deck ----

/** Draws `n` cards, shuffling the discards back in when the pile runs short. */
function draw(
  state: ReverieState,
  n: number,
  rng: Rng,
): { cards: number[]; state: ReverieState; reshuffled: boolean } {
  let pile = [...state.draw];
  let discard = [...state.discard];
  const cards: number[] = [];
  let reshuffled = false;
  while (cards.length < n) {
    if (pile.length === 0) {
      if (discard.length === 0) break;
      pile = rng.shuffle(discard);
      discard = [];
      reshuffled = true;
    }
    cards.push(pile.shift()!);
  }
  return { cards, state: { ...state, draw: pile, discard }, reshuffled };
}

/** Tops every player up to a full hand; says whether the discards had to be shuffled back in. */
function refill(state: ReverieState, rng: Rng): { state: ReverieState; reshuffled: boolean } {
  let next = state;
  let reshuffled = false;
  const size = handSize(state);
  for (const id of players(state)) {
    const seat = next.seats[id]!;
    if (seat.hand.length >= size) continue;
    const drawn = draw(next, size - seat.hand.length, rng);
    reshuffled ||= drawn.reshuffled;
    next = {
      ...drawn.state,
      seats: { ...drawn.state.seats, [id]: { ...seat, hand: [...seat.hand, ...drawn.cards] } },
    };
  }
  return { state: next, reshuffled };
}

/** Every card in the game, wherever it is. */
function cardsInPlay(state: ReverieState) {
  return (
    state.draw.length +
    state.discard.length +
    Object.values(state.seats).reduce((n, s) => n + s.hand.length, 0) +
    (state.turn?.table.length ?? 0)
  );
}

// ---- Turn flow ----

function beginTurn(
  state: ReverieState,
  storyteller: PlayerId,
  round: number,
  now: number,
  rng: Rng,
  skipped: PlayerId | null = null,
  reshuffled = false,
): ReverieState {
  const turn: Turn = {
    round,
    storyteller,
    nextStoryteller: playingAfter(state, storyteller) ?? storyteller,
    phase: 'clue',
    give: cardsToGive(players(state).length),
    clue: null,
    storyCard: null,
    submissions: {},
    table: [],
    votes: {},
    deadline: deadline(state.settings.clueSeconds, now),
    results: null,
    allOrNone: null,
    skipped,
    autoGiven: [],
    missedVote: [],
    ...(reshuffled ? { reshuffled } : {}),
  };
  return { ...state, seed: newSeed(rng), turn };
}

/** Shuffles whatever was given onto the table, face up, and opens the vote. */
function layTable(state: ReverieState, rng: Rng, now: number): ReverieState {
  const turn = state.turn!;
  const cards = [
    { card: turn.storyCard!, owner: turn.storyteller },
    ...others(state).flatMap((id) =>
      (turn.submissions[id] ?? []).map((card) => ({ card, owner: id })),
    ),
  ];
  return {
    ...state,
    turn: {
      ...turn,
      phase: 'vote',
      table: rng.shuffle(cards),
      deadline: deadline(state.settings.guessSeconds, now),
    },
  };
}

/** Lays the table once every other player has given their cards. */
function maybeStartVoting(state: ReverieState, rng: Rng, now: number): ReverieState {
  const turn = state.turn;
  if (!turn || turn.phase !== 'pick') return state;
  if (!others(state).every((id) => id in turn.submissions)) return state;
  return layTable(state, rng, now);
}

/** Scores the turn once every other player has voted. */
function maybeReveal(state: ReverieState): ReverieState {
  const turn = state.turn;
  if (!turn || turn.phase !== 'vote') return state;
  if (!others(state).every((id) => id in turn.votes)) return state;
  return reveal(state);
}

/**
 * The scoring rules: if everyone or nobody found the storyteller's card, the storyteller scores
 * nothing and each voter 2; otherwise the storyteller and each finder score 3. Everyone but the
 * storyteller also scores 1 for every vote their own card attracted. Someone who didn't vote (a
 * strict timer ran out) counts as not having found the card and only gets that bonus, so a lone
 * finder among absentees still earns the storyteller 3; if nobody voted at all nobody gets the 2.
 */
export function reveal(state: ReverieState): ReverieState {
  const turn = state.turn!;
  const guessers = others(state);
  const voters = guessers.filter((id) => id in turn.votes);
  const storyIndex = turn.table.findIndex((t) => t.owner === turn.storyteller);
  const finders = voters.filter((id) => turn.votes[id] === storyIndex);
  const allOrNone = finders.length === 0 || finders.length === guessers.length;
  const results: Record<PlayerId, TurnResult> = {};
  for (const id of players(state)) {
    const isStory = id === turn.storyteller;
    const votesReceived = isStory
      ? finders.length
      : voters.filter((v) => turn.table[turn.votes[v]!]?.owner === id).length;
    const foundIt = !isStory && finders.includes(id);
    const forGuessing = !voters.includes(id) ? 0 : allOrNone ? 2 : foundIt ? 3 : 0;
    const points = isStory ? (allOrNone ? 0 : 3) : forGuessing + votesReceived;
    results[id] = { points, foundIt, votesReceived };
  }
  const seats = { ...state.seats };
  for (const [id, r] of Object.entries(results)) {
    seats[id] = { ...seats[id]!, score: seats[id]!.score + r.points };
  }
  return {
    ...state,
    seats,
    turn: { ...turn, phase: 'reveal', deadline: null, results, allOrNone },
  };
}

/**
 * Ends the game: everyone on the top score wins. Scores are compared among those still playing,
 * or among everyone at the table if nobody is left playing. The turn is left as it is, so a
 * finished reveal stays on screen.
 */
function endGame(state: ReverieState, endReason: EndReason): ReverieState {
  const seated = players(state);
  const pool = seated.length > 0 ? seated : Object.keys(state.seats);
  const top = Math.max(...pool.map((id) => state.seats[id]!.score));
  return {
    ...state,
    phase: 'over',
    winners: pool.filter((id) => state.seats[id]!.score === top),
    endReason,
  };
}

function nextTurn(state: ReverieState, ctx: Ctx): Result {
  if (!ctx.isHost) return new GameError('not-host', 'Only the host can move on.');
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn || turn.phase !== 'reveal') {
    return new GameError('wrong-stage', 'Finish this turn first.');
  }
  const seated = players(state);
  const top = Math.max(...seated.map((id) => state.seats[id]!.score));
  if (top >= state.settings.targetScore) return endGame(state, 'target');
  if (seated.length < MIN_PLAYERS) return endGame(state, 'too-few');
  // Everyone's played cards go to the discard pile, then hands are refilled.
  const { state: next, reshuffled } = refill(
    { ...state, discard: [...state.discard, ...turn.table.map((t) => t.card)] },
    ctx.rng,
  );
  return beginTurn(
    next,
    nextStorytellerOf(next, turn),
    turn.round + 1,
    ctx.now,
    ctx.rng,
    null,
    reshuffled,
  );
}

// ---- Actions ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : new GameError('not-host', 'Only the host can do that.');
}

function seatOf(state: ReverieState, id: PlayerId): Seat | GameError {
  return state.seats[id] ?? new GameError('not-seated', 'You are not in this game.');
}

function updateSettings(
  state: ReverieState,
  action: Extract<ReverieAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing')
    return new GameError('in-progress', 'Settings can only change between games.');
  const settings = { ...state.settings };
  if (action.sets) {
    const known = new Set(CARD_SETS.map((s) => s.id));
    if (action.sets.some((id) => !known.has(id)))
      return new GameError('unknown-set', 'That card set does not exist.');
    settings.sets = [...action.sets];
  }
  if (action.targetScore) settings.targetScore = action.targetScore;
  if (action.clueSeconds !== undefined) settings.clueSeconds = action.clueSeconds;
  if (action.guessSeconds !== undefined) settings.guessSeconds = action.guessSeconds;
  if (action.timerMode !== undefined) settings.timerMode = action.timerMode;
  return { ...state, settings };
}

function sit(state: ReverieState, playing: boolean, ctx: Ctx): Result {
  const seat = seatOf(state, ctx.by);
  if (seat instanceof GameError) return seat;
  if (seat.playing === playing) return state;
  if (state.phase === 'playing' && state.turn?.phase !== 'reveal') {
    return new GameError('in-progress', 'You can sit down or stand up between turns.');
  }
  if (playing && players(state).length >= MAX_PLAYERS) {
    return new GameError('full', `Only ${MAX_PLAYERS} can play at once.`);
  }
  // Mid-game the cards already dealt must stretch to one more full hand.
  if (playing && state.phase === 'playing') {
    if (cardsInPlay(state) < cardsNeeded(players(state).length + 1)) {
      return new GameError('not-enough-cards', 'There are not enough cards left for another hand.');
    }
  }
  // Standing up mid-game: the hand goes to the discard pile.
  const next: ReverieState = {
    ...state,
    seats: { ...state.seats, [ctx.by]: { ...seat, playing, hand: playing ? seat.hand : [] } },
    discard: playing ? state.discard : [...state.discard, ...seat.hand],
  };
  return next;
}

/** How many cards the chosen sets need to hold for a game to start. */
export function cardsNeeded(playerCount: number) {
  return (playerCount === 3 ? HAND_SIZE_THREE : HAND_SIZE) * playerCount + 1;
}

function start(state: ReverieState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') return new GameError('in-progress', 'A game is already running.');
  const seated = players(state);
  if (seated.length < MIN_PLAYERS)
    return new GameError('too-few', `${MIN_PLAYERS} players are needed.`);
  if (seated.length > MAX_PLAYERS)
    return new GameError('too-many', `At most ${MAX_PLAYERS} can play.`);
  const pool = CARD_SETS.filter((s) => state.settings.sets.includes(s.id)).flatMap(cardsIn);
  if (pool.length < cardsNeeded(seated.length)) {
    return new GameError(
      'not-enough-cards',
      'The chosen card sets are too small for this many players.',
    );
  }
  const seats = Object.fromEntries(
    Object.entries(state.seats).map(([id, s]) => [id, { ...s, score: 0, hand: [] }]),
  );
  let next: ReverieState = {
    ...state,
    phase: 'playing',
    seats,
    seed: newSeed(ctx.rng),
    draw: ctx.rng.shuffle(pool),
    discard: [],
    winners: [],
    endReason: null,
    gamesPlayed: state.gamesPlayed + 1,
    departed: {},
  };
  next = refill(next, ctx.rng).state;
  // The storyteller alternates between games; within a game it goes round the table.
  const first = seated[state.gamesPlayed % seated.length]!;
  return beginTurn(next, first, 1, ctx.now, ctx.rng);
}

function backToLobby(state: ReverieState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  const seats = Object.fromEntries(
    Object.entries(state.seats).map(([id, s]) => [id, { ...s, hand: [] }]),
  );
  return {
    ...state,
    phase: 'lobby',
    seats,
    turn: null,
    draw: [],
    discard: [],
    winners: [],
    endReason: null,
  };
}

function tell(state: ReverieState, card: number, clue: string, ctx: Ctx): Result {
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn)
    return new GameError('not-playing', 'No game in progress.');
  if (turn.storyteller !== ctx.by)
    return new GameError('not-storyteller', "You're not the storyteller this turn.");
  if (turn.phase !== 'clue')
    return new GameError('wrong-stage', 'The clue has already been given.');
  const seat = state.seats[ctx.by]!;
  if (!seat.hand.includes(card))
    return new GameError('not-in-hand', "That card isn't in your hand.");
  return {
    ...state,
    seats: { ...state.seats, [ctx.by]: { ...seat, hand: seat.hand.filter((c) => c !== card) } },
    turn: {
      ...turn,
      phase: 'pick',
      clue: clue.trim(),
      storyCard: card,
      deadline: deadline(state.settings.guessSeconds, ctx.now),
    },
  };
}

function give(state: ReverieState, cards: number[], ctx: Ctx): Result {
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn)
    return new GameError('not-playing', 'No game in progress.');
  if (turn.phase !== 'pick') return new GameError('wrong-stage', "It's not time to give a card.");
  if (turn.storyteller === ctx.by)
    return new GameError('storyteller', 'The storyteller has already played a card.');
  const seat = seatOf(state, ctx.by);
  if (seat instanceof GameError) return seat;
  if (!seat.playing) return new GameError('watching', "You're watching this game.");
  if (turn.submissions[ctx.by])
    return new GameError('already-gave', "You've already given your card.");
  const need = turn.give;
  const unique = [...new Set(cards)];
  if (unique.length !== need)
    return new GameError('wrong-count', `Give ${need} card${need === 1 ? '' : 's'}.`);
  if (unique.some((c) => !seat.hand.includes(c)))
    return new GameError('not-in-hand', "That card isn't in your hand.");
  const next: ReverieState = {
    ...state,
    seats: {
      ...state.seats,
      [ctx.by]: { ...seat, hand: seat.hand.filter((c) => !unique.includes(c)) },
    },
    turn: { ...turn, submissions: { ...turn.submissions, [ctx.by]: unique } },
  };
  return maybeStartVoting(next, ctx.rng, ctx.now);
}

function vote(state: ReverieState, index: number, ctx: Ctx): Result {
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn)
    return new GameError('not-playing', 'No game in progress.');
  if (turn.phase !== 'vote') return new GameError('wrong-stage', "It's not time to vote.");
  if (turn.storyteller === ctx.by)
    return new GameError('storyteller', "The storyteller doesn't vote.");
  const seat = seatOf(state, ctx.by);
  if (seat instanceof GameError) return seat;
  if (!seat.playing) return new GameError('watching', "You're watching this game.");
  const target = turn.table[index];
  if (!target) return new GameError('bad-card', 'No such card on the table.');
  if (target.owner === ctx.by)
    return new GameError('own-card', "You can't vote for your own card.");
  return maybeReveal({ ...state, turn: { ...turn, votes: { ...turn.votes, [ctx.by]: index } } });
}

function reduce(state: ReverieState, action: ReverieAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'start':
      return start(state, ctx);
    case 'back-to-lobby':
      return backToLobby(state, ctx);
    case 'tell':
      return tell(state, action.card, action.clue, ctx);
    case 'give':
      return give(state, action.cards, ctx);
    case 'vote':
      return vote(state, action.index, ctx);
    case 'next-turn':
      return nextTurn(state, ctx);
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): ReverieState {
  let state: ReverieState = {
    phase: 'lobby',
    settings: {
      sets: ['base'],
      targetScore: 30,
      clueSeconds: null,
      guessSeconds: null,
      timerMode: 'soft',
    },
    seed: newSeed(ctx.rng),
    seats: {},
    draw: [],
    discard: [],
    turn: null,
    winners: [],
    endReason: null,
    gamesPlayed: 0,
  };
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: ReverieState, player: PlayerInfo): ReverieState {
  const existing = state.seats[player.id];
  if (existing)
    return { ...state, seats: { ...state.seats, [player.id]: { ...existing, name: player.name } } };
  // Between games newcomers take a seat straight away (if there is one); mid-game they watch
  // until they sit down between turns, and then get cards at the next turn.
  const playing = state.phase !== 'playing' && players(state).length < MAX_PLAYERS;
  // Someone coming back to the game they left picks up their score again.
  const kept = state.departed?.[player.id];
  const score = state.phase === 'lobby' ? 0 : (kept ?? 0);
  const seat: Seat = { name: player.name, color: nextColor(state), playing, score, hand: [] };
  const next: ReverieState = { ...state, seats: { ...state.seats, [player.id]: seat } };
  if (kept === undefined) return next;
  const departed = { ...state.departed };
  delete departed[player.id];
  return { ...next, departed };
}

function playerLeft(state: ReverieState, playerId: PlayerId, now: number): ReverieState {
  const seat = state.seats[playerId];
  if (!seat) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  let turn = state.turn;
  // Keep the rotation on track when the player due to tell next is the one leaving.
  if (state.phase === 'playing' && turn && turn.nextStoryteller === playerId) {
    turn = { ...turn, nextStoryteller: playingAfter(state, playerId) ?? turn.storyteller };
  }
  // Remember the score, so a player who comes back during this game picks it up again.
  const departed =
    state.phase === 'lobby' ? state.departed : { ...state.departed, [playerId]: seat.score };
  let next: ReverieState = {
    ...state,
    seats,
    turn,
    departed,
    discard: [...state.discard, ...seat.hand],
  };
  // During the reveal the table and votes are already scored and stay as they are: the host's
  // Next turn discards the table, story card included.
  if (next.phase !== 'playing' || !turn || !seat.playing || turn.phase === 'reveal') return next;
  const rng = hiddenRng(state, now);

  if (turn.storyteller === playerId) {
    // The storyteller left: give everyone their cards back and start over with the next player.
    for (const [id, cards] of Object.entries(turn.submissions)) {
      const seat = next.seats[id];
      if (seat) next.seats[id] = { ...seat, hand: [...seat.hand, ...cards] };
    }
    if (turn.storyCard !== null) next.discard = [...next.discard, turn.storyCard];
    if (players(next).length < MIN_PLAYERS) return endGame({ ...next, turn: null }, 'too-few');
    return beginTurn(next, nextStorytellerOf(next, turn), turn.round, now, rng);
  }

  // Someone else left: drop their card(s) and vote, then see whether the phase can move on.
  const submissions = { ...turn.submissions };
  const given = submissions[playerId] ?? [];
  delete submissions[playerId];
  const votes = { ...turn.votes };
  delete votes[playerId];
  const table = turn.table.filter((t) => t.owner !== playerId);
  const removed = new Set(
    turn.table.map((t, i) => (t.owner === playerId ? i : -1)).filter((i) => i >= 0),
  );
  // Table indices shift when a card is pulled; remap votes and drop any that pointed at it.
  for (const [id, index] of Object.entries(votes)) {
    if (removed.has(index)) delete votes[id];
    else votes[id] = index - [...removed].filter((r) => r < index).length;
  }
  next = {
    ...next,
    discard: [...next.discard, ...given],
    turn: { ...turn, submissions, votes, table },
  };
  if (players(next).length < MIN_PLAYERS) return endGame({ ...next, turn: null }, 'too-few');
  return maybeReveal(maybeStartVoting(next, rng, now));
}

// ---- Timers ----

function nextDeadline(state: ReverieState): number | null {
  if (state.phase !== 'playing' || state.settings.timerMode !== 'strict') return null;
  return state.turn?.deadline ?? null;
}

/** Always moves the turn on (or clears the deadline), so the room host never re-arms a 0 ms timer. */
function onDeadline(state: ReverieState, now: number): ReverieState {
  const due = nextDeadline(state);
  const turn = state.turn;
  if (due === null || now < due || !turn) return state;
  const rng = hiddenRng(state, now);
  if (turn.phase === 'clue') {
    // A storyteller who ran out of time is skipped, and the new turn says so.
    return beginTurn(state, nextStorytellerOf(state, turn), turn.round, now, rng, turn.storyteller);
  }
  if (turn.phase === 'pick') {
    // Whoever hasn't given a card gives the first card(s) of their hand, then the table is laid.
    let next = state;
    const autoGiven: PlayerId[] = [];
    for (const id of others(state)) {
      if (id in next.turn!.submissions) continue;
      autoGiven.push(id);
      const seat = next.seats[id]!;
      next = {
        ...next,
        seats: { ...next.seats, [id]: { ...seat, hand: seat.hand.slice(turn.give) } },
        turn: {
          ...next.turn!,
          submissions: { ...next.turn!.submissions, [id]: seat.hand.slice(0, turn.give) },
        },
      };
    }
    return layTable({ ...next, turn: { ...next.turn!, autoGiven } }, rng, now);
  }
  if (turn.phase === 'vote') {
    const missedVote = others(state).filter((id) => !(id in turn.votes));
    return reveal({ ...state, turn: { ...turn, missedVote } });
  }
  return { ...state, turn: { ...turn, deadline: null } };
}

// ---- Views ----

function view(state: ReverieState, viewer: PlayerId | null): ReverieView {
  const turn = state.turn;
  const seatViews: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    color: s.color,
    playing: s.playing,
    score: s.score,
    done:
      !!turn &&
      (turn.phase === 'pick'
        ? id === turn.storyteller || id in turn.submissions
        : turn.phase === 'vote'
          ? id === turn.storyteller || id in turn.votes
          : turn.phase === 'reveal'),
  }));
  const me = viewer === null ? null : (seatViews.find((s) => s.id === viewer) ?? null);
  const revealed = turn?.phase === 'reveal';
  return {
    phase: state.phase,
    settings: state.settings,
    seats: seatViews,
    me,
    hand: viewer === null ? [] : [...(state.seats[viewer]?.hand ?? [])],
    cardsToGive: turn?.give ?? cardsToGive(players(state).length),
    drawPile: state.draw.length,
    turn: turn
      ? {
          round: turn.round,
          storyteller: turn.storyteller,
          phase: turn.phase,
          clue: turn.clue,
          myStoryCard: viewer === turn.storyteller ? turn.storyCard : null,
          myCards: viewer === null ? [] : [...(turn.submissions[viewer] ?? [])],
          myVote: viewer === null ? null : (turn.votes[viewer] ?? null),
          table: turn.table.map((t, i) => ({
            card: t.card,
            owner: revealed ? t.owner : null,
            voters: revealed
              ? Object.entries(turn.votes)
                  .filter(([, index]) => index === i)
                  .map(([id]) => id)
              : [],
            isStory: revealed && t.owner === turn.storyteller,
            mine: viewer !== null && t.owner === viewer,
          })),
          results: turn.results,
          allOrNone: turn.allOrNone,
          deadline: turn.deadline,
          skipped: turn.skipped ?? null,
          autoGiven: [...(turn.autoGiven ?? [])],
          missedVote: [...(turn.missedVote ?? [])],
          nextStoryteller: nextStorytellerOf(state, turn),
          reshuffled: !!turn.reshuffled,
        }
      : null,
    winners: state.winners,
    endReason: state.endReason,
  };
}

export const reverie: GameDefinition<ReverieState, ReverieAction, ReverieView> = {
  id: 'reverie',
  name: 'Reverie',
  description: 'Give a dreamy clue for one of your picture cards; let some, but not all, find it.',
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
  awards: reverieAwards,
};
