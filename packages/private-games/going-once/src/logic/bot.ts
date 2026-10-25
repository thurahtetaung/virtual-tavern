import { type BotCtx, type BotInfo, type Rng, chance, encodeDrawing, pickOne } from '@vt/game-sdk';
import type { GoingOnceAction, GoingOnceView } from './types.ts';

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
 * Plays a seat from its own view: sends a scribble for each title, bids up to a rough guess of a
 * lot's worth (more for its own drawing to push the price, more when a buyer says someone knows
 * it), sometimes screws in the second half, and borrows when short.
 */
export function goingOnceBot(view: GoingOnceView, ctx: BotCtx): GoingOnceAction | null {
  const { rng, me } = ctx;
  if (view.phase === 'lobby')
    return view.me && !view.me.playing ? { type: 'sit', playing: true } : null;
  const g = view.game;
  const mine = view.mine;
  if (view.phase !== 'playing' || !g || !mine) return null;

  if (g.stage === 'draw') {
    const todo = mine.prompts.find((p) => !p.sent);
    return todo ? { type: 'draw', item: todo.item, drawing: scribble(rng) } : null;
  }

  if (g.stage === 'bank') {
    if (mine.bankDone) return null;
    return { type: 'loan', take: mine.canLoan && mine.cash < 1500 && mine.loans < 2 };
  }

  const a = g.auction;
  if (g.stage !== 'auction' || !a) return null;
  if (a.screw) {
    if (a.screw.by !== me) return null;
    const target = pickOne(rng, mine.targets);
    return target ? { type: 'screw-pick', target } : null;
  }
  if (a.bid?.by === me) return null;

  if (mine.canCallBank && mine.cash < 800 && mine.loans < 3) return { type: 'call-bank' };

  if (g.screwsOn && mine.screw && !a.screwed && a.bid && chance(rng, 0.12))
    return { type: 'screw' };

  const own = mine.prompts.some((p) => p.item === a.picture.item);
  const tip = mine.messages.at(-1);
  let guess = 1300 + rng.int(16) * 100;
  if (tip?.lot === a.lot && tip.kind === 'someoneKnows') guess += 600;
  if (own) guess = Math.min(guess, 1200);
  const affordable = a.steps.filter((s) => s <= mine.cash && s <= guess);
  if (!affordable.length || !chance(rng, 0.7)) return null;
  const amount = chance(rng, 0.8) ? affordable[0]! : affordable.at(-1)!;
  return { type: 'bid', amount, seq: a.seq };
}

export const goingOnceBotInfo: BotInfo = {
  // A live auction closes a few seconds after the last bid: bids and the bank are quick moves.
  quick: (move) => {
    const type = (move as { type?: string }).type;
    return type === 'bid' || type === 'loan' || type === 'screw-pick';
  },
  // Another bid can beat the bot's to the price on screen; it tries again on the next change.
};
