import { type BotCtx, type BotInfo, pickOne } from '@vt/game-sdk';
import { SCENE_SLOTS } from './content.ts';
import type { InquestAction, InquestView } from './types.ts';

/**
 * A playtest bot, from its own seat's view only. It plays every role but the Forensic Scientist
 * (whose bullets would decide the game): the Murderer picks a random crime from their own cards,
 * Ruled Out Evidence flips a random face-up Clue (never the Murderer's own crime), the Witness
 * points at a random scene tile, a speaker finishes presenting, and the Reversal taps a random
 * candidate before confirming. It never solves, so it never spends a badge.
 */
export function inquestBot(view: InquestView, ctx: BotCtx): InquestAction | null {
  const { me, rng } = ctx;
  if (view.phase === 'lobby')
    return view.me && !view.me.playing ? { type: 'sit', playing: true } : null;
  const g = view.game;
  if (view.phase !== 'playing' || !g) return null;
  const mine = g.players.find((p) => p.id === me);
  if (!mine || mine.gone || g.fs === me) return null;
  switch (g.stage) {
    case 'night': {
      if (g.myRole !== 'murderer' || g.solution) return null;
      const clue = pickOne(rng, mine.clue);
      const means = pickOne(rng, mine.means);
      return clue === undefined || means === undefined
        ? null
        : { type: 'commit-crime', clue, means };
    }
    case 'collect': {
      const ev = g.event;
      if (ev?.kind === 'ruled-out' && ev.current === me) {
        const clue = pickOne(
          rng,
          mine.clue.filter((c) => !mine.ruledOut.includes(c) && c !== g.solution?.clue),
        );
        return clue === undefined ? null : { type: 'rule-out', clue };
      }
      if (ev?.kind === 'testimony' && g.myRole === 'witness')
        return { type: 'testify', slot: pickOne(rng, SCENE_SLOTS)! };
      return null;
    }
    case 'present': {
      const p = g.present;
      return p && p.order[p.index] === me ? { type: 'done-presenting' } : null;
    }
    case 'reversal': {
      const rev = g.reversal;
      if (!rev || (g.myRole !== 'murderer' && g.myRole !== 'accomplice')) return null;
      const tapped = g.myRole === 'murderer' ? rev.murdererTap : rev.accompliceTap;
      if (tapped) return g.myRole === 'murderer' ? { type: 'reversal-confirm' } : null;
      const target = pickOne(
        rng,
        g.players
          .filter(
            (p) =>
              p.id !== me &&
              p.id !== g.partner &&
              p.id !== g.fs &&
              !g.formerFs.includes(p.id) &&
              !p.gone,
          )
          .map((p) => p.id),
      );
      return target ? { type: 'reversal-tap', target } : null;
    }
    default:
      return null;
  }
}

/** The Forensic Scientist stays with a human: the playtest makes the host pick, and picks them. */
export const inquestBotInfo: BotInfo = {
  note: 'The Forensic Scientist must be human: it goes to the host.',
  setup: (hostId) => [{ type: 'update-settings', fsMode: 'host', fsPick: hostId }],
};
