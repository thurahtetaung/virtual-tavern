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
import {
  CHANT_GAP_MS,
  CLIP_GAP_MS,
  type VoicePart,
  chantKey,
  clipTimes,
  clipsFor,
  clipsMs,
  leadIn,
  sayClips,
  speak,
  voiced,
} from './voice.ts';
import { artOf, sendHints } from './hints.ts';
import { PRACTICE_TIP, dealContacts, fillLine, money } from './lines.ts';
import { deal as dealItems, halfAt, wishLists } from './setup.ts';
import {
  BANK_FIRST_MS,
  BANK_LATER_MS,
  BANK_TRIGGER,
  BID_BUTTONS,
  BID_GAP_MS,
  BID_STEP,
  COMMISSION,
  DEFAULT_SETTINGS,
  DRAW_GRACE_MS,
  type Game,
  HOUSE_BIDDER,
  type GoingOnceAction,
  type Auction,
  type GoingOnceState,
  type Item,
  LOAN_CASH,
  LOAN_DEBT,
  LOT_INTRO_MS,
  type LogEntry,
  MAX_BANK_CALLS,
  MAX_LOANS,
  MAX_LOG,
  MAX_PLAYERS,
  MAX_USED_GROUPS,
  MIN_PLAYERS,
  OPENING_BID,
  PADDLE_SHAPES,
  PRACTICE_CASH,
  PRACTICE_MS,
  PRACTICE_VALUE,
  type Practice,
  RECENT_BIDS,
  type PlayerState,
  type Rig,
  BANK_RING_MS,
  BID_SETTLE_MS,
  ARTIST_FLIP_MS,
  COMMISSION_MS,
  SCREW_OUTCOME_MS,
  SOLD_BEAT_MS,
  SOLD_LINE_GAP_MS,
  SOLD_PAUSE_MS,
  SOLD_SHOWN_MS,
  SOLD_SPIN_MS,
  type SoldBeats,
  SCREW_PICK_MS,
  STARTING_CASH,
  type Seat,
  type Stage,
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
  const c = closeScale(state);
  return {
    open: t.open * c,
    quiet: t.quiet * c,
    once: t.once * c,
    twice: t.twice * c,
    sold: t.sold * k,
    halftime: t.halftime * k,
  };
}

/** The test rig's speed for the auction's close (it may keep the close at full length). */
const closeScale = (state: Pick<GoingOnceState, 'rig'>) =>
  state.rig?.closeScale ?? state.rig?.scale ?? 1;

const screwMs = (state: GoingOnceState) => SCREW_PICK_MS * (state.rig?.scale ?? 1);
const scaled = (state: GoingOnceState, ms: number) => ms * (state.rig?.scale ?? 1);

/** Above this, "going once" and "going twice" come faster at the Normal pace. */
export const FAST_CALLS_ABOVE = 1000;

/** How long a close stage lasts now: the pace's, with faster calls above $1,000 at Normal pace. */
export function closeMs(
  state: Pick<GoingOnceState, 'settings' | 'rig'>,
  close: 'intro' | 'open' | 'quiet' | 'once' | 'twice',
  bid: { amount: number } | null,
): number {
  const t = TIMINGS[state.settings.pace];
  const k = closeScale(state);
  if (close === 'intro') return LOT_INTRO_MS * k;
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
  // As the original, the button stays from the lot's start through its Sold wrap-up.
  if ((g.stage !== 'auction' && g.stage !== 'sold') || !a || !g.bankOpened) return undefined;
  if (a.lot >= g.lots.length - 1) return undefined;
  const p = g.players[id]!;
  if (p.loans >= MAX_LOANS) return 'Bad credit: no more loans.';
  if (p.bankCalls >= MAX_BANK_CALLS) return 'Stop calling: three calls is the limit.';
  // Anyone else may call too (each on their own three), as in the original.
  if (a.bankCalled.includes(id)) return 'You called the bank: it opens after this lot.';
  return null;
}

/**
 * Who can be screwed now: anyone else at the table, the top bidder included (forced to raise
 * their own bid by $100), as the original (the owner's ruling, 2026-10-26).
 */
