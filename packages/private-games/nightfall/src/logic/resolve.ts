import type { PlayerId } from '@vt/game-sdk';
import {
  ARTIFACTS,
  HOSTILE_GROUPS,
  type HostileGroup,
  type NostraTeam,
  ROLES,
  type RoleId,
  groupOfRole,
} from './roles.ts';
import { type BlobShape, blobMembers } from './tables.ts';
import {
  type Card,
  type Death,
  type FinalIdentity,
  type GameRound,
  type MarkToken,
  type OracleMod,
  type OracleState,
  type TeamResult,
  type TeamResultId,
  VOTE_APP,
  type VoteResult,
} from './types.ts';

/** Copier cards: they are what they copied, or a plain Villager if they never woke. */
const COPIERS: ReadonlySet<RoleId> = new Set(['doppelganger', 'copycat']);

/** The role a card makes its holder at the end of the night, before artifacts. */
export function cardRole(card: Card): RoleId {
  let role = card.role;
  // A Copycat who copied the Oracle is always a plain Villager.
  if (role === 'copycat' && card.copied === 'oracle') return 'villager';
  if (COPIERS.has(role)) role = card.copied ?? 'villager';
  if (COPIERS.has(role)) role = 'villager';
  if (role === 'paranormal-investigator' && card.became) role = card.became;
  return role;
}

/** What the night did to a player rather than their card (a New Alien tap, the Oracle's answer). */
export interface IdentityFlags {
  /** A New Alien: an Alien whatever card they hold. */
  alienPlayer?: boolean;
  /** An Alien Helper: on the alien team, but not an Alien. */
  alienHelper?: boolean;
  /** The Oracle's answer, for an Oracle card (or a Doppelgänger's copy of it). */
  oracleMod?: OracleMod | null;
}

/**
 * Who a player is at the end of the night (§0.7): card, copies, the P.I., then card modifiers (the
 * Oracle's answer, an Alien card), the Mark of the Vampire, the player's own New Alien or helper
 * tap, then artifacts. A role-changing artifact beats everything; the other Marks still apply.
 */
export function identityOf(
  card: Card,
  mark?: MarkToken | null,
  flags: IdentityFlags = {},
): FinalIdentity {
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
  const id: FinalIdentity = { role: base, team: ROLES[base].team, ...extra };
  if (base === 'nostradamus' && card.foretold) id.foretold = { team: card.foretold.team };
  // The Oracle's answer: her card joins a team (she doesn't become that role).
  const mod = base === 'oracle' ? flags.oracleMod : null;
  if (mod) {
    id.oracle = mod;
    if (mod === 'werewolf-card') Object.assign(id, { group: 'werewolf', team: 'werewolf' });
    else if (mod === 'vampire-card') Object.assign(id, { group: 'vampire', team: 'vampire' });
    else if (mod === 'alien-card')
      Object.assign(id, { group: 'alien', team: 'alien', alien: 'oracle' });
    else Object.assign(id, { group: null, team: 'alien', alien: 'oracle' });
  }
  // A card the Body Snatcher took is an Alien card, keeping its other abilities.
  if (card.alienCard) {
    id.group = 'alien';
    if (id.team !== 'synthetic') id.team = 'alien';
    if (!ROLES[base].alien) id.alien = 'card';
  }
  if (mark?.id === 'vampire') {
    Object.assign(id, { group: 'vampire', team: 'vampire', vampireMark: true });
    delete id.alien;
  }
  if (flags.alienPlayer) {
    Object.assign(id, { group: 'alien', team: 'alien', alien: 'player' });
    delete id.vampireMark;
  } else if (flags.alienHelper) {
    Object.assign(id, { group: null, team: 'alien', alien: 'helper' });
    delete id.vampireMark;
  }
  return id;
}

/** The hostile group a player counts towards, if any. */
export function groupOf(id: FinalIdentity): HostileGroup | null {
  if (id.converted) return id.converted;
  if (id.group !== undefined) return id.group;
  if (id.vampireMark) return 'vampire';
  return groupOfRole(id.role);
}

