import {
  type ActionCtx,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type PlayerId,
  type PlayerInfo,
  type Rng,
  timedOut,
} from '@vt/game-sdk';
import { seanceAwards } from './awards.ts';
import { PILLARS, POOL_IDS, type Pillar, SET_IDS, kindOf, poolOf } from './cards.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import { RAVENS, assignColors, startProblem, tableCards, tokensFor, voteStageOf } from './setup.ts';
import {
  DEFAULT_TIMER,
  type EndHow,
  type Final,
  type Game,
  type GameView,
  HAND_SIZE,
  type LockHow,
  HOURS,
  MAX_NOTICES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type MyRole,
  type Psychic,
  type PsychicColor,
  type PsychicView,
  AWAY_SECONDS,
  REVEAL_SECONDS,
  type SeanceAction,
  type SeanceState,
  type SeanceView,
  type Seat,
  type SeatView,
  TOKENS_BACK_HOUR,
  VOTE_SECONDS,
  type Verdict,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = SeanceState | GameError;

const err = (code: string, message: string) => new GameError(code, message);

// ---- Small helpers ----

export const seated = (state: SeanceState): PlayerId[] =>
  Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));

const newSeed = (rng: Rng) => rng.int(2 ** 32);

const withGame = (state: SeanceState, game: Game): SeanceState => ({ ...state, game });

/** Psychics still at the table: a retired seat has left the game for good. */
const active = (g: Game) => g.psychics.filter((p) => !p.retired);
const psychicOf = (g: Game, id: PlayerId | null | undefined) =>
  active(g).find((p) => p.id === id) ?? null;
const byColor = (g: Game, c: PsychicColor) => active(g).find((p) => p.color === c) ?? null;

/** Players at the table: the ghost seat plus the psychics. */
const tableSize = (g: Game) => g.psychics.length + 1;

export const pillarOf = (step: number): Pillar | null => PILLARS[step] ?? null;

const unfinished = (g: Game) => active(g).filter((p) => p.step < 3);

/** A seat nobody is in: left for good, or away so long it counts as empty until they're back. */
export const empty = (p: Psychic) => p.gone || !!p.absent;

/**
 * Psychics the hour waits on before it can lock: everyone still searching and at the table. Those
 * who found all three may still play tokens, but never hold the table up, and an empty seat is
 * neither sent a vision nor judged until someone takes it over (or the host retires it).
 */
export function readyNeeded(g: Game): Psychic[] {
  return unfinished(g).filter((p) => !empty(p));
}

const allSent = (g: Game) => readyNeeded(g).every((p) => g.sent.includes(p.color));

/** Every psychic still in the game has found all three. */
const allFound = (g: Game) => active(g).every((p) => p.step >= 3);

/** Once every vision is out, the sand runs (if the host set a timer and it isn't running yet). */
function startSand(state: SeanceState, now: number): SeanceState {
  const g = state.game!;
  if (g.stage !== 'visions' || g.deadline !== null || state.settings.timerSeconds === null)
    return state;
  if (!g.sent.length || !allSent(g)) return state;
  return withGame(state, { ...g, deadline: now + state.settings.timerSeconds * 1000 });
}

function notice(state: SeanceState, text: string, now: number): SeanceState {
  const g = state.game!;
  const n = state.noticeSeq + 1;
  return {
    ...state,
    noticeSeq: n,
    game: { ...g, notices: [...g.notices, { id: n, text, at: now }].slice(-MAX_NOTICES) },
  };
}

/** Draws the hand back up to seven, reshuffling the discards when the pile runs out. */
function refill(g: Game, rng: Rng): Game {
  let deck = g.deck;
  let discard = g.discard;
  const hand = [...g.hand];
  while (hand.length < HAND_SIZE) {
    if (!deck.length) {
      if (!discard.length) break;
      deck = rng.shuffle(discard);
      discard = [];
    }
    hand.push(deck[0]!);
    deck = deck.slice(1);
  }
  return { ...g, hand, deck, discard };
}

export function ravensLeft(g: Game): number {
  const r = RAVENS[g.difficulty];
  if (r.perHour) return g.ravenHour === g.hour ? 0 : r.count;
  return Math.max(0, r.count - g.ravensUsed);
}

// ---- Lobby ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

function updateSettings(
  state: SeanceState,
  action: Extract<SeanceAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing')
    return err('in-progress', 'Settings can only change between games.');
  const s = { ...state.settings };
  if (action.ghostMode !== undefined) s.ghostMode = action.ghostMode;
  if (action.ghostPick !== undefined) {
    if (action.ghostPick !== null && !state.seats[action.ghostPick]?.playing)
      return err('not-seated', 'Pick someone who is playing.');
    s.ghostPick = action.ghostPick;
  }
  if (action.difficulty !== undefined) s.difficulty = action.difficulty;
  if (action.sets !== undefined) s.sets = SET_IDS.filter((id) => action.sets!.includes(id));
  if (action.third !== undefined) s.third = action.third;
  if (action.pools !== undefined) s.pools = POOL_IDS.filter((id) => action.pools!.includes(id));
  if (action.extras !== undefined) s.extras = action.extras;
  if (action.timerSeconds !== undefined) s.timerSeconds = action.timerSeconds;
  if (action.timerMode !== undefined) s.timerMode = action.timerMode;
  return { ...state, settings: s };
}

