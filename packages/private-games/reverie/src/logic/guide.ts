import type { GameGuide } from '@vt/game-sdk';

export const guide: GameGuide = {
  tagline: 'Give a dreamy clue for one of your picture cards, and let some, but not all, find it.',
  players: '3 to 8',
  duration: '30 minutes',
  goal: 'Be the first to 30 points by giving clues that are neither too obvious nor too obscure, and by spotting other players’ clues.',
  setup: [
    'Everyone sits down (up to 8 players; others can watch).',
    'The host picks which card sets to play with and presses Start. Everyone gets 6 picture cards.',
    'Only you can see your hand.',
  ],
  roles: [
    {
      name: 'Storyteller',
      summary:
        'Changes every turn. Picks one card from their hand and gives a clue for it: a word, a sentence, a song line, a sound… anything.',
    },
    {
      name: 'Everyone else',
      summary:
        'Picks the card from their own hand that best fits the clue, then tries to spot the storyteller’s card among all the cards on the table.',
    },
  ],
  sections: [
    {
      title: 'A turn',
      bullets: [
        'The storyteller chooses a card and types a clue. Nobody else sees the card yet.',
        'Each other player gives one card from their hand that could match the clue.',
        'All the cards are shuffled and laid face up, numbered.',
        'Everyone except the storyteller votes for the card they think is the storyteller’s. You can’t vote for your own card.',
        'The cards are revealed with their owners and votes, and points are scored.',
      ],
    },
    {
      title: 'Scoring',
      bullets: [
        'If everyone found the storyteller’s card, or nobody did: the storyteller scores 0 and everyone else scores 2.',
        'Otherwise: the storyteller scores 3, and so does everyone who found the card.',
        'On top of that, each player except the storyteller scores 1 point for every vote their own card received.',
        'Then everyone draws back up to 6 cards and the next player becomes the storyteller.',
      ],
    },
    {
      title: 'Winning',
      paragraphs: [
        'When a turn ends with someone on 30 points or more, the game is over and the highest score wins. The host can choose a shorter game (15 or 20 points) in the settings.',
      ],
    },
    {
      title: 'With three players',
      paragraphs: [
        'Everyone holds 7 cards and the two other players each give 2 cards, so there are still 5 cards on the table. Vote bonuses work the same way.',
      ],
    },
    {
      title: 'Timers (optional)',
      paragraphs: [
        'The host can set a time for the storyteller, and a time for giving cards and voting. By default the timer is just a reminder. In Strict mode, a storyteller who runs out of time is skipped, late card givers play the first card of their hand, and late voters simply miss the vote.',
      ],
    },
  ],
  tips: [
    'The sweet spot is a clue that one or two people get. Too clear and everyone finds it; too strange and nobody does. Both score you nothing.',
    'Picking a card to give is the sneaky part: choose one that could plausibly be the storyteller’s, and you’ll collect votes.',
    'Clues can be a feeling, a memory, a song, a film title, or just a sound.',
    'Tap any card to see it full size before you decide.',
  ],
  glossary: [
    { term: 'Storyteller', meaning: 'The player giving the clue this turn.' },
    { term: 'Table', meaning: 'The shuffled, numbered cards everyone votes on.' },
    { term: 'Card set', meaning: 'A group of 84 picture cards; the host can mix several.' },
  ],
};