export const isVampire = (id: FinalIdentity) => groupOf(id) === 'vampire';
export const isWerewolf = (id: FinalIdentity) => groupOf(id) === 'werewolf';
export const isAlien = (id: FinalIdentity) => groupOf(id) === 'alien';

/**
 * Teams that depend on the whole table: Renfield sides with the village when no player is a
 * Vampire, and the Assassins are plain Villagers when no Mark of the Assassin is in play. With
 * Groob and Zerb both among the players, they are rivals on teams of their own, and the Leader
 * plays for them both to live.
 */
function settleTeams(
  players: readonly PlayerId[],
  ids: Record<PlayerId, FinalIdentity>,
  marks: Record<PlayerId, MarkToken> | null,
) {
  const anyVampire = players.some((p) => isVampire(ids[p]!));
  const assassinMark = players.some((p) => marks?.[p]?.id === 'assassin');
  const assassins = players.some((p) => ids[p]!.role === 'assassin');
  const rivals = (role: RoleId) =>
    players.filter((p) => ids[p]!.role === role && ids[p]!.team === 'alien' && !ids[p]!.alien);
  const groobs = rivals('groob');
  const zerbs = rivals('zerb');
  const rivalry = groobs.length > 0 && zerbs.length > 0;
  for (const p of players) {
    const id = ids[p]!;
    if (id.role === 'renfield' && !id.vampireMark && !anyVampire) id.team = 'village';
    if (id.vampireMark) continue;
    if (id.role === 'assassin' && !assassinMark) id.team = 'village';
    if (id.role === 'apprentice-assassin' && !assassinMark && !assassins) id.team = 'village';
    if (rivalry && groobs.includes(p)) id.team = 'groob';
    if (rivalry && zerbs.includes(p)) id.team = 'zerb';
    if (rivalry && id.role === 'leader' && id.team === 'village') id.team = 'leader';
  }
}

/** What the night left that the vote needs besides cards and Marks. */
export interface ResolveExtra {
  aliens?: { players: PlayerId[]; helpers: PlayerId[] };
  oracle?: OracleState | null;
  blob?: BlobShape | null;
  /** Second-hand votes (a ripple's two-hand vote). */
  votes2?: Record<PlayerId, PlayerId | null>;
  /** Players may vote for the app. */
  voteApp?: boolean;
  /** The centre cards at the end (for a Nostradamus whose card moved there). */
  center?: Card[];
}

