import { type BotCtx, pickOne } from '@vt/game-sdk';
import type { RedHerringAction, RedHerringView } from './types.ts';

/** Playtest bots only: the words a bot word-picker writes. */
export const BOT_WORDS = [
  'Journey',
  'Secret',
  'Light',
  'Water',
  'Home',
  'Music',
  'Danger',
  'Dream',
  'Morning',
  'Shadow',
  'Garden',
  'Hunger',
] as const;

/**
 * A playtest bot, from its own seat's view only. It sits down in the lobby; plays a random card
 * when it's its turn; as word-picker writes a word from a short list; and votes for a random
 * player it may accuse. The talk step is the host's to end.
 */
export function redHerringBot(view: RedHerringView, ctx: BotCtx): RedHerringAction | null {
  const { me } = ctx;
  if (view.phase === 'lobby')
    return view.me && !view.me.playing ? { type: 'sit', playing: true } : null;
  const g = view.game;
  if (view.phase !== 'playing' || !g) return null;
  const r = g.round;
  if (!r.order.includes(me)) return null;
  switch (r.stage) {
    case 'card':
    case 'play': {
      if (r.turn !== me) return null;
      const card = pickOne(ctx.rng, g.hand);
      return card === undefined ? null : { type: 'play', card };
    }
    case 'word':
      return r.picker === me ? { type: 'word', word: pickOne(ctx.rng, BOT_WORDS)! } : null;
    case 'vote': {
      if (me === r.picker || r.myVote !== null) return null;
      if (view.settings.openVote && r.turn !== me) return null;
      const target = pickOne(
        ctx.rng,
        r.order.slice(1).filter((id) => id !== me),
      );
      return target === undefined ? null : { type: 'vote', player: target };
    }
    default:
      return null;
  }
}
