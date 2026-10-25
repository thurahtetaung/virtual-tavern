import {
  type ActionCtx,
  type CreateCtx,
  type Drawing,
  GameError,
  type PlayerId,
  type PlayerInfo,
  type Rng,
  createRng,
  validateDrawing,
} from '@vt/game-sdk';
import { hintLines, hostLinesOf, titleGroups } from './content.ts';
import { type HostPart, bidMoment, say } from './host.ts';
import { artOf, sendHints } from './hints.ts';
import { money } from './lines.ts';
import { deal as dealItems, halfAt, wishLists } from './setup.ts';
import {
  BANK_FIRST_MS,
  BANK_LATER_MS,
  BANK_TRIGGER,
  BID_BUTTONS,
  BID_GAP_MS,
  BID_STEP,
  COMMISSION,
  DRAW_GRACE_MS,
  type Game,
  type GoingOnceAction,
  type GoingOnceState,
  type Item,
  LOAN_CASH,
  LOAN_DEBT,
  type LogEntry,
  MAX_BANK_CALLS,
  MAX_LOANS,
  MAX_LOG,
  MAX_PLAYERS,
  MAX_USED_GROUPS,
  MIN_PLAYERS,
  OPENING_BID,
  PADDLE_SHAPES,
  RECENT_BIDS,
  type PlayerState,
  type Rig,
  SCREW_PICK_MS,
  STARTING_CASH,
  type Seat,
  TIMINGS,
  type Timing,
  type TitleGroupRef,
} from './types.ts';

type Ctx = ActionCtx;
type Result = GoingOnceState | GameError;

const err = (code: string, message: string) => new GameError(code, message);
const draft = (s: GoingOnceState): GoingOnceState => structuredClone(s);
const newSeed = (rng: Rng) => rng.int(2 ** 32);
const hiddenRng = (state: GoingOnceState, now: number) => createRng((state.seed ^ now) >>> 0);

// ---- Test rig (browser tests only) ----

let rigAllowed = false;
/** Lets the host fix the deal and speed up the clock (`rig`). Test servers only. */
export function enableTestRig(on = true): void {
  rigAllowed = on;
}
export const testRigAllowed = () => rigAllowed;

// ---- Reading the table ----

