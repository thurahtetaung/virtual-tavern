import { type BotCtx, type BotInfo, type Rng, chance, encodeDrawing, pickOne } from '@vt/game-sdk';
import { BID_SETTLE_MS, type GoingOnceAction, type GoingOnceView } from './types.ts';
import { drewIt } from './view.ts';

/**
 * A bot's drawing: a few wobbly lines built from its own random numbers (never an image), so a
 * playtest has something on the easel.
 */
export function scribble(rng: Rng) {
  const strokes = Array.from({ length: 3 + rng.int(4) }, () => {
    let x = 150 + rng.int(500);
    let y = 150 + rng.int(700);
    let angle = rng.next() * Math.PI * 2;
    const points: number[] = [x, y];
    for (let i = 0; i < 8 + rng.int(14); i++) {
      angle += (rng.next() - 0.5) * 1.4;
      x = Math.max(20, Math.min(780, x + Math.cos(angle) * 40));
      y = Math.max(20, Math.min(980, y + Math.sin(angle) * 40));
      points.push(x, y);
    }
    return { c: rng.int(4), w: rng.int(3), points };
  });
  return encodeDrawing(strokes);
}

/**
 * A number in [0, 1) fixed by its parts (FNV-1a, then mixed): a bot's choices at one price come out the same
 * on every look, whatever the look's own random numbers.
 */
export function steady(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  // Mixed once more, so parts that differ by a letter still land far apart.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}

/**
 * Plays a seat from its own view: sends a scribble for each title once the auctioneer calls for
 * the drawings, bids up to a rough guess of a lot's worth (more for its own drawing to push the
 * price, more when a buyer says someone knows it), sometimes screws in the second half, and
 * borrows when short. It makes up its mind once per price (when a lot opens and whenever it is
 * outbid), so its bid comes at once or not until the price moves.
 */
export function goingOnceBot(view: GoingOnceView, ctx: BotCtx): GoingOnceAction | null {
  const { rng, me } = ctx;
  if (view.phase === 'lobby')
    return view.me && !view.me.playing ? { type: 'sit', playing: true } : null;
  const g = view.game;
  const mine = view.mine;
  if (view.phase !== 'playing' || !g || !mine) return null;

  if (g.stage === 'draw') {
    // The pads open when the auctioneer calls for the drawings (`wakeAt` looks again then).
    if (ctx.now < g.drawFrom) return null;
    const todo = mine.prompts.find((p) => !p.sent);
    return todo ? { type: 'draw', item: todo.item, drawing: scribble(rng) } : null;
  }

  if (g.stage === 'bank') {
    if (mine.bankDone) return null;
    return { type: 'loan', take: mine.canLoan && mine.cash < 1500 && mine.loans < 2 };
  }

  // The practice lot is for the people at the table: bots leave it to them.
  const a = g.auction;
  if (g.stage !== 'auction' || !a || a.close === 'intro') return null;
  if (a.screw) {
    if (a.screw.by !== me) return null;
    const target = pickOne(rng, mine.targets);
    return target ? { type: 'screw-pick', target } : null;
  }
  if (a.bid?.by === me) return null;
  // A screw still playing out holds every bid, and so does a bid still landing.
  if (ctx.now < a.pausedUntil) return null;
  if (a.bid && a.close === 'quiet' && ctx.now - a.since < BID_SETTLE_MS) return null;

  if (mine.canCallBank && mine.cash < 800 && mine.loans < 3) return { type: 'call-bank' };

  if (g.screwsOn && mine.screw && !a.screwed && a.bid && chance(rng, 0.12))
    return { type: 'screw' };

  // What it thinks the lot is worth stays put for the lot; whether it bids, and how much, is
  // settled once per price.
  const own = drewIt(mine, a.picture.item);
  const tip = mine.messages.at(-1);
  let guess = 1300 + Math.floor(steady('guess', a.lot, me) * 16) * 100;
  if (tip?.lot === a.lot && tip.kind === 'someoneKnows') guess += 600;
  if (own) guess = Math.min(guess, 1200);
  const affordable = a.steps.filter((s) => s <= mine.cash && s <= guess);
  const price = a.bid?.amount ?? 0;
  if (!affordable.length || steady('want', a.lot, a.seq, price, me) >= 0.7) return null;
  const amount =
    steady('amount', a.lot, a.seq, price, me) < 0.8 ? affordable[0]! : affordable.at(-1)!;
  return { type: 'bid', amount, seq: a.seq };
}

/**
 * When a bot that is waiting on the clock looks again: as the pads open, or as a screw's outcome
 * or the last bid has landed. Everything else that matters comes with a change to the room.
 */
export function goingOnceWakeAt(view: GoingOnceView, ctx: BotCtx): number | null {
  const g = view.game;
  if (view.phase !== 'playing' || !g || !view.mine) return null;
  if (g.stage === 'draw')
    return ctx.now < g.drawFrom && view.mine.prompts.some((p) => !p.sent) ? g.drawFrom : null;
  const a = g.auction;
  if (g.stage !== 'auction' || !a || a.close === 'intro' || a.screw || a.bid?.by === ctx.me)
    return null;
  if (ctx.now < a.pausedUntil) return a.pausedUntil;
  if (a.bid && a.close === 'quiet' && ctx.now - a.since < BID_SETTLE_MS)
    return a.since + BID_SETTLE_MS;
  return null;
}

export const goingOnceBotInfo: BotInfo = {
  // A live auction closes a few seconds after the last bid: bids and the bank are quick moves.
  quick: (move) => {
    const type = (move as { type?: string }).type;
    return type === 'bid' || type === 'loan' || type === 'screw-pick';
  },
  // Another bid can beat the bot's to the price on screen; it tries again on the next change.
  wakeAt: (view, ctx) => goingOnceWakeAt(view as GoingOnceView, ctx),
};
