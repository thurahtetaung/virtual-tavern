import type { PlayerId } from '@vt/game-sdk';
import { groupOf } from './resolve.ts';
import type { RoleId } from './roles.ts';
import type { Death, FinalIdentity, TeamResultId, VoteResult } from './types.ts';

// Why the vote came out as it did, in plain words, from the resolution alone. Pure, so every
// screen explains the same reveal the same way, and it's testable without a browser.

export interface ExplainNames {
  player: (id: PlayerId) => string;
  /** A role's display name ("Bodyguard"). */
  role: (role: RoleId) => string;
  /** A team's display name, plural where it reads so ("Werewolves", "Village"). */
  team: (team: TeamResultId) => string;
}

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
}

const votesWord = (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`;

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
const list = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

export function explainResult(result: VoteResult, names: ExplainNames): Explanation {
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

  // Protection, for anyone it saved from at least one vote.
  const saved = players.filter((p) => shielded.has(p) && tallyOf(p) > 0 && !dead.has(p));
  for (const p of saved) {
    const guards = players.filter((v) => id(v).role === 'bodyguard' && result.votes[v] === p);
    const by: string[] = guards.map((g) => `${name(g)} (${names.role('bodyguard')})`);
    if (id(p).role === 'prince')
      say(`${name(p)} is the ${names.role('prince')}, so the vote couldn’t kill them.`);
    else if (by.length) say(`${name(p)} was protected by ${list(by)}.`);
    else if (id(p).role === 'the-master')
      say(
        `${name(p)} was protected: as ${names.role('the-master')}, a vote from a fellow vampire keeps them safe.`,
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
        `${name(d.player)} came second (${votesWord(n)}) and died too: in an epic battle the runner-up dies as well.`,
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

  return { tally, reasons, why: whyTheyWon(result, players, names) };
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

  for (const t of result.teams) {
    if (!t.won) continue;
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

  if (why.length === 0) {
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