export function screwTargets(g: Game, by: PlayerId): PlayerId[] {
  return present(g).filter((id) => id !== by);
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

/** Moves the game to a stage, noting when it began (the sound plays its beats from then). */
function enter(g: Game, stage: Stage, now: number) {
  g.stage = stage;
  g.since = now;
}

type Parts = HostPart[];

/** What the host says at a moment: lines from the text pack, and the voice's clips. */
interface Say {
  text: Parts;
  voice: VoicePart[];
}
const nothing = (): Say => ({ text: [], voice: [] });

/**
 * The host speaks: the voice's clips in a voiced game, else the text pack's lines. Returns how
 * long the voice takes (0 in a text game).
 */
function host(s: GoingOnceState, rng: Rng, now: number, line: Say, clear = false): number {
  if (voiced(s)) return speak(s, rng, now, line.voice, clear);
  say(s, rng, now, line.text, clear);
  return 0;
}

/**
 * A bid's voice, as the original: the bidder's yelp and their paddle going up (`BID_SETTLE_MS`,
 * with no words), then the chant asking for the next amount (its `nextBidTag`, the bid + $100).
 * The amount ("We have $600", its `reactionTag`) is said only after a screw's forced bid.
 */
const bidVoice = (amount: number, rng: Rng, forced = false): VoicePart[] => [
  ...(forced ? [bidMoment(amount)] : [{ wait: BID_SETTLE_MS }]),
  chantKey(amount + BID_STEP, rng),
];

/**
 * The host's call-out as a lot opens, as the original's: first the only player without art, then a
 * quiet bidder (picked at random among those with $900 or more and no bid in the last three
 * lots, from lot 4); each kind at most once a game.
 */
function callOut(s: GoingOnceState, lot: number, rng: Rng): Say {
  const g = s.game!;
  const here = present(g);
  const owners = new Set(
    Object.values(g.items).flatMap((i) => (i.sale?.buyer ? [i.sale.buyer] : [])),
  );
  const without = here.filter((id) => !owners.has(id));
  if (!g.calledOut.empty.length && without.length === 1 && here.length > 1) {
    g.calledOut.empty.push(without[0]!);
    return {
      text: [{ moment: 'no-art', player: g.names[without[0]!]! }],
      voice: [leadIn(without[0]!), 'no-art-yet'],
    };
  }
  if (!Object.keys(g.calledOut.quiet).length && lot >= 3) {
    const quiet = here.filter(
      (id) => g.players[id]!.cash >= 900 && lot - (g.lastBidLot[id] ?? -1) > 3,
    );
    if (quiet.length) {
      const who = quiet[rng.int(quiet.length)]!;
      g.calledOut.quiet[who] = lot;
      return {
        text: [{ moment: 'quiet', player: g.names[who]! }],
        voice: [leadIn(who), 'quiet'],
      };
    }
  }
  return nothing();
}

function startLot(s: GoingOnceState, index: number, now: number, rng: Rng, lead: Say = nothing()) {
  const g = s.game!;
  enter(g, 'auction', now);
  g.until = 0;
  // The lot number and the hints come first; the picture goes up and bidding opens after.
  g.auction = {
    lot: index,
    seq: 0,
    bid: null,
    close: 'intro',
    closeAt: now + closeMs(s, 'intro', null),
    since: now,
    screw: null,
    screwed: null,
    bankCalled: [],
    bidders: [],
    recent: [],
  };
  // Lot 1's tips may have gone out with the tutorial.
  if (!(index === 0 && g.firstSent)) sendHints(s, rng);
  // Text games show the call-out and the opening line now. The voice says what leads in (the
  // drawing's end) and, on lot 1, "The first item up for bid" as the lot number shows; the
  // call-out and the opening come as the picture goes up (`openingVoice`), as in the original.
  const out = voiced(s) ? nothing() : callOut(s, index, rng);
  const ms = host(
    s,
    rng,
    now,
    {
      text: [...lead.text, ...out.text, index === 0 ? ['opening-first', 'opening'] : 'opening'],
      voice: [...lead.voice, ...(index === 0 ? ['opening-first'] : [])],
    },
    true,
  );
  if (ms) g.auction.closeAt = Math.max(g.auction.closeAt, now + ms + CLIP_GAP_MS);
}

/**
 * The voice's opening as the picture goes up: a call-out if anyone is due one, the opening line
 * and the chant for $400, then the pause.
 */
function openingVoice(s: GoingOnceState, now: number, rng: Rng): number {
  const a = s.game!.auction!;
  const out = callOut(s, a.lot, rng);
  const ms = speak(s, rng, now, [...out.voice, 'opening', chantKey(OPENING_BID, rng)]);
  return ms + CHANT_GAP_MS;
}

function endGame(s: GoingOnceState, now: number) {
  const g = s.game!;
  s.phase = 'over';
  enter(g, 'done', now);
  g.until = 0;
  const scores = g.order.map((id) => {
    const p = g.players[id]!;
    return p.cash - p.debt + artOf(g, id);
  });
  const best = Math.max(...scores);
  g.winners = g.order.filter((_, i) => scores[i] === best);
}

function endGameWithHost(s: GoingOnceState, now: number, rng: Rng) {
  endGame(s, now);
  host(s, rng, now, { text: ['end-intro'], voice: ['end-intro'] }, true);
}

/** The drawing is over: unsent drawings become house pictures, wish lists go out, lot 1 opens. */
function endDraw(s: GoingOnceState, now: number, rng: Rng) {
  const g = s.game!;
  const drawn = Object.values(g.items).filter((i) => i.drawing).length;
  if (drawn === 0) {
    // Nobody drew anything: one more round with new titles, then the game is off.
    if (g.redraws === 0 && g.spares) {
      redeal(s, g.spares, now, rng);
      // As the original, the new clock starts once he has said so (and to hurry).
      const ms = host(
        s,
        rng,
        now,
        {
          text: ['redraw', 'draw-start'],
          voice: ['time-up', 'no-art', 'no-art-worry', 'new-titles', 'draw-hurry'],
        },
        true,
      );
      startDrawClock(s, now + ms);
      return;
    }
    s.phase = 'over';
    enter(g, 'done', now);
    g.until = 0;
    g.ended = 'no-drawings';
    g.winners = [];
    host(s, rng, now, { text: ['no-drawings'], voice: ['no-art-end'] }, true);
    return;
  }
  const missing = Object.values(g.items).some((i) => i.drawer && !i.drawing);
  const wish = wishLists(g.order, g.items, rng, s.rig?.fixed);
  for (const id of g.order) g.players[id]!.wish = wish[id] ?? [];
  const lead: Say = missing
    ? { text: ['draw-missing'], voice: ['time-up', 'art-missing', 'house-fill', 'segue'] }
    : { text: ['draw-all-in'], voice: ['all-art-in'] };
  if (g.voiced && s.gamesPlayed === 1) startTutorial(s, now, rng, lead);
  else afterDrawing(s, now, rng, lead);
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
  g.since = now;
  startDrawClock(s, now);
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
  const said = soldVoice(s, a.lot, item.id);
  let ms: number;
  if (sale.buyer) {
    g.unsoldRun = 0;
    const profit = item.value - sale.price;
    const remark =
      item.artist === sale.buyer
        ? sale.screwedBy
          ? 'own-art-screwed'
          : { moment: 'own-art', player: g.names[sale.buyer]! }
        : remarkOf(a.lot, profit);
    const text: Parts = [
      [{ moment: 'congrats', player: g.names[sale.buyer]! }, 'sold'],
      ...(remark ? [remark] : []),
      ...(sale.commission ? [sale.price >= 1000 ? 'commission-high' : 'commission-low'] : []),
    ];
    if (voiced(s)) {
      const beats = voicedBeats(s, rng, now, said, item.artist !== null);
      g.soldBeats = beats.beats;
      ms = beats.ms;
    } else {
      ms = host(s, rng, now, { text, voice: [] }, true);
      g.soldBeats = textBeats(s, item.artist !== null);
    }
  } else {
    g.unsoldRun += 1;
    g.soldBeats = null;
    ms = host(s, rng, now, { text: ['unsold'], voice: said.reveal }, true);
  }
  g.bankCallers = [...a.bankCalled];
  enter(g, 'sold', now);
  // A voiced Sold lasts as long as the auctioneer's wrap-up; every Sold until its beats are seen.
  const shown = g.soldBeats ? g.soldBeats.profit + SOLD_SHOWN_MS * (s.rig?.scale ?? 1) : 0;
  g.until = now + Math.max(timing(s).sold, ms ? ms + 500 : 0, shown);
}

/**
 * The remark on a buy, the original's way: on lot 1 a windfall at $800 or more of profit, "Ouch"
 * at $800 or more of loss, "a bit of a draw" within $200; on later lots a windfall or "Ouch" past
 * $200 either way, else nothing.
 */
function remarkOf(lot: number, profit: number): 'windfall' | 'ouch' | 'even' | null {
  if (lot === 0)
    return profit >= 800
      ? 'windfall'
      : profit <= -800
        ? 'ouch'
        : Math.abs(profit) <= 200
          ? 'even'
          : null;
  return profit > 200 ? 'windfall' : profit < -200 ? 'ouch' : null;
}

/** A text game's Sold beats: the artist's paddle, then the value, then PROFIT or LOSS. */
function textBeats(s: GoingOnceState, artist: boolean): SoldBeats {
  const beat = SOLD_BEAT_MS * (s.rig?.scale ?? 1);
  const value = (artist ? 3 : 2) * beat;
  return { artist: artist ? 2 * beat : null, value, profit: value + beat };
}

/**
 * A voiced Sold: what is said up to the value, then a silence while the value spins and PROFIT
 * or LOSS lands, then the rest; the beats follow the lines, as the original's flowchart waits for
 * each. The artist's paddle turns as they are named (lot 1, or a first own-art buy), or on later
 * lots right after the congratulations, with the commission paid into it before the value.
 */
function voicedBeats(
  s: GoingOnceState,
  rng: Rng,
  now: number,
  said: { reveal: VoicePart[]; after: VoicePart[] },
  hasArtist: boolean,
): { beats: SoldBeats; ms: number } {
  const reveal = clipsFor(s, rng, said.reveal);
  const end = clipsMs(reveal);
  const times = clipTimes({ at: 0, clips: reveal });
  const named = reveal.findIndex((c) => /^(artist-call|own-art|sorry)/.test(c.key));
  let artist: number | null = null;
  let value = end + SOLD_LINE_GAP_MS;
  if (hasArtist && named >= 0) artist = times[named]!;
  else if (hasArtist) {
    artist = end + SOLD_LINE_GAP_MS;
    value = artist + ARTIST_FLIP_MS + COMMISSION_MS;
  }
  const profit = value + SOLD_SPIN_MS + SOLD_PAUSE_MS;
  const after = clipsFor(s, rng, said.after);
  if (after[0])
    after[0] = { ...after[0], wait: Math.max(0, profit + SOLD_LINE_GAP_MS - end - CLIP_GAP_MS) };
  const ms = sayClips(s, now, [...reveal, ...after], true);
  return { beats: { artist, value, profit }, ms: Math.max(ms, profit) };
}

/**
 * The voice's wrap-up of a lot, as the original says it (its Auction and own-art flowcharts):
 * "Sold!" and the winner's congratulations (or a "Sorry" when screwed into their own drawing).
 * Lot 1 explains everything: the artist named, the commission, "More importantly…" and whether the
 * buyer can sell it on; later lots just turn the artist's paddle. The own-art remarks come the
 * first time in a game only. `after`, said once PROFIT or LOSS is up: the remark (`remarkOf`),
 * lot 1's money set aside, and "Moving on…" unless it was the last lot. Unsold: a quip alone.
 */
function soldVoice(
  s: GoingOnceState,
  lot: number,
  itemId: string,
): { reveal: VoicePart[]; after: VoicePart[] } {
  const g = s.game!;
  const item = g.items[itemId]!;
  const sale = item.sale!;
  if (!sale.buyer) return { reveal: ['unsold'], after: [] };
  const buyer = sale.buyer;
  const first = lot === 0;
  const own = item.artist === buyer;
  const reveal: VoicePart[] = ['sold'];
  if (own && sale.screwedBy) reveal.push({ key: 'sorry', player: buyer }, 'screwed-own');
  else
    reveal.push(
      first
        ? [
            { key: 'congrats-first', player: buyer },
            { key: 'congrats', player: buyer },
          ]
        : { key: 'congrats', player: buyer },
    );
  if (own) {
    if (first && !sale.screwedBy) reveal.push('reveal-artist');
    if (!g.ownArtTold) {
      if (!sale.screwedBy) reveal.push({ key: 'own-art', player: buyer }, 'own-art-tease');
      reveal.push('own-art-explain');
      g.ownArtTold = true;
    }
    if (first) reveal.push(sale.screwedBy ? 'own-art-resell' : { key: 'resell', player: buyer });
  } else if (first) {
    if (item.artist)
      reveal.push(
        'reveal-artist',
        { key: 'artist-call', player: item.artist },
        'commission-explain',
        sale.price >= 1000 ? 'commission-high' : 'commission-low',
        'segue-resell',
      );
    reveal.push({ key: 'resell', player: buyer });
  }
  const remark = remarkOf(lot, item.value - sale.price);
  const after: VoicePart[] = [
    ...(remark ? [remark] : []),
    ...(first ? [{ key: 'buyer-keeps', player: buyer }, 'tally'] : []),
    ...(lot + 1 < g.lots.length ? ['moving-on'] : []),
  ];
  return { reveal, after };
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
  enter(g, 'bank', now);
  g.bankOpened = true;
  g.bankDone = [];
  g.bankTook = [];
  g.until = now + scaled(s, first ? BANK_FIRST_MS : BANK_LATER_MS);
  host(
    s,
    rng,
    now,
    first
      ? {
          text: ['bank-first'],
          voice: [
            { wait: BANK_RING_MS },
            'bank-first',
            'bank-pitch',
            'bank-press',
            'bank-owe',
            'bank-aside',
            'bank-remember',
          ],
        }
      : { text: ['bank-called'], voice: [{ wait: BANK_RING_MS }, 'bank-called'] },
    true,
  );
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
    enter(g, 'halftime', now);
    const ms = host(
      s,
      rng,
      now,
      {
        text: ['halftime'],
        voice: ['halfway', 'halfway-turn', 'screw-explain', 'screw-whenever'],
      },
      true,
    );
    g.until = now + Math.max(timing(s).halftime, ms ? ms + 500 : 0);
    return;
  }
  if (from === 'bank') closeBank(g);
  else if (bankDue(g, next)) {
    openBank(s, now, rng);
    if (loanWaiting(g).length === 0) {
      closeBank(g);
    } else return;
  }
  if (next >= g.lots.length) endGameWithHost(s, now, rng);
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
  if (a.close === 'intro') return err('not-yet', 'Wait for the picture to go up.');
  if (a.screw)
    return err('screwing', `${g.names[a.screw.by]} is choosing who to screw: hold your horses.`);
  if (a.pausedUntil && now < a.pausedUntil)
    return err('screwing', 'Hold your horses: the screw is still playing out.');
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
  // As the original, the auction stops listening while a bid lands (the paddle up and down).
  if (a.bidAt !== undefined && now - a.bidAt < BID_SETTLE_MS)
    return err('too-soon', 'Hold on: the last bid is still landing.');
  a.bid = { by, amount };
  a.seq += 1;
  a.screwed = null;
  a.recent = [...(a.recent ?? []), { by, amount, forced: false }].slice(-RECENT_BIDS);
  if (!a.bidders.includes(by)) a.bidders.push(by);
  a.close = 'quiet';
  a.since = now;
  a.bidAt = now;
  p.bids += 1;
  p.lastBidAt = now;
  g.lastBidLot[by] = a.lot;
  // Voiced, the quiet stretch is the paddle going up, the chant for the next amount, the pause.
  const ms = host(s, rng, now, { text: [bidMoment(amount)], voice: bidVoice(amount, rng) });
  a.closeAt = now + (ms ? ms + CHANT_GAP_MS : timing(s).quiet);
  return null;
}

