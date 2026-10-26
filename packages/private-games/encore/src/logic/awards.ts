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
  str,
  strs,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Encore, read from its `insights` events (`show`, `recruit`,
 * `round`, `outcome`). Moves the table made for someone (`auto`) never earn an award.
 */

const shows = (g: GameEvents) => g.of('show').filter((e) => bool(e, 'auto') !== true);
const recruitsOf = (g: GameEvents) => g.of('recruit');
const outcome = (g: GameEvents) => g.of('outcome').at(-1);

const rules: AwardRule[] = [
  {
    id: 'en.big-show',
    emoji: '🎪',
    title: 'Showstopper',
    wholesomeTitle: 'Grand Finale',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'show',
    copy: {
      cheeky: ['{who} put {n} cards out at once. Subtle', '{who} unloaded a {n}-card show'],
      wholesome: ['{who} played a dazzling {n}-card show', '{who} lined up {n} cards in one show'],
    },
    compute: (g) => {
      const best = new Map<string, number>();
      for (const e of shows(g)) {
        const size = num(e, 'size');
        if (!e.playerId || size === undefined) continue;
        best.set(e.playerId, Math.max(best.get(e.playerId) ?? 0, size));
      }
      return leaders(best, { min: 4 });
    },
  },
  {
    id: 'en.crowd-favourite',
    emoji: '🎟️',
    title: 'Crowd Favourite',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'recruited',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} got recruited {n|time}. Everyone wants a piece',
        'The table raided {who}’s shows {n|time}',
      ],
      wholesome: [
        '{who}’s shows drew {n} recruits',
        'Everyone wanted {who}’s cards: recruited {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        recruitsOf(g).filter((e) => bool(e, 'paid') !== true),
        (e) => str(e, 'owner'),
        { min: 3 },
      ),
  },
  {
    id: 'en.talent-recruit',
    emoji: '🤝',
    title: 'Talent Recruit',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'recruit',
    copy: {
      cheeky: ['{who} recruited {n|time}. Window shopping?', '{who} took {n} cards off the table'],
      wholesome: ['{who} recruited {n} performers', '{who} recruited {n|time} to build a show'],
    },
    compute: (g) =>
      mostBy(
        recruitsOf(g).filter((e) => bool(e, 'auto') !== true),
        undefined,
        { min: 4 },
      ),
  },
  {
    id: 'en.encore',
    emoji: '👏',
    title: 'Curtain Closer',
    wholesomeTitle: 'Last Bow',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'rounds',
    copy: {
      cheeky: ['{who} ended {n} rounds. Hogging the curtain', '{who} called time on {n} rounds'],
      wholesome: ['{who} closed {n} rounds in style', '{who} took the final bow {n|time}'],
    },
    compute: (g) => mostBy(g.of('round'), undefined, { min: 2 }),
  },
  {
    id: 'en.recycled',
    emoji: '♻️',
    title: 'Borrowed Brilliance',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'recruit',
    copy: {
      cheeky: [
        '{who} showed recruited cards {n|time}. Thanks, table',
        '{who} turned others’ cards into {n} shows',
      ],
      wholesome: [
        '{who} built {n} shows from recruited cards',
        '{who} put recruited cards to work {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        shows(g).filter((e) => bool(e, 'withRecruited') === true),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'en.in-the-red',
    emoji: '📉',
    title: 'In the Red',
    wholesomeTitle: 'Brave Hands',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'blunder',
    copy: {
      cheeky: [
        '{who} scored below zero in {n} rounds',
        '{who} went negative {n|time}. Hold fewer cards',
      ],
      wholesome: [
        '{who} kept a full hand in {n} rounds',
        '{who} held on bravely in {n} tough rounds',
      ],
    },
    compute: (g) => mostBy(g.of('round'), (e) => strs(e, 'negative'), { min: 2 }),
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'en.biggest-show',
    emoji: '🎪',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const best = Math.max(
        0,
        ...games.flatMap((g) => g.of('show').map((e) => num(e, 'size') ?? 0)),
      );
      return best >= 3 ? { value: best, text: `Biggest show: ${best} cards` } : null;
    },
  },
  {
    id: 'en.top-score',
    emoji: '🏆',
    interest: 2,
    record: 'max',
    compute: (games) => {
      const best = Math.max(-999, ...games.flatMap((g) => nums(outcome(g), 'scores')));
      return best > 0 ? { value: best, text: `Highest score: ${best} points` } : null;
    },
  },
  {
    id: 'en.recruits',
    emoji: '🤝',
    interest: 1,
    compute: (games) => {
      const n = games.reduce((sum, g) => sum + recruitsOf(g).length, 0);
      return n >= 10 ? { value: n, text: `${n} cards recruited` } : null;
    },
  },
];

const HOW: Record<string, string> = {
  out: 'played out their hand',
  unbeaten: 'went unbeaten',
  stuck: 'went unanswered',
};

/** One line per round: who ended it and how. */
function history(g: GameEvents): string[] {
  return g.of('round').flatMap((e) => {
    const how = HOW[str(e, 'how') ?? ''];
    const round = num(e, 'round');
    if (!e.playerId || !how || round === undefined) return [];
    return [`Round ${round}: ${ph.p(e.playerId)} ${how}`];
  });
}

export const encoreAwards: AwardModule = { rules, nuggets, history };
