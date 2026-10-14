import { type BotCtx, chance, pickN, pickOne } from '@vt/game-sdk';
import { legalSlots } from './game.ts';
import type { QuestCard, RoundTableAction, RoundTableView } from './types.ts';

/**
 * A playtest bot, from its own seat's view only: what a strict timer would do, with a little
 * more life. It reads its role, votes mostly Approve, plays Success unless Evil wants a Fail,
 * and picks teams, Lady checks and the assassination target at random.
 */
export function roundTableBot(view: RoundTableView, ctx: BotCtx): RoundTableAction | null {
  const g = view.game;
  const { me, rng } = ctx;
  if (view.phase !== 'playing' || !g || !g.players.some((p) => p.id === me)) return null;
  const others = g.players.map((p) => p.id).filter((id) => id !== me);
  const evil = view.role?.loyalty === 'evil';
  switch (view.stage) {
    case 'reveal':
      return g.ready.includes(me) ? null : { type: 'ready' };
    case 'propose': {
      if (g.leader !== me) return null;
      const slot = g.slot ?? pickOne(rng, legalSlots(g))!;
      const size = g.quests[slot]!.size;
      // A traitor likes to be on the team; anyone else just picks a team.
      const pool = g.players.map((p) => p.id);
      const team =
        evil && chance(rng, 0.7) ? [me, ...pickN(rng, others, size - 1)] : pickN(rng, pool, size);
      return { type: 'propose', team, slot };
    }
    case 'discuss':
      return g.leader === me ? { type: 'call-vote' } : null;
    case 'vote':
      return g.vote && g.vote.myVote === null && !g.vote.voted.includes(me)
        ? { type: 'vote', approve: chance(rng, 0.7) }
        : null;
    case 'quest': {
      const q = g.quest;
      if (!q || !q.team.includes(me) || q.myCard !== null || q.played.includes(me)) return null;
      const cards = view.role?.cards ?? ['success'];
      const card: QuestCard =
        evil && cards.includes('fail') && chance(rng, 0.6)
          ? 'fail'
          : cards.includes('success')
            ? 'success'
            : cards[0]!;
      return { type: 'play', card };
    }
    case 'lady': {
      if (g.lady?.holder !== me) return null;
      const target = pickOne(
        rng,
        others.filter((id) => !g.lady!.holders.includes(id)),
      );
      return target ? { type: 'lady', target } : null;
    }
    case 'assassinate': {
      if (g.assassin !== me) return null;
      // Never a known fellow traitor, if there is anyone else to name.
      const known = new Set(view.role?.known.filter((k) => k.as === 'evil').map((k) => k.id));
      const target =
        pickOne(
          rng,
          others.filter((id) => !known.has(id)),
        ) ?? pickOne(rng, others);
      return target ? { type: 'assassinate', target } : null;
    }
    default:
      return null;
  }
}
