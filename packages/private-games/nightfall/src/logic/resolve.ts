import type { PlayerId } from '@vt/game-sdk';
import { ARTIFACTS, type HostileGroup, ROLES, type RoleId } from './roles.ts';
import type {
  Card,
  Death,
  FinalIdentity,
  GameRound,
  MarkToken,
  TeamResult,
  TeamResultId,
  VoteResult,
} from './types.ts';

/** Copier cards: they are what they copied, or a plain Villager if they never woke. */
const COPIERS: ReadonlySet<RoleId> = new Set(['doppelganger', 'copycat']);

/** The role a card makes its holder at the end of the night, before artifacts. */
export function cardRole(card: Card): RoleId {
  let role = card.role;
  if (COPIERS.has(role)) role = card.copied ?? 'villager';
  if (COPIERS.has(role)) role = 'villager';
  if (role === 'paranormal-investigator' && card.became) role = card.became;
  return role;
}

/**
 * Who a player is at the end of the night (§0.7): card, copies, the P.I., the Mark of the
 * Vampire, then artifacts. A role-changing artifact beats the card and the Mark of the Vampire;
 * the other Marks still apply to the new role.
 */
export function identityOf(card: Card, mark?: MarkToken | null): FinalIdentity {
  const base = cardRole(card);
  const artifact = card.artifact ? ARTIFACTS[card.artifact] : null;
  const extra = {
    ...(mark ? { mark: mark.id } : {}),
    ...(artifact?.traitor || mark?.id === 'traitor' ? { traitor: true } : {}),
  };
  if (artifact?.becomes) {
    const role = artifact.becomes;
    return {
      role,
      team: ROLES[role].team,
      ...(role !== base ? { artifact: artifact.id } : {}),
      ...extra,
    };
  }
  if (mark?.id === 'vampire') return { role: base, team: 'vampire', vampireMark: true, ...extra };
  return { role: base, team: ROLES[base].team, ...extra };
}

export const isVampire = (id: FinalIdentity) =>
  id.converted === 'vampire' || id.vampireMark === true || ROLES[id.role].vampire === true;
export const isWerewolf = (id: FinalIdentity) =>
  !isVampire(id) && (id.converted === 'werewolf' || ROLES[id.role].werewolf === true);

/** The hostile group a player counts towards, if any. */
export function groupOf(id: FinalIdentity): HostileGroup | null {
  if (isVampire(id)) return 'vampire';
  if (isWerewolf(id)) return 'werewolf';
  return null;
}

/**
 * Teams that depend on the whole table: Renfield sides with the village when no player is a
 * Vampire, and the Assassins are plain Villagers when no Mark of the Assassin is in play.
 */
function settleTeams(
  players: readonly PlayerId[],
  ids: Record<PlayerId, FinalIdentity>,
  marks: Record<PlayerId, MarkToken> | null,
) {
  const anyVampire = players.some((p) => isVampire(ids[p]!));
  const assassinMark = players.some((p) => marks?.[p]?.id === 'assassin');
  const assassins = players.some((p) => ids[p]!.role === 'assassin');
  for (const p of players) {
    const id = ids[p]!;
    if (id.role === 'renfield' && !id.vampireMark && !anyVampire) id.team = 'village';
    if (id.role === 'assassin' && !assassinMark) id.team = 'village';
    if (id.role === 'apprentice-assassin' && !assassinMark && !assassins) id.team = 'village';
  }
}

/**
 * Resolves the vote and the winners (§3.2 and §3.3). `votes` maps each voter to their pick; a
 * Bodyguard's pick protects instead of voting. `players` are in seat order; `marks` are each
 * player's Mark (null in a game without Marks).
 */