function screw(s: GoingOnceState, by: PlayerId, now: number, rng: Rng) {
  const g = s.game!;
  const a = g.auction;
  const p = g.players[by];
  if (!p) return err('not-playing', 'You are not in this game.');
  if (g.stage !== 'auction' || !a) return err('no-auction', 'Nothing is up for auction right now.');
  if (!screwsOn(g)) return err('locked', 'Screws unlock at half-time.');
  if (a.close === 'intro') return err('not-yet', 'Wait for the picture to go up.');
  if (!p.screw) return err('no-screw', 'You’ve used your screw.');
  if (a.screw) return err('screwing', `${g.names[a.screw.by]} is already screwing someone.`);
  if (a.screwed) return err('screwed', 'No screwing until someone makes a free bid.');
  if (a.pausedUntil && now < a.pausedUntil)
    return err('screwing', 'Hold your horses: the screw is still playing out.');
  p.screw = false;
  a.screw = { by, until: now + screwMs(s) };
  a.since = now;
  if (voiced(s)) speak(s, rng, now, [{ key: 'screw-pick', player: by }]);
  return null;
}

/**
 * A screw's outcome (a forced bid, or a screw that failed or was lost): the clock stays paused
 * while it plays out (`pausedUntil`: voiced, its first line; otherwise `SCREW_OUTCOME_MS` for its
 * banner), then a full fresh stretch starts, never the time left before the screw. So does the
 * original: after any screw it goes back to the next-bid prompt and a new chant. A lot can never
 * close while a screw is aimed or still playing out.
 */
