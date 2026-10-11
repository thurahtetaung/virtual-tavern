import type { PlayerId } from '@vt/game-sdk';
import { groupOf, isVampire } from './resolve.ts';
import type { MarkId, RoleId } from './roles.ts';
import type { Death, FinalIdentity, MarkToken, TeamResultId, VoteResult } from './types.ts';

// Why the vote came out as it did, in plain words, from the resolution alone. Pure, so every
// screen explains the same reveal the same way, and it's testable without a browser.

export interface ExplainNames {
  player: (id: PlayerId) => string;
  /** A role's display name ("Bodyguard"). */
  role: (role: RoleId) => string;
  /** A team's display name, plural where it reads so ("Werewolves", "Village"). */
  team: (team: TeamResultId) => string;
  /** A Mark's display name ("Mark of Disease"). */
  mark?: (mark: MarkId) => string;
}

/** "disease" → "Mark of Disease", when no name is given. */
const markWords = (m: MarkId) =>
  ['vampire', 'traitor', 'assassin'].includes(m)
    ? `Mark of the ${m[0]!.toUpperCase()}${m.slice(1)}`
    : `Mark of ${m[0]!.toUpperCase()}${m.slice(1)}`;

/** One outcome, in words; a death carries the death it explains. */
export interface Reason {
  text: string;
  death?: Death;
}

export interface Explanation {
  /** Votes each player got, most first (players with none left out; seat order breaks ties). */
  tally: { player: PlayerId; votes: number }[];
  /** One line per outcome: protections, each death and why, near misses, conversions. */
  reasons: Reason[];
  /** Why the winners won (or why nobody did). */
  why: string[];
  /** Players whose own result differs from their team's: Disease, traitors, the Assassins. */
  personal: string[];
}

