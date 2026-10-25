import {
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  bool,
  mostBy,
  num,
  pairTally,
  ph,
  plain,
  str,
  strs,
  topPair,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Stampede, read from its `insights` events (`answer`, `round`,
 * `pink`, `outcome`). The Pink Cow is named with `{card}` (`pink-cow`), which the browser fills
 * from the private manifest's names.
 */

const PINK = 'pink-cow';
const withPink = (cs: AwardCandidate[]) => cs.map((c) => ({ ...c, params: { card: PINK } }));
const answers = (g: GameEvents) => g.of('answer');
/** Every pair of players who gave the same answer in a round (each pair seen from both sides). */
const matches = (g: GameEvents) =>
  answers(g).flatMap((e) =>
    e.playerId ? strs(e, 'with').map((other) => [e.playerId!, other] as const) : [],
  );

const rules: AwardRule[] = [
  {
    id: 'sp.herd-leader',
    emoji: '🐄',
    title: 'Herd Leader',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'herd',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} thought like the crowd {n|time}. Suspicious',
        '{who} was in the herd {n|time}. Moo-ve over',
      ],
      wholesome: [
        '{who} was in tune with everyone, {n|time}',
        '{who} read the room perfectly, {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        answers(g).filter((e) => bool(e, 'herd') === true),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'sp.lone-wolf',
    emoji: '🐺',
    title: 'Lone Wolf',
    wholesomeTitle: 'Free Thinker',
    valence: 'gentle',
    weight: 3,
    kind: 'award',
    family: 'alone',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} stood alone {n|time}. Nobody followed',
        '{who} went their own way {n|time}. Brave',
      ],
      wholesome: [
        '{who} had {n} answers all their own',
        '{who} brought {n} ideas nobody else thought of',
      ],
    },
    compute: (g) =>
      mostBy(
        answers(g).filter((e) => bool(e, 'alone') === true),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'sp.pink-magnet',
    emoji: '🩷',
    title: 'Cow Magnet',
    wholesomeTitle: 'Cow Whisperer',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'pink',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} took the {card} {n|time}. It likes them',
        '{who} and the {card}: {n} reunions',
      ],
      wholesome: [
        '{who} gave the {card} a home {n|time}',
        '{who} looked after the {card} {n|time}',
      ],
    },
    compute: (g) => withPink(mostBy(g.of('pink'), undefined, { min: 2 })),
  },
  {
    id: 'sp.mind-meld',
    emoji: '🤝',
    title: 'Mind Meld',
    valence: 'glory',
    weight: 3,
    kind: 'pair',
    family: 'pair',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} said the same thing {n|time}. Twins?', '{who} matched {n|time}. Rehearsed?'],
      wholesome: ['{who} were on one wavelength {n|time}', '{who} matched answers {n|time}'],
    },
    compute: (g) => topPair(halve(pairTally(matches(g))), 3),
  },
  {
    id: 'sp.one-herd',
    emoji: '🌪️',
    title: 'One Big Herd',
    valence: 'glory',
    weight: 4,
    kind: 'moment',
    family: 'herd',
    minPlayers: 3,
    copy: {
      cheeky: ['All {n} said the same thing. Who copied?', '{n} players, one answer. Spooky'],
      wholesome: ['All {n} of us agreed on one answer', '{n} players, one answer: a perfect herd'],
    },
    compute: (g) => {
      const whole = g
        .of('round')
        .filter(
          (e) => num(e, 'groups') === 1 && (num(e, 'herdSize') ?? 0) >= 3 && num(e, 'blanks') === 0,
        );
      const best = Math.max(0, ...whole.map((e) => num(e, 'herdSize') ?? 0));
      return best >= 3 ? [{ players: [], value: best }] : [];
    },
  },
  {
    id: 'sp.escape',
    emoji: '🏃',
    title: 'Great Escape',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'pink',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} shook off the {card} and won anyway',
        '{who} held the {card} {n|time}, then won. Sneaky',
      ],
      wholesome: [
        '{who} passed on the {card} and won the day',
        '{who} came back from the {card} {n|time} to win',
      ],
    },
    compute: (g) => {
      const winners = g.winners.length ? g.winners : strs(g.of('outcome').at(-1), 'winners');
      const held = mostBy(g.of('pink'), undefined, { among: winners });
      return withPink(held);
    },
  },
];

/** Each matching pair is reported by both players: count it once. */
function halve(tallies: Map<string, number>): Map<string, number> {
  return new Map([...tallies].map(([k, v]) => [k, Math.round(v / 2)]));
}

const nuggets: NuggetRule[] = [
  {
    id: 'sp.biggest-herd',
    emoji: '🐄',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const best = Math.max(
        0,
        ...games.flatMap((g) => g.of('round').map((e) => num(e, 'herdSize') ?? 0)),
      );
      return best >= 3 ? { value: best, text: `Biggest herd: ${best} players, one answer` } : null;
    },
  },
  {
    id: 'sp.ties',
    emoji: '🤷',
    interest: 2,
    compute: (games) => {
      const n = games.reduce(
        (sum, g) => sum + g.of('round').filter((e) => bool(e, 'tie') === true).length,
        0,
      );
      return n >= 2 ? { value: n, text: `${n} rounds tied at the top: no cows` } : null;
    },
  },
  {
    id: 'sp.pink-moves',
    emoji: '🩷',
    interest: 2,
    compute: (games) => {
      const n = games.reduce((sum, g) => sum + g.of('pink').length, 0);
      return n >= 2 ? { value: n, text: `The ${ph.card(PINK)} changed hands ${n} times` } : null;
    },
  },
];

/** One line per round, in order. */
function history(g: GameEvents): string[] {
  const pinks = new Map(g.of('pink').map((e) => [num(e, 'round'), e.playerId]));
  return g.of('round').map((e) => {
    const n = num(e, 'round') ?? 0;
    const herd = str(e, 'herd');
    const size = num(e, 'herdSize') ?? 0;
    const line = herd
      ? `Round ${n}: ${size} said “${plain(herd)}”`
      : bool(e, 'tie') === true
        ? `Round ${n}: a tie at the top, no cows`
        : `Round ${n}: no herd`;
    const pink = pinks.get(n);
    return pink ? `${line}; ${ph.p(pink)} took the ${ph.card(PINK)}` : line;
  });
}

export const stampedeAwards: AwardModule = { rules, nuggets, history, stripSize: 2 };