function afterScrew(s: GoingOnceState, rng: Rng, now: number, line: Say) {
  const g = s.game!;
  const a = g.auction!;
  a.screw = null;
  a.since = now;
  a.close = a.bid ? 'quiet' : 'open';
  const ms = host(s, rng, now, line);
  if (ms) {
    // Voiced: the outcome's line, then the rest (the bid's lines and the chant) is the stretch.
    const first = g.host!.clips![0]!;
    a.pausedUntil = now + first.ms + CLIP_GAP_MS;
    a.closeAt = now + ms + CHANT_GAP_MS;
  } else {
    a.pausedUntil = now + SCREW_OUTCOME_MS * (s.rig?.scale ?? 1);
    a.closeAt = a.pausedUntil + timing(s)[a.close];
  }
}

/** A screw that came to nothing: said, then the chant asking for the bid on the table again. */
const screwMiss = (a: Auction, key: 'screw-fail' | 'screw-lost', rng: Rng): Say => ({
  text: [key],
  voice: [key, chantKey(a.bid ? a.bid.amount + BID_STEP : OPENING_BID, rng)],
});

function screwPick(s: GoingOnceState, by: PlayerId, target: PlayerId, now: number, rng: Rng) {
  const g = s.game!;
  const a = g.auction;
  if (g.stage !== 'auction' || !a?.screw || a.screw.by !== by)
    return err('not-screwing', 'You aren’t aiming a screw.');
  if (!screwTargets(g, by).includes(target))
    return err('bad-target', 'Pick another player at the table.');
  const amount = a.bid ? a.bid.amount + BID_STEP : OPENING_BID;
  if (g.players[target]!.cash < amount) {
    log(s, { kind: 'screw', by, target, outcome: 'failed', amount });
    afterScrew(s, rng, now, screwMiss(a, 'screw-fail', rng));
    return null;
  }
  a.bid = { by: target, amount };
  a.seq += 1;
  a.screwed = { target, by };
  a.recent = [...(a.recent ?? []), { by: target, amount, forced: true }].slice(-RECENT_BIDS);
  if (!a.bidders.includes(target)) a.bidders.push(target);
  log(s, { kind: 'screw', by, target, outcome: 'forced', amount });
  afterScrew(s, rng, now, {
    text: [bidMoment(amount)],
    voice: [{ key: 'screwed', player: target }, ...bidVoice(amount, rng, true)],
  });
  return null;
}

