import {
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  type RecapEvent,
  bool,
  count,
  leaders,
  num,
  str,
  tally,
} from '@vt/game-sdk';

/**
 * Séance's night-recap awards, read from its own insight events (see `insights.ts`). Everyone
 * wins or loses together, so the awards celebrate the reading (first-hour finds, clairvoyance)
 * and the ghost's craft rather than a side.
 */

const outcomeOf = (g: GameEvents): RecapEvent | undefined => g.of('outcome').at(-1);
const one = (id: string | undefined | null, value = 1): AwardCandidate[] =>
  id ? [{ players: [id], value }] : [];
const won = (g: GameEvents) => bool(outcomeOf(g), 'win') === true;

const mindReader: AwardRule = {
  id: 'seance.mind-reader',
  emoji: '🔮',
  title: 'Mind Reader',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'reading',
  minPlayers: 3,
  copy: {
    cheeky: [
      '{who} read {n} visions at first sight. Spooky',
      '{who} got {n} right first time. Who told them?',
    ],
    wholesome: [
      '{who} read {n} visions right at first sight',
      '{who} found {n} cards on the very first try',
    ],
  },
  compute(g) {
    const firsts = g.of('guess').filter((e) => bool(e, 'correct') && num(e, 'tries') === 1);
    return leaders(tally(firsts), { min: 2, among: g.players });
  },
};

const sixthSense: AwardRule = {
  id: 'seance.sixth-sense',
  emoji: '👁️',
  title: 'Sixth Sense',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'clairvoyance',
  minPlayers: 4,
  copy: {
    cheeky: [
      '{who} called {n} of the others’ guesses right',
      '{who} trusted the right hunch {n|time}',
    ],
    wholesome: [
      '{who} judged {n} of the others’ guesses right',
      '{who} saw clearly for the table {n|time}',
    ],
  },
  compute(g) {
    const hits = g.of('clairvoyance').filter((e) => bool(e, 'hit'));
    return leaders(tally(hits), { min: 2, among: g.players });
  },
};

const lostInTheMist: AwardRule = {
  id: 'seance.lost-in-the-mist',
  emoji: '🌫️',
  title: 'Lost in the Mist',
  wholesomeTitle: 'Patient Seer',
  valence: 'chaos',
  weight: 2,
  kind: 'award',
  family: 'reading',
  minPlayers: 3,
  copy: {
    cheeky: [
      '{who} read the visions wrong {n|time}',
      '{who} guessed wrong {n} times. The ghost sighed',
    ],
    wholesome: [
      '{who} kept trying through {n} misses',
      '{who} never gave up, even after {n} misses',
    ],
  },
  compute(g) {
    const wrong = g.of('guess').filter((e) => bool(e, 'correct') === false);
    return leaders(tally(wrong), { min: 3, among: g.players });
  },
};

const spiritGuide: AwardRule = {
  id: 'seance.spirit-guide',
  emoji: '👻',
  title: 'Spirit Guide',
  valence: 'glory',
  weight: 5,
  kind: 'award',
  family: 'ghost',
  minPlayers: 3,
  copy: {
    cheeky: [
      '{who} said nothing all game and still won',
      '{who} haunted the table to a win by hour {n}',
    ],
    wholesome: [
      '{who} guided the table to the culprit in silence',
      '{who} was a wonderful ghost: solved by hour {n}',
    ],
  },
  compute(g) {
    const o = outcomeOf(g);
    if (!won(g)) return [];
    return one(str(o, 'ghost'), num(o, 'hour') ?? 7);
  },
};

const ravenKeeper: AwardRule = {
  id: 'seance.raven-keeper',
  emoji: '🐦‍⬛',
  title: 'Raven Keeper',
  valence: 'gentle',
  weight: 2,
  kind: 'award',
  family: 'ghost',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} sent {n} ravens. The hand was not great', '{who} swapped their hand {n} times'],
    wholesome: [
      '{who} called on the ravens {n} times',
      '{who} kept looking for the right picture: {n} ravens',
    ],
  },
  compute(g) {
    const ravens = g.of('raven');
    return ravens.length >= 2 ? one(ravens[0]?.playerId, ravens.length) : [];
  },
};

const oneCardWonder: AwardRule = {
  id: 'seance.one-card-wonder',
  emoji: '🖼️',
  title: 'One Card Wonder',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'ghost',
  minPlayers: 3,
  copy: {
    cheeky: [
      '{who} needed one picture, {n} times. Show-off',
      '{who} landed {n} finds with a single card',
    ],
    wholesome: [
      '{who} sent {n} single cards that said it all',
      '{who} picked the perfect picture {n|time}',
    ],
  },
  compute(g) {
    const ghost = str(outcomeOf(g), 'ghost');
    const n = g.of('guess').filter((e) => bool(e, 'correct') && num(e, 'visions') === 1).length;
    return n >= 2 ? one(ghost, n) : [];
  },
};

