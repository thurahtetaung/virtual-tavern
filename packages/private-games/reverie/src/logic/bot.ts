import { type BotCtx, cannedText, pickN, pickOne } from '@vt/game-sdk';
import type { ReverieAction, ReverieView } from './types.ts';

/**
 * A playtest bot, from its own seat's view only: takes a seat; as the storyteller it tells a
 * random card of its own with a canned clue (any clue is legal, and its meaning doesn't matter
 * when testing the flow); otherwise it gives random cards and votes for any card not its own.
 */
export function reverieBot(view: ReverieView, ctx: BotCtx): ReverieAction | null {
  const { me, rng } = ctx;
  if (view.phase === 'lobby')
    return view.me && !view.me.playing ? { type: 'sit', playing: true } : null;
  const t = view.turn;
  if (view.phase !== 'playing' || !t || !view.me?.playing) return null;
  const storyteller = t.storyteller === me;
  switch (t.phase) {
    case 'clue': {
      if (!storyteller || t.myStoryCard !== null) return null;
      const card = pickOne(rng, view.hand);
      return card === undefined ? null : { type: 'tell', card, clue: cannedText(rng, 'clue') };
    }
    case 'pick': {
      if (storyteller || t.myCards.length > 0) return null;
      const cards = pickN(rng, view.hand, view.cardsToGive);
      return cards.length ? { type: 'give', cards } : null;
    }
    case 'vote': {
      if (storyteller || t.myVote !== null) return null;
      const index = pickOne(
        rng,
        t.table.flatMap((c, i) => (c.mine ? [] : [i])),
      );
      return index === undefined ? null : { type: 'vote', index };
    }
    default:
      return null;
  }
}
