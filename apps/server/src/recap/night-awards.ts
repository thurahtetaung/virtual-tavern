import {
  type AwardCandidate,
  type GameEvents,
  leaders,
  pairTally,
  strs,
  topPair,
} from '@vt/game-sdk';
import type { RuleInfo } from './select.ts';

/** What the cross-game rules read: the night's finished games and the per-game award tallies. */
export interface NightContext {
  games: readonly GameEvents[];
  /** Win-or-skill candidates per player, across games. */
  glory: ReadonlyMap<string, number>;
  /** Blunder candidates per player, across games. */
  chaos: ReadonlyMap<string, number>;
  /** The host's `getTimezoneOffset()`, if known. */
  tzOffsetMin: number | null;
}

export interface NightRule extends RuleInfo {
  /** Fewest finished games the night needs. */
  minGames: number;
  compute(ctx: NightContext): AwardCandidate[];
}

const played = (ctx: NightContext, p: string) => ctx.games.filter((g) => g.players.includes(p));
const won = (g: GameEvents, p: string) => g.winners.includes(p);
/** A game some players won and others lost (co-op wins and losses are not head-to-head). */
const contested = (g: GameEvents) => g.winners.length > 0 && g.winners.length < g.players.length;

export function nightPlayers(games: readonly GameEvents[]): string[] {
  return [...new Set(games.flatMap((g) => g.players))].sort();
}

/** 1-based place in the game's final ranking (`outcome.ranking`), if it has one. */
function rankIn(g: GameEvents, p: string): { rank: number; of: number } | null {
  const ranking = strs(g.of('outcome').at(-1), 'ranking');
  const i = ranking.indexOf(p);
  return i < 0 ? null : { rank: i + 1, of: ranking.length };
}

/** Night MVP points: a win, a bonus for a high place, and a little for each win-or-skill award. */
export function mvpPoints(ctx: NightContext, p: string): number {
  let points = 0.25 * (ctx.glory.get(p) ?? 0);
  for (const g of played(ctx, p)) {
    if (won(g, p)) points += 1;
    const r = rankIn(g, p);
    if (r && r.of > 1) points += 0.5 * (1 - (r.rank - 1) / (r.of - 1));
  }
  return points;
}

export const MVP: NightRule = {
  id: 'night-mvp',
  emoji: '👑',
  title: 'Night MVP',
  valence: 'glory',
  weight: 5,
  kind: 'award',
  minGames: 2,
  copy: {
    cheeky: ['{who} won {n} of {m}. Insufferable', '{who} won {n} of {m}. Someone stop them'],
    wholesome: [
      '{who} had a magical night: {n} of {m} won',
      '{who} shone all night, {n} of {m} won',
    ],
  },
  compute(ctx) {
    const players = nightPlayers(ctx.games);
    const scored = players
      .map((p) => ({
        p,
        points: mvpPoints(ctx, p),
        wins: played(ctx, p).filter((g) => won(g, p)).length,
      }))
      .filter((s) => s.points > 0)
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.p.localeCompare(b.p));
    const best = scored[0];
    if (!best || best.wins === 0) return [];
    return [
      {
        players: [best.p],
        value: best.points,
        ...(scored[1] && { runnerUp: scored[1].points }),
        params: { n: best.wins, m: played(ctx, best.p).length },
      },
    ];
  },
};

const COMEBACK: NightRule = {
  id: 'night-comeback',
  emoji: '📈',
  title: 'Comeback Kid',
  valence: 'glory',
  weight: 5,
  kind: 'award',
  family: 'night-streak',
  minGames: 4,
  copy: {
    cheeky: ['{who} lost early, then won everything', '{who} warmed up slowly, then took over'],
    wholesome: ['{who} found their groove and won the last game', '{who} grew stronger every game'],
  },
  compute(ctx) {
    const tally = new Map<string, number>();
    for (const p of nightPlayers(ctx.games)) {
      const games = played(ctx, p);
      if (games.length < 4 || !won(games.at(-1)!, p)) continue;
      const half = Math.floor(games.length / 2);
      const rate = (list: GameEvents[]) => list.filter((g) => won(g, p)).length / list.length;
      const lift = rate(games.slice(half)) - rate(games.slice(0, half));
      if (lift >= 0.5) tally.set(p, lift);
    }
    return leaders(tally, { min: 0.5 });
  },
};

const CHAOS_AGENT: NightRule = {
  id: 'night-chaos',
  emoji: '🌪️',
  title: 'Chaos Agent',
  wholesomeTitle: 'Life of the Party',
  valence: 'chaos',
  weight: 4,
  kind: 'award',
  family: 'night-chaos',
  minGames: 3,
  copy: {
    cheeky: ['{who} caused {n} delightful disasters', '{who} stirred the pot {n|time} tonight'],
    wholesome: ['{who} kept every game exciting', '{who} made {n} moments to remember'],
  },
  compute: (ctx) => leaders(ctx.chaos, { min: 2 }),
};