export function players(state: GoingOnceState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

/** The clock for this room: the host's pace, sped up by the test rig. */
export function timing(state: GoingOnceState): Timing {
  const t = TIMINGS[state.settings.pace];
  const k = state.rig?.scale ?? 1;
  return {
    open: t.open * k,
    quiet: t.quiet * k,
    once: t.once * k,
    twice: t.twice * k,
    sold: t.sold * k,
    halftime: t.halftime * k,
  };
}

const screwMs = (state: GoingOnceState) => SCREW_PICK_MS * (state.rig?.scale ?? 1);
const scaled = (state: GoingOnceState, ms: number) => ms * (state.rig?.scale ?? 1);

/** Above this, "going once" and "going twice" come faster at the Normal pace. */
export const FAST_CALLS_ABOVE = 1000;

/** How long a close stage lasts now: the pace's, with faster calls above $1,000 at Normal pace. */
export function closeMs(
  state: Pick<GoingOnceState, 'settings' | 'rig'>,
  close: 'open' | 'quiet' | 'once' | 'twice',
  bid: { amount: number } | null,
): number {
  const t = TIMINGS[state.settings.pace];
  const k = state.rig?.scale ?? 1;
  const fast =
    state.settings.pace === 'normal' &&
    (close === 'once' || close === 'twice') &&
    (bid?.amount ?? 0) > FAST_CALLS_ABOVE;
  return (fast ? 1500 : t[close]) * k;
}

/** The drawing clock: when half the time and ten seconds remain, and when it ends (before grace). */
export function drawTimes(state: GoingOnceState, start: number) {
  const total = scaled(state, state.settings.drawSeconds * 1000);
  return {
    half: start + total / 2,
    ten: start + total - scaled(state, 10_000),
    end: start + total,
  };
}

/** The bids the buttons offer: $400/$500/$600 before any bid, then the next three steps. */
export function bidSteps(bid: { amount: number } | null): number[] {
  const base = bid ? bid.amount + BID_STEP : OPENING_BID;
  return Array.from({ length: BID_BUTTONS }, (_, i) => base + i * BID_STEP);
}

/** Players still at the table (not gone for good). */
export const present = (g: Game) => g.order.filter((id) => !g.left.includes(id));

/**
 * Who hasn't decided at this bank visit. Players with three loans decide too (they can only say
 * no), so nobody learns who is out of credit.
 */
export const loanWaiting = (g: Game) => present(g).filter((id) => !g.bankDone.includes(id));

/** Who still has a drawing to send. */
export const drawWaiting = (g: Game) =>
  present(g).filter((id) => g.prompts[id]!.some((item) => !g.items[item]!.drawing));

/** Whether the screws are unlocked (the second half). */
export const screwsOn = (g: Game) => g.auction !== null && g.auction.lot >= halfAt(g.lots.length);

/** Why a player can't call the bank now, or null if they can. Undefined: no button at all. */
export function bankRefusal(g: Game, id: PlayerId): string | null | undefined {
  const a = g.auction;
  if (g.stage !== 'auction' || !a || !g.bankOpened) return undefined;
  if (a.lot >= g.lots.length - 1) return undefined;
  const p = g.players[id]!;
  if (p.loans >= MAX_LOANS) return 'Bad credit: no more loans.';
  if (p.bankCalls >= MAX_BANK_CALLS) return 'Stop calling: three calls is the limit.';
  if (a.bankCalled.length) return 'The bank has been called: it opens after this lot.';
  return null;
}

/** Who can be screwed now: anyone else at the table but the top bidder. */
export function screwTargets(g: Game, by: PlayerId): PlayerId[] {
  const a = g.auction;
  return present(g).filter((id) => id !== by && id !== a?.bid?.by);
}

// ---- Log ----

type NewLog = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, 'id' | 'lot'>
    : never
  : never;

function log(s: GoingOnceState, entry: NewLog) {
  s.seq += 1;
  s.log.push({ ...entry, id: s.seq, lot: s.game?.auction?.lot ?? -1 });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

// ---- The flow ----

type Parts = HostPart[];

/** The host's call-out before a lot, if anyone is due one: a quiet bidder, or the only one without art. */
function callOut(s: GoingOnceState, lot: number): Parts {
  const g = s.game!;
  const here = present(g);
  const quiet = here.find(
    (id) =>
      lot >= 3 &&
      g.players[id]!.cash >= 900 &&
      lot - (g.lastBidLot[id] ?? -1) > 3 &&
      lot - (g.calledOut.quiet[id] ?? -9) >= 3,
  );
  if (quiet) {
    g.calledOut.quiet[quiet] = lot;
    return [{ moment: 'quiet', player: g.names[quiet]! }];
  }
  const owners = new Set(
    Object.values(g.items).flatMap((i) => (i.sale?.buyer ? [i.sale.buyer] : [])),
  );
  const without = here.filter((id) => !owners.has(id));
  if (without.length === 1 && here.length > 1 && !g.calledOut.empty.includes(without[0]!)) {
    g.calledOut.empty.push(without[0]!);
    return [{ moment: 'no-art', player: g.names[without[0]!]! }];
  }
  return [];
}

function startLot(s: GoingOnceState, index: number, now: number, rng: Rng, lead: Parts = []) {
  const g = s.game!;
  g.stage = 'auction';
  g.until = 0;
  g.auction = {
    lot: index,
    seq: 0,
    bid: null,
    close: 'open',
    closeAt: now + timing(s).open,
    screw: null,
    screwed: null,
    bankCalled: [],
    bidders: [],
    recent: [],
  };
  sendHints(s, rng);
  say(
    s,
    rng,
    [...lead, ...callOut(s, index), index === 0 ? ['opening-first', 'opening'] : 'opening'],
    true,
  );
}

function endGame(s: GoingOnceState) {
  const g = s.game!;
  s.phase = 'over';
  g.stage = 'done';
  g.until = 0;
  const scores = g.order.map((id) => {
    const p = g.players[id]!;
    return p.cash - p.debt + artOf(g, id);
  });
  const best = Math.max(...scores);
  g.winners = g.order.filter((_, i) => scores[i] === best);
}

function endGameWithHost(s: GoingOnceState, rng: Rng) {
  endGame(s);
  say(s, rng, ['end-intro'], true);
}

/** The drawing is over: unsent drawings become house pictures, wish lists go out, lot 1 opens. */
function endDraw(s: GoingOnceState, now: number, rng: Rng) {
  const g = s.game!;
  const drawn = Object.values(g.items).filter((i) => i.drawing).length;
  if (drawn === 0) {
    // Nobody drew anything: one more round with new titles, then the game is off.
    if (g.redraws === 0 && g.spares) {
      redeal(s, g.spares, now, rng);
      say(s, rng, ['redraw', 'draw-start'], true);
      return;
    }
    s.phase = 'over';
    g.stage = 'done';
    g.until = 0;
    g.ended = 'no-drawings';
    g.winners = [];
    say(s, rng, ['no-drawings'], true);
    return;
  }
  const missing = Object.values(g.items).some((i) => i.drawer && !i.drawing);
  const wish = wishLists(g.order, g.items, rng, s.rig?.fixed);
  for (const id of g.order) g.players[id]!.wish = wish[id] ?? [];
  startLot(s, 0, now, rng, [missing ? 'draw-missing' : 'draw-all-in']);
}

/** Deals the drawing again from the spare title groups (nothing else has happened yet). */
function redeal(s: GoingOnceState, groups: [TitleGroupRef, TitleGroupRef], now: number, rng: Rng) {
  const g = s.game!;
  const dealt = dealItems(g.order, groups, rng, s.rig?.fixed);
  g.items = dealt.items;
  g.lots = dealt.lots;
  g.prompts = dealt.prompts;
  g.redraws += 1;
  g.spares = null;
  g.nudges = 0;
  g.drawStart = now;
  g.until = drawTimes(s, now).end + DRAW_GRACE_MS;
  s.usedGroups = [...s.usedGroups, ...groups.map((x) => x.key)].slice(-MAX_USED_GROUPS);
}

/** The hammer falls on the current lot. */
function hammer(s: GoingOnceState, now: number, rng: Rng) {
  const g = s.game!;
  const a = g.auction!;
  const item = g.items[g.lots[a.lot]!]!;
  if (a.bid) {
    const buyer = g.players[a.bid.by]!;
    buyer.cash -= a.bid.amount;
    const commission =
      item.artist && item.artist !== a.bid.by ? Math.floor(a.bid.amount * COMMISSION) : 0;
    if (commission) g.players[item.artist!]!.cash += commission;
    item.sale = {
      buyer: a.bid.by,
      price: a.bid.amount,
      commission,
      screwedBy: a.screwed?.target === a.bid.by ? a.screwed.by : null,
    };
  } else item.sale = { buyer: null, price: 0, commission: 0, screwedBy: null };
  const sale = item.sale;
  if (sale.buyer) {
    g.unsoldRun = 0;
    const profit = item.value - sale.price;
    const remark =
      item.artist === sale.buyer
        ? sale.screwedBy
          ? 'own-art-screwed'
          : { moment: 'own-art', player: g.names[sale.buyer]! }
        : profit >= 800
          ? 'windfall'
          : profit <= -800
            ? 'ouch'
            : Math.abs(profit) <= 200
              ? 'even'
              : null;
    say(
      s,
      rng,
      [
        [{ moment: 'congrats', player: g.names[sale.buyer]! }, 'sold'],
        ...(remark ? [remark] : []),
        ...(sale.commission ? [sale.price >= 1000 ? 'commission-high' : 'commission-low'] : []),
      ],
      true,
    );
  } else {
    g.unsoldRun += 1;
    say(s, rng, ['unsold'], true);
  }
  g.bankCallers = [...a.bankCalled];
  g.stage = 'sold';
  g.until = now + timing(s).sold;
}

/** Whether the bank visits before the next lot. */
function bankDue(g: Game, next: number): boolean {
  if (next >= g.lots.length) return false;
  if (!g.bankOpened) return present(g).some((id) => g.players[id]!.cash <= BANK_TRIGGER);
  return g.bankCallers.length > 0;
}

function openBank(s: GoingOnceState, now: number, rng: Rng) {
  const g = s.game!;
  const first = !g.bankOpened;
  g.stage = 'bank';
  g.bankOpened = true;
  g.bankDone = [];
  g.bankTook = [];
  g.until = now + scaled(s, first ? BANK_FIRST_MS : BANK_LATER_MS);
  say(s, rng, [first ? 'bank-first' : 'bank-called'], true);
}

function closeBank(g: Game) {
  for (const id of g.bankCallers) {
    const p = g.players[id]!;
    if (!g.bankTook.includes(id) && !p.sent.includes('prankCall')) p.pending.push('prankCall');
  }
  g.bankCallers = [];
  g.bankDone = [];
  g.bankTook = [];
}

/** After the Sold card, the half-time card or the bank: the next step. */
function advance(s: GoingOnceState, from: 'sold' | 'halftime' | 'bank', now: number, rng: Rng) {
  const g = s.game!;
  const done = g.auction!.lot;
  const next = done + 1;
  if (from === 'sold' && next === halfAt(g.lots.length) && next < g.lots.length) {
    g.stage = 'halftime';
    g.until = now + timing(s).halftime;
    say(s, rng, ['halftime'], true);
    return;
  }
  if (from === 'bank') closeBank(g);
  else if (bankDue(g, next)) {
    openBank(s, now, rng);
    if (loanWaiting(g).length === 0) {
      closeBank(g);
    } else return;
  }
  if (next >= g.lots.length) endGameWithHost(s, rng);
  else startLot(s, next, now, rng);
}

// ---- Actions in play ----

function draw(
  s: GoingOnceState,
  by: PlayerId,
  itemId: string,
  raw: Drawing,
  now: number,
  rng: Rng,
) {
  const g = s.game!;
  if (g.stage !== 'draw') return err('not-drawing', 'The drawing time is over.');
  if (now > g.until) return err('too-late', 'Time ran out before your drawing arrived.');
  const item = g.items[itemId];
  if (!item || item.drawer !== by) return err('not-yours', 'That isn’t one of your titles.');
  if (item.drawing) return err('sent', 'You already sent that one.');
  const check = validateDrawing(raw);
  if (!check.ok) return err(check.code, check.message);
  item.drawing = check.drawing;
  item.artist = by;
  if (drawWaiting(g).length === 0) endDraw(s, now, rng);
  return null;
}

function bid(s: GoingOnceState, by: PlayerId, amount: number, seq: number, now: number, rng: Rng) {
  const g = s.game!;
  const a = g.auction;
  const p = g.players[by];
  if (!p) return err('not-playing', 'You are not in this game.');
  if (g.stage === 'sold') return err('too-late', 'Sold just before your bid.');
  if (g.stage !== 'auction' || !a) return err('no-auction', 'Nothing is up for auction right now.');
  if (a.screw)
    return err('screwing', `${g.names[a.screw.by]} is choosing who to screw: hold your horses.`);
  if (seq !== a.seq)
    return err(
      'too-late',
      a.bid
        ? `Too late: ${g.names[a.bid.by]} bid ${money(a.bid.amount)}.`
        : 'Too late: the price changed.',
    );
  if (a.bid?.by === by) return err('leading', 'You already have the top bid.');
  if (!bidSteps(a.bid).includes(amount))
    return err('bad-bid', 'Bid one of the amounts on the buttons.');
  if (amount > p.cash) return err('cash', 'You don’t have that much cash.');
  if (now - p.lastBidAt < BID_GAP_MS) return err('too-fast', 'One bid at a time!');
  a.bid = { by, amount };
  a.seq += 1;
  a.screwed = null;
  a.recent = [...(a.recent ?? []), { by, amount, forced: false }].slice(-RECENT_BIDS);
  if (!a.bidders.includes(by)) a.bidders.push(by);
  a.close = 'quiet';
  a.closeAt = now + timing(s).quiet;
  p.bids += 1;
  p.lastBidAt = now;
  g.lastBidLot[by] = a.lot;
  say(s, rng, [bidMoment(amount)]);
  return null;
}

function screw(s: GoingOnceState, by: PlayerId, now: number) {
  const g = s.game!;
  const a = g.auction;
  const p = g.players[by];
  if (!p) return err('not-playing', 'You are not in this game.');
  if (g.stage !== 'auction' || !a) return err('no-auction', 'Nothing is up for auction right now.');
  if (!screwsOn(g)) return err('locked', 'Screws unlock at half-time.');
  if (!p.screw) return err('no-screw', 'You’ve used your screw.');
  if (a.screw) return err('screwing', `${g.names[a.screw.by]} is already screwing someone.`);
  if (a.screwed) return err('screwed', 'No screwing until someone makes a free bid.');
  p.screw = false;
  a.screw = { by, until: now + screwMs(s), left: Math.max(0, a.closeAt - now) };
  return null;
}

function resumeClock(s: GoingOnceState, now: number) {
  const a = s.game!.auction!;
  a.closeAt = now + a.screw!.left;
  a.screw = null;
}

function screwPick(s: GoingOnceState, by: PlayerId, target: PlayerId, now: number, rng: Rng) {
  const g = s.game!;
  const a = g.auction;
  if (g.stage !== 'auction' || !a?.screw || a.screw.by !== by)
    return err('not-screwing', 'You aren’t aiming a screw.');
  if (!screwTargets(g, by).includes(target))
    return err('bad-target', 'Pick another player (not the top bidder).');
  const amount = a.bid ? a.bid.amount + BID_STEP : OPENING_BID;
  if (g.players[target]!.cash < amount) {
    log(s, { kind: 'screw', by, target, outcome: 'failed', amount });
    resumeClock(s, now);
    say(s, rng, ['screw-fail']);
    return null;
  }
  a.screw = null;
  a.bid = { by: target, amount };
  a.seq += 1;
  a.screwed = { target, by };
  a.recent = [...(a.recent ?? []), { by: target, amount, forced: true }].slice(-RECENT_BIDS);
  if (!a.bidders.includes(target)) a.bidders.push(target);
  a.close = 'quiet';
  a.closeAt = now + timing(s).quiet;
  log(s, { kind: 'screw', by, target, outcome: 'forced', amount });
  say(s, rng, [bidMoment(amount)]);
  return null;
}

function callBank(s: GoingOnceState, by: PlayerId) {
  const g = s.game!;
  const why = bankRefusal(g, by);
  if (why === undefined) return err('no-bank', 'You can’t call the bank right now.');
  if (why) return err('bank-refused', why);
  g.players[by]!.bankCalls += 1;
  g.auction!.bankCalled.push(by);
  return null;
}

function loan(s: GoingOnceState, by: PlayerId, take: boolean, now: number, rng: Rng) {
  const g = s.game!;
  if (g.stage !== 'bank') return err('no-bank', 'The bank isn’t open.');
  const p = g.players[by];
  if (!p) return err('not-playing', 'You are not in this game.');
  if (g.bankDone.includes(by)) return err('decided', 'You’ve already decided at this visit.');
  if (take) {
    if (p.loans >= MAX_LOANS) return err('bad-credit', 'Bad credit: no more loans.');
    p.cash += LOAN_CASH;
    p.debt += LOAN_DEBT;
    p.loans += 1;
    g.bankTook.push(by);
    if (p.loans === 1) p.pending.push('firstLoan');
    if (p.loans === MAX_LOANS) p.pending.push('thirdLoan');
  }
  g.bankDone.push(by);
  if (loanWaiting(g).length === 0) advance(s, 'bank', now, rng);
  return null;
}

function hide(s: GoingOnceState, itemId: string, hidden: boolean) {
  const g = s.game!;
  const item = g.items[itemId];
  if (!item?.drawing) return err('no-drawing', 'There is no drawing to hide.');
  if (item.hidden === hidden) return null;
  item.hidden = hidden;
  log(s, { kind: 'hidden', item: itemId, hidden });
  return null;
}

function skip(s: GoingOnceState, now: number, rng: Rng) {
  const g = s.game!;
  if (g.stage === 'sold' || g.stage === 'halftime' || g.stage === 'bank') {
    advance(s, g.stage, now, rng);
    return null;
  }
  return err('nothing-to-skip', 'Nothing to skip right now.');
}

// ---- Lobby ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

/** Until the host picks a pace, it follows the table: Fast at 3 players, else Normal. */
function defaultPace(s: GoingOnceState) {
  if (s.settings.paceChosen || s.phase === 'playing') return;
  s.settings.pace = players(s).length === 3 ? 'fast' : 'normal';
}

function seatWaiting(s: GoingOnceState) {
  let free = MAX_PLAYERS - players(s).length;
  for (const seat of Object.values(s.seats)) {
    if (free <= 0) break;
    if (!seat.waiting || seat.playing) continue;
    delete seat.waiting;
    seat.playing = true;
    free -= 1;
  }
}

/** Players who left during the game lose their seats when it ends. */
function dropLeft(s: GoingOnceState) {
  for (const id of s.game?.left ?? []) delete s.seats[id];
}

const countGroups = (s: GoingOnceState, ctx: CreateCtx) => {
  s.groupsAvailable = titleGroups(ctx.content).length;
};

function sit(state: GoingOnceState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this room.');
  if (state.phase === 'playing' && state.game?.players[ctx.by])
    return err('in-progress', 'You can sit down or stand up between games.');
  if (playing && !seat.playing && players(state).length >= MAX_PLAYERS)
    return err('full', `Only ${MAX_PLAYERS} can play.`);
  const s = draft(state);
  const mine = s.seats[ctx.by]!;
  delete mine.waiting;
  if (s.phase === 'playing' && playing) mine.waiting = true;
  else mine.playing = playing;
  if (s.phase === 'lobby') countGroups(s, ctx);
  defaultPace(s);
  return s;
}

function start(state: GoingOnceState, ctx: Ctx): Result {
  const s = draft(state);
  dropLeft(s);
  seatWaiting(s);
  defaultPace(s);
  const order = players(s);
  if (order.length < MIN_PLAYERS) return err('too-few', `${MIN_PLAYERS} players are needed.`);
  if (order.length > MAX_PLAYERS) return err('too-many', `At most ${MAX_PLAYERS} can play.`);
  const all = titleGroups(ctx.content);
  s.groupsAvailable = all.length;
  const fixed = s.rig?.fixed ?? false;
  const fit = all.filter((g) => g.titles.length >= order.length + 1);
  if (fit.length < 2)
    return err('no-content', 'No title groups yet: an admin has to import them first.');
  let fresh = fit.filter((g) => !s.usedGroups.includes(g.key));
  if (fresh.length < 2) {
    s.usedGroups = [];
    fresh = fit;
  }
  const order4 = fixed ? fresh : ctx.rng.shuffle(fresh);
  const groups = [order4[0]!, order4[1]!] as const;
  // Spares for a redraw: two more unused groups, else other groups, else the same two again.
  const others = fit.filter((g) => g !== groups[0] && g !== groups[1]);
  const pool = [
    ...order4.slice(2),
    ...(fixed ? others : ctx.rng.shuffle(others)).filter((g) => !order4.slice(2).includes(g)),
  ];
  const spares: [TitleGroupRef, TitleGroupRef] =
    pool.length >= 2 ? [pool[0]!, pool[1]!] : [groups[0], groups[1]];
  s.usedGroups = [...s.usedGroups, ...groups.map((g) => g.key)].slice(-MAX_USED_GROUPS);
  const dealt = dealItems(order, groups, ctx.rng, fixed);
  const cash = s.rig?.cash ?? STARTING_CASH;
  const pl: Record<PlayerId, PlayerState> = {};
  for (const id of order)
    pl[id] = {
      cash,
      debt: 0,
      loans: 0,
      bankCalls: 0,
      screw: true,
      bids: 0,
      wish: [],
      messages: [],
      sent: [],
      pending: [],
      lastBidAt: 0,
    };
  s.phase = 'playing';
  s.gamesPlayed += 1;
  s.log = [];
  s.game = {
    order,
    names: Object.fromEntries(order.map((id) => [id, s.seats[id]!.name])),
    players: pl,
    items: dealt.items,
    lots: dealt.lots,
    prompts: dealt.prompts,
    stage: 'draw',
    until: drawTimes(s, ctx.now).end + DRAW_GRACE_MS,
    drawStart: ctx.now,
    auction: null,
    bankOpened: false,
    bankDone: [],
    bankCallers: [],
    bankTook: [],
    left: [],
    winners: [],
    lines: hintLines(ctx.content),
    hostLines: hostLinesOf(ctx.content),
    host: null,
    spares: spares.map((g) => ({ key: g.key, titles: [...g.titles], house: [...g.house] })) as [
      TitleGroupRef,
      TitleGroupRef,
    ],
    redraws: 0,
    ended: null,
    nudges: 0,
    unsoldRun: 0,
    paddles: Object.fromEntries(
      (fixed ? order.map((_, i) => i) : ctx.rng.shuffle([...Array(PADDLE_SHAPES).keys()]))
        .slice(0, order.length)
        .map((shape, i) => [order[i]!, shape % PADDLE_SHAPES]),
    ),
    lastBidLot: {},
    calledOut: { quiet: {}, empty: [] },
  };
  say(s, ctx.rng, ['draw-start']);
  s.seed = newSeed(ctx.rng);
  return s;
}

function updateSettings(
  state: GoingOnceState,
  action: Extract<GoingOnceAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Settings change between games.');
  const s = draft(state);
  if (action.drawSeconds !== undefined) s.settings.drawSeconds = action.drawSeconds;
  if (action.pace !== undefined) {
    s.settings.pace = action.pace;
    s.settings.paceChosen = true;
  }
  countGroups(s, ctx);
  return s;
}

function backToLobby(state: GoingOnceState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'lobby') return err('wrong-phase', 'No game to leave.');
  const s = draft(state);
  dropLeft(s);
  s.phase = 'lobby';
  s.game = null;
  s.log = [];
  seatWaiting(s);
  countGroups(s, ctx);
  return s;
}

function rig(state: GoingOnceState, r: Rig, ctx: Ctx): Result {
  if (!rigAllowed) return err('no-rig', 'This server doesn’t allow the test rig.');
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Rig the next game from the lobby.');
  const s = draft(state);
  s.rig = { scale: r.scale, fixed: r.fixed, ...(r.cash !== undefined && { cash: r.cash }) };
  return s;
}

// ---- Reduce ----

function inPlay(state: GoingOnceState, fn: (s: GoingOnceState) => GameError | null): Result {
  if (state.phase !== 'playing' || !state.game) return err('not-playing', 'No game in play.');
  const s = draft(state);
  const e = fn(s);
  return e ?? s;
}

export function reduce(state: GoingOnceState, action: GoingOnceAction, ctx: Ctx): Result {
  const by = ctx.by;
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'refresh': {
      if (state.phase !== 'lobby') return state;
      const s = draft(state);
      countGroups(s, ctx);
      return s;
    }
    case 'start': {
      const e = requireHost(ctx);
      if (e) return e;
      if (state.phase === 'playing') return err('in-progress', 'A game is already running.');
      return start(state, ctx);
    }
    case 'play-again': {
      const e = requireHost(ctx);
      if (e) return e;
      if (state.phase !== 'over') return err('wrong-phase', 'Finish the game first.');
      return start(state, ctx);
    }
    case 'back-to-lobby':
      return backToLobby(state, ctx);
    case 'rig':
      return rig(state, action, ctx);
    case 'draw':
      return inPlay(state, (s) => draw(s, by, action.item, action.drawing, ctx.now, ctx.rng));
    case 'bid':
      return inPlay(state, (s) => bid(s, by, action.amount, action.seq, ctx.now, ctx.rng));
    case 'screw':
      return inPlay(state, (s) => screw(s, by, ctx.now));
    case 'screw-pick':
      return inPlay(state, (s) => screwPick(s, by, action.target, ctx.now, ctx.rng));
    case 'call-bank':
      return inPlay(state, (s) => callBank(s, by));
    case 'loan':
      return inPlay(state, (s) => loan(s, by, action.take, ctx.now, ctx.rng));
    case 'hide': {
      const e = requireHost(ctx);
      if (e) return e;
      if (!state.game) return err('not-playing', 'No game in play.');
      const s = draft(state);
      return hide(s, action.item, action.hidden) ?? s;
    }
    case 'skip': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, (s) => skip(s, ctx.now, ctx.rng));
    }
  }
}

