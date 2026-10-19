import { type GameGuide, shapeGuide } from '@vt/game-sdk';
import type { StarlightView } from './types.ts';

const text: GameGuide = {
  tagline: 'One word, fifteen pictures: mark the ones it brings to mind, and hope others did too.',
  players: '3 to 6',
  duration: '30 minutes',
  goal: 'Score the most stars over 4 rounds by marking the pictures other players also link to the word, without being the only one who saw something.',
  quickStart: [
    'Each round a word is revealed and 15 picture cards lie in a grid.',
    'In secret, mark every picture the word makes you think of: at least 1, at most 10. Lock your slate when you’re done.',
    'Everyone’s count is shown. Whoever marked the most, alone, is in the Dark.',
    'Taking turns as the Scout, show one of your marked cards. Everyone who marked it shares the stars: 2 each, or 3 if just one other did.',
    'If nobody else marked it, you fall: no more stars for you this round.',
    'After 4 rounds, the most stars wins. A player in the Dark who fell loses a point for each Spark they made.',
  ],
  setup: [
    'Everyone sits down (3 to 6 players; others can watch).',
    'The host picks the picture card sets and the word lists, then presses Start.',
    'A random player gets the First Scout pawn; it moves one seat clockwise every round.',
  ],
  sections: [
    {
      title: 'The word',
      paragraphs: [
        'Each round shows one word, drawn at random from the host’s word lists, and everyone marks for that same word at once.',
      ],
    },
    {
      title: 'Marking your slate',
      bullets: [
        'Tap the pictures you link to the word. Your marks are secret: nobody sees them until a card is shown.',
        'Mark at least 1 and at most 10 cards, then Lock. You can Unlock and change your mind until the last player locks; then every slate is final.',
        'Take your time: there is no clock unless the host set one.',
      ],
    },
    {
      title: 'Light and Dark',
      paragraphs: [
        'When every slate is locked, everyone’s count is shown. The player who marked more cards than anyone else is in the Dark. If two or more share the top count, nobody is. Being in the Dark only matters for scoring.',
      ],
    },
    {
      title: 'The Reveal',
      bullets: [
        'The First Scout is the first Scout. The Scout shows one of their marked cards that hasn’t been shown yet this round.',
        'Two or more other players marked it: a Spark. Everyone who marked it fills 2 stars, the Scout included.',
        'Exactly one other player marked it: a Super-Spark. Those two fill 3 stars each.',
        'Nobody else marked it: the Scout falls. They fill no stars for it, and no more stars this round.',
        'Then the player on the Scout’s left becomes the Scout, skipping anyone who has fallen or has no unshown marks left. A Scout with marks left must show one, even if it can only fall.',
        'The Reveal ends when everyone has fallen, or nobody who is still standing has an unshown mark.',
      ],
    },
    {
      title: 'Fallen players still count',
      paragraphs: [
        'A fallen player’s marks still count for everyone else. If the only other player who marked the Scout’s card has fallen, it is still a Super-Spark: the Scout fills 3 stars and the fallen player none. Stars filled before a fall are kept.',
      ],
    },
    {
      title: 'Scoring',
      bullets: [
        'You score a point per star you filled this round.',
        'In the Dark and never fell: you score normally.',
        'In the Dark and fell: you lose 1 point for each Spark and Super-Spark you filled this round (a Super-Spark’s bonus star still counts).',
      ],
    },
    {
      title: 'Between rounds and the end',
      bullets: [
        'The host presses Next round. The First Scout pawn moves one seat clockwise and one line of pictures is replaced: the bottom line after round I, the middle after round II, the top after round III. New cards are marked on the grid.',
        'No word comes back in the same game.',
        'After round IV, the most points wins. Players on the same total share the win.',
      ],
    },
    {
      title: 'Coming and going',
      bullets: [
        'You can sit down or stand up in the lobby, between rounds and at the end. Someone who sits down mid-game plays from the next round.',
        'Someone who leaves before the Reveal takes their slate with them; a leaving First Scout passes the pawn clockwise.',
        'Someone who leaves during the Reveal is out of the round, but their marks still count for everyone else, like a fallen player’s.',
        'Someone who comes back during the same game picks up their score again. If fewer than 3 players are left, the game ends and the most points wins.',
      ],
    },
    {
      title: 'Timers (optional)',
      paragraphs: [
        'The host can time marking and each Scout’s choice. By default the timer is only a reminder. In Strict mode, unlocked slates lock as they are when time runs out (an empty one gets one random card) and a slow Scout shows one of their marks at random. The table is told each time.',
      ],
    },
  ],
  tips: [
    'Show your most obvious card first: the more people share it, the safer you are.',
    'Marking a lot is tempting, but the player alone in the lead risks the Dark.',
    'A Super-Spark is worth more than a Spark: an odd idea that exactly one friend shares pays best.',
    'Tap a picture and hold, or use the zoom button, to see it full size.',
  ],
  glossary: [
    { term: 'Slate', meaning: 'Your secret grid of marks, one box per picture.' },
    { term: 'Scout', meaning: 'The player showing a card right now.' },
    {
      term: 'First Scout',
      meaning: 'Starts the Reveal; moves clockwise each round.',
    },
    { term: 'Spark', meaning: 'A shown card at least 2 other players marked: 2 stars each.' },
    { term: 'Super-Spark', meaning: 'A shown card exactly 1 other player marked: 3 stars each.' },
    { term: 'Fall', meaning: 'Showing a card nobody else marked: no more stars this round.' },
    {
      term: 'In the Dark',
      meaning: 'Marked the most cards, alone; a fall costs a point per Spark.',
    },
  ],
  tiles: {
    label: 'Outcomes',
    blurb: 'Spark · Super-Spark · Fall · the Dark',
    intro: 'What can happen when a card is shown, and what the Dark does.',
    items: [
      {
        id: 'spark',
        name: 'Spark',
        icon: '✨',
        tone: 'good',
        text: 'At least 2 other players marked the shown card. Everyone who marked it, the Scout too, fills 2 stars (fallen players fill none).',
      },
      {
        id: 'super-spark',
        name: 'Super-Spark',
        icon: '🌟',
        tone: 'good',
        text: 'Exactly 1 other player marked the shown card. The Scout and that player fill 3 stars each: the 2 of a Spark and a bonus star.',
      },
      {
        id: 'fall',
        name: 'Fall',
        icon: '🌠',
        tone: 'evil',
        text: 'Nobody else marked the shown card. The Scout fills no stars for it, fills no more stars this round and is never the Scout again this round. Their marks still count for the others.',
      },
      {
        id: 'dark',
        name: 'In the Dark',
        icon: '🌑',
        text: 'The one player who marked the most cards. If they fall, they lose 1 point for each Spark and Super-Spark they filled this round. A tie for the most puts nobody in the Dark.',
      },
      {
        id: 'light',
        name: 'In the Light',
        icon: '🏮',
        text: 'Everyone else. Your stars are your points, fall or not.',
      },
      {
        id: 'scout',
        name: 'Scout',
        icon: '🔭',
        text: 'Shows one of their unshown marked cards, then the role moves to the left, skipping fallen players and those with no unshown marks.',
      },
    ],
  },
};

