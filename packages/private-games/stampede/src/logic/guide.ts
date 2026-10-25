import {
  type GameGuide,
  type GuideContext,
  type GuideFooter,
  type GuideOption,
  shapeGuide,
} from '@vt/game-sdk';
import { type Manifest, footerOf, namesOf } from './manifest.ts';
import { type Names, PLACEHOLDER_NAMES, fillNames } from './names.ts';
import type { StampedeView } from './types.ts';

export { type Manifest, footerOf, namesOf } from './manifest.ts';

const HOLDER_PICKS: GuideOption = { key: 'holderPicks', label: 'Holder picks' };
const SHARED_WIN: GuideOption = { key: 'sharedWin', label: 'Shared win' };
const SKIP: GuideOption = { key: 'skip', label: 'Skip a question' };
const STRICT: GuideOption = { key: 'strict', label: 'Strict timer' };

/** Every string in the guide with its name tokens filled. */
function fill<T>(value: T, names: Names): T {
  if (typeof value === 'string') return fillNames(value, names) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => fill(v, names)) as T;
  if (value && typeof value === 'object' && typeof value !== 'function') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, typeof v === 'function' ? v : fill(v, names)]),
    ) as T;
  }
  return value;
}

const text: GameGuide = {
  tagline:
    'Answer odd questions the way everyone else will. Match the herd to win {cows}; stand alone and you get the {pink}.',
  players: '3 to 20 (best with 5 or more)',
  duration: '20–30 minutes',
  goal: 'Be the first to collect enough {cows} (8, unless the host chose 5 or 10) without holding the {pink}. You win a {cow} each time your answer is the one most people gave.',
  quickStart: [
    'Everyone sees the same question. There is no right answer.',
    'Write the answer you think most people will give. Nobody sees it yet.',
    'Answers that say the same thing are grouped; the host checks the groups.',
    'The biggest group is the herd: each of its players wins a {cow}. A tie for biggest scores nobody.',
    'The only player alone with their answer takes the {pink}. You can’t win while you hold it.',
    'First to the target with no {pink} wins.',
  ],
  setup: [
    'Up to 20 players can play; anyone else in the room watches. Use “Sit out (watch)” to sit out, and “Take a seat” to play again.',
    'The host picks the question decks, the target (5, 8 or 10 {cows}), an optional answer timer and the house rules.',
    'The host presses Start. You need at least 3 players.',
  ],
  sections: [
    {
      title: 'A round, step by step',
      bullets: [
        'Everyone sees the same question. Write the answer you think most people will give: one or two words is best, and at most 30 characters.',
        'Nobody sees what you wrote, only a tick that you have answered. You can change your answer until the last one is in.',
        'Answers that are the same apart from capitals, accents, punctuation, plurals and a leading “a”, “an” or “the” are grouped together automatically.',
        'The host checks the groups and joins answers that mean the same thing (“Coke” and “Coca-Cola”), or splits ones that don’t. Then the host reveals them to everyone.',
        'The {cows} are handed out and the host moves on to the next question.',
      ],
    },
    {
      title: 'Winning {cows}',
      bullets: [
        'The herd is the single biggest group of matching answers. Everyone in it wins one {cow}.',
        'It only needs to be the biggest, not more than half: with 3 “dime”, 2 “nickel” and 1 “quarter”, the 3 score.',
        'If two or more groups tie for biggest, nobody scores that round.',
        'A herd needs at least 2 players: if every answer is different, nobody scores.',
        'If everyone gives the same answer, everyone scores.',
        'Nobody checks whether an answer is “right”. If the herd says it, it counts.',
      ],
    },
    {
      title: 'The {pink}',
      bullets: [
        'If exactly one player gave an answer nobody else gave, they take the {pink} from whoever holds it (at the start it sits in the middle).',
        'With two or more answers on their own, or none, the {pink} stays where it is.',
        'This happens even when the biggest groups tie: with 2 “soup”, 2 “yogurt” and 1 “toast”, nobody scores, but “toast” takes the {pink}.',
        'While you hold the {pink} you still win {cows}, but you can’t win the game. The only way to get rid of it is for someone else to be the odd one out.',
        'A blank or late answer matches nothing and never counts as being alone, so it can’t hand you the {pink}.',
        'If only one player answered at all, there’s no herd, and that one answer is alone: it takes the {pink}.',
      ],
    },
    {
      title: 'Winning the game',
      bullets: [
        'At the end of each round, look at the players who don’t hold the {pink} and have reached the target. If one of them has the most {cows}, they win.',
        'If several of them tie for the most, the target goes up to one more than their score and the game carries on until one player leads.',
        'A player holding the {pink} at or above the target wins later, at the end of a round where they’ve passed it on and lead the others who have reached it.',
      ],
    },
    {
      title: 'Checking the answers',
      bullets: [
        'Only the host sees the answers while they are being checked, and every change the host makes is listed for everyone at the reveal (“Joined Coke into Coca-Cola”).',
        'Answers that look like a typo of each other (“flower” and “flowr”) are suggested to the host, never joined by themselves.',
        'Tap an answer to move it into another group or onto its own. “Undo my changes” brings back the automatic groups.',
        'If the host is away for a while, another player becomes host and takes over the checking.',
      ],
    },
    {
      title: 'Moo!',
      bullets: [
        'Once you have answered, you can moo at the players still writing. They hear about it on their screen. Moo once every few seconds at most.',
      ],
    },
    {
      title: 'Skipping a question',
      option: SKIP,
      bullets: [
        'On by default. While answers are being written, the host may swap the question for another one, once a round. Answers written so far are cleared.',
      ],
    },
    {
      title: 'House rule: the holder picks',
      option: HOLDER_PICKS,
      bullets: [
        'Off by default. When two or more players are alone with their answer, the player holding the {pink} picks which of them takes it (30 seconds, then it’s picked at random).',
        'If the holder is one of them, they must pass it to another. If it is still in the middle, nobody picks and it stays there.',
      ],
    },
    {
      title: 'House rule: shared win',
      option: SHARED_WIN,
      bullets: [
        'Off by default. Players who tie for the most {cows} at the target share the win instead of raising the target.',
      ],
    },
    {
      title: 'Timers',
      level: 'edge',
      bullets: [
        'The host can set a time to answer. By default it is just a reminder: once it runs out the host can “Continue without” anyone still writing.',
        'With a strict timer, time running out locks the answers: anyone still writing has no answer that round.',
        'The holder’s pick (house rule) always has 30 seconds.',
      ],
    },
    {
      title: 'Coming and going',
      level: 'edge',
      bullets: [
        'Players who join during a game watch until the next question, then play from 0 {cows}.',
        'A player who leaves takes their answer with them until the reveal. Their {cows} stay on the scoreboard, but they can’t win. If they held the {pink}, it goes back to the middle.',
        'If fewer than 3 players are left, the game ends with no winner.',
        'If the host abandons a game, everyone goes back to the lobby.',
      ],
    },
  ],
  tips: [
    'Don’t give your own favourite: give the one you think most people at this table will give.',
    'The obvious answer is usually the herd’s. Clever answers tend to end up alone.',
    'Holding the {pink}? Play it safe until someone else ends up on their own.',
  ],
  glossary: [
    {
      term: 'Herd',
      meaning: 'The single biggest group of matching answers; its players win a {cow}.',
    },
    {
      term: 'Odd one out',
      meaning: 'The only player whose answer nobody else gave: they take the {pink}.',
    },
    {
      term: 'Target',
      meaning: 'The {cows} needed to win: 5, 8 or 10, raised after a tie at the top.',
    },
  ],
};