function callBank(s: GoingOnceState, by: PlayerId) {
  const g = s.game!;
  const why = bankRefusal(g, by);
  if (why === undefined) return err('no-bank', 'You can’t call the bank right now.');
  if (why) return err('bank-refused', why);
  g.players[by]!.bankCalls += 1;
  g.auction!.bankCalled.push(by);
  // Called during the Sold wrap-up: the bank comes before the next lot all the same.
  if (g.stage === 'sold') g.bankCallers.push(by);
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

// ---- The practice lot ----

/**
 * The practice lot runs in a room's first game (unless the host turned it off), before lot 1: a
 * house picture from the spare title groups (no lot uses them once the drawings are in), play
 * money, and a house bidder who bids once. Nothing in it counts.
 */
function practiceDue(s: GoingOnceState): boolean {
  return (
    (s.settings.practice ?? DEFAULT_SETTINGS.practice) && s.gamesPlayed === 1 && !!s.game?.spares
  );
}

function startPractice(s: GoingOnceState, now: number, rng: Rng, lead: Say) {
  const g = s.game!;
  const spare = g.spares![0];
  const tips = g.lines.practice?.length ? g.lines.practice : [PRACTICE_TIP];
  enter(g, 'practice', now);
  g.until = 0;
  g.practice = {
    step: 'hint',
    since: now,
    until: now + scaled(s, PRACTICE_MS.hint),
    title: spare.titles[0]!,
    house: spare.house[0]!,
    hint: fillLine(tips[rng.int(tips.length)]!, { value: PRACTICE_VALUE }, rng),
    seq: 0,
    bid: null,
    close: 'open',
    closeAt: 0,
    recent: [],
    houseBid: false,
    lastBidAt: {},
  };
  host(s, rng, now, lead, true);
}

function endPractice(s: GoingOnceState, now: number, rng: Rng) {
  s.game!.practice = null;
  startLot(s, 0, now, rng);
}

/** A practice bid moves the practice lot's own close, as a real bid moves a lot's. */
function placePracticeBid(
  s: GoingOnceState,
  p: Practice,
  by: PlayerId,
  amount: number,
  now: number,
  rng: Rng,
) {
  p.bid = { by, amount };
  p.seq += 1;
  p.recent = [...p.recent, { by, amount, forced: false }].slice(-RECENT_BIDS);
  p.close = 'quiet';
  p.closeAt = now + timing(s).quiet;
  p.since = now;
  host(s, rng, now, { text: [bidMoment(amount)], voice: [bidMoment(amount)] });
}

function practiceBid(
  s: GoingOnceState,
  by: PlayerId,
  amount: number,
  seq: number,
  now: number,
  rng: Rng,
) {
  const g = s.game!;
  const p = g.practice;
  if (!g.players[by]) return err('not-playing', 'You are not in this game.');
  if (g.stage !== 'practice' || !p) return err('no-practice', 'The practice lot is over.');
  if (p.step !== 'bid')
    return err(p.step === 'hint' ? 'not-yet' : 'too-late', 'The practice bidding isn’t open.');
  if (seq !== p.seq) return err('too-late', 'Too late: the price changed.');
  if (p.bid?.by === by) return err('leading', 'You already have the top bid.');
  if (!bidSteps(p.bid).includes(amount))
    return err('bad-bid', 'Bid one of the amounts on the buttons.');
  if (amount > PRACTICE_CASH) return err('cash', 'That’s more play money than you have.');
  if (now - (p.lastBidAt[by] ?? 0) < BID_GAP_MS) return err('too-fast', 'One bid at a time!');
  p.lastBidAt[by] = now;
  placePracticeBid(s, p, by, amount, now, rng);
  return null;
}

function skipPractice(s: GoingOnceState, by: PlayerId, now: number, rng: Rng) {
  const g = s.game!;
  if (!g.players[by]) return err('not-playing', 'You are not in this game.');
  if (g.stage !== 'practice') return err('no-practice', 'The practice lot is over.');
  endPractice(s, now, rng);
  return null;
}

/** The practice lot's timers: its steps in turn, and the bidding's close with the house bidder. */
function practiceDeadline(s: GoingOnceState, now: number, rng: Rng) {
  const g = s.game!;
  const p = g.practice!;
  const next = (step: Exclude<Practice['step'], 'hint' | 'bid'>) => {
    p.step = step;
    p.since = now;
    p.until = now + scaled(s, PRACTICE_MS[step]);
  };
  switch (p.step) {
    case 'hint':
      p.step = 'bid';
      p.since = now;
      p.close = 'open';
      p.closeAt = now + timing(s).open;
      return;
    case 'bid':
      // The house bidder bids once: to open a lot nobody opened, or to raise a low first bid.
      if ((p.close === 'open' || p.close === 'quiet') && !p.houseBid) {
        const amount = p.bid ? p.bid.amount + BID_STEP : OPENING_BID;
        if (amount <= PRACTICE_VALUE / 2 + OPENING_BID) {
          p.houseBid = true;
          placePracticeBid(s, p, HOUSE_BIDDER, amount, now, rng);
          return;
        }
      }
      p.since = now;
      if (p.close === 'open' || p.close === 'quiet') {
        p.close = 'once';
        p.closeAt = now + closeMs(s, 'once', p.bid);
        host(s, rng, now, { text: ['going-once'], voice: ['going-once'] });
      } else if (p.close === 'once') {
        p.close = 'twice';
        p.closeAt = now + closeMs(s, 'twice', p.bid);
        host(s, rng, now, { text: ['going-twice'], voice: ['going-twice'] });
      } else {
        next('sold');
        host(s, rng, now, { text: ['sold'], voice: ['sold'] }, true);
      }
      return;
    case 'sold':
      next('own');
      return;
    case 'own':
      next('screw');
      return;
    case 'screw':
      endPractice(s, now, rng);
      return;
  }
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
    until: 0,
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
    since: ctx.now,
    contacts: dealContacts(order, ctx.rng, fixed),
    practice: null,
    voiced: s.settings.voice === true && (s.settings.sound ?? DEFAULT_SETTINGS.sound) !== 'off',
  };
  beginDraw(s, ctx.now, ctx.rng);
  s.seed = newSeed(ctx.rng);
  return s;
}