// ---- Players coming and going ----

export function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): GoingOnceState {
  let state: GoingOnceState = {
    phase: 'lobby',
    settings: { drawSeconds: 90, pace: 'normal' },
    seats: {},
    game: null,
    log: [],
    seq: 0,
    usedGroups: [],
    groupsAvailable: 0,
    gamesPlayed: 0,
    rig: null,
    seed: newSeed(ctx.rng),
  };
  countGroups(state, ctx);
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

export function playerJoined(state: GoingOnceState, player: PlayerInfo): GoingOnceState {
  const s = draft(state);
  const existing = s.seats[player.id];
  if (existing) {
    existing.name = player.name;
    const g = s.game;
    if (g?.names[player.id]) g.names[player.id] = player.name;
    if (g?.left.includes(player.id)) {
      g.left = g.left.filter((id) => id !== player.id);
      log(s, { kind: 'back', player: player.id });
    }
    return s;
  }
  const playing = s.phase !== 'playing' && players(s).length < MAX_PLAYERS;
  const seat: Seat = { name: player.name, playing, ...(!playing && { waiting: true }) };
  s.seats[player.id] = seat;
  defaultPace(s);
  return s;
}

/**
 * Someone left the room for good. Between games their seat goes. Mid-game they keep their place,
 * cash and art, as if they'd only gone quiet: the drawing doesn't wait for them, the bank stops
 * waiting, and a screw they were aiming is wasted.
 */
export function playerLeft(state: GoingOnceState, playerId: PlayerId, now: number): GoingOnceState {
  if (!state.seats[playerId]) return state;
  const s = draft(state);
  const g = s.game;
  if (s.phase !== 'playing' || !g?.players[playerId]) {
    delete s.seats[playerId];
    if (s.phase !== 'playing') seatWaiting(s);
    defaultPace(s);
    return s;
  }
  if (g.left.includes(playerId)) return s;
  g.left.push(playerId);
  log(s, { kind: 'left', player: playerId });
  const rng = hiddenRng(state, now);
  if (g.stage === 'draw' && drawWaiting(g).length === 0) endDraw(s, now, rng);
  else if (g.stage === 'bank' && loanWaiting(g).length === 0) advance(s, 'bank', now, rng);
  else if (g.stage === 'auction' && g.auction?.screw?.by === playerId) {
    log(s, { kind: 'screw', by: playerId, target: null, outcome: 'wasted' });
    resumeClock(s, now);
    say(s, rng, ['screw-lost']);
  }
  s.seed = newSeed(rng);
  return s;
}

// ---- Timers ----

export function nextDeadline(state: GoingOnceState): number | null {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return null;
  if (g.stage === 'auction') return g.auction!.screw ? g.auction!.screw.until : g.auction!.closeAt;
  if (g.stage === 'done') return null;
  if (g.stage === 'draw') {
    // The host's nudges at half time and with ten seconds left come first.
    const t = drawTimes(state, g.drawStart);
    const nudge = [t.half, t.ten][g.nudges];
    if (nudge !== undefined && nudge < g.until) return nudge;
  }
  return g.until;
}

export function onDeadline(state: GoingOnceState, now: number): GoingOnceState {
  const due = nextDeadline(state);
  if (due === null || now < due) return state;
  const s = draft(state);
  const g = s.game!;
  const rng = hiddenRng(state, now);
  switch (g.stage) {
    case 'draw':
      if (due < g.until) {
        say(s, rng, [g.nudges === 0 ? 'draw-halfway' : 'draw-seconds'], true);
        g.nudges += 1;
      } else endDraw(s, now, rng);
      break;
    case 'auction': {
      const a = g.auction!;
      if (a.screw) {
        log(s, { kind: 'screw', by: a.screw.by, target: null, outcome: 'wasted' });
        resumeClock(s, now);
        if (a.closeAt <= now) a.closeAt = now + 1;
        say(s, rng, ['screw-lost']);
        break;
      }
      if (a.close === 'open' || a.close === 'quiet') {
        if (!a.bid)
          say(s, rng, [
            a.lot === 0
              ? ['no-bids-first', 'no-bids-1']
              : g.unsoldRun > 0
                ? ['no-bids-2', 'no-bids-1']
                : 'no-bids-1',
          ]);
        else
          say(s, rng, [
            closeMs(s, 'once', a.bid) < TIMINGS[s.settings.pace].once * (s.rig?.scale ?? 1)
              ? ['going-once-fast', 'going-once']
              : 'going-once',
          ]);
        a.close = 'once';
        a.closeAt = now + closeMs(s, 'once', a.bid);
      } else if (a.close === 'once') {
        say(s, rng, [
          closeMs(s, 'twice', a.bid) < TIMINGS[s.settings.pace].twice * (s.rig?.scale ?? 1)
            ? ['going-twice-fast', 'going-twice']
            : 'going-twice',
        ]);
        a.close = 'twice';
        a.closeAt = now + closeMs(s, 'twice', a.bid);
      } else hammer(s, now, rng);
      break;
    }
    case 'sold':
    case 'halftime':
    case 'bank':
      advance(s, g.stage, now, rng);
      break;
    case 'done':
      break;
  }
  s.seed = newSeed(rng);
  return s;
}

/** Items in a game, for tests and the bot. */
export const itemsOf = (g: Game): Item[] => g.lots.map((id) => g.items[id]!);
