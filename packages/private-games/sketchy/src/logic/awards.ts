import {
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  type RecapEvent,
  bool,
  leaders,
  mostBy,
  num,
  ph,
  plain,
  strs,
  tally,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Sketchy, read from its `insights` events (`lie`, `vote`, `like`,
 * `drawing`, `outcome`). Text only: no prompts, no drawings.
 */

const authorsOf = (e: RecapEvent) => {
  const a = strs(e, 'authors');
  return a.length ? a : e.playerId ? [e.playerId] : [];
};

/** The lie's text, as players wrote it (made safe for placeholders). */
const lieText = (lie: RecapEvent): string => {
  const words = lie.props.words;
  const first = Array.isArray(words) ? (words[0] as { word?: unknown } | undefined) : undefined;
  return plain(typeof first?.word === 'string' ? first.word : '');
};

/** Each drawing with its lies (reported just before it). */
function drawingsOf(g: GameEvents): { drawing: RecapEvent; lies: RecapEvent[] }[] {
  const out: { drawing: RecapEvent; lies: RecapEvent[] }[] = [];
  let lies: RecapEvent[] = [];
  for (const e of g.events) {
    if (e.type === 'lie') lies.push(e);
    else if (e.type === 'drawing') {
      out.push({ drawing: e, lies });
      lies = [];
    }
  }
  return out;
}

const fooledBy = (g: GameEvents) => tally(g.of('lie'), authorsOf, (e) => num(e, 'fooled') ?? 0);

const rules: AwardRule[] = [
  {
    id: 'sketchy.best-liar',
    emoji: '🎭',
    title: 'Best Liar',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'deception',
    minPlayers: 3,
    copy: {
      cheeky: ["{who}'s fake titles fooled {n} people", '{who} talked {n} players into a lie'],
      wholesome: ["{who}'s titles won over {n} players", '{who} wrote {n} convincing fibs'],
    },
    compute: (g) => leaders(fooledBy(g), { min: 2 }),
  },
  {
    id: 'sketchy.most-fooled',
    emoji: '🫠',
    title: 'Most Fooled',
    wholesomeTitle: 'Trusting Soul',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'guessing',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} fell for {n} fake titles', '{who} believed {n} lies. Bless'],
      wholesome: ['{who} gave {n} fake titles a fair chance', '{who} saw the best in {n} lies'],
    },
    compute: (g) =>
      mostBy(
        g.of('vote').filter((v) => bool(v, 'foundTruth') === false),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'sketchy.artists-favourite',
    emoji: '🖼️',
    title: 'Artist’s Favourite',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'likes',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} made the artists laugh {n|time}', 'Artists liked {who}’s lies {n|time}'],
      wholesome: ['{who} won {n} likes from the artists', 'The artists loved {who}’s titles ({n})'],
    },
    compute: (g) =>
      leaders(
        tally(
          g.of('like').filter((l) => bool(l, 'byArtist') === true),
          (l) => strs(l, 'authors'),
        ),
      ),
  },
  {
    id: 'sketchy.most-liked',
    emoji: '👍',
    title: 'Most Liked',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'likes',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} collected {n} likes. Influencer', '{who}’s lies got {n} thumbs up'],
      wholesome: [
        '{who} made the table smile {n} times',
        '{who} earned {n} likes for funny titles',
      ],
    },
    compute: (g) =>
      leaders(
        tally(g.of('like'), (l) => strs(l, 'authors')),
        { min: 2 },
      ),
  },
  {
    id: 'sketchy.clear-artist',
    emoji: '🎨',
    title: 'Clear Artist',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'drawing',
    minPlayers: 3,
    copy: {
      cheeky: ['{who}’s drawings got {n} right guesses', 'Even liars got {who}’s art ({n} hits)'],
      wholesome: ['{who} drew so well {n} players got it', '{who}’s drawings spoke clearly ({n})'],
    },
    compute: (g) =>
      leaders(
        tally(g.of('drawing'), undefined, (d) => num(d, 'found') ?? 0),
        { min: 2 },
      ),
  },
  {
    id: 'sketchy.total-con',
    emoji: '💯',
    title: 'Total Con',
    valence: 'glory',
    weight: 5,
    kind: 'moment',
    family: 'deception',
    minPlayers: 4,
    copy: {
      cheeky: ['{who}’s "{w}" fooled every voter', '{who} conned the whole table with "{w}"'],
      wholesome: ['{who}’s "{w}" convinced everyone', 'Everyone believed {who}’s "{w}"'],
    },
    compute: (g) =>
      drawingsOf(g)
        .flatMap(({ drawing, lies }) => {
          const voters = num(drawing, 'voters') ?? 0;
          if (num(drawing, 'found') !== 0 || voters < 2) return [];
          return lies.flatMap((lie) => {
            const fooled = num(lie, 'fooled') ?? 0;
            const others = voters - authorsOf(lie).length;
            return others >= 2 && fooled === others
              ? [
                  {
                    players: authorsOf(lie).slice(0, 3),
                    value: fooled,
                    params: { w: lieText(lie) },
                  },
                ]
              : [];
          });
        })
        .slice(-1),
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'sketchy.mystery',
    emoji: '❓',
    interest: 2,
    compute: (games) => {
      const n = games.reduce(
        (sum, g) =>
          sum +
          g.of('drawing').filter((d) => num(d, 'found') === 0 && (num(d, 'voters') ?? 0) >= 2)
            .length,
        0,
      );
      return n >= 2 ? { value: n, text: `${n} drawings nobody could name` } : null;
    },
  },
  {
    id: 'sketchy.likes',
    emoji: '👍',
    interest: 1,
    record: 'max',
    compute: (games) => {
      const n = games.reduce((sum, g) => sum + g.of('like').length, 0);
      return n >= 3 ? { value: n, text: `Likes handed out for fake titles: ${n}` } : null;
    },
  },
];

/** One line per drawing, in order. */
function history(g: GameEvents): string[] {
  return g.of('drawing').flatMap((d) => {
    if (!d.playerId) return [];
    const found = num(d, 'found') ?? 0;
    const voters = num(d, 'voters') ?? 0;
    return [`${ph.p(d.playerId)}’s drawing: ${found} of ${voters} found the real title`];
  });
}

export const sketchyAwards: AwardModule = { rules, nuggets, history };