function base(): GameGuide {
  return shapeGuide(text, {
    steps: [
      ['One question for everyone', '❓'],
      ['Write a secret answer', '✍️'],
      ['The host checks the groups', '🧐'],
      ['The herd wins {cows}', '🐄'],
      ['Alone? Take the {pink}', '🩷'],
      ['Reach the target', '🏆'],
    ],
    levels: {
      'A round, step by step': 'basics',
      'Winning {cows}': 'basics',
      'The {pink}': 'basics',
      'Winning the game': 'basics',
      'Checking the answers': 'details',
      'Moo!': 'details',
      'Skipping a question': 'edge',
      'House rule: the holder picks': 'edge',
      'House rule: shared win': 'edge',
    },
    tiles: {
      label: '{Cows}',
      blurb: 'The {cow}, the {pink}, the herd and the odd one out',
      intro: 'Everything that scores. Tap one to read it.',
      shape: 'square',
      items: [
        {
          id: 'cow',
          name: '{Cow}',
          icon: '🐄',
          tone: 'good',
          text: 'One for each player in the herd, every round. Collect enough to win.',
          meta: 'One per round at most',
        },
        {
          id: 'pink',
          name: '{pink}',
          icon: '🩷',
          tone: 'evil',
          text: 'Taken by the only player alone with their answer. You keep winning {cows} while you hold it, but you can’t win the game.',
          meta: 'Only one in the game',
        },
        {
          id: 'herd',
          name: 'The herd',
          icon: '🐮',
          tone: 'good',
          text: 'The single biggest group of matching answers, of 2 or more. A tie for biggest means no herd that round.',
        },
        {
          id: 'alone',
          name: 'Odd one out',
          icon: '🐺',
          tone: 'neutral',
          text: 'An answer nobody else gave. If it’s the only one, its player takes the {pink}.',
        },
      ],
    },
    reference: [
      {
        title: 'Who gets what',
        head: ['The answers', '{Cows}', '{pink}'],
        rows: [
          ['One biggest group (2+)', 'Its players, 1 each', '—'],
          ['Biggest groups tie', 'Nobody', '—'],
          ['Exactly one answer alone', '—', 'Moves to that player'],
          ['Two or more alone, or none', '—', 'Stays put'],
          ['Everyone matches', 'Everyone', '—'],
          ['Blank or late', 'Nothing', 'Never'],
        ],
        note: 'The {pink} part happens even when the biggest groups tie.',
      },
    ],
  });
}

/** The guide in the given names, with the credits when there are some. */
export function makeGuide(names: Names = PLACEHOLDER_NAMES, footer?: GuideFooter): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as StampedeView;
    if (!v?.settings) return undefined;
    const s = v.settings;
    const options = [
      ...(s.skip ? [SKIP.key] : []),
      ...(s.holderPicks ? [HOLDER_PICKS.key] : []),
      ...(s.sharedWin ? [SHARED_WIN.key] : []),
      ...(s.timerMode === 'strict' && s.answerSeconds !== null ? [STRICT.key] : []),
    ];
    const rules = [s.holderPicks && 'holder picks', s.sharedWin && 'shared win'].filter(Boolean);
    return {
      summary: `First to ${v.target} ${names.cows}${rules.length ? ` · ${rules.join(', ')}` : ''}`,
      options,
      inGame: { cow: 1, pink: 1, herd: 1, alone: 1 },
    };
  };
  return { ...fill(base(), names), ...(footer && { footer }), room };
}

/** The guide with the placeholder names, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

/** The guide in the manifest's names, with the credits. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = (manifest && typeof manifest === 'object' ? manifest : null) as Manifest | null;
  return makeGuide(namesOf(m), footerOf(m));
}
