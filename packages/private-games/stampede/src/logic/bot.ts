import { type BotCtx, chance, pickOne } from '@vt/game-sdk';
import type { StampedeAction, StampedeView } from './types.ts';

/** Self-written answers for questions whose deck gives no common answers. */
const GENERIC = [
  'Pizza',
  'Blue',
  'A dog',
  'Chocolate',
  'Summer',
  'Cheese',
  'Paris',
  'Pasta',
  'Tuesday',
  'Coffee',
  'Red',
  'A cat',
];

/**
 * A playtest bot, from its own seat's view only: takes a seat, answers with one of the question's
 * common answers when its deck gives some (the first, the likeliest, most often), else a generic
 * one, and picks a random player when it holds the Pink Cow and must pass it on. It never sees
 * anyone else's answer before the reveal, and never hosts (`hostMove` is the tests' host).
 */
export function stampedeBot(view: StampedeView, ctx: BotCtx): StampedeAction | null {
  const { me, rng } = ctx;
  if (view.phase === 'lobby')
    return view.me && !view.me.playing ? { type: 'sit', playing: true } : null;
  const r = view.round;
  if (view.phase !== 'playing' || !r) return null;
  switch (r.stage) {
    case 'answer': {
      if (!r.players.includes(me) || r.myAnswer !== null || r.answered.includes(me)) return null;
      const hints = ctx.hints?.(r.questionId) ?? [];
      const text = hints.length
        ? chance(rng, 0.6)
          ? hints[0]!
          : pickOne(rng, hints)!
        : pickOne(rng, GENERIC)!;
      return { type: 'answer', text };
    }
    case 'pick': {
      if (view.pinkCow !== me || !r.pick) return null;
      const player = pickOne(rng, r.pick.options);
      return player ? { type: 'pick', player } : null;
    }
    default:
      return null;
  }
}

/** The host's buttons for bot tests: start, and go on to the next question. */
export function hostMove(view: StampedeView): StampedeAction | null {
  if (view.phase === 'lobby') return { type: 'start' };
  const r = view.round;
  if (view.phase !== 'playing' || !r) return null;
  if (r.stage === 'reveal') return { type: 'next-round' };
  return null;
}
