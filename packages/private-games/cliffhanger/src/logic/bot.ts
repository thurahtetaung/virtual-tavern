import { type BotCtx, chance, pickOne } from '@vt/game-sdk';
import { tierRank } from './content.ts';
import { missing } from './genres.ts';
import { type CliffhangerAction, type CliffhangerView, type TeamId, other } from './types.ts';

/**
 * A playtest bot, from its own seat's view only. It answers in face-offs (less likely the longer
 * the rally runs, so face-offs end), keeps and places its easiest cards, taps Got it on a card it
 * can see now and then (or switches card), steals when its own three are done, makes a
 * three-for-one for a genre its team still needs and picks a comeback category at random. It never
 * hosts (`hostMove` is the tests' host).
 */
export function cliffhangerBot(view: CliffhangerView, ctx: BotCtx): CliffhangerAction | null {
  const { me, rng } = ctx;
  const r = view.round;
  if (view.phase !== 'playing' || !r) return null;
  const team = view.myTeam;
  if (!team) return null;

  if (r.myHand) {
    const hand = r.myHand;
    const keep = hand.offered
      .map((c, i) => ({ c, i }))
      .sort((x, y) => tierRank(x.c) - tierRank(y.c) || x.i - y.i)
      .slice(0, 3)
      .map(({ c }) => c.id);
    return { type: 'lock', slots: rng.shuffle(keep) };
  }

  switch (r.stage) {
    case 'pick-category': {
      if (r.pick?.by !== me || !r.pick.options) return null;
      return { type: 'pick-category', id: pickOne(rng, r.pick.options)!.id };
    }
    case 'faceoff': {
      const fo = r.faceoff;
      if (!fo || (r.pair.a !== me && r.pair.b !== me)) return null;
      if (fo.on === null) return r.pair.a === me || chance(rng, 0.3) ? { type: 'said' } : null;
      if (fo.on !== me) return null;
      // A bot that doesn't answer runs out of time: the face-off ends.
      return chance(rng, Math.max(0.2, 0.9 - fo.answers * 0.1)) ? { type: 'said' } : null;
    }
    case 'turn': {
      const turn = r.turn;
      if (!turn || turn.describer !== me) return null;
      const open = (t: TeamId) =>
        (r.board[t] ?? []).flatMap((s) => (s.card && s.got === null ? [s.card] : []));
      const cards = open(team).length ? open(team) : turn.stealOpen ? open(other(team)) : [];
      if (!cards.length) return null;
      const now = cards.find((c) => c.id === turn.focus) ?? cards[0]!;
      if (chance(rng, 0.7)) return { type: 'got', card: now.id };
      const next = cards.find((c) => c.id !== now.id);
      return next ? { type: 'focus', card: next.id } : null;
    }
    case 'steal': {
      if (r.steal?.team !== team) return null;
      const mine = view.collections[team];
      const counts = new Map<string, number>();
      for (const c of mine) counts.set(c.genre, (counts.get(c.genre) ?? 0) + 1);
      const goal = view.target;
      const need = missing(
        mine.map((c) => c.genre),
        goal,
      );
      // Give up a genre we have three or more of, for one we still need (keeping a card of it).
      const spare = [...counts].find(
        ([g, n]) => n >= (goal.genres.includes(g) ? goal.each + 3 : 3),
      );
      const want = view.collections[other(team)].find((c) => need.includes(c.genre));
      if (spare && want) return { type: 'steal', genre: spare[0], card: want.id };
      return { type: 'pass' };
    }
    default:
      return null;
  }
}

/** The tests' host: starts the game, and nothing else. */
export function hostMove(view: CliffhangerView): CliffhangerAction | null {
  return view.phase === 'lobby' ? { type: 'start' } : null;
}