const firstToFinish: AwardRule = {
  id: 'seance.first-to-finish',
  emoji: '🕯️',
  title: 'First Light',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'speed',
  minPlayers: 4,
  copy: {
    cheeky: [
      '{who} was done by hour {n} and then just watched',
      '{who} finished first, in hour {n}',
    ],
    wholesome: [
      '{who} found all three cards first, in hour {n}',
      '{who} lit the way: all three by hour {n}',
    ],
  },
  compute(g) {
    const hours = new Map<string, number>();
    for (const e of g.of('finish')) {
      const h = num(e, 'hour');
      if (e.playerId && h !== undefined) hours.set(e.playerId, h);
    }
    return leaders(hours, { lowest: true, among: g.players });
  },
};

const photoFinish: AwardRule = {
  id: 'seance.photo-finish',
  emoji: '🕛',
  title: 'Photo Finish',
  valence: 'glory',
  weight: 4,
  kind: 'moment',
  family: 'speed',
  minPlayers: 3,
  copy: {
    cheeky: [
      'The last card fell in hour {n}, with the clock nearly out',
      'Hour {n}, the last possible moment, and still a win',
    ],
    wholesome: [
      'Everyone found their cards by hour {n} and won together',
      'A win in hour {n}: right on the last stroke of the clock',
    ],
  },
  compute(g) {
    const o = outcomeOf(g);
    return won(g) && num(o, 'hour') === 7 ? [{ players: [], value: 7 }] : [];
  },
};

const SEANCE_RULES: AwardRule[] = [
  spiritGuide,
  mindReader,
  sixthSense,
  firstToFinish,
  oneCardWonder,
  ravenKeeper,
  lostInTheMist,
  photoFinish,
];

const outcomes = (games: readonly GameEvents[]) =>
  games.flatMap((g) => {
    const o = outcomeOf(g);
    return o ? [o] : [];
  });

const nuggets: NuggetRule[] = [
  {
    id: 'seance.solved',
    emoji: '🕯️',
    interest: 3,
    compute(games) {
      const list = outcomes(games);
      if (!list.length) return null;
      const n = list.filter((o) => bool(o, 'win')).length;
      return { value: n, text: `Ghosts laid to rest: ${n} of ${list.length}` };
    },
  },
  {
    id: 'seance.fastest',
    emoji: '⏱️',
    interest: 3,
    record: 'min',
    compute(games) {
      const hours = outcomes(games)
        .filter((o) => bool(o, 'win'))
        .map((o) => num(o, 'hour'))
        .filter((h): h is number => h !== undefined);
      if (!hours.length) return null;
      const best = Math.min(...hours);
      return { value: best, text: `Quickest séance: solved by hour ${best}` };
    },
  },
  {
    id: 'seance.visions',
    emoji: '🖼️',
    interest: 2,
    compute(games) {
      const n = outcomes(games).reduce((sum, o) => sum + (num(o, 'visions') ?? 0), 0);
      return n ? { value: n, text: `${count(n, 'vision card')} sent in silence` } : null;
    },
  },
  {
    id: 'seance.ravens',
    emoji: '🐦‍⬛',
    interest: 1,
    compute(games) {
      const n = outcomes(games).reduce((sum, o) => sum + (num(o, 'ravens') ?? 0), 0);
      return n ? { value: n, text: `${count(n, 'raven')} flew` } : null;
    },
  },
  {
    id: 'seance.top-level',
    emoji: '👁️',
    interest: 2,
    record: 'max',
    compute(games) {
      const levels = outcomes(games).map((o) => num(o, 'topLevel') ?? 0);
      const best = levels.length ? Math.max(...levels) : 0;
      return best >= 5 ? { value: best, text: `Clearest sight: level ${best}` } : null;
    },
  },
];

/** One line per hour: "Hour 2: 3 of 4 found their card". */
function history(g: GameEvents): string[] {
  const byHour = new Map<number, { right: number; all: number }>();
  for (const e of g.of('guess')) {
    const h = num(e, 'hour');
    if (h === undefined) continue;
    const t = byHour.get(h) ?? { right: 0, all: 0 };
    t.all += 1;
    if (bool(e, 'correct')) t.right += 1;
    byHour.set(h, t);
  }
  const lines = [...byHour]
    .sort((a, b) => a[0] - b[0])
    .map(([h, t]) => `Hour ${h}: ${t.right} of ${t.all} found their card`);
  const o = outcomeOf(g);
  const how = str(o, 'how');
  if (how === 'culprit') lines.push('The vote found the culprit');
  else if (how === 'wrong' || how === 'no-votes') lines.push('The vote missed the culprit');
  else if (how === 'clock') lines.push('The clock ran out');
  return lines;
}

export const seanceAwards: AwardModule = { rules: SEANCE_RULES, nuggets, history, stripSize: 3 };
