import { type BotCtx, pickN, pickOne } from '@vt/game-sdk';
import { GRID, type StarlightAction, type StarlightView } from './types.ts';

/**
 * A playtest bot, from its own seat's view only. It takes a seat; it marks 2–5 cards from a seeded preference (its seat and the word, so it
 * keeps its count steady) and locks; as Scout it shows a random cross of its own not yet shown.
 */
export function starlightBot(view: StarlightView, ctx: BotCtx): StarlightAction | null {
  const { me } = ctx;
  if (view.phase === 'lobby')
    return view.me && !view.me.playing ? { type: 'sit', playing: true } : null;
  const r = view.round;
  if (view.phase !== 'playing' || !r || !r.players.includes(me) || r.gone.includes(me)) return null;
  switch (r.stage) {
    case 'mark': {
      if (r.locked.includes(me)) return null;
      if (r.myMarks.length) return { type: 'lock' };
      const rng = preference(`${me}|${r.no}|${r.word}`);
      const n = 2 + (rng % 4);
      const positions = pickN(
        ctx.rng,
        Array.from({ length: GRID }, (_, i) => i),
        n,
      );
      return { type: 'mark', positions };
    }
    case 'reveal': {
      if (r.scout !== me) return null;
      const shown = new Set(r.shown.map((s) => s.pos));
      const pos = pickOne(
        ctx.rng,
        r.myMarks.filter((p) => !shown.has(p)),
      );
      return pos === undefined ? null : { type: 'show', pos };
    }
    default:
      return null;
  }
}

/** A small stable hash: how many cards this bot likes for this word. */
function preference(key: string): number {
  let h = 0;
  for (const c of key) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return h;
}
