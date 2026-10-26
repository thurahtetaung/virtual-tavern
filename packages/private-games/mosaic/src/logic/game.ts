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
import { mosaicAwards } from './awards.ts';
import { bestMove, mosaicBot } from './bot.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  addTo,
  bonusOf,
  columnOf,
  countOf,
  countsOf,
  emptyBoard,
  fullRows,
  lineProblem,
  lineTile,
  linesFor,
  noCounts,
  place,
  runWall,
  startScore,
  wallSpaces,
  totalOf,
} from './rules.ts';
import { flipSpecials, gone, leftoverGroups, neighbours } from './specials.ts';
import {
  type Auto,
  type Board,
  COLOURS,
  type Colour,
  DEFAULT_SECONDS,
  FACTORIES_FOR,
  FACTORY_SIZE,
  type Game,
  type GameView,
  JOKERS_FOR,
  LEFT_BEAT_MS,
  type LogEntry,
  MAX_LOG,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type MosaicAction,
  type MosaicState,
  type Move,
  type MosaicView,
  type PlayerScore,
  type Seat,
  type SeatView,
  type Source,
  type Special,
  type Split,
  TILES,
  TILES_EACH,
  TILING_BASE_MS,
  TILING_PER_PLAYER_MS,
  type Tile,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = MosaicState | GameError;

const err = (code: string, message: string) => new GameError(code, message);
const draft = (s: MosaicState): MosaicState => structuredClone(s);
const hiddenRng = (state: MosaicState, now: number) => createRng((state.seed ^ now) >>> 0);
const newSeed = (rng: Rng) => rng.int(2 ** 32);

// ---- Test rig ----

/**
 * Browser tests only: tiles put on top of the bag when a game is dealt (in drawing order, so the
 * first four fill the first factory), tiles already on the first seat's wall, and the first seat
 * starting, so a spec knows the deal and reaches the end quickly.
 */
export interface TestBag {
  top?: Tile[];
  /** Colours already on the first seat's wall, by row. */
  wall?: Record<number, Colour[]>;
  firstSeat?: boolean;
  /** With jokers: the top of the bag instead of `top`. */
  jokerTop?: Tile[];
  /** With special factories: the faces of the first factories every round (null: plain). */
  specials?: (Special | null)[];
}
let testBag: TestBag | null = null;
export function setTestBag(rig: TestBag | null) {
  testBag = rig;
}

// ---- Reading the table ----

export function players(state: MosaicState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

/** Players still in the game (not removed), in seat order. */
export const active = (g: Game) => g.order.filter((id) => !g.removed.includes(id));

/** The next player still in the game after `from`. */
function nextPlayer(g: Game, from: PlayerId): PlayerId {
  const at = g.order.indexOf(from);
  for (let i = 1; i <= g.order.length; i++) {
    const id = g.order[(at + i) % g.order.length]!;
    if (!g.removed.includes(id)) return id;
  }
  return from;
}

/** The table's options as the game plays them. */
const greyOf = (s: MosaicState) => !!s.settings.grey;

/** Whether every factory and the centre are empty. */
export const tableEmpty = (g: Pick<Game, 'factories' | 'centre'>) =>
  g.factories.every((f) => f.length === 0) && totalOf(g.centre) === 0;

// ---- Log ----

type NewLog = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, 'id' | 'round'>
    : never
  : never;

function log(s: MosaicState, entry: NewLog) {
  s.seq += 1;
  s.log.push({ ...entry, id: s.seq, round: s.game?.round ?? 0 });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

const autoOf = (auto?: Auto) => (auto ? { auto } : {});

// ---- The bag ----

/**
 * Fills every factory with 4 tiles from the bag. An empty bag takes the whole lid first
 * (shuffled); with both empty, the rest of the factories stay as they are.
 */
const byTile = (a: Tile, b: Tile) => TILES.indexOf(a) - TILES.indexOf(b);

/** One tile from the bag; an empty bag takes the whole lid first (shuffled). Null: none left. */
function draw(g: Game, rng: Rng): Tile | null {
  if (!g.bag.length) {
    const lid = TILES.flatMap((t) => Array<Tile>(countOf(g.lid, t)).fill(t));
    if (!lid.length) return null;
    g.bag = rng.shuffle(lid);
    const jokers = g.lid.joker !== undefined;
    g.lid = noCounts();
    if (jokers) g.lid.joker = 0;
  }
  return g.bag.shift()!;
}

/**
 * Fills every factory with 4 tiles from the bag. An empty bag takes the whole lid first
 * (shuffled); with both empty, the rest of the factories stay as they are. Then the special
 * factories set up: every `sf1` takes one more tile, then every `sf2` (in table order) one tile of
 * its colour from each neighbour.
 */
function fillFactories(g: Game, rng: Rng) {
  let out = false;
  for (const f of g.factories) {
    while (!out && f.length < FACTORY_SIZE) {
      const t = draw(g, rng);
      if (t === null) out = true;
      else f.push(t);
    }
  }
  const sp = g.specials ?? [];
  sp.forEach((x, i) => {
    if (x?.kind !== 'sf1') return;
    const t = draw(g, rng);
    if (t !== null) g.factories[i]!.push(t);
  });
  sp.forEach((x, i) => {
    if (x?.kind !== 'sf2' || !x.colour) return;
    const { left, right } = neighbours(sp, g.factories.length, i);
    for (const j of new Set([left, right])) {
      if (j === null || j === i) continue;
      const at = g.factories[j]!.indexOf(x.colour);
      if (at < 0) continue;
      g.factories[j]!.splice(at, 1);
      g.factories[i]!.push(x.colour);
    }
  });
  for (const f of g.factories) f.sort(byTile);
}

/** The special factories' faces for a new round, and a log line naming them. */
function flip(s: MosaicState, g: Game, rng: Rng) {
  if (!s.settings.specials) return;
  const n = g.factories.length;
  g.specials = testBag?.specials
    ? Array.from({ length: n }, (_, i) =>
        testBag?.specials?.[i] ? { ...testBag.specials[i] } : null,
      )
    : flipSpecials(n, g.order.length - g.removed.length, rng);
  log(s, { kind: 'specials', faces: g.specials.filter((x): x is Special => !!x) });
}

// ---- Turn flow ----

/** The decision clock restarts whenever the table waits on something new. */
function settle(s: MosaicState, now: number) {
  const g = s.game;
  if (!g) return;
  if (s.phase !== 'playing' || g.stage === 'tiling') {
    g.clock = null;
    return;
  }
  const key = g.stage === 'wall' ? `${g.round}:wall` : `${g.round}:${g.turns}`;
  if (g.clock?.key !== key) g.clock = { key, since: now, reminded: false };
}

/** Bonuses, the winner (a tie: most full rows, then shared) and the end. */
function finish(s: MosaicState, how?: 'empty' | 'alone') {
  const g = s.game!;
  const ids = active(g);
  if (!g.scoring || g.scoring.round !== g.round)
    g.scoring = {
      round: g.round,
      last: true,
      players: Object.fromEntries(
        ids.map((id): [PlayerId, PlayerScore] => {
          const score = g.players[id]!.score;
          return [id, { placed: [], floor: [], penalty: 0, before: score, after: score }];
        }),
      ),
    };
  g.scoring.last = true;
  for (const id of ids) {
    const b = g.players[id]!;
    const bonus = bonusOf(b.wall);
    b.score += bonus.points;
    const ps = g.scoring.players[id];
    if (ps) {
      ps.bonus = bonus;
      ps.after = b.score;
    }
  }
  const best = Math.max(...ids.map((id) => g.players[id]!.score));
  const top = ids.filter((id) => g.players[id]!.score === best);
  const rows = (id: PlayerId) => fullRows(g.players[id]!.wall);
  const most = Math.max(...top.map(rows));
  g.winners = top.filter((id) => rows(id) === most);
  s.phase = 'over';
  g.stage = 'tiling';
  g.tilingUntil = null;
  g.ready = [];
  g.clock = null;
  log(s, { kind: 'end', winners: [...g.winners], ...(how && { how }) });
}

/**
 * The round's wall-tiling for everyone at once, as far as it goes without a choice; players with
 * a choice (the grey wall, a line of jokers) make it in the `wall` stage, top line first.
 */
function endRound(s: MosaicState, now: number) {
  const g = s.game!;
  g.walls = {};
  for (const id of active(g)) {
    const board = g.players[id]!;
    const score = startScore(board);
    const lid: Tile[] = [];
    const row = runWall(board, score, 0, greyOf(s), lid, null);
    for (const t of lid) addTo(g.lid, t);
    g.walls[id] = { row, score };
  }
  if (Object.values(g.walls).some((w) => w.row !== null)) {
    g.stage = 'wall';
    g.ready = [];
    // Players who left choose at once, as the table would.
    return;
  }
  wallsDone(s, now);
}

/** Puts the waiting line's tile on a wall space and carries on down that player's lines. */
function wallPlace(
  s: MosaicState,
  by: PlayerId,
  row: number,
  col: number | null,
  now: number,
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const w = g.walls?.[by];
  if (g.stage !== 'wall') return err('wrong-stage', 'That’s for the wall-tiling.');
  if (!w || g.removed.includes(by)) return err('not-playing', 'You are not in this game.');
  if (w.row === null) return err('done', 'Your wall is done for this round.');
  if (w.row !== row) return err('wrong-row', `Line ${w.row + 1} goes first.`);
  const board = g.players[by]!;
  const lid: Tile[] = [];
  let first = true;
  const choose = (r: number, spaces: number[]) => {
    // The safe choice (strict timer, Act for, a leaver): the leftmost space, line after line.
    const c = col === null ? spaces[0]! : first ? col : null;
    if (c === null) return null;
    if (!spaces.includes(c)) return null;
    first = false;
    log(s, { kind: 'wall', by, row: r, col: c, tile: lineTile(board.lines[r]!), ...autoOf(auto) });
    return c;
  };
  if (col !== null && !wallLegal(s, by, col))
    return err('bad-space', 'That space can’t take this tile.');
  w.row = runWall(board, w.score, row, greyOf(s), lid, choose);
  for (const t of lid) addTo(g.lid, t);
  if (Object.values(g.walls!).every((x) => x.row === null)) wallsDone(s, now);
  return null;
}

/** Whether a space is one the waiting line's tile may take. */
function wallLegal(s: MosaicState, by: PlayerId, col: number) {
  const g = s.game!;
  const w = g.walls?.[by];
  if (!w || w.row === null) return false;
  return wallSpacesFor(g.players[by]!, w.row, greyOf(s)).includes(col);
}

const wallSpacesFor = (board: Board, row: number, grey: boolean) =>
  wallSpaces(board.wall, row, board.lines[row]!, grey);

/** Every wall-tiling is done: the round's scores, then the end or a pause to watch it. */
function wallsDone(s: MosaicState, now: number) {
  const g = s.game!;
  const ids = active(g);
  const scores: Record<PlayerId, PlayerScore> = {};
  for (const id of ids) {
    const w = g.walls?.[id];
    if (w) scores[id] = w.score;
  }
  g.walls = null;
  g.scoring = { round: g.round, players: scores, last: false };
  log(s, { kind: 'round' });
  if (ids.some((id) => fullRows(g.players[id]!.wall) > 0)) {
    finish(s);
    return;
  }
  g.stage = 'tiling';
  g.tilingUntil = now + TILING_BASE_MS + TILING_PER_PLAYER_MS * ids.length;
  g.ready = [];
}

/**
 * The next round: whoever took the marker starts (nobody took it: the same player starts again;
 * they were removed: the next seat on), the marker goes back to the centre and the factories are
 * filled. With no tiles anywhere, the game ends as it stands.
 */
function nextRound(s: MosaicState, rng: Rng) {
  const g = s.game!;
  const holder = g.marker === 'centre' ? g.starter : g.marker;
  g.starter = g.removed.includes(holder) ? nextPlayer(g, holder) : holder;
  g.marker = 'centre';
  g.round += 1;
  g.stage = 'draft';
  g.tilingUntil = null;
  g.ready = [];
  g.current = g.starter;
  g.centre = noCounts();
  g.walls = null;
  flip(s, g, rng);
  fillFactories(g, rng);
  if (tableEmpty(g)) finish(s, 'empty');
}

/** What a group taken from a place holds: the colour's tiles and, with it, the jokers. */
export function groupAt(
  g: Pick<Game, 'factories' | 'centre'>,
  source: Source,
  colour: Tile,
  withJokers: boolean,
): { count: number; jokers: number; rest: Tile[] } | null {
  const tiles =
    source === 'centre'
      ? TILES.flatMap((t) => Array<Tile>(countOf(g.centre, t)).fill(t))
      : g.factories[source];
  if (!tiles) return null;
  const count = tiles.filter((t) => t === colour).length;
  const jokers = colour !== 'joker' && withJokers ? tiles.filter((t) => t === 'joker').length : 0;
  const rest = tiles.filter((t) => t !== colour && !(jokers && t === 'joker'));
  return { count, jokers, rest };
}

function take(
  s: MosaicState,
  by: PlayerId,
  move: Move,
  now: number,
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const { source, colour, target } = move;
  const board = g.players[by];
  if (!board || g.removed.includes(by)) return err('not-playing', 'You are not in this game.');
  if (g.stage !== 'draft') return err('wrong-stage', 'Wait for the next round.');
  if (g.current !== by) return err('not-your-turn', 'It’s not your turn.');
  if (source !== 'centre' && (!g.factories[source] || gone(g.specials, source)))
    return err('no-factory', 'There is no such factory.');
  const grp = groupAt(g, source, colour, !!move.jokers);
  const where = source === 'centre' ? 'the centre has' : 'that factory has';
  if (!grp?.count)
    return err('not-there', `${where[0]!.toUpperCase()}${where.slice(1)} no tiles of that kind.`);
  if (move.jokers && !grp.jokers) return err('no-jokers', `No jokers: ${where} none.`);
  if (target !== 'floor') {
    const problem = lineProblem(board, target, colour, greyOf(s));
    if (problem) return err('bad-line', problem);
  }
  const special = source === 'centre' ? null : (g.specials?.[source] ?? null);
  // A special factory that sends its leftovers on needs to know where each colour goes.
  const split: Split = {};
  let sent: { left: number; right: number } | undefined;
  if (special?.kind === 'sf4' && grp.rest.length) {
    const { left, right } = neighbours(g.specials, g.factories.length, source as number);
    sent = { left: 0, right: 0 };
    for (const { tile, count } of leftoverGroups(grp.rest)) {
      const side = move.split?.[tile] ?? (left === null ? 'right' : right === null ? 'left' : null);
      if (!side) return err('split-needed', 'Say where each colour left behind goes.');
      split[tile] = side;
      sent[side] += count;
    }
  }
  const total = grp.count + grp.jokers;
  const marker = source === 'centre' && g.marker === 'centre';
  // Tiles thrown on the floor that a line could have taken.
  const dumped = target === 'floor' && linesFor(board, colour, greyOf(s)).length ? total : 0;
  if (source === 'centre') {
    if (colour === 'joker' || grp.jokers) g.centre.joker = 0;
    if (colour !== 'joker') g.centre[colour] = 0;
  } else {
    g.factories[source] = [];
    if (special?.kind === 'sf3') g.factories[source] = [...grp.rest];
    else if (special?.kind === 'sf4' && sent) {
      const { left, right } = neighbours(g.specials, g.factories.length, source);
      for (const t of grp.rest) {
        const to = split[t] === 'left' ? left : right;
        g.factories[to!]!.push(t);
      }
      for (const f of g.factories) f.sort(byTile);
    } else for (const t of grp.rest) addTo(g.centre, t);
    if (special?.kind === 'sf5') {
      special.holder = by;
      board.shield = null;
    }
  }
  if (marker) g.marker = by;
  const r = place(board, colour, grp.count, target, marker, grp.jokers);
  // What spilled past a full floor: the colour's tiles spill first, then the jokers.
  const spilled: Tile[] = [
    ...Array<Tile>(grp.count).fill(colour),
    ...Array<Tile>(grp.jokers).fill('joker'),
  ].slice(total - r.toLid);
  for (const t of spilled) addTo(g.lid, t);
  g.turns += 1;
  log(s, {
    kind: 'take',
    by,
    source,
    colour,
    count: total,
    ...(grp.jokers && { jokers: grp.jokers }),
    ...(colour === 'joker' && { jokers: total }),
    ...(special && { special: special.kind }),
    ...(sent && { sent }),
    ...(r.shielded && { shielded: true }),
    target,
    toLine: r.toLine,
    toFloor: r.toFloor,
    toLid: r.toLid,
    marker,
    penalty: r.penalty,
    leftover: grp.rest.length,
    dumped,
    ...autoOf(auto),
  });
  if (tableEmpty(g)) endRound(s, now);
  else g.current = nextPlayer(g, by);
  return null;
}

/**
 * The host takes a player who left out of the game: their pattern-line and floor tiles go to the
 * lid, their board leaves play, and they no longer take turns or score. If it was their turn, the
 * next player goes on; with one player left, the game ends.
 */
function remove(s: MosaicState, player: PlayerId, now: number): GameError | null {
  const g = s.game!;
  const b = g.players[player];
  if (!b || g.left[player] === undefined)
    return err('not-left', 'Only a player who has left can be removed.');
  if (g.removed.includes(player)) return err('already-removed', 'They are already out.');
  for (const l of b.lines) {
    if (l.colour) g.lid[l.colour] += l.count - (l.jokers ?? 0);
    if (l.jokers) addTo(g.lid, 'joker', l.jokers);
  }
  for (const f of b.floor) if (f !== 'first') addTo(g.lid, f);
  if (b.shield && b.shield !== 'first') addTo(g.lid, b.shield);
  delete b.shield;
  b.lines = emptyBoard().lines;
  b.floor = [];
  g.removed.push(player);
  if (g.walls) delete g.walls[player];
  g.ready = g.ready.filter((id) => id !== player);
  log(s, { kind: 'removed', player });
  if (active(g).length <= 1) {
    finish(s, 'alone');
    return null;
  }
  if (g.stage === 'draft' && g.current === player) g.current = nextPlayer(g, player);
  if (g.stage === 'tiling') maybeNextRound(s, now);
  if (g.stage === 'wall' && Object.values(g.walls ?? {}).every((w) => w.row === null))
    wallsDone(s, now);
  return null;
}

/** During the wall-tiling: once every player still here is ready, the next round starts. */
function maybeNextRound(s: MosaicState, now: number) {
  const g = s.game!;
  const waiting = active(g).filter((id) => g.left[id] === undefined && !g.ready.includes(id));
  if (!waiting.length) nextRound(s, hiddenRng(s, now));
}

// ---- Moves made for a player ----

/** The safe move for a player out of time, away, or acted for: the bot's pick, never random. */
function autoTurn(s: MosaicState, who: PlayerId, why: Auto, now: number): boolean {
  const g = s.game!;
  if (g.stage === 'wall') {
    const row = g.walls?.[who]?.row;
    if (row === null || row === undefined) return false;
    return !wallPlace(s, who, row, null, now, why);
  }
  if (g.stage !== 'draft' || g.current !== who) return false;
  const move = bestMove(view(s, who), who, null);
  if (!move) return false;
  return !take(s, who, move, now, why);
}

// ---- Lobby ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

function seatWaiting(s: MosaicState) {
  let free = MAX_PLAYERS - players(s).length;
  for (const seat of Object.values(s.seats)) {
    if (free <= 0) break;
    if (!seat.waiting || seat.playing) continue;
    delete seat.waiting;
    seat.playing = true;
    free -= 1;
  }
}

function sit(state: MosaicState, playing: boolean, ctx: Ctx): Result {
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

/** Seats of players who left during the last game go once it's over. */
function dropLeft(s: MosaicState) {
  for (const id of Object.keys(s.game?.left ?? {})) delete s.seats[id];
}

function deal(state: MosaicState, ctx: Ctx): Result {
  const s = draft(state);
  dropLeft(s);
  seatWaiting(s);
  const seated = players(s);
  if (seated.length < MIN_PLAYERS) return err('too-few', `${MIN_PLAYERS} players are needed.`);
  if (seated.length > MAX_PLAYERS) return err('too-many', `At most ${MAX_PLAYERS} can play.`);
  const rng = ctx.rng;
  // The first game's first player is random; each new game starts one seat on.
  const last = s.lastFirst ? seated.indexOf(s.lastFirst) : -1;
  const first = testBag?.firstSeat
    ? 0
    : last >= 0
      ? (last + 1) % seated.length
      : rng.int(seated.length);
  const starter = seated[first]!;
  s.lastFirst = starter;
  // Jokers take the place of 2 tiles of each colour (1 each at 2 players).
  const jokers = s.settings.jokers ? JOKERS_FOR[seated.length]! : 0;
  const each = TILES_EACH - jokers / COLOURS.length;
  let bag = rng.shuffle<Tile>([
    ...COLOURS.flatMap((c) => Array<Colour>(each).fill(c)),
    ...Array<Tile>(jokers).fill('joker'),
  ]);
  const pl: Record<PlayerId, Board> = {};
  for (const id of seated) pl[id] = emptyBoard();
  // The rig: walls first (those tiles leave the bag), then the top of the bag.
  for (const [row, colours] of Object.entries(testBag?.wall ?? {}))
    for (const c of colours) {
      const at = bag.indexOf(c);
      if (at < 0) continue;
      bag.splice(at, 1);
      pl[starter]!.wall[Number(row)]![columnOf(Number(row), c)] = c;
    }
  const top: Tile[] = [];
  for (const c of (jokers ? testBag?.jokerTop : undefined) ?? testBag?.top ?? []) {
    const at = bag.indexOf(c);
    if (at < 0) continue;
    bag.splice(at, 1);
    top.push(c);
  }
  bag = [...top, ...bag];
  s.phase = 'playing';
  s.gamesPlayed += 1;
  s.log = [];
  s.game = {
    order: seated,
    players: pl,
    names: Object.fromEntries(seated.map((id) => [id, s.seats[id]!.name])),
    bag,
    lid: jokers ? { ...noCounts(), joker: 0 } : noCounts(),
    factories: Array.from({ length: FACTORIES_FOR[seated.length]! }, () => []),
    centre: noCounts(),
    marker: 'centre',
    starter,
    current: starter,
    round: 1,
    stage: 'draft',
    turns: 0,
    scoring: null,
    walls: null,
    tilingUntil: null,
    ready: [],
    left: {},
    removed: [],
    clock: null,
    winners: [],
  };
  log(s, { kind: 'start', first: starter });
  flip(s, s.game, rng);
  fillFactories(s.game, rng);
  s.seed = newSeed(rng);
  settle(s, ctx.now);
  return s;
}

function updateSettings(
  state: MosaicState,
  action: Extract<MosaicAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Settings change between games.');
  const s = draft(state);
  if (action.seconds !== undefined) s.settings.seconds = action.seconds;
  if (action.timerMode !== undefined) s.settings.timerMode = action.timerMode;
  for (const k of ['grey', 'jokers', 'specials'] as const)
    if (action[k] !== undefined) s.settings[k] = action[k];
  return s;
}

function backToLobby(state: MosaicState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'lobby') return err('wrong-phase', 'No game to leave.');
  const s = draft(state);
  dropLeft(s);
  s.phase = 'lobby';
  s.game = null;
  s.log = [];
  seatWaiting(s);
  return s;
}

// ---- In play ----

function inPlay(state: MosaicState, ctx: Ctx, fn: (s: MosaicState) => GameError | null): Result {
  if (state.phase !== 'playing' || !state.game) return err('not-playing', 'No game in play.');
  const s = draft(state);
  const e = fn(s);
  if (e) return e;
  settle(s, ctx.now);
  return s;
}

function reduce(state: MosaicState, action: MosaicAction, ctx: Ctx): Result {
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
    case 'take':
      return inPlay(state, ctx, (s) => take(s, by, action, ctx.now));
    case 'wall':
      return inPlay(state, ctx, (s) => wallPlace(s, by, action.row, action.col, ctx.now));
    case 'ready':
      return inPlay(state, ctx, (s) => {
        const g = s.game!;
        if (g.stage !== 'tiling') return err('wrong-stage', 'The round is under way.');
        if (!g.players[by] || g.removed.includes(by))
          return err('not-playing', 'You are not in this game.');
        if (!g.ready.includes(by)) g.ready.push(by);
        maybeNextRound(s, ctx.now);
        return null;
      });
    case 'skip-tiling': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) => {
        if (s.game!.stage !== 'tiling') return err('wrong-stage', 'The round is under way.');
        nextRound(s, hiddenRng(s, ctx.now));
        return null;
      });
    }
    case 'remove': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) => remove(s, action.player, ctx.now));
    }
    case 'act-for': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) => {
        const g = s.game!;
        const waiting =
          g.stage === 'wall'
            ? (g.walls?.[action.player]?.row ?? null) !== null
            : g.stage === 'draft' && g.current === action.player;
        if (!waiting) return err('not-waiting', 'The table isn’t waiting on that player.');
        return autoTurn(s, action.player, 'host', ctx.now)
          ? null
          : err('stuck', 'Nothing to do for them.');
      });
    }
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): MosaicState {
  let state: MosaicState = {
    phase: 'lobby',
    settings: { seconds: DEFAULT_SECONDS, timerMode: 'soft' },
    seed: newSeed(ctx.rng),
    seats: {},
    game: null,
    log: [],
    seq: 0,
    gamesPlayed: 0,
    lastFirst: null,
  };
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: MosaicState, player: PlayerInfo): MosaicState {
  const s = draft(state);
  const existing = s.seats[player.id];
  if (existing) {
    existing.name = player.name;
    const g = s.game;
    if (g?.names[player.id]) g.names[player.id] = player.name;
    // Back after leaving: they play their own turns again (unless the host removed them).
    if (g && g.left[player.id] !== undefined && !g.removed.includes(player.id)) {
      delete g.left[player.id];
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
 * Someone left for good. Between games their seat goes; mid-game they keep it, and the table
 * plays their turns with the safe move (after a short beat) until they come back or the game ends.
 */
function playerLeft(state: MosaicState, playerId: PlayerId, now: number): MosaicState {
  if (!state.seats[playerId]) return state;
  const s = draft(state);
  const g = s.game;
  if (s.phase === 'playing' && g?.players[playerId]) {
    if (g.left[playerId] === undefined) {
      g.left[playerId] = now;
      log(s, { kind: 'left', player: playerId });
      // Nobody waits on them to watch the wall-tiling.
      if (g.stage === 'tiling') maybeNextRound(s, now);
      settle(s, now);
    }
    return s;
  }
  delete s.seats[playerId];
  if (s.phase !== 'playing') seatWaiting(s);
  return s;
}

// ---- Timers ----

type Due = { at: number; why: 'left' | 'timer' | 'remind' | 'tiling'; who?: PlayerId };

function deadlines(state: MosaicState): Due[] {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return [];
  if (g.stage === 'tiling')
    return g.tilingUntil === null ? [] : [{ at: g.tilingUntil, why: 'tiling' }];
  if (!g.clock) return [];
  const out: Due[] = [];
  // Who the table waits on: the player whose turn it is, or everyone still choosing wall spaces.
  const waiting =
    g.stage === 'wall'
      ? Object.entries(g.walls ?? {}).flatMap(([id, w]) => (w.row === null ? [] : [id]))
      : [g.current];
  for (const who of waiting) {
    const gone = g.left[who];
    if (gone !== undefined)
      out.push({ at: Math.max(g.clock.since, gone) + LEFT_BEAT_MS, why: 'left', who });
  }
  const secs = state.settings.seconds;
  if (secs !== null && waiting.length) {
    const at = g.clock.since + secs * 1000;
    if (state.settings.timerMode === 'strict') out.push({ at, why: 'timer' });
    else if (!g.clock.reminded) out.push({ at, why: 'remind' });
  }
  return out.sort((a, b) => a.at - b.at);
}

function nextDeadline(state: MosaicState): number | null {
  return deadlines(state)[0]?.at ?? null;
}

function onDeadline(state: MosaicState, now: number): MosaicState {
  const due = deadlines(state)[0];
  if (!due || now < due.at) return state;
  const s = draft(state);
  const g = s.game!;
  const rng = hiddenRng(state, now);
  if (due.why === 'tiling') nextRound(s, rng);
  else if (due.why === 'remind') g.clock!.reminded = true;
  else if (g.stage === 'wall') {
    // A leaver's wall, or (strict) every wall still waiting: the leftmost spaces.
    const who = due.who
      ? [due.who]
      : Object.entries(g.walls ?? {}).flatMap(([id, w]) => (w.row === null ? [] : [id]));
    for (const id of who) if (g.stage === 'wall') autoTurn(s, id, due.why, now);
  } else if (!autoTurn(s, g.current, due.why, now)) g.clock = null;
  settle(s, now);
  s.seed = newSeed(rng);
  return s;
}

// ---- Views ----

const boardCopy = (b: Board): Board => ({
  lines: b.lines.map((l) => ({ ...l })),
  wall: b.wall.map((r) => [...r]),
  floor: [...b.floor],
  score: b.score,
  ...(b.shield !== undefined && { shield: b.shield }),
});

/** Everything on the table is public; only the bag's order (and the hidden seed) is not. */
function gameView(state: MosaicState, g: Game): GameView {
  const secs = state.settings.seconds;
  return {
    order: [...g.order],
    players: g.order.map((id) => ({
      id,
      name: state.seats[id]?.name ?? g.names[id] ?? 'Gone',
      ...boardCopy(g.players[id]!),
      left: g.left[id] !== undefined || !state.seats[id],
      removed: g.removed.includes(id),
    })),
    bag: countsOf(g.bag, g.lid.joker !== undefined),
    lid: { ...g.lid },
    factories: g.factories.map((f) => [...f]),
    specials: g.specials ? g.specials.map((x) => (x ? { ...x } : null)) : null,
    centre: { ...g.centre },
    marker: g.marker,
    starter: g.starter,
    current: g.current,
    round: g.round,
    stage: g.stage,
    turns: g.turns,
    scoring: g.scoring ? structuredClone(g.scoring) : null,
    walls: g.walls ? structuredClone(g.walls) : null,
    tilingUntil: g.tilingUntil,
    ready: [...g.ready],
    clock:
      g.clock && state.phase === 'playing' && g.stage !== 'tiling'
        ? {
            who: g.current,
            since: g.clock.since,
            deadline: secs === null ? null : g.clock.since + secs * 1000,
            reminded: g.clock.reminded,
          }
        : null,
    winners: [...g.winners],
  };
}

function view(state: MosaicState, viewer: PlayerId | null): MosaicView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
    ...(s.waiting && { waiting: true }),
  }));
  const g = state.game;
  return {
    phase: state.phase,
    settings: { ...state.settings },
    seats,
    me: seats.find((s) => s.id === viewer) ?? null,
    game: g ? gameView(state, g) : null,
    log: state.log.map((e) => ({ ...e })),
  };
}

export const mosaic: GameDefinition<MosaicState, MosaicAction, MosaicView> = {
  id: 'mosaic',
  name: 'Mosaic',
  description: 'Draft coloured tiles, fill your pattern lines and tile a wall that scores in runs.',
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
  awards: mosaicAwards,
  bot: mosaicBot,
  botInfo: {},
};
