import { type BotCtx, chance, pickOne } from '@vt/game-sdk';
import { randomPick } from './night.ts';
import type { NightfallAction, NightfallView } from './types.ts';

/**
 * A playtest bot, from its own seat's view only: takes a seat, presses Ready, answers its own
 * night prompt at random (passing now and then where passing is allowed), is ready to vote, and
 * votes for someone at random. Night steps run on their fixed clocks whatever it does.
 */
export function nightfallBot(view: NightfallView, ctx: BotCtx): NightfallAction | null {
  const { me, rng } = ctx;
  if (view.phase === 'lobby')
    return view.me && !view.me.playing ? { type: 'sit', playing: true } : null;
  const seat = view.table?.find((p) => p.id === me);
  if (!seat || seat.left) return null;
  switch (view.phase) {
    case 'ready':
      return view.meReady ? null : { type: 'ready' };
    case 'night': {
      const night = view.night;
      const prompt = night?.acting?.prompt;
      if (!night || night.index < 0 || !prompt) return null;
      if (!prompt.mandatory && chance(rng, 0.25))
        return { type: 'night', step: night.index, pass: true };
      return randomPick(prompt, rng, night.index);
    }
    case 'day':
      return view.day && !view.day.meReady ? { type: 'ready-to-vote', ready: true } : null;
    case 'vote': {
      const vote = view.vote;
      if (!vote) return null;
      const others = (view.table ?? []).filter((p) => p.id !== me).map((p) => p.id);
      if (vote.myVote === null) {
        const target = pickOne(rng, others);
        return target ? { type: 'vote', target } : null;
      }
      if (vote.hands === 2 && (vote.mySecond ?? null) === null) {
        const target = pickOne(rng, others);
        return target ? { type: 'vote', target, hand: 2 } : null;
      }
      return null;
    }
    default:
      return null;
  }
}