/**
 * The drawing starts: two titles each, open at once, and one clock. Voiced, as the original: the
 * welcome every game (greeting, the guests, the room's scent, "we'll need some art"), then the
 * drawing's instructions in a room's first game ("I'll spare you the introduction" later); the
 * clock starts once he has said them, so the instructions never eat the drawing time.
 */
function beginDraw(s: GoingOnceState, now: number, rng: Rng) {
  const g = s.game!;
  const n = g.order.length;
  enter(g, 'draw', now);
  g.nudges = 0;
  const ms = host(
    s,
    rng,
    now,
    {
      text: ['draw-start'],
      voice: [
        'greeting',
        'welcome',
        'guest-error',
        `guest-count-${n}`,
        'guest-tease',
        'need-art',
        ...(s.gamesPlayed > 1
          ? ['later-game']
          : [
              'titles-sent',
              'draw-instructions',
              'draw-craft',
              'artist-cut',
              'draw-hurry',
              'two-drawings',
            ]),
      ],
    },
    true,
  );
  startDrawClock(s, now + ms);
}

/** The drawing's clock from `at` (its nudges and its end, with a short grace). */
function startDrawClock(s: GoingOnceState, at: number) {
  const g = s.game!;
  g.drawStart = at;
  g.until = drawTimes(s, at).end + DRAW_GRACE_MS;
}

