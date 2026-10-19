import { type BotCtx, chance, pickOne } from '@vt/game-sdk';
import type { ThornsAction, ThornsView } from './types.ts';

/** How often a bot hides its thorn when it puts a disc down (while it still has one in hand). */
const THORN_RATE = 0.3;

/**
 * A playtest bot, from its own view only: it hides its thorn now and then, bids from the roses
 * it knows are on its own mat plus a small margin, passes when the bid is past that, turns over
 * the stacks of players who bid this round first (they likely hold roses), and never bids when
 * its own thorn is on its mat unless it has to.
 */
export function thornsBot(view: ThornsView, ctx: BotCtx): ThornsAction | null {
  const g = view.game;
  const mine = view.mine;
  if (view.phase !== 'playing' || !g || !mine) return null;
  const me = g.players.find((p) => p.id === ctx.me);
  const r = g.round;
  // Out by their own thorn, the Challenger still names who starts.
  if (!me || (me.out && r.stage !== 'starter')) return null;
  const rng = ctx.rng;
  const high = r.bids.at(-1)?.amount ?? 0;
  const putDown = (): ThornsAction => {
    const thorn = mine.hand.includes('thorn') && !mine.stack.includes('thorn');
    const rose = mine.hand.includes('rose');
    if (thorn && (!rose || chance(rng, THORN_RATE))) return { type: 'place', disc: 'thorn' };
    // The Last Chance disc is a known rose: put it down first.
    return {
      type: 'place',
      disc: mine.hand.includes('chance') ? 'chance' : rose ? 'rose' : 'thorn',
    };
  };
  // What it believes it can turn over: its own roses, and maybe one more.
  const reach = () =>
    mine.stack.includes('thorn') ? 0 : mine.stack.length + (chance(rng, 0.5) ? 1 : 0);

  switch (r.stage) {
    case 'place':
      return mine.stack.length === 0 && mine.hand.length > 0 ? putDown() : null;
    case 'turns': {
      if (r.current !== ctx.me) return null;
      if (mine.hand.length === 0) return { type: 'bid', amount: 1 };
      const est = Math.min(reach(), r.total);
      const ready = mine.stack.length >= 2 || r.total >= g.players.filter((p) => !p.out).length + 2;
      if (est >= 1 && ready && chance(rng, 0.4)) return { type: 'bid', amount: est };
      return putDown();
    }
    case 'bid': {
      if (r.current !== ctx.me) return null;
      return high < Math.min(reach(), r.total)
        ? { type: 'bid', amount: high + 1 }
        : { type: 'pass' };
    }
    case 'flip': {
      if (r.challenger !== ctx.me) return null;
      if (me.flipped.length < Math.min(high, me.stack)) return { type: 'flip', owner: ctx.me };
      const open = g.players.filter((p) => p.id !== ctx.me && !p.out && p.flipped.length < p.stack);
      const bidders = new Set(r.bids.map((b) => b.by));
      const pick =
        pickOne(
          rng,
          open.filter((p) => bidders.has(p.id)),
        ) ?? pickOne(rng, open);
      return pick ? { type: 'flip', owner: pick.id } : null;
    }
    case 'lose': {
      if (r.challenger !== ctx.me) return null;
      const disc = pickOne(rng, mine.discs);
      return disc ? { type: 'lose', disc } : null;
    }
    case 'starter': {
      if (r.challenger !== ctx.me) return null;
      const pick = pickOne(
        rng,
        g.players.filter((p) => !p.out),
      );
      return pick ? { type: 'starter', player: pick.id } : null;
    }
    case 'result':
      return null;
  }
}