const OLD_RELIABLE: NightRule = {
  id: 'night-reliable',
  emoji: '📏',
  title: 'Old Reliable',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'night-steady',
  minGames: 3,
  copy: {
    cheeky: ['{who} finished top half in all {n} games', '{who} was top half {n} games running'],
    wholesome: [
      '{who} was steady all night: top half {n|time}',
      '{who} never dipped: top half in {n}',
    ],
  },
  compute(ctx) {
    const tally = new Map<string, number>();
    for (const p of nightPlayers(ctx.games)) {
      const ranks = played(ctx, p).map((g) => rankIn(g, p));
      if (ranks.length < 3 || ranks.some((r) => r === null)) continue;
      if (ranks.every((r) => r!.rank <= Math.ceil(r!.of / 2))) tally.set(p, ranks.length);
    }
    return leaders(tally, { min: 3 });
  },
};

const REGULAR: NightRule = {
  id: 'night-regular',
  emoji: '🍺',
  title: 'The Regular',
  valence: 'gentle',
  weight: 1,
  kind: 'award',
  family: 'night-presence',
  minGames: 3,
  copy: {
    cheeky: ['{who} played all {n} games. Lives here', '{who} sat in for all {n}. Has a stool'],
    wholesome: ['{who} was there for every game, all {n}', '{who} played all {n} games with us'],
  },
  compute(ctx) {
    const all = nightPlayers(ctx.games).filter((p) => played(ctx, p).length === ctx.games.length);
    return all.length && all.length <= 3 ? [{ players: all, value: ctx.games.length }] : [];
  },
};

const LATE: NightRule = {
  id: 'night-late',
  emoji: '🐣',
  title: 'Fashionably Late',
  valence: 'gentle',
  weight: 1,
  kind: 'award',
  family: 'night-presence',
  minGames: 3,
  copy: {
    cheeky: ['{who} arrived for game {n} and still showed up', '{who} strolled in at game {n}'],
    wholesome: ['{who} made a grand entrance at game {n}', '{who} joined the fun from game {n}'],
  },
  compute(ctx) {
    const tally = new Map<string, number>();
    for (const p of nightPlayers(ctx.games)) {
      const first = ctx.games.findIndex((g) => g.players.includes(p));
      if (first > 0) tally.set(p, first + 1);
    }
    return leaders(tally, { min: 2 });
  },
};

const ON_FIRE: NightRule = {
  id: 'night-streak',
  emoji: '🔥',
  title: 'On Fire',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'night-streak',
  minGames: 3,
  copy: {
    cheeky: ['{who} won {n} in a row. Unbearable', '{who} strung {n} wins together'],
    wholesome: ['{who} had a {n}-game winning streak', '{who} won {n} games on the trot'],
  },
  compute(ctx) {
    const tally = new Map<string, number>();
    for (const p of nightPlayers(ctx.games)) {
      let run = 0;
      let best = 0;
      for (const g of played(ctx, p)) {
        run = won(g, p) ? run + 1 : 0;
        best = Math.max(best, run);
      }
      if (best >= 3) tally.set(p, best);
    }
    return leaders(tally, { min: 3 });
  },
};

const DUO: NightRule = {
  id: 'night-duo',
  emoji: '🤝',
  title: 'Dynamic Duo',
  valence: 'glory',
  weight: 3,
  kind: 'pair',
  family: 'night-pair',
  minGames: 2,
  copy: {
    cheeky: ['{a} and {b} won together {n} times', '{a} and {b}: {n} shared wins. Suspicious'],
    wholesome: [
      '{a} and {b} make a great team: {n} wins',
      '{a} and {b} won {n} games side by side',
    ],
  },
  compute(ctx) {
    const pairs: [string, string][] = [];
    for (const g of ctx.games.filter(contested)) {
      const w = [...g.winners].sort();
      for (let i = 0; i < w.length; i++)
        for (let j = i + 1; j < w.length; j++) pairs.push([w[i]!, w[j]!]);
    }
    return topPair(pairTally(pairs), 2);
  },
};

const RIVALS: NightRule = {
  id: 'night-rivals',
  emoji: '⚔️',
  title: 'Rivals',
  valence: 'gentle',
  weight: 3,
  kind: 'pair',
  family: 'night-pair',
  minGames: 3,
  copy: {
    cheeky: ['{a} vs {b}: {n}–{m}. Grudge match', '{a} and {b} traded wins, {n}–{m}'],
    wholesome: [
      '{a} and {b} kept each other sharp, {n}–{m}',
      '{a} and {b}: a friendly {n}–{m} duel',
    ],
  },
  compute(ctx) {
    const meetings = new Map<string, { a: number; b: number }>();
    for (const g of ctx.games.filter(contested)) {
      const ps = [...g.players].sort();
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) {
          const [a, b] = [ps[i]!, ps[j]!];
          if (won(g, a) === won(g, b)) continue;
          const k = `${a}|${b}`;
          const m = meetings.get(k) ?? { a: 0, b: 0 };
          if (won(g, a)) m.a += 1;
          else m.b += 1;
          meetings.set(k, m);
        }
    }
    const close = [...meetings].filter(([, m]) => m.a + m.b >= 3 && Math.abs(m.a - m.b) <= 1);
    if (!close.length) return [];
    const most = Math.max(...close.map(([, m]) => m.a + m.b));
    const top = close.filter(([, m]) => m.a + m.b === most);
    if (top.length !== 1) return [];
    const [k, m] = top[0]!;
    const [a, b] = k.split('|') as [string, string];
    // The one ahead goes first.
    const ahead = m.a >= m.b;
    return [
      {
        players: ahead ? [a, b] : [b, a],
        value: most,
        params: { n: Math.max(m.a, m.b), m: Math.min(m.a, m.b) },
      },
    ];
  },
};

