import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { loyaltyOf } from './roles.ts';
import type { RoundTableAction, RoundTableState } from './types.ts';

/**
 * Stats and the night recap, reported only once nothing about them is secret:
 * - `proposal` (the leader): each vote once revealed: the team, whether it was approved, the
 *   approve and reject counts, who voted which way, and which proposal of the round it was;
 * - `quest`: each quest's slot, team, size, Fail count and result (never who played what);
 * - `lady` (the holder): who checked whom; the results only arrive with `outcome`;
 * - at the end: `assassination` (the assassin: target, hit), `player` per player (role, side,
 *   won), and `outcome` (winning side, how it was won, every seat's role and side, the Lady's
 *   results, the longest run of rejections).
 */
export function insights(
  before: RoundTableState,
  after: RoundTableState,
  _action: RoundTableAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const events: InsightEvent[] = [];
  const was = before.game;
  const g = after.game;
  if (!g || after.phase === 'lobby') return events;
  // A fresh game (Play again) starts from nothing.
  const fresh = !was || before.phase !== 'playing';
  const oldProposals = fresh ? 0 : was.proposals.length;
  const oldResults = fresh ? 0 : was.results.length;
  const oldChecks = fresh ? 0 : (was.ladyState?.checks.length ?? 0);
  for (const p of g.proposals.slice(oldProposals)) {
    const approvers = g.players.filter((id) => p.votes[id] === true);
    const rejecters = g.players.filter((id) => p.votes[id] === false);
    events.push({
      type: 'proposal',
      playerId: p.leader,
      props: {
        round: p.round,
        attempt: p.attempt,
        slot: p.slot,
        size: p.team.length,
        team: [...p.team],
        approved: p.approved,
        approves: approvers.length,
        rejects: rejecters.length,
        approvers,
        rejecters,
        autoVoters: [...p.autoVotes],
        auto: p.auto,
      },
    });
  }
  for (const r of g.results.slice(oldResults)) {
    events.push({
      type: 'quest',
      props: {
        round: r.round,
        slot: r.slot,
        size: r.team.length,
        team: [...r.team],
        fails: r.fails,
        success: r.success,
      },
    });
  }
  for (const c of (g.ladyState?.checks ?? []).slice(oldChecks)) {
    events.push({ type: 'lady', playerId: c.holder, props: { target: c.target, round: c.round } });
  }
  if (before.phase !== 'over' && after.phase === 'over' && g.winner && g.reason) {
    const sideOf = (p: PlayerId) => loyaltyOf(g.roles[p]!);
    const winners = g.players.filter((p) => sideOf(p) === g.winner);
    if (g.assassin && g.target) {
      events.push({
        type: 'assassination',
        playerId: g.assassin,
        props: { target: g.target, hit: g.roles[g.target] === 'merlin', auto: g.autoTarget },
      });
    }
    for (const p of g.players) {
      events.push({
        type: 'player',
        playerId: p,
        props: { role: g.roles[p]!, side: sideOf(p), won: winners.includes(p) },
      });
    }
    const checks = g.ladyState?.checks ?? [];
    events.push({
      type: 'outcome',
      winners,
      props: {
        winner: g.winner,
        reason: g.reason,
        players: g.players.length,
        seats: [...g.players],
        roles: g.players.map((p) => g.roles[p]!),
        sides: g.players.map(sideOf),
        merlin: g.players.find((p) => g.roles[p] === 'merlin') ?? null,
        assassin: g.assassin,
        successes: g.results.filter((r) => r.success).length,
        failures: g.results.filter((r) => !r.success).length,
        proposals: g.proposals.length,
        rejected: g.proposals.filter((p) => !p.approved).length,
        streak: Math.max(0, ...g.proposals.filter((p) => !p.approved).map((p) => p.attempt)),
        ladyHolders: checks.map((c) => c.holder),
        ladyTargets: checks.map((c) => c.target),
        ladyEvil: checks.map((c) => (c.loyalty === 'evil' ? 1 : 0)),
      },
    });
  }
  return events;
}
