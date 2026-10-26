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
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Mosaic, read from its `insights` events (`take`, `tiling`,
 * `outcome`).
 */

const takes = (g: GameEvents) => g.of('take');
const tilings = (g: GameEvents) => g.of('tiling');
const outcome = (g: GameEvents) => g.of('outcome').at(-1);

/** Each player's best (or summed) value of a prop. */
function per(
  events: ReturnType<GameEvents['of']>,
  key: string,
  how: 'max' | 'sum',
  keep: (e: ReturnType<GameEvents['of']>[number]) => boolean = () => true,
) {
  const out = new Map<string, number>();
  for (const e of events) {
    const v = num(e, key);
    if (!e.playerId || v === undefined || !keep(e)) continue;
    const was = out.get(e.playerId) ?? 0;
    out.set(e.playerId, how === 'max' ? Math.max(was, v) : was + v);
  }
  return out;
}

const rules: AwardRule[] = [
  {
    id: 'mo.hate-drafter',
    emoji: '😈',
    title: 'Hate-Drafter',
    wholesomeTitle: 'Table Guardian',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'denial',
    copy: {
      cheeky: [
        '{who} binned {n} tiles just so nobody else got them',
        '{who} threw {n} good tiles on the floor. Out of spite',
      ],
      wholesome: [
        '{who} kept {n} tiles away from the others',
        '{who} gave up {n} tiles to keep the table in check',
      ],
    },
    compute: (g) =>
      leaders(
        per(takes(g), 'dumped', 'sum', (e) => bool(e, 'auto') !== true),
        { min: 3 },
      ),
  },
  {
    id: 'mo.big-round',
    emoji: '🧱',
    title: 'Biggest Round',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'wall',
    copy: {
      cheeky: [
        '{who} tiled {n} points in one round. Show-off',
        '{who} cashed in {n} points at once',
      ],
      wholesome: ['{who} tiled {n} points in a single round', 'A {n}-point round for {who}'],
    },
    compute: (g) => leaders(per(tilings(g), 'points', 'max'), { min: 8 }),
  },
  {
    id: 'mo.clean-wall',
    emoji: '🧽',
    title: 'Cleanest Wall',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'floor',
    copy: {
      cheeky: [
        '{who} kept the floor spotless {n|time}. Neat freak',
        '{n} rounds without a tile on the floor for {who}',
      ],
      wholesome: [
        '{who} finished {n} rounds with a clean floor',
        '{who} kept a tidy floor {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        tilings(g).filter((e) => bool(e, 'perfect') === true),
        undefined,
        { min: 3 },
      ),
  },
  {
    id: 'mo.floor-eater',
    emoji: '🍽️',
    title: 'Floor Eater',
    wholesomeTitle: 'Brave Taker',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'floor',
    copy: {
      cheeky: ['{who} ate −{n} in one take. Hungry?', '{who} swallowed a −{n} take whole'],
      wholesome: ['{who} took one for the table: −{n}', '{who} bravely cleared a −{n} pile'],
    },
    compute: (g) => {
      const worst = new Map<string, number>();
      for (const e of takes(g)) {
        const p = num(e, 'penalty');
        if (!e.playerId || p === undefined || bool(e, 'auto') === true) continue;
        worst.set(e.playerId, Math.max(worst.get(e.playerId) ?? 0, -p));
      }
      return leaders(worst, { min: 5 });
    },
  },
  {
    id: 'mo.first-dibs',
    emoji: '1️⃣',
    title: 'First Dibs',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'marker',
    copy: {
      cheeky: [
        '{who} grabbed the first-player marker {n|time}',
        '{who} just had to go first, {n|time}',
      ],
      wholesome: ['{who} led the next round {n|time}', '{who} took the marker {n|time}'],
    },
    compute: (g) =>
      mostBy(
        takes(g).filter((e) => bool(e, 'marker') === true),
        undefined,
        { min: 3 },
      ),
  },
  {
    id: 'mo.chain',
    emoji: '✨',
    title: 'Chain Reaction',
    valence: 'glory',
    weight: 3,
    kind: 'moment',
    family: 'wall',
    copy: {
      cheeky: ['One tile, {n} points: {who} lit up the wall', '{who} dropped a {n}-point tile'],
      wholesome: ['{who} placed a single tile worth {n}', 'A {n}-point tile for {who}'],
    },
    compute: (g) => leaders(per(tilings(g), 'best', 'max'), { min: 7 }),
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'mo.top-score',
    emoji: '🧩',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const best = Math.max(0, ...games.flatMap((g) => nums(outcome(g), 'scores')));
      return best > 0 ? { value: best, text: `Highest wall score: ${best} points` } : null;
    },
  },
  {
    id: 'mo.best-tile',
    emoji: '✨',
    interest: 2,
    record: 'max',
    compute: (games) => {
      const best = Math.max(0, ...games.flatMap((g) => tilings(g).map((e) => num(e, 'best') ?? 0)));
      return best >= 5 ? { value: best, text: `Best single tile: ${best} points` } : null;
    },
  },
  {
    id: 'mo.full-floors',
    emoji: '💥',
    interest: 2,
    compute: (games) => {
      const n = games.reduce(
        (sum, g) => sum + tilings(g).filter((e) => (num(e, 'penalty') ?? 0) <= -14).length,
        0,
      );
      return n ? { value: n, text: `${n} full floor${n === 1 ? '' : 's'} (−14 each)` } : null;
    },
  },
];

/** One line per round: who scored the most from their wall. */
function history(g: GameEvents): string[] {
  const rounds = new Map<number, { id: string; net: number }[]>();
  for (const e of tilings(g)) {
    const round = num(e, 'round');
    if (round === undefined || !e.playerId) continue;
    const net = (num(e, 'points') ?? 0) + (num(e, 'penalty') ?? 0);
    rounds.set(round, [...(rounds.get(round) ?? []), { id: e.playerId, net }]);
  }
  return [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, rows]) => {
      const best = Math.max(...rows.map((r) => r.net));
      const top = rows.filter((r) => r.net === best);
      if (best <= 0) return `Round ${round}: nobody gained`;
      return top.length === 1
        ? `Round ${round}: ${ph.p(top[0]!.id)} gained most (+${best})`
        : `Round ${round}: ${top.length} players gained +${best}`;
    });
}

export const mosaicAwards: AwardModule = { rules, nuggets, history };