function sit(state: SeanceState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this room.');
  if (state.phase === 'playing') return err('in-progress', 'You can sit down between games.');
  if (seat.playing === playing) return state;
  if (playing && seated(state).length >= MAX_PLAYERS)
    return err('full', `At most ${MAX_PLAYERS} can play.`);
  const settings =
    !playing && state.settings.ghostPick === ctx.by
      ? { ...state.settings, ghostPick: null }
      : state.settings;
  return {
    ...state,
    settings,
    seats: {
      ...state.seats,
      [ctx.by]: { ...seat, playing, volunteer: playing && seat.volunteer },
    },
  };
}

function volunteer(state: SeanceState, on: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat?.playing) return err('not-seated', 'Take a seat first.');
  if (state.phase === 'playing') return err('in-progress', 'You can volunteer between games.');
  return { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, volunteer: on } } };
}

function pickColor(state: SeanceState, color: PsychicColor, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this room.');
  if (state.phase === 'playing') return err('in-progress', 'You can pick a psychic between games.');
  const holder = Object.entries(state.seats).find(
    ([id, s]) => id !== ctx.by && s.playing && s.color === color,
  );
  if (holder) return err('taken', `${holder[1].name} has already picked that psychic.`);
  return { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, color } } };
}

function start(state: SeanceState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'A game is already running.');
  const seatViews = Object.entries(state.seats).map(([id, s]) => ({ id, ...s }));
  const problem = startProblem(state.settings, seatViews);
  if (problem) return err('cannot-start', problem);
  const ids = seated(state);
  const rng = ctx.rng;
  const s = state.settings;
  const volunteers = ids.filter((id) => state.seats[id]!.volunteer);
  const ghost =
    s.ghostMode === 'host'
      ? s.ghostPick!
      : s.ghostMode === 'volunteers'
        ? volunteers[rng.int(volunteers.length)]!
        : ids[rng.int(ids.length)]!;
  const psychicIds = ids.filter((id) => id !== ghost);
  const colors = assignColors(psychicIds, (id) => state.seats[id]!.color);
  const n = tableCards(s.difficulty, ids.length);
  const third = s.third ?? 'object';
  // Per pillar: lay N cards face up; the ghost shuffles their copies and deals one per psychic.
  const table = {} as Record<Pillar, number[]>;
  const targets = psychicIds.map(() => [] as number[]);
  for (const pillar of PILLARS) {
    const laid = rng.shuffle(poolOf(s.sets, kindOf(pillar, third), [], s.extras)).slice(0, n);
    table[pillar] = [...laid].sort((a, b) => a - b);
    const dealt = rng.shuffle(laid);
    psychicIds.forEach((_, i) => targets[i]!.push(dealt[i]!));
  }
  const clairvoyance = ids.length >= 4;
  const tokensEach = tokensFor(ids.length);
  const psychics: Psychic[] = psychicIds.map((id, i) => ({
    id,
    name: state.seats[id]!.name,
    color: colors.get(id)!,
    targets: targets[i] as [number, number, number],
    step: 0,
    found: [],
    visions: [],
    intuition: null,
    ready: false,
    tokens: tokensEach,
    level: 0,
    finishedHour: null,
    gone: false,
    retired: false,
    // Someone whose device is already gone starts the away clock with the game.
    awaySince: ctx.connected?.(id) === false ? ctx.now : null,
    absent: false,
  }));
  const deck = rng.shuffle(poolOf(s.sets, 'vision', s.pools));
  const game: Game = refill(
    {
      ghost,
      formerGhosts: [],
      psychics,
      difficulty: s.difficulty,
      third,
      clairvoyance,
      tokensEach,
      hour: 1,
      stage: 'visions',
      table,
      hand: [],
      deck,
      discard: [],
      sent: [],
      ravensUsed: 0,
      ravenHour: null,
      marks: [],
      deadline: null,
      sends: [],
      verdicts: [],
      final: null,
      result: null,
      notices: [],
      startedAt: ctx.now,
    },
    rng,
  );
  return {
    ...state,
    phase: 'playing',
    seed: newSeed(rng),
    gamesPlayed: state.gamesPlayed + 1,
    game,
  };
}

function backToLobby(state: SeanceState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  return { ...state, phase: 'lobby', game: null };
}

// ---- The ghost ----

function requireGhost(state: SeanceState, by: PlayerId): GameError | null {
  const g = state.game;
  if (!g || state.phase !== 'playing') return err('not-playing', 'No game in progress.');
  if (g.ghost !== by) return err('not-ghost', 'Only the ghost can do that.');
  return null;
}

const handProblem = (g: Game, cards: readonly number[]) =>
  new Set(cards).size !== cards.length || cards.some((c) => !g.hand.includes(c))
    ? err('not-in-hand', 'Pick cards from your hand.')
    : null;

function send(
  state: SeanceState,
  action: Extract<SeanceAction, { type: 'send' }>,
  ctx: Ctx,
): Result {
  const e = requireGhost(state, ctx.by);
  if (e) return e;
  const g = state.game!;
  if (g.stage !== 'visions') return err('wrong-stage', 'Visions go out at the start of the hour.');
  const p = byColor(g, action.to);
  if (!p) return err('no-psychic', 'No such psychic.');
  if (p.step >= 3) return err('finished', `${p.name} has already found everything.`);
  if (g.sent.includes(p.color))
    return err('already-sent', `${p.name} has had their vision this hour.`);
  const bad = handProblem(g, action.cards);
  if (bad) return bad;
  const hour = g.hour;
  const psychics = g.psychics.map((x) =>
    x.color === p.color
      ? {
          ...x,
          visions: [...x.visions, ...action.cards.map((card) => ({ card, hour }))],
          ready: false,
        }
      : x,
  );
  const next: Game = refill(
    {
      ...g,
      psychics,
      hand: g.hand.filter((c) => !action.cards.includes(c)),
      sent: [...g.sent, p.color],
      sends: [...g.sends, { hour, to: p.color, step: p.step, cards: [...action.cards] }],
    },
    ctx.rng,
  );
  // Every vision is out: the sand runs.
  return startSand(withGame(state, next), ctx.now);
}

