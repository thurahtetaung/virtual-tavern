import {
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  type RecapEvent,
  bool,
  count,
  leaders,
  num,
  pairTally,
  ph,
  plain,
  str,
  strs,
  tally,
  topPair,
} from '@vt/game-sdk';

const ROMAN = ['I', 'II', 'III', 'IV'];
const roundName = (n: number | undefined) => (n ? (ROMAN[n - 1] ?? String(n)) : '?');

const shows = (g: GameEvents, kind?: string) =>
  g.of('show').filter((e) => e.playerId && (kind === undefined || str(e, 'kind') === kind));

/** The other marker of a Super-Spark (the Scout is the first marker). */
const partner = (e: RecapEvent) => strs(e, 'markers')[1];

const rules: AwardRule[] = [
  {
    id: 'starlight.kindred',
    emoji: '💫',
    title: 'Kindred Spirits',
    valence: 'glory',
    weight: 4,
    kind: 'pair',
    family: 'super',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{a} and {b} shared {n} Super-Sparks. Suspicious',
        '{a} and {b}: one brain, {n} Super-Sparks',
      ],
      wholesome: [
        '{a} and {b} saw the same stars {n} times',
        '{a} and {b} lit {n} Super-Sparks together',
      ],
    },
    compute: (g) =>
      topPair(
        pairTally(
          shows(g, 'super').flatMap((e) => {
            const b = partner(e);
            return b ? [[e.playerId!, b] as const] : [];
          }),
        ),
      ),
  },
  {
    id: 'starlight.super-spark',
    emoji: '🌟',
    title: 'Super-Sparker',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'super',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} was in on {n} Super-Sparks. Hogging the bonus',
        '{who} grabbed {n} bonus stars. Greedy',
      ],
      wholesome: ['{who} lit up {n} Super-Sparks', '{who} found the one kindred mind {n} times'],
    },
    compute: (g) =>
      leaders(
        tally(shows(g, 'super'), (e) => strs(e, 'markers').slice(0, 2)),
        { min: 2 },
      ),
  },
  {
    id: 'starlight.spark-plug',
    emoji: '✨',
    title: 'Spark Plug',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'scout',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} scouted {n} Sparks. Too obvious, frankly',
        '{who} kept showing crowd-pleasers: {n}',
      ],
      wholesome: [
        '{who} showed {n} cards the whole table loved',
        '{who} sparked {n} times as Scout',
      ],
    },
    compute: (g) => leaders(tally(shows(g, 'spark')), { min: 3 }),
  },
  {
    id: 'starlight.lone-star',
    emoji: '🌑',
    title: 'Lone Star',
    wholesomeTitle: 'Unique Vision',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'fall',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} fell {n} times. Nobody else saw it',
        '{who} pointed at {n} cards only they liked',
      ],
      wholesome: ['{who} saw {n} things nobody else could', '{who} had {n} visions all their own'],
    },
    compute: (g) => leaders(tally(shows(g, 'fall')), { min: 2 }),
  },
  {
    id: 'starlight.lantern',
    emoji: '🏮',
    title: 'Lantern in the Dark',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'dark',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} marked the most and still scored {n}. Show-off',
        'In the Dark, {who} never fell: {n} points',
      ],
      wholesome: [
        '{who} walked the Dark without a stumble: {n}',
        '{who} lit the Dark for {n} points',
      ],
    },
    compute: (g) => {
      const clean = g
        .of('round')
        .filter((e) => bool(e, 'dark') === true && bool(e, 'fell') === false);
      return leaders(
        tally(
          clean,
          (e) => e.playerId,
          (e) => num(e, 'points') ?? 0,
        ),
        { min: 1 },
      );
    },
  },
  {
    id: 'starlight.lost-in-dark',
    emoji: '🕳️',
    title: 'Lost in the Dark',
    wholesomeTitle: 'Brave Explorer',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'dark',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} marked big, fell, and paid for it in round {r}',
        'Round {r}: {who} went too deep into the Dark',
      ],
      wholesome: [
        '{who} dreamed big in round {r}, bless them',
        'Round {r}: {who} explored the far side of the word',
      ],
    },
    compute: (g) => {
      const lost = g.of('round').filter((e) => bool(e, 'dark') && bool(e, 'fell') && e.playerId);
      const last = lost.at(-1);
      return last
        ? [
            {
              players: [last.playerId!],
              value: lost.length,
              params: { r: roundName(num(last, 'round')) },
            },
          ]
        : [];
    },
  },
  {
    id: 'starlight.big-round',
    emoji: '🌌',
    title: 'Starry Night',
    valence: 'glory',
    weight: 3,
    kind: 'moment',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} filled {n} stars in one round. Leave some sky',
        '{who} took {n} points in a single round',
      ],
      wholesome: [
        '{who} had a {n}-point night under the stars',
        '{who} shone for {n} points in one round',
      ],
    },
    compute: (g) => {
      const best = Math.max(0, ...g.of('round').map((e) => num(e, 'points') ?? 0));
      if (best < 8) return [];
      const ids = [
        ...new Set(
          g
            .of('round')
            .filter((e) => num(e, 'points') === best)
            .map((e) => e.playerId!),
        ),
      ];
      return ids.length === 1 ? [{ players: ids, value: best }] : [];
    },
  },
  {
    id: 'starlight.minimalist',
    emoji: '🎯',
    title: 'Minimalist',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} marked one card and still scored {n}. Smug',
        '{who} needed one cross for {n} points',
      ],
      wholesome: [
        '{who} chose one card, perfectly, for {n}',
        'One cross, {n} points: {who} kept it simple',
      ],
    },
    compute: (g) => {
      const lean = g
        .of('round')
        .filter((e) => num(e, 'marks') === 1 && (num(e, 'points') ?? 0) > 0);
      return leaders(
        tally(
          lean,
          (e) => e.playerId,
          (e) => num(e, 'points') ?? 0,
        ),
        { min: 2 },
      );
    },
  },
];

