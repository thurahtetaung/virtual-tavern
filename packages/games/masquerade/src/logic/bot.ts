import { type BotCtx, pickOne } from '@vt/game-sdk';
import type { MasqueradeAction, MasqueradeView } from './types.ts';

/**
 * A playtest bot, from its own seat's view only. It can't take part in the questions (they are
 * spoken), so it says it's ready to vote, votes for someone at random, and, if caught as the
 * spy, guesses a location, preferring ones not yet played this game.
 */
export function masqueradeBot(view: MasqueradeView, ctx: BotCtx): MasqueradeAction | null {
  const r = view.round;
  const { me, rng } = ctx;
  if (view.phase !== 'playing' || !r || !r.players.some((p) => p.id === me)) return null;
  switch (r.stage) {
    case 'talk':
      return r.meReady ? null : { type: 'ready-to-vote', ready: true };
    case 'vote': {
      if (r.myVote !== null || r.votedIds.includes(me)) return null;
      const target = pickOne(
        rng,
        r.players.filter((p) => p.id !== me).map((p) => p.id),
      );
      return target ? { type: 'vote', target } : null;
    }
    case 'guess': {
      if (!r.canGuess) return null;
      const played = new Set(view.played);
      const location =
        pickOne(
          rng,
          view.locations.filter((l) => !played.has(l)),
        ) ?? pickOne(rng, view.locations);
      return location ? { type: 'spy-guess', location } : null;
    }
    default:
      return null;
  }
}
