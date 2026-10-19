import type { GameGuide, GuideContext, GuideFooter, GuideOption, GuideTile } from '@vt/game-sdk';
import { type Manifest, footerOf, namesOf } from './manifest.ts';
import { type Names, PLACEHOLDER_NAMES, fillNames } from './names.ts';
import type { ThornsView } from './types.ts';

export { type Manifest, footerOf, namesOf } from './manifest.ts';

/** Art for the guide, from the private manifest (the first set's discs). */
export interface GuideArt {
  rose?: string;
  thorn?: string;
  back?: string;
  mat?: string;
  chance?: string;
}

const CHANCE: GuideOption = { key: 'lastChance', label: '{Chance}' };

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

function base(art: GuideArt): GameGuide {
  const tiles: GuideTile[] = [
    {
      id: 'rose',
      name: '{Rose}',
      icon: '🌹',
      text: 'Three of your four discs. When a Challenger turns one over, the challenge goes on.',
      meta: '×3 per player',
      tone: 'good',
      ...(art.rose && { art: art.rose }),
    },
    {
      id: 'thorn',
      name: '{Thorn}',
      icon: '💀',
      text: 'Your one {thorn}. When a Challenger turns it over, the challenge stops at once and they lose a disc.',
      meta: '×1 per player',
      tone: 'evil',
      ...(art.thorn && { art: art.thorn }),
    },
    {
      id: 'mat',
      name: 'Mat',
      icon: '🟫',
      text: 'Where you stack your discs. Win a challenge and it turns over to its scored side; win a second and you win the game.',
      meta: 'One per player',
      tone: 'neutral',
      ...(art.mat && { art: art.mat }),
    },
    {
      id: 'chance',
      name: '{Chance}',
      icon: '🍀',
      text: 'Lent to a Challenger who fails and is left with one disc: a known {rose} for the next round only. Fail as Challenger while holding it and you lose both, and you are out.',
      meta: 'One for the table · once per player per game',
      tone: 'own',
      option: CHANCE,
      ...(art.chance && { art: art.chance }),
    },
  ];
  return {
    tagline: 'Hide a {thorn} among your {roses}, bid on how many you can turn over, and bluff.',
    players: '3 to 6',
    duration: '15 minutes',
    goal: 'Win two challenges, or be the last player left. A challenge is a bid that you can turn over that many discs without finding a {thorn}.',
    quickStart: [
      'Everyone has three {roses} and one {thorn}. Each round, everyone puts one disc face down at once.',
      'In turn, add another disc to your stack, or start the bidding: how many discs can you turn over without a {thorn}?',
      'Others raise or pass. The last bidder standing is the Challenger and turns over that many discs, their own first.',
      'All {roses}: the Challenger scores. Two points wins the game.',
      'A {thorn}: the challenge fails and the Challenger loses a disc for good. Lose all four and you’re out.',
      'Bluff: a {thorn} on your mat stops whoever bids past it.',
    ],
    steps: [
      {
        title: 'Four discs each',
        text: 'Three {roses} and one {thorn}, all with the same back. Only you know which disc is which.',
        icon: '🌹',
        ...(art.rose && { art: art.rose }),
      },
      {
        title: 'Everyone puts one down',
        text: 'Each round starts with everyone putting one disc face down on their mat, all at once.',
        icon: '🫳',
        ...(art.back && { art: art.back }),
      },
      {
        title: 'Add a disc or bid',
        text: 'In turn, add another disc to your stack, or bid how many discs you can turn over without hitting a {thorn}. Others raise or pass.',
        icon: '🗣️',
      },
      {
        title: 'Turn them over',
        text: 'The highest bidder is the Challenger: they turn over their own discs first, top down, then pick from the tops of other stacks.',
        icon: '🔄',
      },
      {
        title: 'Why play your {thorn}?',
        text: 'A {thorn} under a {rose} or two stops anyone who bids high, and costs them a disc. Bid with a {thorn} down and others think you have {roses}.',
        icon: '💀',
        ...(art.thorn && { art: art.thorn }),
      },
      {
        title: 'Two points, or last one in',
        text: 'Make two challenges to win. Fail and you lose a disc at random; lose them all and you are out.',
        icon: '🏆',
        ...(art.mat && { art: art.mat }),
      },
    ],
    stepsDone: 'Tap 📖 Rules any time to read the details.',
    setup: [
      'Everyone sits down; 3 to 6 can play, others can watch. The first player is picked at random.',
      'Everyone gets a mat, three {roses} and one {thorn}. The app keeps your discs; only you see yours.',
    ],
    sections: [
      {
        title: 'A round',
        level: 'basics',
        bullets: [
          'Everyone puts one disc face down on their mat, all at once.',
          'Then, in turn from the first player: put one more disc on top of your stack, or open the bidding with a number.',
          'With no discs left in hand you must open the bidding. The app only offers what you may do.',
          'Once anyone has bid, nobody adds discs for the rest of the round.',
        ],
      },
      {
        title: 'Bidding',
        level: 'basics',
        bullets: [
          'A bid is how many discs you say you can turn over without a {thorn}: at least 1, at most every disc on the mats.',
          'In turn, raise by any amount, or pass. A pass is for the rest of the round, but your discs stay in play.',
          'When everyone else has passed, or someone bids every disc on the mats, the highest bidder becomes the Challenger.',
        ],
      },
      {
        title: 'Turning discs over',
        level: 'basics',
        bullets: [
          'The Challenger turns over as many discs as they bid, one at a time.',
          'Their own stack comes first, from the top, but only as many as the bid needs.',
          'Then they pick the top face-down disc of any other stack, switching between stacks as they like.',
          'A {thorn} stops the challenge at once. Discs not turned over stay secret.',
        ],
      },
      {
        title: 'Winning and losing a challenge',
        level: 'details',
        bullets: [
          'All {roses}: the Challenger’s mat turns to its scored side. With it already turned, they win the game.',
          'Someone else’s {thorn}: the Challenger loses one of their discs at random, from all of them.',
          'Their own {thorn}: they choose which disc to lose.',
          'Only the loser knows which disc they lost; everyone sees how many discs they have left.',
          'A player who loses their last disc is out. The last player left wins.',
          'A {thorn} that was its owner’s last disc knocks its owner out when it is turned over (not while they hold the {chance}).',
          'After a failed challenge, anyone may tap Show my stack to turn their own stack face up, to show off a bluff.',
        ],
      },
      {
        title: 'Who starts the next round',
        level: 'details',
        bullets: [
          'The Challenger starts the next round, won or lost.',
          'If the Challenger is out because of someone else’s {thorn}, that {thorn}’s owner starts. If that owner went out too, the next player after them starts.',
          'If the Challenger knocked themselves out on their own {thorn}, they name who starts (30 seconds, or it is the next player still in).',
          'If the last two players both go out on the same {thorn}, its owner wins.',
          'Everyone takes their discs back between rounds.',
        ],
      },
      {
        title: 'The {chance}',
        level: 'details',
        option: CHANCE,
        bullets: [
          'On by default; the host can switch it off in the lobby.',
          'A Challenger who fails and is left with one disc gets the {chance} for the next round only, so they hold two discs.',
          'Everyone knows it is a {rose}: it is marked on the mat where it was put down.',
          'Fail as Challenger while holding it and you lose it and your last disc together: you are out.',
          'While you hold it you have two discs, so if someone turns over your {thorn} that round, you are safe. Once you are back to one disc, a revealed last {thorn} knocks you out as usual.',
          'Each player can only get it once a game. At the end of the round it goes back for the next player who needs it.',
        ],
      },
      {
        title: 'Timers',
        level: 'edge',
        bullets: [
          'The host can set a time for each decision. By default it is a reminder, and the host may tap Act for to move for a player.',
          'In Strict mode, nobody’s disc is put down for them except the first disc of a round, which is picked at random from their hand. Before any bid, a player out of time opens the bidding at 1; in the bidding, they pass; as Challenger, they turn over their own disc while it must be turned, then the top disc of the next stack clockwise; a disc to lose is picked at random, and the next player is named to start. The log marks those moves with ⏱.',
        ],
      },
      {
        title: 'Coming and going',
        level: 'edge',
        bullets: [
          'Players joining during a game watch, and are seated at the next one if there is room.',
          'Someone who leaves mid-game stays in, marked away: they are skipped when discs go down and in the bidding (a skipped bidder has passed for that round), and their discs stay on the mat, where they can be turned over. If they come back, they carry on.',
          'An away Challenger is waited for (a strict timer moves for them). The host can remove a player who left: if their discs were in play, the round starts again with nobody scoring or losing a disc; once a {thorn} has been hit, the round finishes first. If only one player is left, they win.',
        ],
      },
    ],
    tiles: {
      label: 'Discs',
      blurb: '{Roses}, {thorns}, mats and the {chance}',
      intro: 'Everything on the table. Tap one to read it.',
      shape: 'square',
      items: tiles,
    },
    reference: [
      {
        title: 'On your turn',
        head: ['Before any bid', 'Once someone has bid'],
        rows: [
          ['Add a disc to your stack', 'Raise the bid'],
          [
            'Open the bidding (you must, with no discs in hand)',
            'Pass (for the rest of the round)',
          ],
        ],
      },
      {
        title: 'After the challenge',
        head: ['What was turned over', 'Challenger', 'Next round starts with'],
        rows: [
          ['Only {roses}', 'Scores a point (two wins)', 'The Challenger'],
          [
            'Someone else’s {thorn}',
            'Loses a random disc',
            'The Challenger, or the {thorn}’s owner if they are out',
          ],
          [
            'Their own {thorn}',
            'Chooses a disc to lose',
            'The Challenger, or whoever they name if they are out',
          ],
        ],
      },
    ],
    tips: [
      'Bid low with only {roses} on your own mat: you turn your own over first, so you know they are safe.',
      'A {thorn} on top of your stack stops anyone who bids past your own discs. Bidding with it down makes it a trap.',
      'Watch who raises: a player who bids high probably has {roses} on their mat, so their stack is a safer pick.',
      'Down to one disc? Everyone will wonder if it’s your {thorn}.',
    ],
    glossary: [
      { term: 'Challenger', meaning: 'The highest bidder, who must turn over that many discs.' },
      {
        term: 'Stack',
        meaning: 'Your discs on your mat this round, face down, the newest on top.',
      },
      { term: 'Discs in play', meaning: 'Every disc on every mat: the most anyone may bid.' },
    ],
  };
}

