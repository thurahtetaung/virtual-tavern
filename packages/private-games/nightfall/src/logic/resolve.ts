import type { PlayerId } from '@vt/game-sdk';
import { ARTIFACTS, type HostileGroup, ROLES, type RoleId } from './roles.ts';
import type {
  Card,
  Death,
  FinalIdentity,
  GameRound,
  TeamResult,
  TeamResultId,
  VoteResult,
} from './types.ts';

/** A copier card's role at the end: what it copied, or a plain Villager if it never woke. */
const COPIERS: ReadonlySet<RoleId> = new Set(['doppelganger']);

/** The role a card makes its holder at the end of the night, before artifacts. */
export function cardRole(card: Card): RoleId {
  let role = card.role;
  if (COPIERS.has(role)) role = card.copied ?? 'villager';
  if (role === 'paranormal-investigator' && card.became) role = card.became;
  return role;
}

const teamOf = (role: RoleId | 'vampire'): TeamResultId =>
  role === 'vampire' ? 'vampire' : ROLES[role].team;

/** Who a player is at the end of the night (§0.7): card, copies, the P.I., then artifacts. */
export function identityOf(card: Card): FinalIdentity {
  const base = cardRole(card);
  const artifact = card.artifact ? ARTIFACTS[card.artifact] : null;
  if (artifact?.becomes && artifact.becomes !== base) {
    return {
      role: artifact.becomes,
      team: teamOf(artifact.becomes),
      artifact: artifact.id,
    };
  }
  return { role: base, team: teamOf(base), ...(artifact?.traitor ? { traitor: true } : {}) };
}

export const isWerewolf = (id: FinalIdentity) =>
  id.converted === true || (id.role !== 'vampire' && ROLES[id.role].werewolf === true);
export const isVampire = (id: FinalIdentity) => id.role === 'vampire';

/** The hostile group a player counts towards, if any. */
export function groupOf(id: FinalIdentity): HostileGroup | null {
  if (isWerewolf(id)) return 'werewolf';
  if (isVampire(id)) return 'vampire';
  return null;
}

/**
 * Resolves the vote and the winners (§3.2 and §3.3). `votes` maps each voter to their pick; a
 * Bodyguard's pick protects instead of voting. `players` are in seat order.
 */
export function resolveVote(
  players: readonly PlayerId[],
  cards: Record<PlayerId, Card>,
  votes: Record<PlayerId, PlayerId | null>,
): VoteResult {
  const ids: Record<PlayerId, FinalIdentity> = {};
  for (const p of players) ids[p] = identityOf(cards[p]!);

  // 1. Tally (protection picks are not votes).
  const tally: Record<PlayerId, number> = Object.fromEntries(players.map((p) => [p, 0]));
  const protectedSet = new Set<PlayerId>();
  for (const v of players) {
    const t = votes[v];
    if (!t || !(t in tally)) continue;
    if (ids[v]!.role === 'bodyguard') protectedSet.add(t);
    else tally[t]! += 1;
  }

  // 2. Mode, from the identities before any conversion.
  const groupsInPlay = new Set(players.map((p) => groupOf(ids[p]!)).filter((g) => g !== null));
  const villageInPlay = players.some((p) => ids[p]!.team === 'village');
  const epic = groupsInPlay.size + (villageInPlay ? 1 : 0) >= 3;

  // 3. Protection: the Prince, and Bodyguard picks.
  for (const p of players) if (ids[p]!.role === 'prince') protectedSet.add(p);

  // 4. Day conversions: a Cursed voted for by a Werewolf becomes one (dead or alive).
  for (const c of players) {
    if (ids[c]!.role !== 'cursed') continue;
    const wolfVotes = players.filter((v) => votes[v] === c && isWerewolf(ids[v]!)).length;
    if (wolfVotes > 0) ids[c] = { ...ids[c]!, team: 'werewolf', converted: true };
  }

  // 5. Deaths by vote. Protected players drop out of the ranking first.
  const cand = players.filter((p) => tally[p]! >= 1 && !protectedSet.has(p));
  const top = Math.max(0, ...cand.map((p) => tally[p]!));
  const dead: Death[] = [];
  if (top >= 2) {
    const first = cand.filter((p) => tally[p] === top);
    for (const p of first) dead.push({ player: p, cause: 'vote' });
    if (epic && first.length === 1) {
      const rest = cand.filter((p) => !first.includes(p));
      const second = Math.max(0, ...rest.map((p) => tally[p]!));
      if (second >= 1)
        for (const p of rest) if (tally[p] === second) dead.push({ player: p, cause: 'vote' });
    }
  }

  // 8. Chain deaths: a dead Hunter takes the player they voted for (unless protected).
  const isDead = (p: PlayerId) => dead.some((d) => d.player === p);
  for (let changed = true; changed;) {
    changed = false;
    for (const d of [...dead]) {
      if (ids[d.player]!.role !== 'hunter') continue;
      const t = votes[d.player];
      if (t && t in tally && !isDead(t) && !protectedSet.has(t)) {
        dead.push({ player: t, cause: 'hunter', by: d.player });
        changed = true;
      }
    }
  }

  const deadSet = new Set(dead.map((d) => d.player));
  const { teams, winners } = evaluateWins(players, ids, deadSet, epic);
  return {
    votes: Object.fromEntries(players.map((p) => [p, votes[p] ?? null])),
    tally,
    protectedPlayers: players.filter((p) => protectedSet.has(p)),
    deaths: dead,
    identities: ids,
    teams,
    winners,
    epic,
  };
}