export const guide: GameGuide = shapeGuide(text, {
  steps: [
    ['A word, fifteen pictures', '🖼️'],
    ['Mark in secret', '✏️'],
    ['Counts, and the Dark', '🌑'],
    ['Show and share stars', '✨'],
    ['Alone? You fall', '🌠'],
    ['Four rounds, most stars wins', '🏆'],
  ],
  levels: {
    'Marking your slate': 'basics',
    'Light and Dark': 'basics',
    'The Reveal': 'basics',
    Scoring: 'basics',
    'The word': 'details',
    'Fallen players still count': 'details',
    'Between rounds and the end': 'details',
  },
  room: (raw) => {
    const v = raw as StarlightView;
    if (!Array.isArray(v?.seats)) return undefined;
    const n = v.seats.filter((x) => x.playing).length;
    return {
      summary: `${n} ${n === 1 ? 'player' : 'players'} · ${v.round ? `round ${v.round.no} of 4` : '4 rounds'}`,
    };
  },
  reference: [
    {
      title: 'Stars for a shown card',
      head: ['Other players who marked it', 'Result', 'Stars each'],
      rows: [
        ['2 or more', 'Spark', '2'],
        ['Exactly 1', 'Super-Spark', '3'],
        ['None', 'The Scout falls', '0'],
      ],
    },
    {
      title: 'In the Dark and fell',
      head: ['Box', 'Normally', 'In the Dark, fell'],
      rows: [
        ['Spark', '2', '1'],
        ['Super-Spark', '3', '2'],
      ],
    },
    {
      title: 'Line replaced after each round',
      head: ['After round', 'Line'],
      rows: [
        ['I', 'Bottom'],
        ['II', 'Middle'],
        ['III', 'Top'],
      ],
    },
  ],
});