const LAST_ORDERS: NightRule = {
  id: 'night-last-orders',
  emoji: '🦉',
  title: 'Last Orders',
  valence: 'gentle',
  weight: 2,
  kind: 'moment',
  minGames: 1,
  copy: {
    cheeky: ['The final game ended at {time}. Bedtime, anyone?', 'Still playing at {time}. Bold'],
    wholesome: ['The tavern stayed open until {time}', 'A late one: the last game ended at {time}'],
  },
  compute(ctx) {
    const last = ctx.games.at(-1);
    if (!last || ctx.tzOffsetMin === null) return [];
    const local = new Date(last.endedAt - ctx.tzOffsetMin * 60_000);
    const h = local.getUTCHours();
    if (h >= 5) return [];
    const time = `${h}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
    return [{ players: [], value: 1, params: { time } }];
  },
};

/** A linked night ("Same crew, new game"): who tried the most different games. */
const JACK: NightRule = {
  id: 'night-jack',
  emoji: '🎲',
  title: 'Jack of All Games',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'night-variety',
  minGames: 3,
  copy: {
    cheeky: [
      '{who} played {n} different games. Commitment issues',
      '{who} tried {n} different games in one night. Restless',
    ],
    wholesome: [
      '{who} tried everything: {n} different games',
      '{who} played all {n} games on offer',
    ],
  },
  compute(ctx) {
    const kinds = new Map<string, number>();
    for (const p of nightPlayers(ctx.games))
      kinds.set(p, new Set(played(ctx, p).map((g) => g.gameId)).size);
    return leaders(kinds, { min: 3 });
  },
};

/** Fallback: most games, fewest wins. Only ever someone's guaranteed award. */
export const GOOD_SPORT: NightRule = {
  id: 'night-good-sport',
  emoji: '😇',
  title: 'Good Sport',
  valence: 'gentle',
  weight: 1,
  kind: 'award',
  minGames: 3,
  copy: {
    cheeky: [
      '{who}: {n} games, {m} wins, 100% vibes',
      '{who} played {n}, won {m}, smiled throughout',
    ],
    wholesome: [
      '{who} brought joy to all {n} games',
      '{who} was a delight in every one of {n} games',
    ],
  },
  compute: () => [],
};

/** Fallback for anyone left: they came, they played. */
export const SHOWED_UP: NightRule = {
  id: 'night-showed-up',
  emoji: '🎟️',
  title: 'Showed Up',
  valence: 'gentle',
  weight: 1,
  kind: 'award',
  minGames: 1,
  copy: {
    cheeky: [
      '{who} showed up and played {n|time}. Legend',
      '{who} came, sat down, played {n|time}',
    ],
    wholesome: ['{who} joined in {n|time}. Glad you came', '{who} played {n|time} with the crew'],
  },
  compute: () => [],
};

/** The cross-game awards, in no particular order (MVP is picked on its own). */
export const NIGHT_RULES: readonly NightRule[] = [
  COMEBACK,
  CHAOS_AGENT,
  OLD_RELIABLE,
  REGULAR,
  LATE,
  ON_FIRE,
  DUO,
  RIVALS,
  LAST_ORDERS,
  JACK,
];

/** Every night rule's copy, for the copy lint. */
export const ALL_NIGHT_RULES: readonly NightRule[] = [MVP, ...NIGHT_RULES, GOOD_SPORT, SHOWED_UP];

/** The guaranteed fallbacks for one player, best first (§3.4 step 3). */
export function fallbacksFor(
  ctx: NightContext,
  p: string,
): { rule: NightRule; cand: AwardCandidate }[] {
  const games = played(ctx, p);
  const wins = games.filter((g) => won(g, p)).length;
  const out: { rule: NightRule; cand: AwardCandidate }[] = [];
  if (games.length >= 3 && games.length === ctx.games.length)
    out.push({ rule: REGULAR, cand: { players: [p], value: games.length } });
  const first = ctx.games.findIndex((g) => g.players.includes(p));
  if (ctx.games.length >= 3 && first > 0)
    out.push({ rule: LATE, cand: { players: [p], value: first + 1 } });
  if (games.length >= 3)
    out.push({
      rule: GOOD_SPORT,
      cand: { players: [p], value: games.length, params: { m: wins } },
    });
  out.push({ rule: SHOWED_UP, cand: { players: [p], value: games.length } });
  return out;
}