export function resolveVote(
  players: readonly PlayerId[],
  cards: Record<PlayerId, Card>,
  votes: Record<PlayerId, PlayerId | null>,
  marks: Record<PlayerId, MarkToken> | null = null,
): VoteResult {
  const ids: Record<PlayerId, FinalIdentity> = {};
  for (const p of players) ids[p] = identityOf(cards[p]!, marks?.[p]);
  settleTeams(players, ids, marks);

  // 1. Tally (protection picks are not votes).
  const tally: Record<PlayerId, number> = Object.fromEntries(players.map((p) => [p, 0]));
  const protectedSet = new Set<PlayerId>();
  const voted = (v: PlayerId) => {
    const t = votes[v];
    return t && t in tally && ids[v]!.role !== 'bodyguard' ? t : null;
  };
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

  // 3. Protection: the Prince, Bodyguard picks, and a Master another Vampire voted for.
  for (const p of players) {
    if (ids[p]!.role === 'prince') protectedSet.add(p);
    if (
      ids[p]!.role === 'the-master' &&
      players.some((v) => v !== p && voted(v) === p && isVampire(ids[v]!))
    )
      protectedSet.add(p);
  }

  // 4. Day conversions: a Cursed voted for by a Werewolf or a Vampire joins the side that cast
  // more of those votes (a tie goes to the werewolves), dead or alive. A Cursed with the Mark of
  // the Vampire stays a Vampire.
  const before = { ...ids };
  for (const c of players) {
    if (ids[c]!.role !== 'cursed' || isVampire(ids[c]!)) continue;
    const from = (test: (id: FinalIdentity) => boolean) =>
      players.filter((v) => voted(v) === c && test(before[v]!)).length;
    const wolves = from(isWerewolf);
    const vampires = from(isVampire);
    if (wolves + vampires === 0) continue;
    const side = wolves >= vampires ? 'werewolf' : 'vampire';
    ids[c] = { ...ids[c]!, team: side, converted: side };
  }

  // 5. Deaths by vote. Protected players drop out of the ranking first. In an epic battle the
  // runner-up dies too (one vote is enough for second place), unless first place is tied.
  const cand = players.filter((p) => tally[p]! >= 1 && !protectedSet.has(p));
  const top = Math.max(0, ...cand.map((p) => tally[p]!));
  const dead: Death[] = [];
  if (top >= 2) {
    const first = cand.filter((p) => tally[p] === top);
    for (const p of first) dead.push({ player: p, cause: 'vote', ...(epic ? { place: 1 } : {}) });
    if (epic && first.length === 1) {
      const rest = cand.filter((p) => !first.includes(p));
      const second = Math.max(0, ...rest.map((p) => tally[p]!));
      if (second >= 1)
        for (const p of rest)
          if (tally[p] === second) dead.push({ player: p, cause: 'vote', place: 2 });
    }
  }

  // 8. Chain deaths, until nothing changes: a dead Hunter takes the player they voted for
  // (unless protected), and when a lover dies every other lover dies, protected or not.
  const isDead = (p: PlayerId) => dead.some((d) => d.player === p);
  const lovers = players.filter((p) => marks?.[p]?.id === 'love');
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
    const heartbroken = lovers.length >= 2 ? lovers.find(isDead) : undefined;
    if (heartbroken)
      for (const l of lovers)
        if (!isDead(l)) {
          dead.push({ player: l, cause: 'love', by: heartbroken });
          changed = true;
        }
  }

  const deadSet = new Set(dead.map((d) => d.player));
  const { teams, winners: teamWinners } = evaluateWins(players, ids, deadSet, epic, marks);
  // Disease: anyone who voted for the Mark of Disease, or for the Diseased, can't win.
  const diseased = new Set(
    players.filter((p) => marks?.[p]?.id === 'disease' || ids[p]!.role === 'diseased'),
  );
  const disqualified = players.filter((v) => {
    const t = voted(v);
    return t !== null && diseased.has(t);
  });
  return {
    votes: Object.fromEntries(players.map((p) => [p, votes[p] ?? null])),
    tally,
    protectedPlayers: players.filter((p) => protectedSet.has(p)),
    deaths: dead,
    identities: ids,
    teams,
    winners: teamWinners.filter((p) => !disqualified.includes(p)),
    epic,
    ...(disqualified.length ? { disqualified } : {}),
  };
}

/** §3.3: team results, then each player's own result (before Disease). */
export function evaluateWins(
  players: readonly PlayerId[],
  ids: Record<PlayerId, FinalIdentity>,
  dead: ReadonlySet<PlayerId>,
  epic: boolean,
  marks: Record<PlayerId, MarkToken> | null = null,
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

  // Each evil team needs a member, none of them dead, no dead Tanner, and in an epic battle
  // another evil team's death.
  const hostileWin = (g: HostileGroup) =>
    members(g).length > 0 &&
    deadIn(g).length === 0 &&
    !tannerDied &&
    (!epic || hostileDead.some((h) => h !== g));
  const wolves = members('werewolf');
  const wolfWin = hostileWin('werewolf');
  const vampWin = hostileWin('vampire');
  const villageWin = epic
    ? hostileDead.length >= 2
    : hostileDead.length > 0 || (!anyHostile && dead.size === 0);

  // The Assassins: anyone with the Mark of the Assassin dying (or, for the Apprentice, an
  // Assassin among the players dying).
  const markedDied = players.some((p) => marks?.[p]?.id === 'assassin' && dead.has(p));
  const assassinPlayers = players.filter((p) => id(p).role === 'assassin');

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
    } else if (team === 'assassin') won = markedDied;
    else if (team === 'apprentice-assassin')
      won = assassinPlayers.length ? assassinPlayers.some((a) => dead.has(a)) : markedDied;
    else if (me.role === 'tanner') won = dead.has(p);
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
  const anyWon = (team: TeamResultId) => roster(team).some((p) => result.get(p));
  add('village', villageWin);
  if (roster('werewolf').length) add('werewolf', wolves.length ? wolfWin : anyWon('werewolf'));
  add('vampire', vampWin);
  for (const team of ['tanner', 'assassin', 'apprentice-assassin'] as const)
    if (roster(team).length) add(team, anyWon(team));
  return { teams, winners: players.filter((p) => result.get(p)) };
}

/** The final identities, from a round's cards (for the reveal before the vote resolves). */
export const identitiesOf = (r: GameRound) =>
  Object.fromEntries(r.order.map((p) => [p, identityOf(r.cards[p]!, r.marks?.[p])]));
