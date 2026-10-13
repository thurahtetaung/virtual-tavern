import type { CopyKey, CopyVars } from '../logic/copy.ts';
import type { HydraView, Policy } from '../logic/types.ts';
import type { Content } from './assets.ts';

export const nameOf = (view: HydraView, id: string | null | undefined) =>
  (id && view.game?.players.find((p) => p.id === id)?.name) ||
  view.seats.find((s) => s.id === id)?.name ||
  'Someone';

/** "you" for the viewer, the name otherwise. */
export const who = (view: HydraView, id: string | null | undefined, you = 'you') =>
  id && id === view.me?.id ? you : nameOf(view, id);

export const amAlive = (view: HydraView) => {
  const me = view.game?.players.find((p) => p.id === view.me?.id);
  return !!me && !me.dead;
};

/** Who the table is waiting on right now (mirrors the engine's `awaited`). */
export function waitingOn(view: HydraView): string[] {
  const g = view.game;
  if (view.phase !== 'playing' || !g) return [];
  const alive = g.players.filter((p) => !p.dead).map((p) => p.id);
  switch (view.stage) {
    case 'reveal':
      return g.players.filter((p) => !g.ready.includes(p.id)).map((p) => p.id);
    case 'nominate':
    case 'legislate-president':
    case 'veto-response':
    case 'power':
      return [g.president];
    case 'legislate-chancellor':
      return g.chancellor ? [g.chancellor] : [];
    case 'vote':
      return alive.filter((p) => !g.voted.includes(p));
    case 'claim':
      return g.needs.map((n) => n.by);
    default:
      return [];
  }
}

export interface Status {
  text: string;
  yourMove: boolean;
}

/** Cards as coloured squares, for logs and claims: "🟥🟥🟦". */
export const pips = (cards: readonly Policy[]) =>
  cards.map((c) => (c === 'blue' ? '🟦' : '🟥')).join('');

/** A blue count out of `n` as pips, red first: 1 of 3 → 🟥🟥🟦. */
export const bluesPips = (blues: number, n: number) =>
  pips([
    ...Array.from({ length: n - blues }, () => 'red' as const),
    ...Array.from({ length: blues }, () => 'blue' as const),
  ]);

/** What the viewer should do (or what's happening), role-neutral so a glance gives nothing away. */
export function statusFor(view: HydraView, c: Content): Status {
  const g = view.game;
  const me = view.me?.id;
  if (view.phase === 'lobby' || !g) return { text: '', yourMove: false };
  if (view.phase === 'over' && g.end)
    return {
      text: c.copy(g.end.winner === 'blue' ? 'status.over.blue' : 'status.over.red'),
      yourMove: false,
    };
  const inGame = g.players.some((p) => p.id === me);
  const alive = amAlive(view);
  const n = g.players.filter((p) => !p.dead).length;
  const vars = {
    P: who(view, g.president),
    C: who(view, g.chancellor),
    voted: g.voted.length,
    alive: n,
    ready: g.ready.length,
    total: g.players.length,
  };
  const say = (key: CopyKey, yourMove: boolean, more: CopyVars = {}): Status => ({
    text: c.copy(key, { ...vars, ...more }),
    yourMove,
  });
  if (inGame && !alive && view.stage !== 'reveal') return say('status.dead', false);
  switch (view.stage) {
    case 'reveal':
      return inGame && !g.ready.includes(me!)
        ? say('status.reveal.you', true)
        : say('status.reveal.waiting', false);
    case 'nominate':
      return g.president === me
        ? say('status.nominate.you', true)
        : say('status.nominate.other', false);
    case 'vote':
      if (inGame && g.myVote === null) return say('status.vote.you', true);
      if (g.myVote) return say('status.vote.voted', false, { ballot: c.ballotName(g.myVote) });
      return say('status.vote.other', false);
    case 'leader-check':
      // A question about the Chancellor by name, even to the Chancellor ("is you…" reads badly).
      return say('status.leaderCheck', false, { C: nameOf(view, g.chancellor) });
    case 'legislate-president':
      return g.president === me
        ? say('status.legislate.president.you', true)
        : say('status.legislate.president.other', false);
    case 'legislate-chancellor':
      return g.chancellor === me
        ? say(
            g.vetoUnlocked && !g.vetoRequested
              ? 'status.legislate.chancellor.veto.you'
              : 'status.legislate.chancellor.you',
            true,
          )
        : say('status.legislate.chancellor.other', false);
    case 'veto-response':
      return g.president === me ? say('status.veto.you', true) : say('status.veto.other', false);
    case 'claim': {
      const mine = g.needs.find((x) => x.by === me);
      if (mine)
        return say(`status.claim.${mine.kind}.you`, true, { target: nameOf(view, mine.target) });
      return say('status.claim.other', false);
    }
    case 'power': {
      if (!g.power) return { text: '', yourMove: false };
      const power = c.powerName(g.power);
      return g.president === me
        ? say(`status.power.${g.power}.you`, true, { power })
        : say('status.power.other', false, { power });
    }
    case 'chaos':
      return say('status.chaos', false);
    default:
      return { text: '', yourMove: false };
  }
}