function raven(state: SeanceState, cards: readonly number[], ctx: Ctx): Result {
  const e = requireGhost(state, ctx.by);
  if (e) return e;
  const g = state.game!;
  if (g.stage === 'vote' || g.stage === 'done')
    return err('wrong-stage', 'The shared vision is already out.');
  if (ravensLeft(g) <= 0)
    return err(
      'no-ravens',
      RAVENS[g.difficulty].perHour
        ? 'You have used this hour’s raven.'
        : 'You have no ravens left this game.',
    );
  const bad = handProblem(g, cards);
  if (bad) return bad;
  const next = refill(
    {
      ...g,
      hand: g.hand.filter((c) => !cards.includes(c)),
      discard: [...g.discard, ...cards],
      ravensUsed: g.ravensUsed + 1,
      ravenHour: g.hour,
    },
    ctx.rng,
  );
  return notice(
    withGame(state, next),
    `🐦‍⬛ The ghost sent a raven: ${cards.length} ${cards.length === 1 ? 'card' : 'cards'} swapped.`,
    ctx.now,
  );
}

// ---- The psychics ----

function requirePsychic(state: SeanceState, by: PlayerId): Psychic | GameError {
  const g = state.game;
  if (!g || state.phase !== 'playing') return err('not-playing', 'No game in progress.');
  const me = psychicOf(g, by);
  if (!me) return err('not-psychic', 'Only the psychics can do that.');
  return me;
}

function intuition(state: SeanceState, card: number | null, ctx: Ctx): Result {
  const me = requirePsychic(state, ctx.by);
  if (me instanceof GameError) return me;
  const g = state.game!;
  if (g.stage !== 'visions') return err('wrong-stage', 'Guesses are locked for this hour.');
  const pillar = pillarOf(me.step);
  if (!pillar) return err('finished', 'You have found everything: help the others now.');
  if (card !== null && !g.table[pillar].includes(card))
    return err('not-on-table', `Pick one of the ${pillar} cards on the table.`);
  const psychics = g.psychics.map((p) =>
    p.id === me.id ? { ...p, intuition: card, ready: false } : p,
  );
  return withGame(state, { ...g, psychics });
}

function mark(
  state: SeanceState,
  action: Extract<SeanceAction, { type: 'mark' }>,
  ctx: Ctx,
): Result {
  const me = requirePsychic(state, ctx.by);
  if (me instanceof GameError) return me;
  const g = state.game!;
  if (!g.clairvoyance) return err('no-tokens', 'With 3 players there are no clairvoyance tokens.');
  if (g.stage !== 'visions') return err('wrong-stage', 'Tokens are locked for this hour.');
  if (action.target === me.color)
    return err('own', 'Clairvoyance tokens go on the other psychics’ guesses.');
  const target = byColor(g, action.target);
  if (!target || target.step >= 3 || empty(target))
    return err('bad-target', 'That psychic has nothing to guess.');
  const existing = g.marks.find((m) => m.by === me.color && m.target === action.target);
  const marks = g.marks.filter((m) => m !== existing);
  let tokens = me.tokens + (existing ? 1 : 0);
  if (action.kind !== null) {
    if (target.intuition === null)
      return err('no-intuition', `${target.name} hasn’t placed a guess yet.`);
    if (tokens <= 0)
      return err(
        'no-tokens',
        `You have no clairvoyance tokens left${g.hour < TOKENS_BACK_HOUR ? ' until hour IV' : ''}.`,
      );
    marks.push({ by: me.color, target: action.target, kind: action.kind });
    tokens -= 1;
  }
  const psychics = g.psychics.map((p) => (p.id === me.id ? { ...p, tokens, ready: false } : p));
  return withGame(state, { ...g, psychics, marks });
}

function ready(state: SeanceState, on: boolean, ctx: Ctx): Result {
  const me = requirePsychic(state, ctx.by);
  if (me instanceof GameError) return me;
  const g = state.game!;
  if (g.stage !== 'visions') return err('wrong-stage', 'Nothing to get ready for right now.');
  if (on && me.step < 3 && me.intuition === null)
    return err('no-intuition', 'Place your guess first.');
  const psychics = g.psychics.map((p) => (p.id === me.id ? { ...p, ready: on } : p));
  return withGame(state, { ...g, psychics });
}

/** Every vision is out and everyone the hour waits on is Ready: the ghost may reveal. */
export const canReveal = (g: Game) =>
  g.stage === 'visions' && g.sent.length > 0 && allSent(g) && readyNeeded(g).every((p) => p.ready);

/**
 * Nothing locks the moment the last psychic is Ready: the ghost reveals the verdicts, so anyone
 * can still change their mind (which un-Readies them) until then.
 */
