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
  ph,
  plain,
  str,
  tally,
} from '@vt/game-sdk';

const conspirators = (g: GameEvents) => g.of('conspirator').filter((e) => e.playerId);
/** Votes by Detectives (the Conspirator's own vote is a bluff, not a guess). */
const detectiveVotes = (g: GameEvents) =>
  g.of('vote').filter((e) => e.playerId && bool(e, 'asConspirator') !== true);

const rules: AwardRule[] = [
  {
    id: 'red-herring.blend-in',
    emoji: '🫥',
    title: 'Perfect Blend-in',
    valence: 'glory',
    weight: 5,
    kind: 'award',
    family: 'bluff',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} bluffed blind {n} times and drew no vote',
        '{who}: no word, no votes, {n} times. Unsettling',
      ],
      wholesome: [
        '{who} blended in perfectly {n} times',
        'Not one vote landed on {who} as Conspirator: {n} times',
      ],
    },
    compute: (g) =>
      leaders(tally(conspirators(g).filter((e) => num(e, 'against') === 0)), { min: 1 }),
  },
  {
    id: 'red-herring.escape',
    emoji: '🐟',
    title: 'Slippery Fish',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'bluff',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} slipped away as Conspirator {n} times',
        '{who} got away with it {n} times. Keep an eye on them',
      ],
      wholesome: [
        '{who} escaped {n} times without a word to go on',
        '{who} kept a straight face {n} times and got away',
      ],
    },
    compute: (g) =>
      leaders(tally(conspirators(g).filter((e) => bool(e, 'caught') === false)), { min: 2 }),
  },
  {
    id: 'red-herring.sharp',
    emoji: '🔍',
    title: 'Sharpest Detective',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'detect',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} found the Conspirator {n} times. Nothing gets past them',
        '{who} sniffed out {n} Conspirators. Bit scary',
      ],
      wholesome: ['{who} spotted the Conspirator {n} times', '{who} saw through {n} bluffs'],
    },
    compute: (g) =>
      leaders(tally(detectiveVotes(g).filter((e) => bool(e, 'right') === true)), { min: 2 }),
  },
  {
    id: 'red-herring.suspect',
    emoji: '🙈',
    title: 'Usual Suspect',
    wholesomeTitle: 'Wrongly Accused',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'suspect',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} drew {n} votes while knowing the word',
        '{who} had the word and still got {n} votes',
      ],
      wholesome: [
        '{who} was innocent and still drew {n} votes',
        '{who} played bold cards that got {n} votes',
      ],
    },
    compute: (g) => {
      // Votes that landed on a Detective (never the word-picker: nobody may accuse them).
      const conspiratorOf = new Map(
        g.of('round').map((e) => [num(e, 'round'), str(e, 'conspirator')]),
      );
      const wrong = g
        .of('vote')
        .filter((e) => bool(e, 'right') === false && conspiratorOf.get(num(e, 'round')));
      return leaders(
        tally(wrong, (e) => str(e, 'target')),
        { min: 3 },
      );
    },
  },
  {
    id: 'red-herring.misled',
    emoji: '🎣',
    title: 'Took the Bait',
    wholesomeTitle: 'Trusting Soul',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'detect',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} accused the wrong player {n} times', '{who} chased {n} red herrings'],
      wholesome: [
        '{who} gave the Conspirator {n} lucky breaks',
        '{who} trusted the wrong face {n} times',
      ],
    },
    compute: (g) =>
      leaders(tally(detectiveVotes(g).filter((e) => bool(e, 'right') === false)), { min: 3 }),
  },
  {
    id: 'red-herring.wordsmith',
    emoji: '🖋️',
    title: 'Wordsmith',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'word',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} picked words that won {n} points',
        '{who} hid {n} points of mischief in a word',
      ],
      wholesome: [
        '{who} chose words worth {n} points',
        '{who} gave their partner in crime {n} points of cover',
      ],
    },
    compute: (g) =>
      leaders(
        tally(
          g.of('round'),
          (e) => e.playerId,
          (e) => num(e, 'pickerPoints') ?? 0,
        ),
        { min: 4 },
      ),
  },
  {
    id: 'red-herring.unanimous',
    emoji: '🚨',
    title: 'Caught Red-Handed',
    valence: 'gentle',
    weight: 3,
    kind: 'moment',
    minPlayers: 4,
    copy: {
      cheeky: [
        'All {n} Detectives pointed at {who} at once',
        '{who} got every Detective’s vote: {n} of {n}',
      ],
      wholesome: [
        'The whole table found {who}: {n} votes',
        '{who} was found by all {n} Detectives together',
      ],
    },
    compute: (g) => {
      const full = conspirators(g).filter((e) => {
        const voters = num(
          g.of('round').find((r) => num(r, 'round') === num(e, 'round')),
          'voters',
        );
        // Every voter but the Conspirator themself.
        return voters !== undefined && voters >= 3 && num(e, 'against') === voters - 1;
      });
      const last = full.at(-1);
      return last ? [{ players: [last.playerId!], value: num(last, 'against') ?? 0 }] : [];
    },
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'red-herring.caught',
    emoji: '🔍',
    interest: 1,
    compute: (games) => {
      const n = games.flatMap((g) => g.of('round')).filter((e) => bool(e, 'caught')).length;
      return n ? { value: n, text: `${count(n, 'Conspirator')} caught` } : null;
    },
  },
  {
    id: 'red-herring.escaped',
    emoji: '🐟',
    interest: 2,
    compute: (games) => {
      const n = games
        .flatMap((g) => g.of('round'))
        .filter((e) => bool(e, 'caught') === false).length;
      return n ? { value: n, text: `${count(n, 'Conspirator')} got away` } : null;
    },
  },
  {
    id: 'red-herring.no-votes',
    emoji: '🫥',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const n = games
        .flatMap((g) => g.of('conspirator'))
        .filter((e) => num(e, 'against') === 0).length;
      return n ? { value: n, text: `Conspirators with no votes at all: ${n}` } : null;
    },
  },
];

function history(g: GameEvents): string[] {
  return g.of('round').map((e: RecapEvent) => {
    const who = str(e, 'conspirator');
    const caught = bool(e, 'caught');
    return [
      `Round ${num(e, 'round') ?? '?'}: "${plain(str(e, 'word') ?? '…')}"`,
      who ? `${ph.p(who)} ${caught ? 'was caught' : 'got away'}` : '',
    ]
      .filter(Boolean)
      .join(', ');
  });
}

/** Red Herring's awards for the night recap, read from its own `insights` events. */
export const redHerringAwards: AwardModule = { rules, nuggets, history, stripSize: 3 };
