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
import {
  CARD_SETS,
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
export const cardsToGive = (state: ReverieState) => (players(state).length === 3 ? 2 : 1);

const others = (state: ReverieState) =>
  players(state).filter((id) => id !== state.turn?.storyteller);

/** The lowest unused seat colour, so players keep their colour when someone leaves. */
function nextColor(state: ReverieState) {
  const used = new Set(Object.values(state.seats).map((s) => s.color));
  return SEAT_COLORS.find((c) => !used.has(c)) ?? SEAT_COLORS[0];
}

// ---- Deck ----

/** Draws `n` cards, shuffling the discards back in when the pile runs short. */
function draw(state: ReverieState, n: number, rng: Rng): { cards: number[]; state: ReverieState } {
  let pile = [...state.draw];
  let discard = [...state.discard];
  const cards: number[] = [];
  while (cards.length < n) {
    if (pile.length === 0) {
      if (discard.length === 0) break;
      pile = rng.shuffle(discard);
      discard = [];
    }
    cards.push(pile.shift()!);
  }
  return { cards, state: { ...state, draw: pile, discard } };
}

/** Tops every player up to a full hand. */
function refill(state: ReverieState, rng: Rng): ReverieState {
  let next = state;
  const size = handSize(state);
  for (const id of players(state)) {
    const seat = next.seats[id]!;
    if (seat.hand.length >= size) continue;
    const drawn = draw(next, size - seat.hand.length, rng);
    next = {
      ...drawn.state,
      seats: { ...drawn.state.seats, [id]: { ...seat, hand: [...seat.hand, ...drawn.cards] } },
    };
  }
  return next;
}

// ---- Turn flow ----

function beginTurn(
  state: ReverieState,
  storyteller: PlayerId,
  round: number,
  now: number,
): ReverieState {
  const turn: Turn = {
    round,
    storyteller,
    phase: 'clue',
    clue: null,
    storyCard: null,
    submissions: {},
    table: [],
    votes: {},
    deadline: deadline(state.settings.clueSeconds, now),
    results: null,
    allOrNone: null,
  };
  return { ...state, turn };
}

/** Lays the table once every other player has given their cards. */
function maybeStartVoting(state: ReverieState, rng: Rng, now: number): ReverieState {
  const turn = state.turn;
  if (!turn || turn.phase !== 'pick') return state;
  const need = cardsToGive(state);
  if (!others(state).every((id) => (turn.submissions[id]?.length ?? 0) >= need)) return state;
  const cards = [
    { card: turn.storyCard!, owner: turn.storyteller },
    ...others(state).flatMap((id) => turn.submissions[id]!.map((card) => ({ card, owner: id }))),
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

/** Scores the turn once every other player has voted. */
function maybeReveal(state: ReverieState): ReverieState {
  const turn = state.turn;
  if (!turn || turn.phase !== 'vote') return state;
  if (!others(state).every((id) => id in turn.votes)) return state;
  return reveal(state);
}

/**
 * The scoring rules: if everyone or nobody found the storyteller's card, the storyteller scores
 * nothing and the others 2 each; otherwise the storyteller and each finder score 3. Everyone but
 * the storyteller also scores 1 for every vote their own card attracted.
 */
export function reveal(state: ReverieState): ReverieState {
  const turn = state.turn!;
  const voters = others(state);
  const storyIndex = turn.table.findIndex((t) => t.owner === turn.storyteller);
  const finders = voters.filter((id) => turn.votes[id] === storyIndex);
  const allOrNone = finders.length === 0 || finders.length === voters.length;
  const results: Record<PlayerId, TurnResult> = {};
  for (const id of players(state)) {
    const isStory = id === turn.storyteller;
    const votesReceived = isStory
      ? finders.length
      : voters.filter((v) => turn.table[turn.votes[v]!]?.owner === id).length;
    const foundIt = !isStory && finders.includes(id);
    const points = isStory
      ? allOrNone
        ? 0
        : 3
      : (allOrNone ? 2 : foundIt ? 3 : 0) + votesReceived;
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

function nextTurn(state: ReverieState, ctx: Ctx): Result {
  if (!ctx.isHost) return new GameError('not-host', 'Only the host can move on.');
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn || turn.phase !== 'reveal') {
    return new GameError('wrong-stage', 'Finish this turn first.');
  }
  // Everyone's played cards go to the discard pile, then hands are refilled.
  let next: ReverieState = {
    ...state,
    discard: [...state.discard, ...turn.table.map((t) => t.card)],
  };
  const target = state.settings.targetScore;
  const seated = players(next);
  const top = Math.max(...seated.map((id) => next.seats[id]!.score));
  if (top >= target) {
    return {
      ...next,
      phase: 'over',
      turn: null,
      winners: seated.filter((id) => next.seats[id]!.score === top),
    };
  }
  next = refill(next, ctx.rng);
  const after = seated[(seated.indexOf(turn.storyteller) + 1) % seated.length]!;
  return beginTurn(next, after, turn.round + 1, ctx.now);
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
    const ids = [...new Set(action.sets)];
    if (ids.some((id) => !known.has(id)))
      return new GameError('unknown-set', 'That card set does not exist.');
    settings.sets = ids;
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
    draw: ctx.rng.shuffle(pool),
    discard: [],
    winners: [],
    gamesPlayed: state.gamesPlayed + 1,
  };
  next = refill(next, ctx.rng);
  // The storyteller alternates between games; within a game it goes round the table.
  const first = seated[state.gamesPlayed % seated.length]!;
  return beginTurn(next, first, 1, ctx.now);
}

function backToLobby(state: ReverieState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  return { ...state, phase: 'lobby', turn: null, draw: [], discard: [], winners: [] };
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
  const need = cardsToGive(state);
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

function create(_ctx: CreateCtx, playersIn: readonly PlayerInfo[]): ReverieState {
  let state: ReverieState = {
    phase: 'lobby',
    settings: {
      sets: ['base'],
      targetScore: 30,
      clueSeconds: null,
      guessSeconds: null,
      timerMode: 'soft',
    },
    seats: {},
    draw: [],
    discard: [],
    turn: null,
    winners: [],
    gamesPlayed: 0,
  };
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: ReverieState, player: PlayerInfo): ReverieState {
  const existing = state.seats[player.id];
  if (existing)
    return { ...state, seats: { ...state.seats, [player.id]: { ...existing, name: player.name } } };
  // In the lobby newcomers take a seat straight away (if there is one); mid-game they watch
  // until they sit down between turns, and then get cards at the next turn.
  const playing = state.phase === 'lobby' && players(state).length < MAX_PLAYERS;
  const seat: Seat = { name: player.name, color: nextColor(state), playing, score: 0, hand: [] };
  return { ...state, seats: { ...state.seats, [player.id]: seat } };
}

function playerLeft(state: ReverieState, playerId: PlayerId, now: number): ReverieState {
  const seat = state.seats[playerId];
  if (!seat) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  let next: ReverieState = { ...state, seats, discard: [...state.discard, ...seat.hand] };
  const turn = next.turn;
  if (next.phase !== 'playing' || !turn || !seat.playing) return next;

  if (turn.storyteller === playerId && turn.phase !== 'reveal') {
    // The storyteller left: give everyone their cards back and start over with the next player.
    for (const [id, cards] of Object.entries(turn.submissions)) {
      const seat = next.seats[id];
      if (seat) next.seats[id] = { ...seat, hand: [...seat.hand, ...cards] };
    }
    if (turn.storyCard !== null) next.discard = [...next.discard, turn.storyCard];
    const remaining = players(next);
    if (remaining.length < MIN_PLAYERS) {
      return { ...next, phase: 'over', turn: null, winners: [] };
    }
    const order = players(state);
    const idx = order.indexOf(playerId);
    const after = order
      .slice(idx + 1)
      .concat(order.slice(0, idx))
      .find((id) => remaining.includes(id))!;
    return beginTurn(next, after, turn.round, now);
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
  if (players(next).length < MIN_PLAYERS && turn.phase !== 'reveal') {
    return { ...next, phase: 'over', turn: null, winners: [] };
  }
  // No rng is handed to playerLeft; seed one from the clock so the table is still shuffled.
  return maybeReveal(maybeStartVoting(next, createRng(now), now));
}

// ---- Timers ----

function nextDeadline(state: ReverieState): number | null {
  if (state.phase !== 'playing' || state.settings.timerMode !== 'strict') return null;
  return state.turn?.deadline ?? null;
}

function onDeadline(state: ReverieState, now: number): ReverieState {
  const due = nextDeadline(state);
  const turn = state.turn;
  if (due === null || now < due || !turn) return state;
  const seated = players(state);
  if (turn.phase === 'clue') {
    // A storyteller who ran out of time is skipped.
    const after = seated[(seated.indexOf(turn.storyteller) + 1) % seated.length]!;
    return beginTurn(state, after, turn.round, now);
  }
  if (turn.phase === 'pick') {
    // Whoever hasn't given a card gives the first card(s) of their hand.
    let next = state;
    const need = cardsToGive(state);
    for (const id of others(state)) {
      if (next.turn!.submissions[id]) continue;
      const seat = next.seats[id]!;
      const cards = seat.hand.slice(0, need);
      next = {
        ...next,
        seats: { ...next.seats, [id]: { ...seat, hand: seat.hand.slice(need) } },
        turn: { ...next.turn!, submissions: { ...next.turn!.submissions, [id]: cards } },
      };
    }
    return maybeStartVoting(next, createRng(now), now);
  }
  if (turn.phase === 'vote') return reveal(state);
  return state;
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
      (turn.phase === 'clue'
        ? id === turn.storyteller && turn.storyCard !== null
        : turn.phase === 'pick'
          ? id === turn.storyteller || !!turn.submissions[id]
          : turn.phase === 'vote'
            ? id === turn.storyteller || id in turn.votes
            : true),
  }));
  const me = viewer === null ? null : (seatViews.find((s) => s.id === viewer) ?? null);
  const revealed = turn?.phase === 'reveal' || state.phase === 'over';
  return {
    phase: state.phase,
    settings: state.settings,
    seats: seatViews,
    me,
    hand: viewer === null ? [] : [...(state.seats[viewer]?.hand ?? [])],
    cardsToGive: cardsToGive(state),
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
        }
      : null,
    winners: state.winners,
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
};