const votesWord = (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`;

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
const list = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

export function explainResult(
  result: VoteResult,
  names: ExplainNames,
  marks: Record<PlayerId, MarkToken> | null = null,
): Explanation {
  const players = Object.keys(result.tally);
  const ids = result.identities;
  const id = (p: PlayerId): FinalIdentity => ids[p]!;
  const name = names.player;
  const tallyOf = (p: PlayerId) => result.tally[p] ?? 0;
  const dead = new Set(result.deaths.map((d) => d.player));
  const shielded = new Set(result.protectedPlayers);
  const tally = players
    .filter((p) => tallyOf(p) > 0)
    .map((p) => ({ player: p, votes: tallyOf(p) }))
    .sort((a, b) => b.votes - a.votes);

  const reasons: Reason[] = [];
  const say = (text: string, death?: Death) => {
    reasons.push(death ? { text, death } : { text });
  };

  // Protection: who was protected and why, saved from votes or not (a Bodyguard's pick shows
  // even when nobody voted for that player).
  const saved = players.filter((p) => shielded.has(p) && tallyOf(p) > 0 && !dead.has(p));
  for (const p of players.filter((q) => shielded.has(q) && !dead.has(q))) {
    const guards = players.filter((v) => id(v).role === 'bodyguard' && result.votes[v] === p);
    const by: string[] = guards.map((g) => `${name(g)} (${names.role('bodyguard')})`);
    const fellows = players.filter(
      (v) => v !== p && result.votes[v] === p && id(v).role !== 'bodyguard' && isVampire(id(v)),
    );
    if (tallyOf(p) === 0) {
      if (by.length) say(`${list(by)} protected ${name(p)}, though nobody voted for them.`);
    } else if (id(p).role === 'prince')
      say(`${name(p)} is the ${names.role('prince')}, so the vote couldn’t kill them.`);
    else if (by.length) say(`${name(p)} was protected by ${list(by)}.`);
    else if (id(p).role === 'the-master' && fellows.length)
      say(
        `${name(p)} survived: as ${names.role('the-master')}, a vote from a fellow vampire (${list(fellows.map(name))}) keeps them safe.`,
      );
    else say(`${name(p)} was protected.`);
  }

  // Deaths by vote, one line each.
  const voted = result.deaths.filter((d) => d.cause === 'vote');
  const first = voted.filter((d) => d.place !== 2);
  for (const d of voted) {
    const n = tallyOf(d.player);
    if (d.place === 2)
      say(
        `${name(d.player)} came second (${votesWord(n)}) and died too: in an epic battle everyone in second place dies as well.`,
        d,
      );
    else if (first.length > 1) say(`${name(d.player)} tied for the most votes (${n}) and died.`, d);
    else say(`${name(d.player)} got the most votes (${n}) and died.`, d);
  }
  if (first.length === 0) {
    const rest = players.filter((p) => !shielded.has(p));
    const top = Math.max(0, ...rest.map(tallyOf));
    const others = saved.length ? ' else' : '';
    if (top <= 1)
      say(
        players.every((p) => tallyOf(p) === 0)
          ? 'Nobody voted for anyone, so nobody was voted out.'
          : `Nobody${others} got more than one vote, so nobody was voted out.`,
      );
  }

  // Chains: the Hunter, and the lovers.
  for (const d of result.deaths) {
    if (d.cause === 'hunter' && d.by)
      say(`The ${names.role('hunter')} (${name(d.by)}) took ${name(d.player)} with them.`, d);
    if (d.cause === 'love' && d.by) say(`${name(d.player)} died as ${name(d.by)}’s lover.`, d);
  }
  for (const h of players) {
    if (!dead.has(h) || id(h).role !== 'hunter') continue;
    const t = result.votes[h];
    if (t && shielded.has(t) && !dead.has(t))
      say(
        `The ${names.role('hunter')} (${name(h)}) aimed at ${name(t)}, but ${name(t)} was protected.`,
      );
  }

  // Day conversions: the Cursed.
  for (const p of players) {
    const side = id(p).converted;
    if (!side) continue;
    say(
      `${name(p)} (${names.role('cursed')}) got a ${side}’s vote, and joined the ${names.team(side).toLowerCase()}.`,
    );
  }

  return {
    tally,
    reasons,
    why: whyTheyWon(result, players, names),
    personal: personalResults(result, players, names, marks),
  };
}

/**
 * Players whose own result isn't simply their team's: votes lost to Disease, traitors, the
 * Assassin and the Apprentice Assassin (who wins on the Mark she placed, wherever her card went).
 */
function personalResults(
  result: VoteResult,
  players: PlayerId[],
  names: ExplainNames,
  marks: Record<PlayerId, MarkToken> | null,
): string[] {
  const ids = result.identities;
  const dead = new Set(result.deaths.map((d) => d.player));
  const won = new Set(result.winners);
  const name = names.player;
  const mark = names.mark ?? markWords;
  const teamWon = (t: TeamResultId) => result.teams.find((x) => x.team === t)?.won ?? false;
  const out: string[] = [];

  for (const v of result.disqualified ?? []) {
    const t = result.votes[v]!;
    const what =
      ids[t]?.role === 'diseased' && ids[t]?.mark !== 'disease'
        ? `the ${names.role('diseased')}`
        : `who held the ${mark('disease')}`;
    out.push(`${name(v)} voted for ${name(t)}, ${what}, so ${name(v)} can’t win.`);
  }

  for (const p of players) {
    const me = ids[p]!;
    if (!me.traitor || !['village', 'werewolf', 'vampire'].includes(me.team)) continue;
    const mates = players.filter((q) => q !== p && ids[q]!.team === me.team);
    if (!mates.length) continue;
    const deadMates = mates.filter((q) => dead.has(q));
    if (won.has(p) && !teamWon(me.team))
      out.push(
        `${name(p)} was a traitor: ${list(deadMates.map(name))}, on their own side, died, so ${name(p)} won though their side lost.`,
      );
    else if (!won.has(p) && teamWon(me.team) && !deadMates.length)
      out.push(
        `${name(p)} was a traitor: nobody else on their side died, so ${name(p)} lost though their side won.`,
      );
  }

  // The Assassins.
  const holders = players.filter((p) => ids[p]!.mark === 'assassin');
  const placed = players.filter((p) => marks?.[p]?.id === 'assassin' && marks[p].by);
  for (const p of players) {
    const role = ids[p]!.role;
    if (ids[p]!.team === 'assassin') {
      const died = holders.filter((h) => dead.has(h));
      out.push(
        died.length
          ? `${name(p)} (${names.role('assassin')}) won: ${list(died.map(name))} held the ${mark('assassin')}, and died.`
          : `${name(p)} (${names.role('assassin')}) lost: nobody with the ${mark('assassin')} died.`,
      );
    } else if (ids[p]!.team === 'apprentice-assassin') {
      const assassins = players.filter((q) => ids[q]!.role === 'assassin');
      const apprentice = names.role('apprentice-assassin');
      if (placed.length) {
        const died = placed.filter((h) => dead.has(h));
        out.push(
          died.length
            ? `${name(p)} (${apprentice}) won: ${list(died.map(name))}, who held the ${mark('assassin')} she placed, died.`
            : `${name(p)} (${apprentice}) lost: ${list(placed.map(name))}, who held the ${mark('assassin')} she placed, didn’t die.`,
        );
      } else if (assassins.length) {
        const died = assassins.filter((a) => dead.has(a));
        out.push(
          died.length
            ? `${name(p)} (${apprentice}) won: the ${names.role('assassin')} (${list(died.map(name))}) died.`
            : `${name(p)} (${apprentice}) lost: no ${names.role('assassin')} died.`,
        );
      }
    } else if (role !== 'apprentice-assassin') {
      // She placed the Mark herself, then her card moved: she still wins when its holder dies.
      const mine = placed.filter((h) => marks![h]!.by === p && dead.has(h));
      if (mine.length)
        out.push(
          `${name(p)} placed the ${mark('assassin')} as the ${names.role('apprentice-assassin')}, and ${list(mine.map(name))}, who held it, died: ${name(p)} wins too.`,
        );
    }
  }
  return out;
}

function whyTheyWon(result: VoteResult, players: PlayerId[], names: ExplainNames): string[] {
  const ids = result.identities;
  const dead = new Set(result.deaths.map((d) => d.player));
  const name = names.player;
  const inGroup = (g: 'werewolf' | 'vampire') => players.filter((p) => groupOf(ids[p]!) === g);
  const deadIn = (g: 'werewolf' | 'vampire') => inGroup(g).filter((p) => dead.has(p));
  const tanners = players.filter((p) => ids[p]!.role === 'tanner');
  const deadTanners = tanners.filter((p) => dead.has(p));
  const label = (t: TeamResultId) => names.team(t);
  const why: string[] = [];

  const winners = new Set(result.winners);
  for (const t of result.teams) {
    if (!t.won) continue;
    // Disease or a traitor can leave a winning side with no winner: say so, not "won".
    if (!t.players.some((p) => winners.has(p))) {
      why.push(
        `${label(t.team)} would have won, but nobody on that side can claim it (${list(t.players.map(name))}).`,
      );
      continue;
    }
    switch (t.team) {
      case 'village': {
        const hostile = [...deadIn('werewolf'), ...deadIn('vampire')];
        if (result.epic)
          why.push(
            `${label('village')} won: both evil sides lost a player (${list(hostile.map(name))}).`,
          );
        else if (hostile.length)
          why.push(
            `${label('village')} won: ${list(hostile.map(name))} ${hostile.length === 1 ? 'was' : 'were'} on an evil side, and died.`,
          );
        else
          why.push(
            `${label('village')} won: there was no werewolf or vampire among the players, and nobody died.`,
          );
        break;
      }
      case 'werewolf':
      case 'vampire': {
        const g = t.team;
        const other = g === 'werewolf' ? 'vampire' : 'werewolf';
        if (inGroup(g).length === 0) {
          why.push(`${label(g)} won: there was no ${g} among the players, and someone else died.`);
        } else {
          const epic = result.epic
            ? `, and ${list(deadIn(other).map(name))} (a ${other}) died`
            : '';
          why.push(`${label(g)} won: no ${g} died${epic}.`);
        }
        break;
      }
      case 'tanner':
        why.push(`${label('tanner')} won: ${list(deadTanners.map(name))} wanted to die, and did.`);
        break;
      case 'assassin':
      case 'apprentice-assassin':
        why.push(`${label(t.team)} won: their target died.`);
        break;
    }
  }

  if (winners.size === 0) {
    if (deadTanners.length && players.some((p) => groupOf(ids[p]!) !== null))
      why.push(
        `Nobody won: ${list(deadTanners.map(name))} died as the ${names.role('tanner')}, which stops the evil sides winning, and no one evil died.`,
      );
    else if (!players.some((p) => groupOf(ids[p]!) !== null) && dead.size > 0)
      why.push('Nobody won: there was no werewolf or vampire among the players, yet someone died.');
    else why.push('Nobody won this time.');
  }

  return why;
}