/** The guide in the given names, with art when there is some. */
export function makeGuide(
  names: Names = PLACEHOLDER_NAMES,
  art: GuideArt = {},
  footer?: GuideFooter,
): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as ThornsView;
    if (!v?.settings) return undefined;
    const on = v.settings.lastChance !== false;
    const seated = v.game?.players.length ?? v.seats.filter((s) => s.playing).length;
    return {
      summary: `${seated} players · ${on ? 'with' : 'without'} the ${names.chance}`,
      options: on ? [CHANCE.key] : [],
      inGame: { rose: 3 * seated, thorn: seated, mat: seated, ...(on && { chance: 1 }) },
    };
  };
  return {
    ...fill(base(art), names),
    presets: [
      {
        id: 'standard',
        label: fillNames('With the {chance}', names),
        context: { summary: 'The usual game, with the lent disc on.', options: [CHANCE.key] },
      },
      {
        id: 'classic',
        label: fillNames('Without the {chance}', names),
        context: { summary: 'The older rules: no lent disc.', options: [] },
      },
    ],
    ...(footer && { footer }),
    room,
  };
}

/** The guide without art, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const url = (path: string) => `/api/backroom/assets/thorns/${path.replace(/^\/+/, '')}`;

/** The guide in the manifest's names, with its first set's art and the credits. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = (manifest && typeof manifest === 'object' ? manifest : null) as Manifest | null;
  const set = m?.sets?.[0];
  const a = (p: string | undefined) => (typeof p === 'string' && p ? url(p) : undefined);
  const art: GuideArt = {};
  for (const [k, v] of [
    ['rose', set?.rose],
    ['thorn', set?.thorn],
    ['back', set?.back],
    ['mat', set?.mat],
    ['chance', m?.chance?.face],
  ] as const) {
    const u = a(v);
    if (u) art[k] = u;
  }
  return makeGuide(namesOf(m), art, footerOf(m));
}