function reveal(state: SeanceState, ctx: Ctx): Result {
  const e = requireGhost(state, ctx.by);
  if (e) return e;
  const g = state.game!;
  if (g.stage !== 'visions') return err('wrong-stage', 'There is nothing to reveal right now.');
  if (!g.sent.length || !allSent(g))
    return err('not-yet', 'Send every psychic their vision first.');
  const waiting = readyNeeded(g).filter((p) => !p.ready);
  if (waiting.length)
    return err(
      'not-ready',
      `Wait until every psychic is Ready (${waiting.map((p) => p.name).join(', ')} ${waiting.length === 1 ? 'isn’t' : 'aren’t'} yet).`,
    );
  return lock(notice(state, '👻 The ghost revealed the verdicts.', ctx.now), ctx.now, 'ghost');
}

/** Spectral manifestation: the server judges every guess, then the verdicts stay up a moment. */
function lock(state: SeanceState, now: number, how: LockHow): SeanceState {
  const g = state.game!;
  const verdicts: Verdict[] = [];
  const gains = new Map<PsychicColor, number>();
  const gain = (c: PsychicColor, n: number) => gains.set(c, (gains.get(c) ?? 0) + n);
  const table = { ...g.table };
  let discard = g.discard;
  const judged = g.psychics.map((p) => {
    if (p.step >= 3 || empty(p) || p.retired) return p;
    const pillar = pillarOf(p.step)!;
    const correct = p.intuition !== null && p.intuition === p.targets[p.step];
    const marks = g.marks.filter((m) => m.target === p.color);
    if (g.clairvoyance) for (const m of marks) if ((m.kind === 'yes') === correct) gain(m.by, 1);
    verdicts.push({
      hour: g.hour,
      color: p.color,
      step: p.step,
      guess: p.intuition,
      correct,
      marks,
    });
    if (!correct) return { ...p, intuition: null, ready: false };
    const card = p.targets[p.step]!;
    table[pillar] = table[pillar].filter((c) => c !== card);
    discard = [...discard, ...p.visions.map((v) => v.card)];
    const step = p.step + 1;
    const done = step >= 3;
    // Finishing early is worth a level for every hour left on the clock.
    if (done && g.clairvoyance) gain(p.color, HOURS - g.hour);
    return {
      ...p,
      step,
      found: [...p.found, card],
      visions: [],
      intuition: null,
      ready: false,
      finishedHour: done ? g.hour : null,
    };
  });
  // Tokens on an empty seat's guess, which isn't judged, go back to whoever played them.
  const back = (c: PsychicColor) =>
    g.marks.filter((m) => m.by === c && g.psychics.some((p) => p.color === m.target && empty(p)))
      .length;
  const psychics = judged.map((p) => ({
    ...p,
    level: p.level + (gains.get(p.color) ?? 0),
    tokens: p.tokens + back(p.color),
  }));
  return withGame(state, {
    ...g,
    psychics,
    table,
    discard,
    marks: [],
    verdicts: [...g.verdicts, ...verdicts],
    stage: 'reveal',
    lockedHow: how,
    deadline: now + REVEAL_SECONDS * 1000,
  });
}

/** After the verdicts: the next hour, the final, or the clock runs out. */
function afterReveal(state: SeanceState, now: number): SeanceState {
  const g = state.game!;
  if (allFound(g)) return startFinal(state);
  if (g.hour >= HOURS) return finish(state, false, 'clock', null, null, [], null);
  const hour = g.hour + 1;
  const back = hour === TOKENS_BACK_HOUR && g.clairvoyance;
  const s = withGame(state, {
    ...g,
    hour,
    stage: 'visions',
    sent: [],
    marks: [],
    deadline: null,
    psychics: g.psychics.map((p) => ({
      ...p,
      ready: false,
      tokens: back ? g.tokensEach : p.tokens,
    })),
  });
  return back ? notice(s, 'Hour IV: everyone takes their clairvoyance tokens back.', now) : s;
}

function cont(state: SeanceState, ctx: Ctx): Result {
  const g = state.game;
  if (!g || g.stage !== 'reveal') return err('wrong-stage', 'Nothing to move on from.');
  if (!ctx.isHost && g.ghost !== ctx.by)
    return err('not-host', 'The ghost or the host moves the clock on.');
  return afterReveal(state, ctx.now);
}

function lockNow(state: SeanceState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  const g = state.game;
  if (!g || state.phase !== 'playing') return err('not-playing', 'No game in progress.');
  if (g.stage === 'visions') {
    if (!allSent(g)) return err('not-yet', 'The ghost hasn’t sent every vision yet.');
    return lock(notice(state, 'The host locked the guesses in.', ctx.now), ctx.now, 'host');
  }
  if (g.stage === 'vote')
    return nextVoteStage(notice(state, 'The host closed this round of votes.', ctx.now), ctx.now);
  return err('wrong-stage', 'There is nothing to lock right now.');
}

// ---- The final: line-up, shared vision, staged vote ----

function startFinal(state: SeanceState): SeanceState {
  const g = state.game!;
  const final: Final = {
    groups: active(g).map((p) => p.color),
    culprit: null,
    shared: [],
    tags: [],
    revealed: 0,
    votes: {},
  };
  return withGame(state, { ...g, stage: 'shared', deadline: null, final });
}

export const voteStage = (g: Game, p: Psychic) =>
  voteStageOf(p.level, tableSize(g), g.clairvoyance);

/** Psychics who vote once `stage` cards are face up. */
const votersAt = (g: Game, stage: number) =>
  active(g).filter((p) => !empty(p) && voteStage(g, p) === stage);

function voteDeadline(state: SeanceState, now: number) {
  return state.settings.timerSeconds === null ? null : now + VOTE_SECONDS * 1000;
}

