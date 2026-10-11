import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { groupOf, isAlien, isVampire, isWerewolf } from './resolve.ts';
import { ROLES } from './roles.ts';
import type { NightfallAction, NightfallState, Slot, TeamResultId } from './types.ts';

/** How a game ended, for the stats page (the first that applies). */
export type Ending =
  | 'hunter'
  | 'heartbreak'
  | 'leader-vote'
  | 'tanner'
  | 'synthetic'
  | 'nobody-died'
  | 'werewolf-caught'
  | 'vampire-caught'
  | 'alien-caught'
  | 'wolves-survived'
  | 'vampires-survived'
  | 'aliens-survived'
  | 'wrong-player';

/** What became of the Mark of the Vampire: still where the vampires put it, moved, or wiped. */
export type VampireMarkFate = 'kept' | 'moved' | 'cleansed';

const slotKey = (s: Slot) => ('player' in s ? `p:${s.player}` : `c:${s.center}`);

/**
 * Stats only, all reported at the reveal (nothing is sent while the game is secret):
 * - `outcome`: the teams in play and the winners, the player count, how the game ended, how
 *   long the night and the day took, how many cards moved and the longest chain of moves of a
 *   single card, the setup's roles and the roles that were moved, whether it was an epic battle,
 *   how many lovers died of a broken heart and what became of the Mark of the Vampire; words are
 *   the roles dealt (`clue`) and the roles that died (`guess`).
 * - `player` (one per player): dealt and final role and team, won or not, and the facts behind
 *   the fun facts (lone wolf survivor, Tanner's dream, identity crisis, blindsided vote, Hunter's
 *   revenge, Bodyguard save, vote on a werewolf or on a villager, voted out as a villager, cards
 *   moved, a Vampire at the end, lovers dragged along, voters lost to their Disease, an Assassin
 *   whose mark died), plus votes received, how and where (epic place) they died, a conversion
 *   by the Cursed's vote, and how many night actions the timer chose for them.
 *   With the Alien set: whether aliens were in play, the ripple (and a time loop), the Leader's
 *   vote and the Oracle's failed number; per player, an Alien at the end, abducted (a New Alien
 *   or helper tap, or a snatched card), the Cow (tipped or not), a Blob that kept its members,
 *   a Mortician's or Synthetic Alien's win and a Nostradamus who foresaw right.
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
  const vampires = r.order.filter((p) => isVampire(ids[p]!));
  const aliens = r.order.filter((p) => isAlien(ids[p]!));
  const ending: Ending = result.deaths.some((d) => d.cause === 'hunter')
    ? 'hunter'
    : result.deaths.some((d) => d.cause === 'love')
      ? 'heartbreak'
      : result.leaderRule
        ? 'leader-vote'
        : r.order.some((p) => dead.has(p) && ids[p]!.role === 'tanner')
          ? 'tanner'
          : r.order.some((p) => dead.has(p) && ids[p]!.team === 'synthetic')
            ? 'synthetic'
            : dead.size === 0
              ? 'nobody-died'
              : wolves.some((p) => dead.has(p))
                ? 'werewolf-caught'
                : vampires.some((p) => dead.has(p))
                  ? 'vampire-caught'
                  : aliens.some((p) => dead.has(p))
                    ? 'alien-caught'
                    : wolves.length > 0
                      ? 'wolves-survived'
                      : vampires.length > 0
                        ? 'vampires-survived'
                        : aliens.length > 0
                          ? 'aliens-survived'
                          : 'wrong-player';
  const converted = new Set([...(r.aliens?.players ?? []), ...(r.aliens?.helpers ?? [])]);
  const ripple = r.night?.ripple?.key;

  // The Mark of the Vampire: where the vampires put it, and where it ended up.
  const given = timeline.find((t) => t.note.kind === 'marked' && t.note.mark === 'vampire');
  const marks = r.marks ?? {};
  const holder = r.order.find((p) => marks[p]?.id === 'vampire');
  const vampireMark: VampireMarkFate | null =
    given?.note.kind !== 'marked'
      ? null
      : holder === undefined
        ? 'cleansed'
        : holder === given.note.targets[0]
          ? 'kept'
          : 'moved';
  const disqualified = new Set(result.disqualified ?? []);

  const tally = result.tally;
  const top = Math.max(0, ...Object.values(tally));
  for (const p of r.order) {
    const id = ids[p]!;
    const dealtTeam: TeamResultId = ROLES[r.deal.players[p]!].team;
    const vote = result.votes[p] ?? null;
    const target = vote ? ids[vote] : undefined;
    const isGuard = id.role === 'bodyguard';
    const death = result.deaths.find((d) => d.player === p);
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
        vampire: isVampire(id),
        heartbreaks: result.deaths.filter((d) => d.cause === 'love' && d.by === p).length,
        plague: r.order.filter((v) => disqualified.has(v) && result.votes[v] === p).length,
        hitman:
          id.team === 'assassin' && result.deaths.some((d) => marks[d.player]?.id === 'assassin'),
        mark: marks[p]?.id ?? null,
        votesReceived: tally[p] ?? 0,
        deathCause: death?.cause ?? null,
        deathPlace: death?.place ?? null,
        converted: id.converted ?? null,
        autoActions: timeline.filter((t) => t.by === p && t.auto === true).length,
        alien: isAlien(id),
        abducted: converted.has(p) || (id.alien === 'card' && dealtTeam !== 'alien'),
        cow: r.deal.players[p] === 'cow',
        cowTipped: (r.notes[p] ?? []).some((n) => n.kind === 'tipped' && n.tipped),
        blobSquad:
          won.has(p) &&
          (result.blobs ?? []).some((b) => b.player === p && b.members.some((m) => m !== p)),
        undertaker: id.team === 'mortician' && won.has(p),
        foresaw: !!id.foretold && won.has(p),
        synthetic: id.team === 'synthetic' && won.has(p),
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
      epic: result.epic,
      loveDeaths: result.deaths.filter((d) => d.cause === 'love').length,
      vampireMark,
      disqualified: disqualified.size,
      aliens:
        aliens.length > 0 ||
        r.order.some((p) => ['alien', 'synthetic', 'groob', 'zerb'].includes(ids[p]!.team)),
      ripple: ripple && ripple !== 'none' ? ripple : null,
      timeLoop: r.night?.loopFrom !== undefined,
      leaderRule: result.leaderRule === true,
      oracleRule: result.oracleRule ?? null,
    },
  });
  return events;
}