/**
 * The auctioneer's tutorial, as the original: after the drawing, in a voiced room's first game;
 * lot 1's tips go out with it ("you should have your first message now"). Anyone can skip it.
 */
function startTutorial(s: GoingOnceState, now: number, rng: Rng, lead: Say) {
  const g = s.game!;
  const n = g.order.length;
  enter(g, 'intro', now);
  sendHints(s, rng, 0);
  g.firstSent = true;
  const ms = speak(
    s,
    rng,
    now,
    [
      ...lead.voice,
      'tutorial-start',
      `auction-count-${n}`,
      'worth-a-lot',
      'worth-less',
      'starting-money',
      'buyers-info',
      'buyers-more',
      'expect-messages',
      'first-message',
      'buy-advice',
      'buy-advice-also',
      'how-to-win',
    ],
    true,
  );
  g.until = now + ms + 500;
}

/** After the drawing (and the tutorial): the practice lot in a room's first game, then lot 1. */
function afterDrawing(s: GoingOnceState, now: number, rng: Rng, lead: Say = nothing()) {
  if (practiceDue(s)) startPractice(s, now, rng, lead);
  else startLot(s, 0, now, rng, lead);
}

/** Anyone skips the tutorial: everyone hears so ("On with the game"), and the game goes on. */
function skipIntro(s: GoingOnceState, now: number, rng: Rng) {
  const g = s.game!;
  if (g.stage !== 'intro') return err('no-intro', 'The introduction is over.');
  g.introSkipped = true;
  g.introSkippedAt = now;
  afterDrawing(s, now, rng, { text: [], voice: ['skipped'] });
  return null;
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
  for (const key of ['sound', 'music', 'effects', 'voice', 'practice'] as const)
    if (action[key] !== undefined) Object.assign(s.settings, { [key]: action[key] });
  if (action.sound !== undefined) s.settings.soundChosen = true;
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
  s.rig = {
    scale: r.scale,
    fixed: r.fixed,
    ...(r.cash !== undefined && { cash: r.cash }),
    ...(r.closeScale !== undefined && { closeScale: r.closeScale }),
  };
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
    case 'practice-bid':
      return inPlay(state, (s) => practiceBid(s, by, action.amount, action.seq, ctx.now, ctx.rng));
    case 'skip-practice':
      return inPlay(state, (s) => skipPractice(s, by, ctx.now, ctx.rng));
    case 'skip-intro':
      // Anyone at the table may skip the tutorial, as in the original.
      if (!state.game?.players[ctx.by]) return err('not-playing', 'You are not in this game.');
      return inPlay(state, (s) => skipIntro(s, ctx.now, ctx.rng));
    case 'screw':
      return inPlay(state, (s) => screw(s, by, ctx.now, ctx.rng));
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
    settings: { ...DEFAULT_SETTINGS },
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
    if (player.color) existing.color = player.color;
    const g = s.game;
    if (g?.names[player.id]) g.names[player.id] = player.name;
    if (g?.left.includes(player.id)) {
      g.left = g.left.filter((id) => id !== player.id);
      log(s, { kind: 'back', player: player.id });
    }
    return s;
  }
  const playing = s.phase !== 'playing' && players(s).length < MAX_PLAYERS;
  const seat: Seat = {
    name: player.name,
    playing,
    ...(!playing && { waiting: true }),
    ...(player.color && { color: player.color }),
  };
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
    afterScrew(s, rng, now, screwMiss(g.auction, 'screw-lost', rng));
  }
  s.seed = newSeed(rng);
  return s;
}