/** Turns the next card(s) face up, skipping stages nobody votes in; tallies after the third. */
function openVoteStage(state: SeanceState, from: number, now: number): SeanceState {
  const g = state.game!;
  for (let s = from; s <= 3; s++) {
    if (votersAt(g, s).length)
      return withGame(state, {
        ...g,
        stage: 'vote',
        final: { ...g.final!, revealed: s },
        deadline: voteDeadline(state, now),
      });
  }
  return tally(withGame(state, { ...g, final: { ...g.final!, revealed: 3 } }));
}

function nextVoteStage(state: SeanceState, now: number): SeanceState {
  const g = state.game!;
  const f = g.final!;
  const votes = { ...f.votes };
  for (const p of votersAt(g, f.revealed)) if (!(p.color in votes)) votes[p.color] = null;
  return openVoteStage(withGame(state, { ...g, final: { ...f, votes } }), f.revealed + 1, now);
}

function shared(
  state: SeanceState,
  action: Extract<SeanceAction, { type: 'shared' }>,
  ctx: Ctx,
): Result {
  const e = requireGhost(state, ctx.by);
  if (e) return e;
  const g = state.game!;
  if (g.stage !== 'shared' || !g.final) return err('wrong-stage', 'It isn’t time for that yet.');
  if (action.group >= g.final.groups.length) return err('bad-group', 'Pick one of the groups.');
  const bad = handProblem(g, action.cards);
  if (bad) return bad;
  const tags = action.tags ?? [null, null, null];
  const order = ctx.rng.shuffle([0, 1, 2]);
  const final: Final = {
    ...g.final,
    culprit: action.group,
    shared: order.map((i) => action.cards[i]!),
    tags: order.map((i) => tags[i] ?? null),
  };
  const next = withGame(state, {
    ...g,
    hand: g.hand.filter((c) => !action.cards.includes(c)),
    final,
  });
  return openVoteStage(next, 1, ctx.now);
}

function vote(state: SeanceState, group: number, ctx: Ctx): Result {
  const me = requirePsychic(state, ctx.by);
  if (me instanceof GameError) return me;
  const g = state.game!;
  const f = g.final;
  if (g.stage !== 'vote' || !f) return err('wrong-stage', 'The vote isn’t open.');
  if (group >= f.groups.length) return err('bad-group', 'Pick one of the groups.');
  const mine = voteStage(g, me);
  if (mine !== f.revealed)
    return err(
      'not-your-turn',
      mine > f.revealed
        ? `You vote once ${mine} cards are face up.`
        : 'Your vote has already been counted.',
    );
  const next = withGame(state, { ...g, final: { ...f, votes: { ...f.votes, [me.color]: group } } });
  const after = next.game!;
  if (votersAt(after, f.revealed).every((p) => p.color in after.final!.votes))
    return nextVoteStage(next, ctx.now);
  return next;
}

/**
 * The count: the most votes wins. A tie goes to the tied group chosen by the psychic furthest
 * along the clairvoyance track, then by whoever finished first, then the earlier seat.
 */
function tally(state: SeanceState): SeanceState {
  const g = state.game!;
  const f = g.final!;
  const counts = f.groups.map(() => 0);
  for (const v of Object.values(f.votes)) if (typeof v === 'number') counts[v]! += 1;
  const best = Math.max(0, ...counts);
  if (best === 0) return finish(state, false, 'no-votes', null, f.culprit, counts, null);
  const tied = counts.flatMap((n, i) => (n === best ? [i] : []));
  let chosen = tied[0]!;
  let breaker: PsychicColor | null = null;
  if (tied.length > 1) {
    const ranked = g.psychics
      .map((p, seat) => ({ p, seat, v: f.votes[p.color] }))
      .filter((x): x is { p: Psychic; seat: number; v: number } => tied.includes(x.v as number))
      .sort(
        (a, b) =>
          b.p.level - a.p.level ||
          (a.p.finishedHour ?? HOURS + 1) - (b.p.finishedHour ?? HOURS + 1) ||
          a.seat - b.seat,
      );
    chosen = ranked[0]!.v;
    breaker = ranked[0]!.p.color;
  }
  const win = chosen === f.culprit;
  return finish(state, win, win ? 'culprit' : 'wrong', chosen, f.culprit, counts, breaker);
}

function finish(
  state: SeanceState,
  win: boolean,
  how: EndHow,
  chosen: number | null,
  culprit: number | null,
  counts: number[],
  tieBreaker: PsychicColor | null,
): SeanceState {
  const g = state.game!;
  const everyone = [...(g.ghost ? [g.ghost] : []), ...active(g).map((p) => p.id)];
  return {
    ...state,
    phase: 'over',
    game: {
      ...g,
      stage: 'done',
      deadline: null,
      result: {
        win,
        how,
        chosen,
        culprit,
        tally: counts,
        tieBreaker,
        winners: win ? everyone : [],
      },
    },
  };
}

// ---- Seats changing hands ----

/**
 * Room members who may become the ghost: anyone watching (a new joiner, or a former ghost, who
 * already knows the answers), never a psychic, who would then see them.
 */
export function ghostCandidates(state: SeanceState): PlayerId[] {
  const g = state.game;
  if (!g) return [];
  return Object.keys(state.seats).filter((id) => id !== g.ghost && !psychicOf(g, id));
}

