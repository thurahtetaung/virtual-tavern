import type { GameGuide } from '@vt/game-sdk';

export const guide: GameGuide = {
  tagline: 'Two teams race to find their secret agents using one-word clues.',
  players: '4 or more (best with 6–10)',
  duration: '15–20 minutes',
  goal: 'Be the first team to find all of your agents on the board, and never touch the assassin.',
  setup: [
    'Split into two teams: Red and Blue.',
    'Each team picks one Spymaster. Everyone else is an Operative.',
    'The host presses Start. The team that goes first has 9 agents to find; the other team has 8.',
  ],
  roles: [
    {
      name: 'Spymaster',
      summary:
        'Sees the secret key: which words are Red agents, Blue agents, innocent bystanders, and the assassin. Gives clues to their team, and must not say anything else.',
    },
    {
      name: 'Operative',
      summary:
        "Only sees the words. Talks it over with teammates and picks cards based on the Spymaster's clue.",
    },
  ],
  sections: [
    {
      title: 'The board',
      paragraphs: [
        'There are 25 word cards. Hidden behind them are 9 agents for the starting team, 8 for the other team, 7 innocent bystanders, and 1 assassin.',
        'Only the Spymasters can see which card is which.',
      ],
    },
    {
      title: 'Giving a clue (Spymaster)',
      paragraphs: [
        'On your turn, give one word and one number. The word links some of your agents; the number says how many.',
        'Example: "Ocean 2" could point at WHALE and WAVE.',
      ],
      bullets: [
        'The clue must be a single word (hyphens are fine).',
        'It cannot be one of the words still face-down on the board.',
        'Choose "Unlimited" (or 0) if you want your team to keep guessing as long as they like.',
        'No hints by voice or face. Stay poker-faced while your team guesses!',
      ],
    },
    {
      title: 'Guessing (Operatives)',
      paragraphs: [
        'Discuss with your team. Tap a card to mark it as a suggestion your teammates can see. When you agree, press Guess to flip the card and see what it is.',
      ],
      bullets: [
        'Your agent: great, you may keep guessing.',
        'Innocent bystander: your turn ends.',
        "The other team's agent: your turn ends, and you just helped them.",
        'The assassin: your team loses immediately.',
        'You get up to one more guess than the clue number (for "Ocean 2", up to 3 guesses). You can also end your turn early.',
      ],
    },
    {
      title: 'Winning',
      bullets: [
        'A team wins as soon as all of its agents are revealed, even if the other team revealed the last one.',
        'A team loses instantly if it guesses the assassin.',
      ],
    },
    {
      title: 'Turn timer (optional)',
      paragraphs: [
        'The host can set a time limit for giving clues and for guessing. When time runs out, the turn passes to the other team.',
      ],
    },
  ],
  tips: [
    'Spymasters: a safe "2" beats a risky "4". Check the assassin before every clue.',
    'Operatives: say your reasoning out loud. Your Spymaster cannot help, but your teammates can.',
    'Leftover guesses are useful: the extra guess lets you catch up on an agent you missed last turn.',
    'Use voice or video chat alongside the game for the best experience.',
  ],
  glossary: [
    { term: 'Agent', meaning: 'A card that belongs to a team. Find all of yours to win.' },
    { term: 'Bystander', meaning: 'A neutral card. Guessing it ends your turn.' },
    { term: 'Assassin', meaning: 'The one card that makes your team lose instantly.' },
    { term: 'Key', meaning: 'The secret map of card colours that only Spymasters see.' },
  ],
};