// ---- Timers ----

export function nextDeadline(state: GoingOnceState): number | null {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return null;
  if (g.stage === 'auction') return g.auction!.screw ? g.auction!.screw.until : g.auction!.closeAt;
  if (g.stage === 'practice') {
    const p = g.practice!;
    return p.step === 'bid' ? p.closeAt : p.until;
  }
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
    case 'intro':
      afterDrawing(s, now, rng);
      break;
    case 'draw':
      if (due < g.until) {
        host(
          s,
          rng,
          now,
          g.nudges === 0
            ? { text: ['draw-halfway'], voice: ['nudge', 'draw-halfway', 'second-drawing'] }
            : { text: ['draw-seconds'], voice: ['seconds-left', 'submit-now'] },
          true,
        );
        g.nudges += 1;
      } else endDraw(s, now, rng);
      break;
    case 'auction': {
      const a = g.auction!;
      if (a.screw) {
        log(s, { kind: 'screw', by: a.screw.by, target: null, outcome: 'wasted' });
        afterScrew(s, rng, now, screwMiss(a, 'screw-lost', rng));
        break;
      }
      a.since = now;
      // Voiced, each call lasts as long as it is said, plus the original's pause.
      const call = (line: Say, close: 'once' | 'twice') => {
        const ms = host(s, rng, now, line);
        a.close = close;
        a.closeAt = now + (ms ? ms + CHANT_GAP_MS : closeMs(s, close, a.bid));
      };
      const fast = (step: 'once' | 'twice') =>
        voiced(s)
          ? (a.bid?.amount ?? 0) > FAST_CALLS_ABOVE
          : closeMs(s, step, a.bid) < TIMINGS[s.settings.pace][step] * closeScale(s);
      if (a.close === 'intro') {
        a.close = 'open';
        a.closeAt = now + (voiced(s) ? openingVoice(s, now, rng) : timing(s).open);
      } else if (a.close === 'open' || a.close === 'quiet') {
        const once = fast('once') ? 'going-once-fast' : 'going-once';
        if (!a.bid) {
          const noBids =
            a.lot === 0
              ? ['no-bids-first', 'no-bids-1']
              : g.unsoldRun > 0
                ? ['no-bids-2', 'no-bids-1']
                : ['no-bids-1'];
          // Said as the original: lot 1's "No one?" then "anticlimactic"; a second unsold lot
          // in a row "Again?" alone.
          const said: VoicePart[] =
            a.lot === 0
              ? ['no-bids-1', 'no-bids-first']
              : g.unsoldRun > 0
                ? ['no-bids-2']
                : ['no-bids-1'];
          call({ text: [noBids], voice: [...said, once] }, 'once');
        } else
          call(
            {
              text: [fast('once') ? ['going-once-fast', 'going-once'] : 'going-once'],
              voice: [once],
            },
            'once',
          );
      } else if (a.close === 'once') {
        const twice = fast('twice') ? 'going-twice-fast' : 'going-twice';
        call(
          {
            text: [fast('twice') ? ['going-twice-fast', 'going-twice'] : 'going-twice'],
            voice: [twice],
          },
          'twice',
        );
      } else hammer(s, now, rng);
      break;
    }
    case 'practice':
      practiceDeadline(s, now, rng);
      break;
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