function becomeGhost(state: SeanceState, to: PlayerId, now: number): SeanceState {
  const g = state.game!;
  const old = g.ghost;
  const name = state.seats[to]?.name ?? 'Someone';
  const s = withGame(state, {
    ...g,
    ghost: to,
    formerGhosts: [...g.formerGhosts.filter((id) => id !== to), ...(old ? [old] : [])],
  });
  return notice(s, `👻 ${name} is the ghost now.`, now);
}

function handGhost(state: SeanceState, to: PlayerId, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (!state.game || state.phase !== 'playing') return err('not-playing', 'No game in progress.');
  if (!ghostCandidates(state).includes(to))
    return err(
      'bad-ghost',
      'The ghost can only go to someone watching: a psychic would see the answers.',
    );
  return becomeGhost(state, to, ctx.now);
}

function claimGhost(state: SeanceState, ctx: Ctx): Result {
  const g = state.game;
  if (!g || state.phase !== 'playing') return err('not-playing', 'No game in progress.');
  if (g.ghost !== null) return err('taken', 'The game already has a ghost.');
  if (!ghostCandidates(state).includes(ctx.by))
    return err('bad-ghost', 'Only someone watching can take the ghost’s seat.');
  return becomeGhost(state, ctx.by, ctx.now);
}

function takeSeat(state: SeanceState, color: PsychicColor, ctx: Ctx): Result {
  const g = state.game;
  if (!g || state.phase !== 'playing') return err('not-playing', 'No game in progress.');
  if (g.psychics.some((x) => x.color === color && x.retired))
    return err('retired', 'The host retired that seat.');
  const p = byColor(g, color);
  if (!p?.gone) return err('taken', 'That psychic is still at the table.');
  if (g.ghost === ctx.by || g.formerGhosts.includes(ctx.by) || psychicOf(g, ctx.by))
    return err('in-game', 'You are already part of this game.');
  const name = state.seats[ctx.by]?.name ?? 'Someone';
  const psychics = g.psychics.map((x) =>
    x.color === color
      ? { ...x, id: ctx.by, name, gone: false, ready: false, awaySince: null, absent: false }
      : x,
  );
  return notice(
    withGame(state, { ...g, psychics }),
    `${name} takes over ${p.name}’s seat.`,
    ctx.now,
  );
}

/**
 * The host retires an empty seat nobody is taking over: its found cards go back on the table, its
 * visions to the discard, and the game goes on without it (no visions, verdicts, line-up or vote).
 */
function retireSeat(state: SeanceState, color: PsychicColor, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  const g = state.game;
  if (!g || state.phase !== 'playing') return err('not-playing', 'No game in progress.');
  if (g.stage !== 'visions' && g.stage !== 'reveal')
    return err('wrong-stage', 'Seats can only be retired before the line-up.');
  const p = byColor(g, color);
  if (!p) return err('no-psychic', 'No such psychic.');
  if (!p.gone) return err('still-here', `${p.name} is still at the table.`);
  if (active(g).length <= 1) return err('last-seat', 'The séance needs at least one psychic.');
  const table = { ...g.table };
  p.found.forEach((card, i) => {
    const pillar = PILLARS[i]!;
    table[pillar] = [...table[pillar], card].sort((a, b) => a - b);
  });
  // Tokens on their guess go back to whoever played them.
  const refunds = g.marks.filter((m) => m.target === color);
  const psychics = g.psychics.map((x) =>
    x.color === color
      ? { ...x, retired: true, ready: false, intuition: null, visions: [] }
      : { ...x, tokens: x.tokens + refunds.filter((m) => m.by === x.color).length },
  );
  let s = withGame(state, {
    ...g,
    psychics,
    table,
    discard: [...g.discard, ...p.visions.map((v) => v.card)],
    marks: g.marks.filter((m) => m.target !== color && m.by !== color),
    sent: g.sent.filter((c) => c !== color),
  });
  s = notice(s, `The host retired ${p.name}’s seat: the séance goes on without it.`, ctx.now);
  const after = s.game!;
  if (after.stage === 'visions' && allFound(after)) return startFinal(s);
  return after.stage === 'visions' ? startSand(s, ctx.now) : s;
}

// ---- Reduce ----

function reduce(state: SeanceState, action: SeanceAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'volunteer':
      return volunteer(state, action.on, ctx);
    case 'pick-color':
      return pickColor(state, action.color, ctx);
    case 'start':
      return start(state, ctx);
    case 'play-again':
      if (state.phase !== 'over') return err('in-progress', 'Finish this game first.');
      return start(state, ctx);
    case 'back-to-lobby':
      return backToLobby(state, ctx);
    case 'send':
      return send(state, action, ctx);
    case 'raven':
      return raven(state, action.cards, ctx);
    case 'shared':
      return shared(state, action, ctx);
    case 'continue':
      return cont(state, ctx);
    case 'reveal':
      return reveal(state, ctx);
    case 'intuition':
      return intuition(state, action.card, ctx);
    case 'mark':
      return mark(state, action, ctx);
    case 'ready':
      return ready(state, action.on, ctx);
    case 'vote':
      return vote(state, action.group, ctx);
    case 'take-seat':
      return takeSeat(state, action.color, ctx);
    case 'retire-seat':
      return retireSeat(state, action.color, ctx);
    case 'lock-now':
      return lockNow(state, ctx);
    case 'hand-ghost':
      return handGhost(state, action.to, ctx);
    case 'claim-ghost':
      return claimGhost(state, ctx);
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, players: readonly PlayerInfo[]): SeanceState {
  let state: SeanceState = {
    phase: 'lobby',
    settings: {
      ghostMode: 'random',
      ghostPick: null,
      difficulty: 'easy',
      sets: [...SET_IDS],
      third: 'object',
      pools: [],
      extras: false,
      timerSeconds: DEFAULT_TIMER,
      timerMode: 'soft',
    },
    seed: newSeed(ctx.rng),
    table: ctx.rng.int(2 ** 31),
    seats: {},
    game: null,
    gamesPlayed: 0,
    noticeSeq: 0,
  };
  for (const p of players) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: SeanceState, player: PlayerInfo): SeanceState {
  const existing = state.seats[player.id];
  const g = state.game;
  const game = g && {
    ...g,
    psychics: g.psychics.map((p) =>
      p.id === player.id && !p.retired ? { ...p, name: player.name, gone: false } : p,
    ),
  };
  if (existing)
    return {
      ...state,
      game,
      seats: { ...state.seats, [player.id]: { ...existing, name: player.name } },
    };
  // Someone who left mid-game and comes back finds their seat again (unless it was taken).
  const inGame = !!g && (!!psychicOf(g, player.id) || g.ghost === player.id);
  const playing = inGame || (state.phase !== 'playing' && seated(state).length < MAX_PLAYERS);
  const seat: Seat = { name: player.name, playing, volunteer: false, color: null };
  return { ...state, game, seats: { ...state.seats, [player.id]: seat } };
}

