import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { groupOf, isWerewolf } from './resolve.ts';
import { ROLES } from './roles.ts';
import type { NightfallAction, NightfallState, Slot, TeamResultId } from './types.ts';

/** How a game ended, for the stats page (the first that applies). */
export type Ending =
  'hunter' | 'tanner' | 'nobody-died' | 'werewolf-caught' | 'wolves-survived' | 'wrong-player';

const slotKey = (s: Slot) => ('player' in s ? `p:${s.player}` : `c:${s.center}`);

/**
 * Stats only, all reported at the reveal (nothing is sent while the game is secret):
 * - `outcome`: the teams in play and the winners, the player count, how the game ended, how
 *   long the night and the day took, how many cards moved and the longest chain of moves of a
 *   single card, the setup's roles and the roles that were moved; words are the roles dealt
 *   (`clue`) and the roles that died (`guess`).
 * - `player` (one per player): dealt and final role and team, won or not, and the facts behind
 *   the fun facts (lone wolf survivor, Tanner's dream, identity crisis, blindsided vote, Hunter's
 *   revenge, Bodyguard save, vote on a werewolf or on a villager, voted out as a villager, cards
 *   moved).
 * - `look` (one per Seer or P.I. look at a card): whether that card was still there at dawn.
 * Roles are ids; names come from the private manifest on the page.
 */
export function insights(
  before: NightfallState,
  after: NightfallState,
  _action: NightfallAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  if (before.stage === 'reveal' || after.stage !== 'reveal') return [];
  const r = after.round;
  const result = r?.result;
  if (!r || !result) return [];
  const events: InsightEvent[] = [];
  const ids = result.identities;
  const timeline = r.night?.timeline ?? [];
  const dead = new Set(result.deaths.map((d) => d.player));
  const won = new Set(result.winners);
  const n = r.order.length;

  // Cards moved: each card in a move counts once; a card's chain is how often it moved.
  const chain = new Map<number, number>();
  const movedBy = new Map<PlayerId, number>();
  const movedRoles: string[] = [];
  for (const t of timeline) {
    for (const m of t.moved ?? []) {
      chain.set(m.card, (chain.get(m.card) ?? 0) + 1);
      movedRoles.push(m.role);
      if (t.by) movedBy.set(t.by, (movedBy.get(t.by) ?? 0) + 1);
    }
  }
  const longestChain = Math.max(0, ...chain.values());

  // Looks by the Seer and the P.I.: did the card they saw stay where it was until dawn?
  for (const t of timeline) {
    if (!t.by || t.note.kind !== 'saw') continue;
    if (t.stepId !== 'seer' && t.stepId !== 'paranormal-investigator') continue;
    const slot = t.note.slot;
    const now = 'player' in slot ? r.cards[slot.player]?.role : r.center[slot.center]?.card.role;
    const movedAfter = timeline.some(
      (u) => u.step > t.step && u.moved?.some((m) => slotKey(m.slot) === slotKey(slot)),
    );
    events.push({
      type: 'look',
      playerId: t.by,
      props: { role: t.stepId, right: !movedAfter && now === t.note.role },
    });
  }

  // How the game ended.
  const wolves = r.order.filter((p) => isWerewolf(ids[p]!));
  const ending: Ending = result.deaths.some((d) => d.cause === 'hunter')
    ? 'hunter'
    : r.order.some((p) => dead.has(p) && ids[p]!.role === 'tanner')
      ? 'tanner'
      : dead.size === 0
        ? 'nobody-died'
        : wolves.some((p) => dead.has(p))
          ? 'werewolf-caught'
          : wolves.length > 0
            ? 'wolves-survived'
            : 'wrong-player';

  const tally = result.tally;
  const top = Math.max(0, ...Object.values(tally));
  for (const p of r.order) {
    const id = ids[p]!;
    const dealtTeam: TeamResultId = ROLES[r.deal.players[p]!].team;
    const vote = result.votes[p] ?? null;
    const target = vote ? ids[vote] : undefined;
    const isGuard = id.role === 'bodyguard';
    events.push({
      type: 'player',
      playerId: p,
      props: {
        dealt: r.deal.players[p]!,
        final: String(id.role),
        team: id.team,
        dealtTeam,
        won: won.has(p),
        died: dead.has(p),
        loneWolf: wolves.length === 1 && wolves[0] === p && !dead.has(p),
        tannerDream: id.role === 'tanner' && won.has(p),
        identityCrisis: id.team !== dealtTeam,
        blindsided: id.team !== dealtTeam && !!target && !isGuard && target.team === id.team,
        hunterShots: result.deaths.filter((d) => d.cause === 'hunter' && d.by === p).length,
        bodyguardSave: isGuard && !!vote && top >= 2 && tally[vote] === top,
        voted: !!vote && !isGuard,
        votedWolf: !!target && !isGuard && groupOf(target) === 'werewolf',
        votedVillager: !!target && !isGuard && target.team === 'village',
        votedRole: target && !isGuard ? String(target.role) : null,
        villageDeath: dead.has(p) && id.team === 'village',
        cardsMoved: movedBy.get(p) ?? 0,
      },
    });
  }

  const times = r.times;
  events.push({
    type: 'outcome',
    winners: result.winners,
    words: [
      ...r.order.map((p) => ({ kind: 'clue' as const, word: r.deal.players[p]! })),
      ...result.deaths.map((d) => ({ kind: 'guess' as const, word: String(ids[d.player]!.role) })),
    ],
    props: {
      players: n,
      teams: result.teams.map((t) => t.team),
      teamsWon: result.teams.filter((t) => t.won).map((t) => t.team),
      ending,
      deaths: result.deaths.length,
      nightMs: times.night !== null && times.dawn !== null ? times.dawn - times.night : null,
      dayMs: times.dawn !== null && times.vote !== null ? times.vote - times.dawn : null,
      moves: movedRoles.length,
      chain: longestChain,
      movedRoles,
      setup: [...new Set(after.settings.roles)],
      sets: [...new Set(after.settings.roles.map((role) => ROLES[role].set))],
    },
  });
  return events;
}
