import { type GameGuide, type GuideContext, type GuideFooter, shapeGuide } from '@vt/game-sdk';
import {
  type Names,
  PLACEHOLDER_NAMES,
  asManifest,
  fillNames,
  footerOf,
  namesOf,
} from './manifest.ts';
import { DUMMY, EPILOGUE, type MissionControlView } from './types.ts';

// Written with name tokens ({trump}, {captain}, {token}…), filled from the private manifest, with
// plain words as the fallback.

const base: GameGuide = {
  tagline: 'A cooperative trick-taking campaign: win the right tricks together, in near silence.',
  players: '3 to 5 (2 with {dummy}, best with 3 to 5)',
  duration: '5–20 minutes a mission',
  goal: 'Complete every mission of the campaign as a crew. A mission is done when every task is met: each task says which tricks or cards its holder must (or must not) win. You can’t talk about your cards; one {token} each lets you show a single card.',
  quickStart: [
    'Read the mission briefing together, then the cards are dealt. Whoever holds the 4 {trump} is the {captain}.',
    'Tasks are drawn and shared out: the {captain} picks first, then round the table. Talk about tasks, never about your cards.',
    'Play tricks: follow the colour that was led if you can, else play anything. A {trump} beats every colour; the highest card wins.',
    'A task is done when its holder wins what it asks for. The mission fails the moment any task can no longer be met.',
    'Once per attempt you may signal: show one colour card and say if it is your highest, only or lowest of that colour.',
    'Failed? Retry in one tap with the same tasks or new ones. Every attempt goes in the logbook.',
  ],
  setup: [
    'Two to five players sit down; anyone else watches. With two players {dummy} joins as a third crew member, played by the {captain}.',
    'The host picks the mission from the logbook (the next one by default) and presses Start.',
    'All 40 cards are dealt: four colours valued 1 to 9 and four {trumps} valued 1 to 4. With three players one player gets an extra card, which stays unplayed after the last trick.',
  ],
  sections: [
    {
      title: 'Tricks',
      bullets: [
        'The {captain} leads the first trick. The winner of each trick leads the next, and play goes round the table.',
        'Follow the colour that was led if you can. If you can’t, play anything, a {trump} included. The app lights up only the cards you may play.',
        'The highest card of the led colour wins, unless a {trump} was played: then the highest {trump} wins. A {trump} led must be followed with a {trump} if you have one.',
        'Nobody has to win, or to play a {trump} when out of a colour. Any card may be led at any time.',
      ],
    },
    {
      title: 'Tasks',
      bullets: [
        'Each task belongs to one crew member. “Win the pink 3” means its holder must win the trick with the pink 3 in it, whoever played it.',
        'A task is done once it is met and can no longer fail; it is stamped ✓ with who fed it the cards.',
        'As soon as any task can no longer be met, the attempt fails, and the app tells you why.',
        'Tasks are drawn until their difficulty adds up to the mission’s number. Some tasks name a number of tricks you predict before the first trick; a secret prediction stays hidden until the end.',
      ],
    },
    {
      title: 'Sharing out the tasks',
      bullets: [
        'The {captain} takes a task first, then round the table one at a time, until all are taken.',
        'With fewer tasks than players you may pass, as long as everyone left can still take one. Otherwise nobody passes.',
        'The {captain} never takes a task that compares with the {captain}.',
        'You may talk about the tasks (“who wants the first trick?”) but never about your cards.',
      ],
    },
    {
      title: 'Signals',
      bullets: [
        'Once per attempt, between tricks (never during one), you may show one colour card from your hand. It is your highest, your only or your lowest card of that colour, and you say which. {Trumps} are never signalled.',
        'The card stays face up in front of you and is played later as usual. Its position is never updated, even when it stops being true.',
        'Press Signal: only the cards you may show are lit, each with the positions that are true. If someone wants to signal before a trick starts, they can ask the leader to wait.',
      ],
    },
    {
      title: 'Talking',
      paragraphs: [
        'You may not share anything you only know from your own hand. During the draft and free selection you may talk about tasks. During play the table is silent: there is no chat, only a few emotes after each trick. With the Open table house rule the banners say you may talk freely.',
      ],
    },
    {
      title: '{Distress}',
      bullets: [
        'Before the first signal of an attempt, the crew may agree to send a {distress}: everyone passes one card (never a {trump}) to the same neighbour, left or right.',
        'Anyone proposes a direction; it goes ahead only when everyone agrees.',
        'It adds one attempt to the mission in the logbook, once per mission, and stays available for every further attempt at that mission.',
      ],
    },
    {
      title: 'Mission rules',
      bullets: [
        'Currents: a signalled card is shown without saying whether it is the highest, only or lowest.',
        'Shared tokens: there are no tokens of your own, but two fewer shared ones than players. Anyone may take one and signal at once, several times if tokens are left.',
        'Unfamiliar terrain: a random colour card decides this attempt’s signals: 1–3 as usual, 4–6 currents, 7–9 shared tokens.',
        'No signals before trick N: the mission says from which trick signals open.',
        'Free selection: talk and take any tasks you like, unevenly if you want; when every task has a holder, everyone presses Ready.',
        'All to one: the crew agrees who takes every task.',
        'One (or two) crew members wanted: the {captain} asks round the table, the first yes takes every task (two: the first two yeses share them, at least one each). If everyone before says no, the last asked must take them.',
        'The {captain} offers: the others answer yes or no in turn, then the {captain} keeps every task or gives them all to one who said yes. If given away, every signal must be made before the first trick.',
        'The {captain} skips: the {captain} gets no task. Hardest first: the {captain} must first take the hardest task on show.',
        'Real time: once the tasks are shared, a clock starts; if it runs out, the attempt fails. With the host’s real-time option off, the mission plays its printed alternative instead.',
        'Missions without tasks give the whole crew a condition instead, shown as a crew task.',
      ],
    },
    {
      title: 'Retries and the logbook',
      bullets: [
        'After a failure, press Retry same tasks or New tasks: the cards are dealt again and the tasks shared out again. Each attempt counts in the logbook.',
        'After a success, the logbook stamps the mission and the next one is briefed.',
        'The campaign belongs to the room’s crew: any 3 to 5 of you can carry on, and “Same crew, new game” takes it to a new room. Missions out of order can be played as practice; practice doesn’t change the attempt counts.',
        'After the last mission comes the endless epilogue: difficulty rises by one with each success.',
        'After every attempt, the replay shows every hand and every trick, with the failing trick marked.',
      ],
    },
    {
      title: 'Table rulings',
      bullets: [
        '“Win a trick with a 2” (or a 3, 5, 6…) means a colour card of that value: a {trump} of that value doesn’t count.',
        'Two players: when the crew sends a {distress}, the {captain} picks one of {dummy}’s face-up cards (never a {trump}) to pass, and the card it receives lands face up in that spot.',
        'When the {captain} offers the tasks, the others answer yes or no in order, out loud for all; the {captain} then keeps them or gives them to one who said yes.',
        'Two tasks that no allocation could meet together are put back and replaced by one of the same difficulty, as are pairs only one player could meet when nobody can hold two. A task’s printed re-deal rule deals the cards again by itself.',
        'With three players, the extra card is never played: a task that needs it fails.',
      ],
    },
    {
      title: 'Two players and {dummy}',
      bullets: [
        '{Dummy} has 14 cards: 7 face down with 7 face up on top. It plays only face-up cards; a face-down card turns over once the card on it has been played, after the trick.',
        'The 4 {trump} is set aside before {dummy}’s rows are dealt, so a player is always {captain}. The {captain} picks {dummy}’s tasks and plays its cards; the other player may not discuss it.',
        '{Dummy} has no {token}. Difficulties are the three-player ones. The host chooses where {dummy} sits.',
      ],
    },
    {
      title: 'Host options',
      bullets: [
        'All played cards (on by default): everyone can look back at every trick. Off, only the last trick can be seen, as on the table.',
        'Real-time missions (on by default): off, they play their printed alternative.',
        'Open table (off by default): a house rule for groups that talk freely; only the banners change.',
      ],
    },
    {
      title: 'Coming and going',
      bullets: [
        'If a crew member leaves during an attempt, it stops and doesn’t count. The campaign stays with the room.',
        'People who join watch until the next mission starts in the lobby.',
      ],
    },
  ],
  tips: [
    'Lead the colour of a teammate’s task card when you can’t win it yourself but they might.',
    'Signal early: a signal before the first trick tells the most.',
    'Watch what others discard when they’re out of a colour.',
    'Keep high {trumps} for tricks that matter, and use a low {trump} to win a colour you’re out of.',
  ],
  glossary: [
    {
      term: '{Captain}',
      meaning: 'Whoever holds the 4 {trump}: leads the first trick and picks the first task.',
    },
    {
      term: 'Task',
      meaning: 'A condition one crew member must meet, such as winning a certain card.',
    },
    {
      term: 'Signal',
      meaning:
        'Showing one colour card with its position (highest, only, lowest), once per attempt.',
    },
    {
      term: '{Distress}',
      meaning: 'Everyone passes one card to a neighbour, at the cost of one attempt.',
    },
    { term: 'Difficulty', meaning: 'The total the drawn tasks add up to for your table size.' },
  ],
};

