import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { claimLied } from './claims.ts';
import { countBlue } from './deck.ts';
import type { Game, HydraAction, HydraState, Round } from './types.ts';

/**
 * Stats only. Nothing is reported while it is still secret: elections once the votes flip,
 * sessions once the policy is on the board, claims and powers as they happen (never a result),
 * and everything that was hidden (roles, real draws, lies) only in `outcome`, at the end.
 * - `election`: round, president, chancellor, `yes`/`no`/`missing` ids, passed, tracker after,
 *   special, `zone` (3+ red policies were down);
 * - `cleared`: the Chancellor was confirmed not to be the Leader;
 * - `session`: president, chancellor, enacted colour (null when vetoed), vetoed, `chaos`;
 * - `claim`: who, kind, `blues` / `cards` / `team` / `target`, skipped;
 * - `power`: kind, president, target; `execution`: who was executed, by whom;
 * - `outcome`: winner, `how`, rounds, the teams and the Leader, and what the truth showed.
 */
export function insights(
  before: HydraState,
  after: HydraState,
  _action: HydraAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  if (!g) return [];
  const was = before.game && before.game.startedAt === g.startedAt ? before.game : null;
  const out: InsightEvent[] = [];
  g.rounds.forEach((r, i) => {
    const old: Round | undefined = was?.rounds[i];
    if (r.elected !== null && (old?.elected ?? null) === null) {
      const ids = (b: string) =>
        Object.entries(r.votes)
          .filter(([, v]) => v === b)
          .map(([id]) => id);
      out.push({
        type: 'election',
        playerId: r.president,
        props: {
          round: r.n,
          president: r.president,
          chancellor: r.chancellor,
          yes: ids('yes'),
          no: ids('no'),
          missing: [...r.missing],
          passed: r.elected,
          tracker: r.tracker,
          special: r.special,
          zone: redBefore(g, r) >= 3,
        },
      });
    }
    if (r.cleared && !old?.cleared)
      out.push({ type: 'cleared', playerId: r.chancellor, props: { round: r.n } });
    if (r.session && !old?.session)
      out.push({
        type: 'session',
        playerId: r.chancellor,
        props: {
          round: r.n,
          president: r.president,
          chancellor: r.chancellor,
          enacted: r.session.enacted,
          vetoed: r.session.vetoed,
          chaos: false,
        },
      });
    if (r.chaos && !old?.chaos)
      out.push({
        type: 'session',
        props: {
          round: r.n,
          president: null,
          chancellor: null,
          enacted: r.chaos,
          vetoed: false,
          chaos: true,
        },
      });
    for (const c of r.claims.slice(old?.claims.length ?? 0)) {
      out.push({
        type: 'claim',
        playerId: c.by,
        props: {
          round: r.n,
          kind: c.kind,
          blues: c.blues ?? null,
          cards: c.cards ? [...c.cards] : null,
          team: c.team ?? null,
          target: c.target ?? null,
          skipped: c.skipped ?? null,
        },
      });
    }
    if (r.power && !old?.power) {
      out.push({
        type: 'power',
        playerId: r.president,
        props: { round: r.n, kind: r.power.kind, target: r.power.target, auto: r.power.auto },
      });
      if (r.power.kind === 'execute' && r.power.target)
        out.push({
          type: 'execution',
          playerId: r.power.target,
          props: { round: r.n, by: r.president },
        });
    }
  });
  if (before.phase !== 'over' && after.phase === 'over' && g.winner) out.push(outcome(g));
  return out;
}

/** Red policies on the board when round `r` was voted on. */
function redBefore(g: Game, r: Round): number {
  let red = g.rebalance && g.players.length === 6 ? 1 : 0;
  for (const x of g.rounds) {
    if (x.n >= r.n) break;
    if (x.session?.enacted === 'red') red++;
    if (x.chaos === 'red') red++;
  }
  return red;
}

function outcome(g: Game): InsightEvent {
  const roles = g.roles;
  const isBlue = (id: PlayerId | null | undefined) => !!id && roles[id] === 'blue';
  const leader = g.players.find((p) => roles[p] === 'leader') ?? null;
  const truthOf = (n: number) => g.truth.find((t) => t.round === n);
  const liars: string[] = [];
  const judged = new Set<string>();
  const rrrBlue: string[] = [];
  const redBlue: string[] = [];
  const firewall: string[] = [];
  const bloodhound: string[] = [];
  const friendlyFire: string[] = [];
  let lies = 0;
  const claims = { blue: 0, red: 0 };
  const liesBy = { blue: 0, red: 0 };
  for (const r of g.rounds) {
    const t = truthOf(r.n);
    for (const c of r.claims) {
      const lied = claimLied(c, t);
      if (lied === null) continue;
      judged.add(c.by);
      const side = isBlue(c.by) ? 'blue' : 'red';
      claims[side]++;
      if (lied) {
        liars.push(c.by);
        lies++;
        liesBy[side]++;
      }
      if (c.kind === 'investigate' && !lied && c.team === 'red') bloodhound.push(c.by);
    }
    if (t?.drawn && countBlue(t.drawn) === 0 && isBlue(r.president)) rrrBlue.push(r.president);
    if (r.session?.enacted === 'blue' && r.chancellor && !isBlue(r.chancellor))
      redBlue.push(r.chancellor);
    if (
      r.session?.enacted === 'blue' &&
      isBlue(r.chancellor) &&
      t?.chancellorHand &&
      countBlue(t.chancellorHand) === 1
    )
      firewall.push(r.chancellor!);
    if (r.power?.kind === 'execute' && isBlue(r.president) && isBlue(r.power.target))
      friendlyFire.push(r.president);
  }
  const honest = [...judged].filter((p) => !liars.includes(p));
  const winners = g.players.filter((p) => (roles[p] === 'blue') === (g.winner === 'blue'));
  const executedBy = g.rounds.find(
    (r) => r.power?.kind === 'execute' && r.power.target === leader,
  )?.president;
  const ghost =
    g.winner === 'red' && leader && !g.investigated.includes(leader) && !g.dead.includes(leader)
      ? leader
      : null;
  return {
    type: 'outcome',
    winners,
    props: {
      winner: g.winner,
      how: g.reason,
      rounds: g.rounds.length,
      players: g.players.length,
      blue: g.players.filter((p) => roles[p] === 'blue'),
      red: g.players.filter((p) => roles[p] !== 'blue'),
      leader,
      blueEnacted: g.enacted.blue,
      redEnacted: g.enacted.red,
      chaos: g.rounds.filter((r) => r.chaos).length,
      vetoes: g.rounds.filter((r) => r.session?.vetoed).length,
      lies,
      claimsBlue: claims.blue,
      liesBlue: liesBy.blue,
      claimsRed: claims.red,
      liesRed: liesBy.red,
      liars,
      honest,
      rrrBlue,
      redBlue,
      firewall,
      bloodhound,
      friendlyFire,
      executor: g.reason === 'leader-executed' ? (executedBy ?? null) : null,
      ghost,
      rebalance: g.rebalance,
    },
  };
}
