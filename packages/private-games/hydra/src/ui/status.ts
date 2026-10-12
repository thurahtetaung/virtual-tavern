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
  if (view.phase === 'over' && g.end) {
    const team = c.t(g.end.winner === 'blue' ? '{blues}' : '{reds}');
    return { text: `The ${team} win!`, yourMove: false };
  }
  const inGame = g.players.some((p) => p.id === me);
  const alive = amAlive(view);
  const P = who(view, g.president);
  const C = who(view, g.chancellor);
  const n = g.players.filter((p) => !p.dead).length;
  if (inGame && !alive && view.stage !== 'reveal')
    return {
      text: 'You’ve been executed: you can watch, but you can’t talk, vote or give anything away.',
      yourMove: false,
    };
  switch (view.stage) {
    case 'reveal':
      return inGame && !g.ready.includes(me!)
        ? {
            text: 'Read your secret role (slide the card up, or hold it), then tap Ready. Keep it hidden from your neighbours.',
            yourMove: true,
          }
        : {
            text: `Waiting for everyone to read their role (${g.ready.length} of ${g.players.length}).`,
            yourMove: false,
          };
    case 'nominate':
      return g.president === me
        ? {
            text: 'You’re the Presidential Candidate: nominate a Chancellor. Greyed seats can’t be picked (tap one to see why).',
            yourMove: true,
          }
        : { text: `${P} is choosing a Chancellor. Say out loud who you’d trust!`, yourMove: false };
    case 'vote': {
      const k = `${g.voted.length} of ${n} voted`;
      if (inGame && g.myVote === null)
        return {
          text: c.t(`Vote {yes} or {no} on President ${P} with Chancellor ${C}. ${k}.`),
          yourMove: true,
        };
      if (g.myVote)
        return {
          text: `You voted ${c.ballotName(g.myVote)}: you can change it until the last vote is in. ${k}.`,
          yourMove: false,
        };
      return {
        text: `Everyone votes on President ${P} with Chancellor ${C}. ${k}.`,
        yourMove: false,
      };
    }
    case 'leader-check':
      return { text: c.t(`The moment of truth: is ${C} {leader}?`), yourMove: false };
    case 'legislate-president':
      return g.president === me
        ? {
            text: 'You’re the President: discard one of your three policies. No talking until it’s done!',
            yourMove: true,
          }
        : {
            text: `The government is in session: ${P} is discarding a policy. Silence, please.`,
            yourMove: false,
          };
    case 'legislate-chancellor':
      return g.chancellor === me
        ? {
            text:
              g.vetoUnlocked && !g.vetoRequested
                ? 'You’re the Chancellor: enact one policy, or ask the President for a veto.'
                : 'You’re the Chancellor: enact one policy. The other is discarded.',
            yourMove: true,
          }
        : {
            text: `The government is in session: ${C} is choosing which policy to enact.`,
            yourMove: false,
          };
    case 'veto-response':
      return g.president === me
        ? {
            text: `${C} asks to veto this agenda. Agree (both cards are discarded) or refuse?`,
            yourMove: true,
          }
        : { text: `${C} asked for a veto; ${P} is deciding.`, yourMove: false };
    case 'claim': {
      const mine = g.needs.find((x) => x.by === me);
      if (mine)
        return {
          text:
            mine.kind === 'investigate'
              ? `Tell the table what you saw on ${nameOf(view, mine.target)}’s party card. Claims are final, and you may lie.`
              : mine.kind === 'peek'
                ? 'Tell the table the top three cards you saw. Claims are final, and you may lie.'
                : `Claim the ${mine.kind === 'president' ? 'three cards you drew' : 'two cards you got'}. Claims are final, and you may lie.`,
          yourMove: true,
        };
      return {
        text: 'Claims are coming in. Question them out loud before the next nomination!',
        yourMove: false,
      };
    }
    case 'power': {
      if (!g.power) return { text: '', yourMove: false };
      const name = c.powerName(g.power);
      return g.president === me
        ? { text: `Use your power: ${name}. Talk it over first if you like.`, yourMove: true }
        : { text: `${P} must use a power: ${name}.`, yourMove: false };
    }
    case 'chaos':
      return {
        text: 'Three failed governments: the people take over and enact the top policy!',
        yourMove: false,
      };
    default:
      return { text: '', yourMove: false };
  }
}