const shaped = (footer?: GuideFooter): GameGuide =>
  shapeGuide(base, {
    steps: [
      ['The briefing', '📜'],
      ['Share the tasks', '🧭'],
      ['Play tricks', '🃏'],
      ['Meet every task', '✅'],
      ['One signal each', '📡'],
      ['Retry, log, go on', '📘'],
    ],
    levels: {
      Tricks: 'basics',
      Tasks: 'basics',
      'Sharing out the tasks': 'basics',
      Signals: 'basics',
      Talking: 'details',
      '{Distress}': 'details',
      'Mission rules': 'details',
      'Retries and the logbook': 'details',
      'Table rulings': 'edge',
      'Two players and {dummy}': 'edge',
      'Host options': 'edge',
      'Coming and going': 'edge',
    },
    options: {
      'Two players and {dummy}': { key: 'dummy', label: 'Two players' },
    },
    reference: [
      {
        title: 'Signals',
        head: ['Position', 'Means'],
        rows: [
          ['▲ top', 'my highest card of this colour'],
          ['● only', 'my only card of this colour'],
          ['▼ bottom', 'my lowest card of this colour'],
          ['? (currents)', 'one of the three, not saying which'],
        ],
      },
      {
        title: 'Table sizes',
        head: ['Crew', 'Cards each', 'Tricks'],
        rows: [
          ['2 + {dummy}', '13 (+14 for {dummy})', '13'],
          ['3', '14, 13, 13', '13'],
          ['4', '10', '10'],
          ['5', '8', '8'],
        ],
      },
      {
        title: 'Unfamiliar terrain',
        head: ['Card drawn', 'Signals'],
        rows: [
          ['1–3', 'as usual'],
          ['4–6', 'currents'],
          ['7–9', 'shared tokens'],
        ],
      },
    ],
    ...(footer && { footer }),
  });

