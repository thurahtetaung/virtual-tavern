import {
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  bool,
  leaders,
  mostBy,
  num,
  str,
  strs,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Mission Control, read from its `insights` events (`task`, `feed`,
 * `signal`, `distress`, `outcome`). Each attempt is one game. Nothing here names a card or a task.
 */

const outcome = (g: GameEvents) => g.of('outcome').at(-1);
const won = (g: GameEvents) => bool(outcome(g), 'success') === true;

const rules: AwardRule[] = [
  {
    id: 'mc.feeder',
    emoji: '🍽️',
    title: 'The Feeder',
    wholesomeTitle: 'Team Player',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'feeding',
    copy: {
      cheeky: [
        '{who} fed teammates {n} task cards. Room service',
        '{who} served up {n} task cards',
      ],
      wholesome: ['{who} passed {n} task cards to teammates', '{who} fed the crew {n} task cards'],
    },
    compute: (g) => mostBy(g.of('feed'), undefined, { min: 2 }),
  },
  {
    id: 'mc.mind-reader',
    emoji: '🔮',
    title: 'Mind Reader',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'signals',
    copy: {
      cheeky: [
        '{who} cashed in a teammate’s signal {n|time}',
        'One signal, and {who} knew what to do: {n|time}',
      ],
      wholesome: [
        '{who} met a task right after a signal, {n|time}',
        '{who} read the crew’s signals {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('task').filter((e) => strs(e, 'signalBy').length > 0),
        undefined,
        { min: 1 },
      ),
  },
  {
    id: 'mc.beacon',
    emoji: '🔦',
    title: 'The Beacon',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'signals',
    copy: {
      cheeky: [
        '{who}’s signal landed a task next trick, {n|time}',
        '{who} signalled, the crew delivered: {n|time}',
      ],
      wholesome: [
        '{who} gave a signal that paid off {n|time}',
        '{who}’s signals lit the way {n|time}',
      ],
    },
    compute: (g) => {
      const hits = new Map<string, number>();
      for (const e of g.of('task'))
        for (const s of strs(e, 'signalBy')) hits.set(s, (hits.get(s) ?? 0) + 1);
      return leaders(hits, { min: 1 });
    },
  },
  {
    id: 'mc.flawless',
    emoji: '✨',
    title: 'Flawless Dive',
    valence: 'glory',
    weight: 4,
    kind: 'team',
    family: 'result',
    copy: {
      cheeky: [
        '{who} nailed mission {n} on the very first try',
        'First try, mission {n}. {who} make it look easy',
      ],
      wholesome: ['{who} cleared mission {n} at the first go', 'Mission {n} in one go for {who}'],
    },
    compute: (g) => {
      const o = outcome(g);
      if (!won(g) || num(o, 'attempt') !== 1 || bool(o, 'practice') || bool(o, 'epilogue'))
        return [];
      return [{ players: g.winners, value: num(o, 'mission') ?? 0 }];
    },
  },
  {
    id: 'mc.comeback',
    emoji: '🧗',
    title: 'Never Give Up',
    valence: 'glory',
    weight: 4,
    kind: 'team',
    family: 'result',
    copy: {
      cheeky: ['{who} cracked it on try {n}. Stubborn crew', 'Try {n}, and {who} finally made it'],
      wholesome: ['{who} kept at it and won on try {n}', '{who} got there on attempt {n}'],
    },
    compute: (g) => {
      const n = num(outcome(g), 'attempt') ?? 0;
      return won(g) && n >= 4 ? [{ players: g.winners, value: n }] : [];
    },
  },
  {
    id: 'mc.sunk',
    emoji: '🫧',
    title: 'Glug Glug',
    wholesomeTitle: 'Brave Attempt',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'blunder',
    copy: {
      cheeky: [
        '{who}’s task went under on trick {n}',
        'Trick {n}: {who}’s task sank without a trace',
      ],
      wholesome: [
        '{who} held the toughest task until trick {n}',
        '{who}’s task put up a fight to trick {n}',
      ],
    },
    compute: (g) => {
      const o = outcome(g);
      const who = str(o, 'failedBy');
      if (won(g) || !who || bool(o, 'timedOut')) return [];
      return [{ players: [who], value: Math.max(1, num(o, 'tricks') ?? 1) }];
    },
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'mc.tasks',
    emoji: '✅',
    interest: 2,
    compute: (games) => {
      const n = games.reduce((sum, g) => sum + g.of('task').length, 0);
      return n >= 3 ? { value: n, text: `${n} tasks met` } : null;
    },
  },
  {
    id: 'mc.deepest',
    emoji: '🌊',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const best = Math.max(
        0,
        ...games
          .filter(won)
          .map((g) => (bool(outcome(g), 'epilogue') ? 0 : (num(outcome(g), 'mission') ?? 0))),
      );
      return best > 0 ? { value: best, text: `Furthest mission cleared: ${best}` } : null;
    },
  },
];

/** One line per attempt: the mission, the try and how it went. */
function history(g: GameEvents): string[] {
  const o = outcome(g);
  if (!o) return [];
  const n = num(o, 'mission') ?? 0;
  const what = bool(o, 'epilogue') ? `Epilogue at ${num(o, 'level') ?? 0}` : `Mission ${n}`;
  const how = won(g)
    ? 'made it'
    : bool(o, 'timedOut')
      ? 'ran out of time'
      : `went under on trick ${num(o, 'tricks') ?? 0}`;
  return [`${what}, try ${num(o, 'attempt') ?? 1}: ${how}`];
}

export const missionControlAwards: AwardModule = { rules, nuggets, history, stripSize: 2 };
