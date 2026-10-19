import {
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  bool,
  leaders,
  mostBy,
  nums,
  num,
  ph,
  str,
  strs,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Thorns, read from its `insights` events (`bid`, `challenge`,
 * `elimination`, `outcome`). The discs are only ever ids here: copy names them with `{card}`
 * (`thorn`), which the browser fills from the private manifest.
 */

const challenges = (g: GameEvents) => g.of('challenge');
const thorn = { card: 'thorn' };
const withThorn = (cs: AwardCandidate[]) => cs.map((c) => ({ ...c, params: thorn }));

const rules: AwardRule[] = [
  {
    id: 'th.bluff',
    emoji: '🥀',
    title: 'Bluff of the Night',
    wholesomeTitle: 'Poker Face',
    valence: 'glory',
    weight: 5,
    kind: 'moment',
    family: 'deception',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} hid a {card} and waited. It struck {n|time}',
        'Innocent face, deadly {card}: {who} struck {n|time}',
      ],
      wholesome: [
        '{who} guarded a {card} perfectly, {n|time}',
        '{who} kept a calm face and a {card}, {n|time}',
      ],
    },
    compute: (g) =>
      withThorn(
        mostBy(
          challenges(g).filter((e) => bool(e, 'success') === false && bool(e, 'own') !== true),
          (e) => {
            const by = str(e, 'thornBy');
            return by && by !== e.playerId ? by : null;
          },
        ),
      ),
  },
  {
    id: 'th.bold-bid',
    emoji: '🎯',
    title: 'Nerves of Steel',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'bid',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} bid {n} and turned them all. Show-off', '{who} called {n} and made it. Gulp'],
      wholesome: [
        '{who} called {n} and pulled it off',
        '{who} trusted the table for {n} and won the point',
      ],
    },
    compute: (g) => {
      const best = new Map<string, number>();
      for (const e of challenges(g)) {
        const bid = num(e, 'bid');
        if (bool(e, 'success') !== true || !e.playerId || bid === undefined) continue;
        best.set(e.playerId, Math.max(best.get(e.playerId) ?? 0, bid));
      }
      return leaders(best, { min: 2 });
    },
  },
  {
    id: 'th.own-goal',
    emoji: '🙈',
    title: 'Own Goal',
    wholesomeTitle: 'Honest Gardener',
    valence: 'chaos',
    weight: 4,
    kind: 'award',
    family: 'blunder',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} turned over their own {card}. Bold plan',
        '{who} found their own {card} {n|time}. Surprise!',
      ],
      wholesome: [
        '{who} kept everyone guessing, even about their own {card}',
        '{who} showed us their own {card} {n|time}, fair and square',
      ],
    },
    compute: (g) =>
      withThorn(
        mostBy(
          challenges(g).filter((e) => bool(e, 'success') === false && bool(e, 'own') === true),
        ),
      ),
  },
  {
    id: 'th.thorn-magnet',
    emoji: '🧲',
    title: 'Thorn Magnet',
    wholesomeTitle: 'Brave Explorer',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'blunder',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} found someone else’s {card} {n|time}',
        'Every stack {who} touched had a {card}: {n} in all',
      ],
      wholesome: [
        '{who} bravely went exploring {n|time}',
        '{who} took {n} brave chances on other stacks',
      ],
    },
    compute: (g) =>
      withThorn(
        mostBy(
          challenges(g).filter((e) => bool(e, 'success') === false && bool(e, 'own') !== true),
          undefined,
          { min: 2 },
        ),
      ),
  },
  {
    id: 'th.auctioneer',
    emoji: '🔨',
    title: 'Auctioneer',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'bid',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} bid {n} times. Can’t stay out of it', '{who} raised {n} times. Going once…'],
      wholesome: ['{who} kept the bidding lively, {n} bids', '{who} joined the bidding {n} times'],
    },
    compute: (g) =>
      mostBy(
        g.of('bid').filter((e) => bool(e, 'auto') !== true),
        undefined,
        { min: 3 },
      ),
  },
  {
    id: 'th.last-petal',
    emoji: '🌱',
    title: 'Last Petal',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'survival',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} won with {n} disc left. Hanging by a petal',
        '{who} won on {n} disc. Somehow',
      ],
      wholesome: [
        '{who} won with just {n} disc to their name',
        '{who} bloomed late: won on {n} disc',
      ],
    },
    compute: (g) => {
      const out = g.of('outcome').at(-1);
      const ranking = strs(out, 'ranking');
      const discs = nums(out, 'discs');
      const winners = strs(out, 'winners');
      const lone = ranking.filter((id, i) => winners.includes(id) && discs[i] === 1);
      return lone.length === 1 ? [{ players: lone, value: 1 }] : [];
    },
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'th.biggest-bid',
    emoji: '🎯',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const bids = games.flatMap((g) =>
        challenges(g).flatMap((e) => (bool(e, 'success') === true ? [num(e, 'bid') ?? 0] : [])),
      );
      const best = Math.max(0, ...bids);
      return best >= 2 ? { value: best, text: `Biggest challenge made: ${best} discs` } : null;
    },
  },
  {
    id: 'th.thorns-hit',
    emoji: '🥀',
    interest: 2,
    compute: (games) => {
      const n = games.reduce(
        (sum, g) => sum + challenges(g).filter((e) => bool(e, 'success') === false).length,
        0,
      );
      return n >= 2 ? { value: n, text: `${n} challenges stopped by a ${ph.card('thorn')}` } : null;
    },
  },
];

/** One line per challenge, in order. */
function history(g: GameEvents): string[] {
  return challenges(g).map((e) => {
    const who = e.playerId ? ph.p(e.playerId) : 'Someone';
    const bid = num(e, 'bid') ?? 0;
    if (bool(e, 'success') === true) return `${who} turned over ${bid} and scored`;
    if (bool(e, 'own') === true) return `${who} bid ${bid} and hit their own ${ph.card('thorn')}`;
    const by = str(e, 'thornBy');
    return `${who} bid ${bid} and hit ${by ? `${ph.p(by)}’s` : 'a'} ${ph.card('thorn')}`;
  });
}

export const thornsAwards: AwardModule = { rules, nuggets, history };