/** Deep-fills name tokens in every string of the guide. */
function fill<T>(value: T, names: Names): T {
  if (typeof value === 'string') return fillNames(value, names) as T;
  if (Array.isArray(value)) return (value as unknown[]).map((v) => fill(v, names)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        typeof v === 'function' ? v : fill(v, names),
      ]),
    ) as T;
  }
  return value;
}

/** The guide with the theme's names (and the credit, when there is one). */
export function makeGuide(names: Names = PLACEHOLDER_NAMES, footer?: GuideFooter): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as MissionControlView;
    if (!v?.settings) return undefined;
    const crew = v.attempt?.crew.length ?? v.seats.filter((s) => s.playing).length;
    const two = v.attempt ? v.attempt.crew.some((c) => c.id === DUMMY) : crew === 2;
    const m = v.attempt?.mission;
    const mission = m ? (m.n === EPILOGUE ? 'the epilogue' : `mission ${m.n}`) : null;
    const parts = [
      `${two ? '2 players + {dummy}' : `${crew} players`}`,
      ...(mission ? [mission] : []),
      v.settings.playedCards ? 'all played cards shown' : 'last trick only',
      ...(v.settings.realTime ? [] : ['no real-time clocks']),
    ];
    return {
      summary: fillNames(parts.join(' · '), names),
      options: [...(two ? ['dummy'] : [])],
    };
  };
  return { ...fill(shaped(footer), names), room };
}

/** The guide without the manifest. */
export const guide: GameGuide = makeGuide();

/** The guide with the manifest's names and credit. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = asManifest(manifest);
  return makeGuide(namesOf(m), footerOf(m));
}