const allShows = (games: readonly GameEvents[], kind: string) =>
  games.flatMap((g) => shows(g, kind));

const nuggets: NuggetRule[] = [
  {
    id: 'starlight.sparks',
    emoji: '✨',
    interest: 1,
    compute: (games) => {
      const n = allShows(games, 'spark').length;
      return n ? { value: n, text: `${count(n, 'Spark')} lit` } : null;
    },
  },
  {
    id: 'starlight.supers',
    emoji: '🌟',
    interest: 2,
    compute: (games) => {
      const n = allShows(games, 'super').length;
      return n ? { value: n, text: `${count(n, 'Super-Spark')}` } : null;
    },
  },
  {
    id: 'starlight.falls',
    emoji: '🌠',
    interest: 1,
    compute: (games) => {
      const n = allShows(games, 'fall').length;
      return n ? { value: n, text: `${count(n, 'fall')} from the sky` } : null;
    },
  },
  {
    id: 'starlight.best-round',
    emoji: '🌌',
    interest: 2,
    record: 'max',
    compute: (games) => {
      const best = Math.max(
        0,
        ...games.flatMap((g) => g.of('round').map((e) => num(e, 'points') ?? 0)),
      );
      return best ? { value: best, text: `Best single round: ${count(best, 'point')}` } : null;
    },
  },
];

function history(g: GameEvents): string[] {
  return g.of('word').map((w) => {
    const no = num(w, 'round');
    const inRound = g.of('show').filter((s) => num(s, 'round') === no);
    const n = (kind: string) => inRound.filter((s) => str(s, 'kind') === kind).length;
    const dark = str(w, 'dark');
    return [
      `Round ${roundName(no)}: "${plain(str(w, 'word') ?? '…')}"`,
      `${count(n('spark'), 'Spark')}, ${count(n('super'), 'Super-Spark')}, ${count(n('fall'), 'fall')}`,
      dark ? `${ph.p(dark)} in the Dark` : 'nobody in the Dark',
    ].join(', ');
  });
}

/** Starlight's awards for the night recap, read from its own `insights` events. */
export const starlightAwards: AwardModule = { rules, nuggets, history, stripSize: 3 };
