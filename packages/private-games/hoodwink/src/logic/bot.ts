import { type BotCtx, cannedText, pickOne } from '@vt/game-sdk';
import type { HoodwinkAction, HoodwinkView } from './types.ts';

/**
 * A playtest bot, from its own seat's view only: takes a seat, writes "Lie for me" when the game
 * offers it (the server deals the fakes, as for a human pressing the button, and it takes either) or else a canned lie,
 * and votes for any option that isn't its own. It never sees the answer.
 */
export function hoodwinkBot(view: HoodwinkView, ctx: BotCtx): HoodwinkAction | null {
  const { me, rng } = ctx;
  if (view.phase === 'lobby')
    return view.me && !view.me.playing ? { type: 'sit', playing: true } : null;
  const r = view.round;
  if (view.phase !== 'playing' || !r) return null;
  switch (r.stage) {
    case 'write':
      if (!r.players.includes(me) || r.myLie !== null || r.written.includes(me)) return null;
      // Offered ready-made lies: take either (the others may have picked them all by now).
      if (r.myFakes?.length) {
        const choice = rng.int(r.myFakes.length);
        return { type: 'lie-for-me', choice, fake: r.myFakes[choice] };
      }
      if (r.myFakes) return { type: 'lie', text: cannedText(rng, 'lie') };
      return r.canLieForMe ? { type: 'lie-for-me' } : { type: 'lie', text: cannedText(rng, 'lie') };
    case 'vote': {
      if (!r.voters.includes(me) || r.myVote !== null || r.voted.includes(me)) return null;
      const option = pickOne(
        rng,
        r.options.filter((o) => !o.mine),
      );
      return option ? { type: 'vote', option: option.index } : null;
    }
    default:
      return null;
  }
}
