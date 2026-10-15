import type { PlayerId } from '@vt/game-sdk';
import { groupOf, isVampire } from './resolve.ts';
import {
  HOSTILE_GROUPS,
  type HostileGroup,
  type MarkId,
  type NostraTeam,
  ROLES,
  type RoleId,
} from './roles.ts';
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

/** A side Nostradamus was announced on that has its own card ("Synthetic Alien", "Blob"). */
const foretoldSide = (team: NostraTeam, names: ExplainNames) => {
  const role = team === 'synthetic' ? 'synthetic-alien' : team;
  return role in ROLES ? names.role(role as RoleId) : names.team(team as TeamResultId);
};

const votesWord = (n: number) => `${n} ${n === 1 ? 'vote' : 'votes'}`;

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
const list = (names: readonly string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** "no werewolf or vampire among the players", naming the evil sides the game had. */
const noneOf = (sides: readonly HostileGroup[]) => {
  if (!sides.length) return 'nobody on an evil side';
  const last = sides.at(-1)!;
  return `no ${sides.length === 1 ? last : `${sides.slice(0, -1).join(', ')} or ${last}`} among the players`;
};

/** `sides`: the evil sides the game's cards (and artifacts) could put among the players. */
export function explainResult(
  result: VoteResult,
  names: ExplainNames,
  marks: Record<PlayerId, MarkToken> | null = null,
  sides: readonly HostileGroup[] = HOSTILE_GROUPS,
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
  if (first.length === 0 && (result.appVotes ?? 0) > 0) {
    const top = Math.max(0, ...players.filter((p) => !shielded.has(p)).map(tallyOf));
    if ((result.appVotes ?? 0) >= top && top >= 2)
      say(
        `The app got ${votesWord(result.appVotes!)}, as many as anyone or more, so nobody was voted out.`,
      );
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

  // Who the night made an alien (or an alien supporter) whatever their card says.
  for (const p of players) {
    const how = id(p).alien;
    if (!how) continue;
    const by = {
      card: `they hold the card the ${names.role('body-snatcher')} took, now an Alien card`,
      player: 'the aliens tapped their fist: they are a New Alien, whatever their card',
      helper: 'the aliens tapped their fist: they play for the aliens without being one',
      oracle:
        id(p).oracle === 'alien-card'
          ? `the ${names.role('oracle')} joined the aliens: her card is an Alien card`
          : `the ${names.role('oracle')} wants the aliens to win: she plays for them without being one`,
    }[how];
    say(`${name(p)} was on the aliens’ side: ${by}.`);
  }
  for (const p of players) {
    const o = id(p).oracle;
    if (o === 'werewolf-card' || o === 'vampire-card')
      say(
        `${name(p)} holds the ${names.role('oracle')}, whose answer made it a ${o === 'werewolf-card' ? 'werewolf' : 'vampire'} card.`,
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
    why: whyTheyWon(result, players, names, sides),
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
    if (!me.traitor || !['village', 'werewolf', 'vampire', 'alien'].includes(me.team)) continue;
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

  // The Alien set's own goals.
  const order = players;
  const n = order.length;
  for (const b of result.blobs ?? []) {
    const lost = b.members.filter((m) => dead.has(m));
    const others = b.members.filter((m) => m !== b.player);
    out.push(
      lost.length
        ? `${name(b.player)} (${names.role('blob')}) lost: ${list(lost.map(name))}, in the Blob, died.`
        : `${name(b.player)} (${names.role('blob')}) won: nobody in the Blob died${others.length ? ` (${list(others.map(name))} and the ${names.role('blob')})` : ''}.`,
    );
  }
  for (const p of players) {
    if (ids[p]!.team !== 'mortician') continue;
    const i = order.indexOf(p);
    const sides = [...new Set([order[(i + 1) % n]!, order[(i - 1 + n) % n]!])].filter(
      (q) => q !== p,
    );
    const died = sides.filter((q) => dead.has(q));
    out.push(
      died.length
        ? `${name(p)} (${names.role('mortician')}) won: ${list(died.map(name))}, next to them, died.`
        : `${name(p)} (${names.role('mortician')}) lost: neither neighbour died.`,
    );
  }
  for (const p of players) {
    const f = ids[p]!.foretold;
    if (!f) continue;
    // Announced on a side of its own (the Synthetic Alien, the Blob…) whose card nobody held.
    const centre = !f.holder && ids[p]!.team === 'nostradamus';
    const on = f.holder
      ? `the side of ${name(f.holder)}`
      : centre
        ? `the ${foretoldSide(f.team, names)}`
        : names.team(ids[p]!.team);
    out.push(
      centre && !dead.has(p)
        ? `${name(p)} (${names.role('nostradamus')}) was announced on the side of ${on}, whose card ended in the centre, so nobody could win it.`
        : dead.has(p)
          ? `${name(p)} (${names.role('nostradamus')}) died, so lost, whatever happened to ${on}.`
          : won.has(p)
            ? `${name(p)} (${names.role('nostradamus')}) foresaw ${on}, which won, and lived.`
            : `${name(p)} (${names.role('nostradamus')}) foresaw ${on}, which lost.`,
    );
  }
  if (result.oracleRule === 'oracle')
    out.push(
      `The ${names.role('oracle')} failed the number question: she wins only if she lives, and everyone else only if she dies.`,
    );
  if (result.oracleRule === 'circle')
    out.push(
      `The narrator asked the ${names.role('oracle')}’s number for her card in the centre, and got it wrong: everyone wins only if nobody dies.`,
    );
  return out;
}

function whyTheyWon(
  result: VoteResult,
  players: PlayerId[],
  names: ExplainNames,
  sides: readonly HostileGroup[],
): string[] {
  const ids = result.identities;
  const dead = new Set(result.deaths.map((d) => d.player));
  const name = names.player;
  const inGroup = (g: HostileGroup) => players.filter((p) => groupOf(ids[p]!) === g);
  const deadIn = (g: HostileGroup) => inGroup(g).filter((p) => dead.has(p));
  const synthetic = players.filter((p) => ids[p]!.team === 'synthetic' && dead.has(p));
  const evil = (g: HostileGroup) =>
    ({ werewolf: 'werewolf', vampire: 'vampire', alien: 'alien' })[g];
  const tanners = players.filter((p) => ids[p]!.role === 'tanner');
  const deadTanners = tanners.filter((p) => dead.has(p));
  const label = (t: TeamResultId) => names.team(t);
  const why: string[] = [];

  const winners = new Set(result.winners);
  // The Oracle's failed number replaces every side's result.
  if (result.oracleRule === 'oracle') {
    const oracles = result.oracles ?? [];
    const died = oracles.filter((p) => dead.has(p));
    const oracle = names.role('oracle');
    why.push(
      died.length
        ? `The ${oracle} (${list(died.map(name))}) died, so everyone else won.`
        : oracles.length
          ? `The ${oracle} (${list(oracles.map(name))}) lived, so only ${oracles.length > 1 ? 'they' : 'she'} won.`
          : `The ${oracle} lived, so only she won.`,
    );
    return why;
  }
  if (result.oracleRule === 'circle') {
    why.push(dead.size ? 'Someone died, so nobody won.' : 'Nobody died, so everyone won.');
    return why;
  }
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
        const hostile = HOSTILE_GROUPS.flatMap(deadIn);
        if (result.epic)
          why.push(
            `${label('village')} won: both evil sides lost a player (${list(hostile.map(name))}).`,
          );
        else if (hostile.length)
          why.push(
            `${label('village')} won: ${list(hostile.map(name))} ${hostile.length === 1 ? 'was' : 'were'} on an evil side, and died.`,
          );
        else why.push(`${label('village')} won: there was ${noneOf(sides)}, and nobody died.`);
        break;
      }
      case 'alien':
      case 'werewolf':
      case 'vampire': {
        const g = t.team;
        if (g === 'alien' && result.leaderRule) {
          why.push(
            `${label('alien')} won: every player on their side voted for the ${names.role('leader')}${deadIn('alien').length ? ', so an alien dying didn’t matter' : ''}.`,
          );
          break;
        }
        const others = HOSTILE_GROUPS.filter((h) => h !== g).flatMap(deadIn);
        if (inGroup(g).length === 0) {
          why.push(
            `${label(g)} won: there was no ${evil(g)} among the players, and someone else died.`,
          );
        } else {
          const epic = result.epic
            ? `, and ${list(others.map(name))} (on another evil side) died`
            : '';
          why.push(`${label(g)} won: no ${evil(g)} died${epic}.`);
        }
        break;
      }
      case 'synthetic':
        why.push(`${label('synthetic')} won: ${list(synthetic.map(name))} wanted to die, and did.`);
        break;
      case 'groob':
      case 'zerb': {
        const rival = t.team === 'groob' ? 'zerb' : 'groob';
        why.push(
          `${label(t.team)} won: ${names.role(rival)} died, and ${names.role(t.team)} lived.`,
        );
        break;
      }
      case 'leader':
        why.push(
          `${label('leader')} won: ${names.role('groob')} and ${names.role('zerb')} both lived.`,
        );
        break;
      case 'tanner':
        why.push(`${label('tanner')} won: ${list(deadTanners.map(name))} wanted to die, and did.`);
        break;
      case 'assassin':
      case 'apprentice-assassin':
        why.push(`${label(t.team)} won: their target died.`);
        break;
    }
  }

  if (synthetic.length)
    why.push(
      `${list(synthetic.map(name))} died as the ${names.role('synthetic-alien')}, so the aliens and the village can’t win.`,
    );
  if (winners.size === 0) {
    if (deadTanners.length && players.some((p) => groupOf(ids[p]!) !== null))
      why.push(
        `Nobody won: ${list(deadTanners.map(name))} died as the ${names.role('tanner')}, which stops the evil sides winning, and no one evil died.`,
      );
    else if (!players.some((p) => groupOf(ids[p]!) !== null) && dead.size > 0)
      why.push(`Nobody won: there was ${noneOf(sides)}, yet someone died.`);
    else why.push('Nobody won this time.');
  }

  return why;
}
