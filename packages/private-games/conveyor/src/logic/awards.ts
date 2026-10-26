import {
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  bool,
  leaders,
  mostBy,
  num,
  nums,
  ph,
  strs,
  tally,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Conveyor, read from its `insights` events (`wasabi`, `steal`,
 * `spoon`, `copy`, `takeout`, `uramaki`, `miso`, `round`, `desserts`, `outcome`). Moves the table
 * made for someone (`auto`) never earn an award.
 */

const outcome = (g: GameEvents) => g.of('outcome').at(-1);

/** The best value of a numeric prop per player. */
function bestOf(g: GameEvents, type: string, key: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of g.of(type)) {
    const v = num(e, key);
    if (!e.playerId || v === undefined) continue;
    out.set(e.playerId, Math.max(out.get(e.playerId) ?? -Infinity, v));
  }
  return out;
}

const rules: AwardRule[] = [
  {
    id: 'cv.wasabi-sniper',
    emoji: '🌿',
    title: 'Wasabi Sniper',
    wholesomeTitle: 'Spice Master',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'wasabi',
    copy: {
      cheeky: [
        '{who} tripled {n} points of nigiri. Eyes watering',
        '{who} made wasabi pay: {n} points',
      ],
      wholesome: ['{who} timed the wasabi for {n} points', '{who} spiced up {n} points of nigiri'],
    },
    compute: (g) =>
      leaders(
        tally(g.of('wasabi'), undefined, (e) => num(e, 'points') ?? 0),
        { min: 9 },
      ),
  },
  {
    id: 'cv.dessert-hoarder',
    emoji: '🍮',
    title: 'Dessert Hoarder',
    wholesomeTitle: 'Sweet Tooth',
    valence: 'gentle',
    weight: 3,
    kind: 'award',
    family: 'dessert',
    copy: {
      cheeky: ['{who} stashed {n} desserts. Sharing is optional', '{who} hoarded {n} desserts'],
      wholesome: ['{who} saved room for {n} desserts', '{who} collected {n} sweet treats'],
    },
    compute: (g) => leaders(bestOf(g, 'desserts', 'count'), { min: 4 }),
  },
  {
    id: 'cv.roll-royalty',
    emoji: '🍥',
    title: 'Roll Royalty',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'rolls',
    copy: {
      cheeky: ['{who} rolled up {n} points of rolls', '{who} hogged the rolls for {n} points'],
      wholesome: ['{who} ruled the rolls with {n} points', '{who} won {n} points from rolls'],
    },
    compute: (g) =>
      leaders(
        tally(g.of('round'), undefined, (e) => num(e, 'rolls') ?? 0),
        { min: 10 },
      ),
  },
  {
    id: 'cv.sticky-fingers',
    emoji: '🫳',
    title: 'Sticky Fingers',
    wholesomeTitle: 'Sharp Eyes',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'steal',
    copy: {
      cheeky: [
        '{who} took {n} cards their neighbour needed',
        '{who} grabbed {n} dishes meant for someone else',
      ],
      wholesome: [
        '{who} read the table and took {n} key cards',
        '{who} spotted {n} cards worth taking',
      ],
    },
    compute: (g) => mostBy(g.of('steal'), undefined, { min: 2 }),
  },
  {
    id: 'cv.miso-clash',
    emoji: '🍲',
    title: 'Soup Spiller',
    wholesomeTitle: 'Soup Sharer',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'miso',
    copy: {
      cheeky: ['{who} clashed misos {n|time}. Soup everywhere', '{who} spilled the soup {n|time}'],
      wholesome: [
        '{who} ordered soup at the busy moment {n|time}',
        '{who} shared a soup clash {n|time}',
      ],
    },
    compute: (g) => mostBy(g.of('miso'), (e) => strs(e, 'players'), { min: 2 }),
  },
  {
    id: 'cv.spoon',
    emoji: '🥄',
    title: 'Long Spoon',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'spoon',
    copy: {
      cheeky: [
        '{who} spooned {n} dishes from other hands',
        '{who} reached across the table {n|time}',
      ],
      wholesome: ['{who} asked nicely and got {n} dishes', '{who} found {n} dishes with a spoon'],
    },
    compute: (g) =>
      mostBy(
        g.of('spoon').filter((e) => bool(e, 'hit') === true && bool(e, 'auto') !== true),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'cv.feast',
    emoji: '🍱',
    title: 'Feast',
    wholesomeTitle: 'Full Plate',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'round',
    copy: {
      cheeky: ['{who} piled {n} points on one tray', '{who} scored {n} in a single round'],
      wholesome: ['{who} built a {n}-point tray', '{who} served up {n} points in one round'],
    },
    compute: (g) => leaders(bestOf(g, 'round', 'points'), { min: 25 }),
  },
  {
    id: 'cv.copycat',
    emoji: '🌈',
    title: 'Copycat',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'copy',
    copy: {
      cheeky: ['{who} copied {n} dishes. Original!', '{who} ordered seconds {n|time}'],
      wholesome: ['{who} doubled up {n|time} with special orders', '{who} made {n} clever copies'],
    },
    compute: (g) => mostBy(g.of('copy'), undefined, { min: 2 }),
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'cv.best-round',
    emoji: '🍱',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const best = Math.max(
        0,
        ...games.flatMap((g) => g.of('round').map((e) => num(e, 'points') ?? 0)),
      );
      return best >= 15 ? { value: best, text: `Best tray: ${best} points in a round` } : null;
    },
  },
  {
    id: 'cv.top-score',
    emoji: '🏆',
    interest: 2,
    record: 'max',
    compute: (games) => {
      const best = Math.max(
        -999,
        ...games
          .filter((g) => bool(outcome(g), 'golf') !== true)
          .flatMap((g) => nums(outcome(g), 'scores')),
      );
      return best > 0 ? { value: best, text: `Highest score: ${best} points` } : null;
    },
  },
  {
    id: 'cv.wasabi',
    emoji: '🌿',
    interest: 1,
    compute: (games) => {
      const n = games.reduce((sum, g) => sum + g.of('wasabi').length, 0);
      return n >= 3 ? { value: n, text: `${n} nigiri on wasabi` } : null;
    },
  },
];

/** One line per round: the best tray. */
function history(g: GameEvents): string[] {
  const rounds = new Map<number, { id: string; points: number }>();
  for (const e of g.of('round')) {
    const round = num(e, 'round');
    const points = num(e, 'points');
    if (!e.playerId || round === undefined || points === undefined) continue;
    const best = rounds.get(round);
    if (!best || points > best.points) rounds.set(round, { id: e.playerId, points });
  }
  return [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, b]) => `Round ${round}: ${ph.p(b.id)} served the best tray (${b.points})`);
}

export const conveyorAwards: AwardModule = { rules, nuggets, history };