/** §3.3: team results, then each player's own result. */
export function evaluateWins(
  players: readonly PlayerId[],
  ids: Record<PlayerId, FinalIdentity>,
  dead: ReadonlySet<PlayerId>,
  epic: boolean,
): { teams: TeamResult[]; winners: PlayerId[] } {
  const id = (p: PlayerId) => ids[p]!;
  const members = (g: HostileGroup) => players.filter((p) => groupOf(id(p)) === g);
  const deadIn = (g: HostileGroup) => members(g).filter((p) => dead.has(p));
  const tanners = players.filter((p) => id(p).role === 'tanner');
  // An Apprentice Tanner with no Tanner among the players counts as one.
  const apprentices = players.filter((p) => id(p).role === 'apprentice-tanner');
  const blockingTanners = tanners.length ? tanners : apprentices;
  const tannerDied = blockingTanners.some((p) => dead.has(p));
  const hostileDead = (['werewolf', 'vampire'] as const).filter((g) => deadIn(g).length > 0);
  const anyHostile = (['werewolf', 'vampire'] as const).some((g) => members(g).length > 0);

  const teamOf = (p: PlayerId): TeamResultId => id(p).team;
  const roster = (team: TeamResultId) => players.filter((p) => teamOf(p) === team);

  // Werewolf team.
  const wolves = members('werewolf');
  let wolfWin: boolean;
  if (!epic) wolfWin = wolves.length > 0 && deadIn('werewolf').length === 0 && !tannerDied;
  else
    wolfWin =
      wolves.length > 0 &&
      deadIn('werewolf').length === 0 &&
      hostileDead.some((g) => g !== 'werewolf') &&
      !tannerDied;
  const vampWin =
    members('vampire').length > 0 &&
    deadIn('vampire').length === 0 &&
    !tannerDied &&
    (!epic || hostileDead.some((g) => g !== 'vampire'));
  const villageWin = epic
    ? hostileDead.length >= 2
    : hostileDead.length > 0 || (!anyHostile && dead.size === 0);

  const result = new Map<PlayerId, boolean>();
  for (const p of players) {
    const me = id(p);
    const team = teamOf(p);
    let won: boolean;
    if (team === 'village') won = villageWin;
    else if (team === 'vampire') won = vampWin;
    else if (team === 'werewolf') {
      if (wolves.length === 0 && !isWerewolf(me)) {
        // No Werewolf among the players: the Minion and Squire need someone else to die.
        won = !tannerDied && [...dead].some((q) => q !== p);
      } else won = wolfWin;
    } else if (me.role === 'tanner') won = dead.has(p);
    else if (me.role === 'apprentice-tanner')
      won = tanners.length > 0 ? tanners.some((t) => dead.has(t)) : dead.has(p);
    else won = false;
    // The Traitor's condition replaces the team result when the team has someone else.
    if (me.traitor && (team === 'village' || team === 'werewolf' || team === 'vampire')) {
      const mates = roster(team).filter((q) => q !== p);
      if (mates.length > 0) won = mates.some((q) => dead.has(q));
    }
    result.set(p, won);
  }

  const teams: TeamResult[] = [];
  const add = (team: TeamResultId, won: boolean) => {
    const on = roster(team);
    if (on.length > 0) teams.push({ team, won, players: on });
  };
  add('village', villageWin);
  if (roster('werewolf').length)
    add('werewolf', wolves.length ? wolfWin : roster('werewolf').some((p) => result.get(p)));
  add('vampire', vampWin);
  if (roster('tanner').length)
    add(
      'tanner',
      roster('tanner').some((p) => result.get(p)),
    );
  return { teams, winners: players.filter((p) => result.get(p)) };
}

/** The final identities, from a round's cards (for the reveal before the vote resolves). */
export const identitiesOf = (r: GameRound) =>
  Object.fromEntries(r.order.map((p) => [p, identityOf(r.cards[p]!)]));