function playerLeft(state: SeanceState, playerId: PlayerId, now: number): SeanceState {
  if (!state.seats[playerId]) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  const settings =
    state.settings.ghostPick === playerId ? { ...state.settings, ghostPick: null } : state.settings;
  let s: SeanceState = { ...state, seats, settings };
  const g = s.game;
  if (state.phase !== 'playing' || !g) return s;
  if (g.ghost === playerId) {
    // The game pauses: only someone watching (or a new joiner) may take the ghost's seat.
    s = withGame(s, { ...g, ghost: null, formerGhosts: [...g.formerGhosts, playerId] });
    return notice(s, '⏸ The ghost left. Someone watching can take the ghost’s seat.', now);
  }
  const p = psychicOf(g, playerId);
  if (!p) return s;
  s = withGame(s, {
    ...g,
    psychics: g.psychics.map((x) =>
      x.id === playerId ? { ...x, gone: true, ready: false, awaySince: null, absent: false } : x,
    ),
  });
  s = notice(s, `${p.name} left. Someone watching can take over their seat.`, now);
  return afterEmptied(s, now);
}

/** A seat just emptied: the hour may no longer wait for anyone, or the vote stage is complete. */
function afterEmptied(s: SeanceState, now: number): SeanceState {
  if (s.game!.stage === 'visions') return startSand(s, now);
  if (s.game!.stage === 'vote') {
    const after = s.game!;
    if (votersAt(after, after.final!.revealed).every((x) => x.color in after.final!.votes))
      return nextVoteStage(s, now);
  }
  return s;
}

/**
 * A psychic's device went (or came back). After `AWAY_SECONDS` away the seat counts as empty
 * (`expireAway`); coming back makes it theirs again as it was, cards found and guess kept.
 */
function playerPresence(
  state: SeanceState,
  playerId: PlayerId,
  connected: boolean,
  now: number,
): SeanceState {
  const g = state.game;
  if (state.phase !== 'playing' || !g || g.stage === 'done') return state;
  const p = psychicOf(g, playerId);
  if (!p || p.gone) return state;
  if (!connected) {
    // Already away (the room reloading after a restart): the clock keeps running from then.
    if (p.awaySince != null || p.absent) return state;
    return withGame(state, {
      ...g,
      psychics: g.psychics.map((x) => (x.id === playerId ? { ...x, awaySince: now } : x)),
    });
  }
  if (p.awaySince == null && !p.absent) return state;
  const s = withGame(state, {
    ...g,
    psychics: g.psychics.map((x) =>
      x.id === playerId ? { ...x, awaySince: null, absent: false, ready: false } : x,
    ),
  });
  return p.absent ? notice(s, `${p.name} is back in their seat.`, now) : s;
}

/** When the next away psychic's seat counts as empty, or null. */
function awayDue(g: Game): number | null {
  const due = active(g)
    .filter((p) => !p.gone && !p.absent && p.awaySince != null)
    .map((p) => p.awaySince! + AWAY_SECONDS * 1000);
  return due.length ? Math.min(...due) : null;
}

/** Seats whose psychic has been away for `AWAY_SECONDS` now count as empty. */
function expireAway(state: SeanceState, now: number): SeanceState {
  const g = state.game;
  if (state.phase !== 'playing' || !g || g.stage === 'done') return state;
  const due = active(g).filter(
    (p) => !p.gone && !p.absent && p.awaySince != null && p.awaySince + AWAY_SECONDS * 1000 <= now,
  );
  if (!due.length) return state;
  let s = withGame(state, {
    ...g,
    psychics: g.psychics.map((x) => (due.includes(x) ? { ...x, absent: true, ready: false } : x)),
  });
  for (const p of due)
    s = notice(
      s,
      `${p.name} has been away ${AWAY_SECONDS / 60} minutes: their seat counts as empty until they’re back.`,
      now,
    );
  return afterEmptied(s, now);
}

// ---- Timers ----

function nextDeadline(state: SeanceState): number | null {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return null;
  const timer = stageDeadline(state);
  const away = g.stage === 'done' ? null : awayDue(g);
  if (timer === null) return away;
  return away === null ? timer : Math.min(timer, away);
}