/** Nostradamus's team: a side's own result, or (for an own-team or copier card) its holder's. */
function foretoldTarget(
  team: NostraTeam,
  cardId: number | null,
  players: readonly PlayerId[],
  cards: Record<PlayerId, Card>,
  center: readonly Card[],
): { team: TeamResultId; holder?: PlayerId } {
  const holder = players.find((p) => cards[p]!.id === cardId);
  const card = holder ? cards[holder] : center.find((c) => c.id === cardId);
  let printed: NostraTeam = team;
  if ((team === 'doppelganger' || team === 'copycat') && card) printed = ROLES[cardRole(card)].team;
  if (printed === 'doppelganger' || printed === 'copycat') printed = 'village';
  if (printed === 'oracle' || printed === 'paranormal-investigator') return { team: 'village' };
  if (['village', 'werewolf', 'vampire', 'alien', 'tanner'].includes(printed))
    return { team: printed };
  return holder ? { team: 'nostradamus', holder } : { team: 'nostradamus' };
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
  extra: ResolveExtra = {},
): VoteResult {
  const aliens = extra.aliens ?? { players: [], helpers: [] };
  const ids: Record<PlayerId, FinalIdentity> = {};
  for (const p of players)
    ids[p] = identityOf(cards[p]!, marks?.[p], {
      alienPlayer: aliens.players.includes(p),
      alienHelper: aliens.helpers.includes(p),
      oracleMod: extra.oracle?.mod ?? null,
    });
  settleTeams(players, ids, marks);
  for (const p of players) {
    const f = cards[p]!.foretold;
    if (!ids[p]!.foretold || !f) continue;
    const target = foretoldTarget(f.team, f.card, players, cards, extra.center ?? []);
    ids[p]!.foretold = { team: f.team, ...(target.holder ? { holder: target.holder } : {}) };
    if (ids[p]!.team === 'village' && !ids[p]!.group) ids[p]!.team = target.team;
  }

  // 1. Tally (protection picks are not votes; a two-handed voter's hands count once each).
  const tally: Record<PlayerId, number> = Object.fromEntries(players.map((p) => [p, 0]));
  const protectedSet = new Set<PlayerId>();
  let appVotes = 0;
  const hands = (v: PlayerId): PlayerId[] =>
    [votes[v], extra.votes2?.[v]].filter((t): t is PlayerId => !!t);
  const guards = (v: PlayerId) => ids[v]!.role === 'bodyguard';
  /** The players a voter really voted for (not the app, not a protection pick). */
  const votedFor = (v: PlayerId) => (guards(v) ? [] : hands(v).filter((t) => t in tally));
  for (const v of players)
    for (const t of hands(v)) {
      if (t === VOTE_APP && extra.voteApp) appVotes += 1;
      else if (!(t in tally)) continue;
      else if (guards(v)) protectedSet.add(t);
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
      players.some((v) => v !== p && votedFor(v).includes(p) && isVampire(ids[v]!))
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
      players.filter((v) => votedFor(v).includes(c) && test(before[v]!)).length;
    const wolves = from(isWerewolf);
    const vampires = from(isVampire);
    if (wolves + vampires === 0) continue;
    const side = wolves >= vampires ? 'werewolf' : 'vampire';
    ids[c] = { ...ids[c]!, team: side, converted: side };
  }

  // 5. Deaths by vote. Protected players drop out of the ranking first. In an epic battle the
  // runner-up dies too (one vote is enough for second place), unless first place is tied. When
  // the app may be voted for and it has the most votes (a tie included), nobody dies.
  const cand = players.filter((p) => tally[p]! >= 1 && !protectedSet.has(p));
  const top = Math.max(0, ...cand.map((p) => tally[p]!));
  const dead: Death[] = [];
  const appWins = extra.voteApp === true && appVotes > 0 && appVotes >= top;
  if (top >= 2 && !appWins) {
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

  // The Leader: if every player on the alien side (Groob and Zerb included) voted for a Leader,
  // the aliens win and the village loses, even if an alien died.
  const leaders = players.filter((p) => ids[p]!.role === 'leader');
  const alienSide = players.filter((p) => ['alien', 'groob', 'zerb'].includes(ids[p]!.team));
  const leaderRule =
    leaders.length > 0 &&
    alienSide.length > 0 &&
    alienSide.every((p) => votedFor(p).some((t) => leaders.includes(t)));

  const deadSet = new Set(dead.map((d) => d.player));
  const blobs = players
    .filter((p) => ids[p]!.role === 'blob')
    .map((p) => ({ player: p, members: extra.blob ? blobMembers(players, p, extra.blob) : [p] }));
  const { teams, winners: teamWinners } = evaluateWins(players, ids, deadSet, epic, marks, {
    leaderRule,
    blobs,
  });
  let winners = teamWinners;

  // The Oracle's failed number replaces every other result: she wins only by living, everyone
  // else only if she dies. With her card in the centre, everyone wins only if nobody dies.
  const o = extra.oracle;
  let oracleRule: VoteResult['oracleRule'];
  if (o?.numberFail) {
    if (o.centre || !o.player) {
      oracleRule = 'circle';
      winners = deadSet.size === 0 ? [...players] : [];
    } else {
      oracleRule = 'oracle';
      const oracles = players.filter(
        (p) =>
          p === o.player || (cards[p]!.role === 'doppelganger' && cards[p]!.copied === 'oracle'),
      );
      const oracleDied = oracles.some((p) => deadSet.has(p));
      winners = players.filter((p) => (oracles.includes(p) ? !deadSet.has(p) : oracleDied));
    }
  }

  // Disease: anyone who voted for the Mark of Disease, or for the Diseased, can't win.
  const diseased = new Set(
    players.filter((p) => marks?.[p]?.id === 'disease' || ids[p]!.role === 'diseased'),
  );
  const disqualified = players.filter((v) => votedFor(v).some((t) => diseased.has(t)));
  return {
    votes: Object.fromEntries(players.map((p) => [p, votes[p] ?? null])),
    tally,
    protectedPlayers: players.filter((p) => protectedSet.has(p)),
    deaths: dead,
    identities: ids,
    teams,
    winners: winners.filter((p) => !disqualified.includes(p)),
    epic,
    ...(disqualified.length ? { disqualified } : {}),
    ...(extra.votes2 ? { votes2: Object.fromEntries(Object.entries(extra.votes2)) } : {}),
    ...(extra.voteApp ? { appVotes } : {}),
    ...(leaderRule ? { leaderRule } : {}),
    ...(oracleRule ? { oracleRule } : {}),
    ...(blobs.length ? { blobs } : {}),
  };
}

/** §3.3: team results, then each player's own result (before the Oracle's number and Disease). */
export function evaluateWins(
  players: readonly PlayerId[],
  ids: Record<PlayerId, FinalIdentity>,
  dead: ReadonlySet<PlayerId>,
  epic: boolean,
  marks: Record<PlayerId, MarkToken> | null = null,
  more: { leaderRule?: boolean; blobs?: { player: PlayerId; members: PlayerId[] }[] } = {},
): { teams: TeamResult[]; winners: PlayerId[] } {
  const id = (p: PlayerId) => ids[p]!;
  const members = (g: HostileGroup) => players.filter((p) => groupOf(id(p)) === g);
  const deadIn = (g: HostileGroup) => members(g).filter((p) => dead.has(p));
  const tanners = players.filter((p) => id(p).role === 'tanner' && id(p).team === 'tanner');
  // An Apprentice Tanner with no Tanner among the players counts as one.
  const apprentices = players.filter((p) => id(p).role === 'apprentice-tanner');
  const blockingTanners = tanners.length ? tanners : apprentices;
  const tannerDied = blockingTanners.some((p) => dead.has(p));
  // If the Synthetic Alien dies, the aliens and the village lose.
  const synthDied = players.some((p) => id(p).team === 'synthetic' && dead.has(p));
  const leaderRule = more.leaderRule === true;
  const hostileDead = HOSTILE_GROUPS.filter((g) => deadIn(g).length > 0);
  const anyHostile = HOSTILE_GROUPS.some((g) => members(g).length > 0);

  const teamOf = (p: PlayerId): TeamResultId => id(p).team;
  const roster = (team: TeamResultId) => players.filter((p) => teamOf(p) === team);

  // Each evil team needs a member, none of them dead, no dead Tanner, and in an epic battle
  // another evil team's death. The aliens also lose if the Synthetic Alien dies, and win anyway
  // when every one of them votes for the Leader.
  const hostileWin = (g: HostileGroup) =>
    members(g).length > 0 &&
    deadIn(g).length === 0 &&
    !tannerDied &&
    (!epic || hostileDead.some((h) => h !== g)) &&
    (g !== 'alien' || !synthDied);
  const wolves = members('werewolf');
  const wolfWin = hostileWin('werewolf');
  const vampWin = hostileWin('vampire');
  const alienWin = hostileWin('alien') || leaderRule;
  const villageWin =
    (epic ? hostileDead.length >= 2 : hostileDead.length > 0 || (!anyHostile && dead.size === 0)) &&
    !synthDied &&
    !leaderRule;

  // The Assassins: anyone with the Mark of the Assassin dying. The Apprentice Assassin's card
  // wins on the Mark she placed herself (with no Assassin awake) when one is in play, else on an
  // Assassin among the players dying, else on any Mark of the Assassin.
  const markedDied = players.some((p) => marks?.[p]?.id === 'assassin' && dead.has(p));
  const assassinPlayers = players.filter((p) => id(p).role === 'assassin');
  const placed = players.filter((p) => marks?.[p]?.id === 'assassin' && marks[p].by);
  const apprenticeWin = placed.length
    ? placed.some((p) => dead.has(p))
    : assassinPlayers.length
      ? assassinPlayers.some((a) => dead.has(a))
      : markedDied;
  // Ruling 14: she wins when the holder of a Mark she placed dies, even if her card moved.
  const placedHolderDied = (p: PlayerId) => placed.some((q) => marks![q]!.by === p && dead.has(q));

  const groobs = roster('groob');
  const zerbs = roster('zerb');
  const neighbours = (p: PlayerId) => {
    const i = players.indexOf(p);
    const n = players.length;
    return [players[(i + 1) % n]!, players[(i - 1 + n) % n]!].filter((q) => q !== p);
  };

  const result = new Map<PlayerId, boolean>();
  const nostradamus: PlayerId[] = [];
  for (const p of players) {
    const me = id(p);
    const team = teamOf(p);
    let won: boolean;
    if (me.foretold) {
      nostradamus.push(p);
      continue;
    }
    if (team === 'village') won = villageWin;
    else if (team === 'vampire') won = vampWin;
    else if (team === 'alien') won = alienWin;
    else if (team === 'werewolf') {
      if (wolves.length === 0 && !isWerewolf(me)) {
        // No Werewolf among the players: the Minion and Squire need someone else to die.
        won = !tannerDied && [...dead].some((q) => q !== p);
      } else won = wolfWin;
    } else if (team === 'assassin') won = markedDied;
    else if (team === 'apprentice-assassin') won = apprenticeWin;
    else if (team === 'synthetic') won = dead.has(p);
    else if (team === 'groob') won = !dead.has(p) && zerbs.some((q) => dead.has(q));
    else if (team === 'zerb') won = !dead.has(p) && groobs.some((q) => dead.has(q));
    else if (team === 'leader') won = [...groobs, ...zerbs].every((q) => !dead.has(q));
    else if (team === 'blob')
      won = (more.blobs?.find((b) => b.player === p)?.members ?? [p]).every((q) => !dead.has(q));
    else if (team === 'mortician') won = neighbours(p).some((q) => dead.has(q));
    else if (me.role === 'tanner') won = dead.has(p);
    else if (me.role === 'apprentice-tanner')
      won = tanners.length > 0 ? tanners.some((t) => dead.has(t)) : dead.has(p);
    else won = false;
    // The Traitor's condition replaces the team result when the team has someone else.
    if (me.traitor && ['village', 'werewolf', 'vampire', 'alien'].includes(team)) {
      const mates = roster(team).filter((q) => q !== p);
      if (mates.length > 0) won = mates.some((q) => dead.has(q));
    }
    if (placedHolderDied(p)) won = true;
    result.set(p, won);
  }

  const anyWon = (team: TeamResultId) => roster(team).some((p) => result.get(p));
  const sideWon = (team: TeamResultId): boolean => {
    switch (team) {
      case 'village':
        return villageWin;
      case 'vampire':
        return vampWin;
      case 'alien':
        return alienWin;
      case 'werewolf':
        return wolves.length ? wolfWin : anyWon('werewolf');
      default:
        return anyWon(team);
    }
  };
  // Nostradamus wins only if he lives and the team (or the card's holder) he foresaw wins.
  for (const p of nostradamus) {
    const f = id(p).foretold!;
    const theirs = f.holder ? (result.get(f.holder) ?? false) : sideWon(teamOf(p));
    result.set(p, !dead.has(p) && (teamOf(p) === 'nostradamus' && !f.holder ? false : theirs));
  }

  const teams: TeamResult[] = [];
  const add = (team: TeamResultId, won: boolean) => {
    const on = roster(team);
    if (on.length > 0) teams.push({ team, won, players: on });
  };
  add('village', villageWin);
  if (roster('werewolf').length) add('werewolf', sideWon('werewolf'));
  add('vampire', vampWin);
  add('alien', alienWin);
  for (const team of [
    'tanner',
    'assassin',
    'apprentice-assassin',
    'synthetic',
    'groob',
    'zerb',
    'leader',
    'blob',
    'mortician',
    'nostradamus',
  ] as const)
    if (roster(team).length) add(team, anyWon(team));
  return { teams, winners: players.filter((p) => result.get(p)) };
}

/** The final identities, from a round's cards (for the reveal before the vote resolves). */
export const identitiesOf = (r: GameRound) =>
  Object.fromEntries(r.order.map((p) => [p, identityOf(r.cards[p]!, r.marks?.[p])]));
