import { type BotCtx, type BotInfo, pickOne } from '@vt/game-sdk';
import { SCENE_SLOTS } from './content.ts';
import type { InquestAction, InquestView } from './types.ts';

/**
 * A playtest bot, from its own seat's view only. It plays every role but the Forensic Scientist
 * (whose bullets would decide the game): the Murderer picks a random crime from their own cards,
 * Ruled Out Evidence flips a random face-up Clue (never the Murderer's own crime), the Witness
 * points at a random scene tile, a speaker finishes presenting, and the Reversal taps a random
 * candidate before confirming. It never solves on its own; in the final accusations it accuses
 * in its turn with a random pair from someone else's cards (the Murderer's side never names its
 * own crime, so it bluffs). With the Allies expansion the Lab Technician checks a random card on
 * the table (now and then it skips), the Inside Man takes a random badge (his own allowed) and
 * joins the Reversal, and the Protective Detail just watches. The Inside Man doesn't know the
 * crime, so his final accusation can name it by chance: that is refused privately, and the
 * runner lets him guess again (`retry`).
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
    case 'final': {
      const f = g.final;
      if (!f || f.order[f.index] !== me || mine.badges <= 0) return null;
      const crime = g.myRole === 'murderer' || g.myRole === 'accomplice' ? g.solution : null;
      const pairs = g.players
        .filter((p) => p.id !== me && p.id !== g.fs && p.clue.length > 0)
        .flatMap((p) =>
          p.clue
            .filter((c) => !p.ruledOut.includes(c))
            .flatMap((clue) => p.means.map((means) => ({ target: p.id, clue, means }))),
        )
        .filter(
          (x) =>
            !crime ||
            x.target !== crime.murderer ||
            x.clue !== crime.clue ||
            x.means !== crime.means,
        );
      const pick = pickOne(rng, pairs);
      return pick ? { type: 'solve', ...pick } : null;
    }
    case 'allies': {
      const step = g.allies?.step;
      if (step === 'lab' && g.myRole === 'lab-technician') {
        if (rng.int(5) === 0) return { type: 'lab-skip' };
        const cards = g.players.flatMap((p) => [
          ...p.clue.map((n) => ({ owner: p.id, deck: 'clue' as const, n })),
          ...p.means.map((n) => ({ owner: p.id, deck: 'means' as const, n })),
        ]);
        const card = pickOne(rng, cards);
        return card ? { type: 'lab-check', ...card } : { type: 'lab-skip' };
      }
      if (step === 'inside' && g.myRole === 'inside-man') {
        const target = pickOne(
          rng,
          g.players
            .filter((p) => !p.isFs && !p.formerFs && !p.gone && p.badges > 0)
            .map((p) => p.id),
        );
        return target ? { type: 'inside-pick', target } : null;
      }
      return null;
    }
    case 'reversal': {
      const rev = g.reversal;
      const role = g.myRole;
      if (!rev || (role !== 'murderer' && role !== 'accomplice' && role !== 'inside-man'))
        return null;
      const tapped =
        role === 'murderer'
          ? rev.murdererTap
          : role === 'accomplice'
            ? rev.accompliceTap
            : rev.insideTap;
      if (tapped) return role === 'murderer' ? { type: 'reversal-confirm' } : null;
      const team = (g.team ?? []).map((t) => t.id);
      const target = pickOne(
        rng,
        g.players
          .filter(
            (p) =>
              p.id !== me &&
              p.id !== g.partner &&
              !team.includes(p.id) &&
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
  // The Inside Man's accusation can hit the crime he doesn't know: he just picks again.
  retry: (code) => code === 'no-accusation',
};