/** The stage's own clock: the verdicts, or a strict timer. */
function stageDeadline(state: SeanceState): number | null {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return null;
  if (g.stage === 'reveal') return g.deadline;
  if (state.settings.timerMode !== 'strict') return null;
  if (g.stage === 'visions' || g.stage === 'vote') return g.deadline;
  return null;
}

function onDeadline(prev: SeanceState, now: number): SeanceState {
  const state = expireAway(prev, now);
  const due = stageDeadline(state);
  const g = state.game;
  if (due === null || now < due || !g) return state;
  if (g.stage === 'reveal') return afterReveal(state, now);
  if (g.stage === 'visions') {
    const missing = readyNeeded(g).filter((p) => p.intuition === null).length;
    const what = missing
      ? `guesses were locked in (${missing} without a guess)`
      : 'guesses were locked in';
    return lock(notice(state, timedOut(what), now), now, 'timer');
  }
  if (g.stage === 'vote') {
    const f = g.final!;
    const missing = votersAt(g, f.revealed).filter((p) => !(p.color in f.votes)).length;
    const s = missing
      ? notice(state, timedOut(`${missing} vote(s) counted as abstaining`), now)
      : state;
    return nextVoteStage(s, now);
  }
  return state;
}

// ---- Views ----

function myRoleOf(g: Game, viewer: PlayerId | null): MyRole {
  if (viewer === null) return null;
  if (g.ghost === viewer) return 'ghost';
  if (psychicOf(g, viewer)) return 'psychic';
  if (g.formerGhosts.includes(viewer)) return 'former-ghost';
  return null;
}

function gameView(g: Game, viewer: PlayerId | null): GameView {
  const over = g.stage === 'done';
  const myRole = myRoleOf(g, viewer);
  const ghost = myRole === 'ghost';
  const knows = ghost || over;
  const me = psychicOf(g, viewer);
  const f = g.final;
  const psychics: PsychicView[] = g.psychics.map((p) => ({
    id: p.id,
    name: p.name,
    color: p.color,
    step: p.step,
    found: [...p.found],
    visions: p.visions.map((v) => ({ ...v })),
    intuition: p.intuition,
    ready: p.ready,
    tokens: p.tokens,
    level: p.level,
    finishedHour: p.finishedHour,
    gone: p.gone,
    retired: p.retired ?? false,
    absent: !p.gone && !!p.absent,
    awayUntil:
      !p.gone && !p.absent && p.awaySince != null ? p.awaySince + AWAY_SECONDS * 1000 : null,
    targets: knows ? [...p.targets] : null,
    voteStage: voteStage(g, p),
  }));
  const final: GameView['final'] = f
    ? {
        groups: [...f.groups],
        culprit: knows ? f.culprit : null,
        shared: knows ? [...f.shared] : f.shared.slice(0, f.revealed),
        sharedCount: f.shared.length,
        tags: knows ? [...f.tags] : null,
        revealed: f.revealed,
        voted: Object.keys(f.votes) as PsychicColor[],
        votes: over ? { ...f.votes } : null,
        myVote: me ? f.votes[me.color] : undefined,
      }
    : null;
  return {
    stage: g.stage,
    hour: g.hour,
    difficulty: g.difficulty,
    third: g.third ?? 'object',
    clairvoyance: g.clairvoyance,
    tokensEach: g.tokensEach,
    ghost: g.ghost,
    formerGhosts: [...g.formerGhosts],
    myRole,
    me: me?.color ?? null,
    psychics,
    table: {
      suspect: [...g.table.suspect],
      place: [...g.table.place],
      object: [...g.table.object],
    },
    hand: ghost ? [...g.hand] : null,
    handCount: g.hand.length,
    deckCount: g.deck.length,
    sent: [...g.sent],
    ravensUsed: g.ravensUsed,
    ravenHour: g.ravenHour,
    ravensLeft: ravensLeft(g),
    marks: g.marks.map((m) => ({ ...m })),
    deadline: g.deadline,
    lockedHow: g.lockedHow ?? null,
    canReveal: canReveal(g),
    sends: g.sends.map((s) => ({ ...s, cards: [...s.cards] })),
    verdicts: g.verdicts.map((v) => ({ ...v, marks: v.marks.map((m) => ({ ...m })) })),
    final,
    result: g.result
      ? { ...g.result, tally: [...g.result.tally], winners: [...g.result.winners] }
      : null,
    notices: g.notices.map((n) => ({ ...n })),
  };
}

function view(state: SeanceState, viewer: PlayerId | null): SeanceView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
    volunteer: s.volunteer,
    color: s.color,
  }));
  return {
    phase: state.phase,
    table: state.table,
    gameNo: state.gamesPlayed,
    settings: {
      ...state.settings,
      sets: [...state.settings.sets],
      third: state.settings.third ?? 'object',
      pools: [...(state.settings.pools ?? [])],
      extras: state.settings.extras ?? false,
    },
    seats,
    me: viewer === null ? null : (seats.find((s) => s.id === viewer) ?? null),
    game: state.game ? gameView(state.game, viewer) : null,
  };
}

export const seance: GameDefinition<SeanceState, SeanceAction, SeanceView> = {
  id: 'seance',
  name: 'Séance',
  description:
    'A silent ghost sends picture visions; the psychics read them to find who, where and how.',
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
  playerPresence,
  view,
  nextDeadline,
  onDeadline,
  insights,
  awards: seanceAwards,
};
