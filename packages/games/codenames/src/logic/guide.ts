import type { GameGuide } from '@vt/game-sdk';

export const guide: GameGuide = {
  tagline: 'Two teams race to find their secret agents using one-word clues.',
  players: '4 or more (best with 6–10)',
  duration: '15–20 minutes',
  goal: 'Be the first team to find all of your agents on the board, and never touch the assassin.',
  quickStart: [
    'Join Red or Blue. Each team needs one Spymaster; everyone else is an Operative.',
    'Only Spymasters see which of the 25 words are their agents, bystanders or the assassin.',
    'On your turn, the Spymaster gives one word and a number, like "Ocean 2".',
    'Operatives talk it over, tap a card to suggest it, then press Guess. Keep going while you hit your own agents.',
    'A bystander or the other team’s agent ends your turn. The assassin loses the game at once.',
    'The first team to find all its agents wins.',
  ],
  setup: [
    'Split into two teams: Red and Blue.',
    'Each team picks one Spymaster. Everyone else is an Operative. First game? Start as an Operative: the Spymaster has the harder job.',
    'The host presses Start, which needs a Spymaster and at least one Operative on each team. Which team goes first is random, and it alternates with every rematch.',
    'The team that goes first has 9 agents to find; the other team has 8.',
  ],
  roles: [
    {
      name: 'Spymaster',
      summary:
        'Sees the secret key: which words are Red agents, Blue agents, innocent bystanders, and the assassin. Gives clues to their team, and must not say anything else. Also sees the cards their Operatives have marked.',
    },
    {
      name: 'Operative',
      summary:
        'Only sees the words. Talks it over with teammates and picks cards based on the Spymaster’s clue.',
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
        'Example: “Ocean 2” could point at WHALE and WAVE.',
      ],
      bullets: [
        'The clue must be a single word (hyphens are fine). A bare number or punctuation alone is not a clue.',
        'It cannot be one of the words still face-down on the board, or contain one joined by a hyphen or apostrophe (not “Captain-Antenna” while CAPTAIN is face-down).',
        'The clue must be about the words’ meaning. No clues about spelling, letters, the number of letters or where cards sit on the board (not “P” for words starting with P, or “Corner” for the corner cards).',
        'The number is 1 to 9 and cannot be higher than the agents your team still has to find. Clues for 0 or “unlimited” are not supported.',
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
        'The other team’s agent: your turn ends, and you just helped them.',
        'The assassin: your team loses immediately.',
        'You get up to one more guess than the clue number (for “Ocean 2”, up to 3 guesses). After at least one guess you can also end your turn early.',
        'Only one guess counts at a time. If a teammate’s guess ends the turn just before yours arrives, yours is refused as too late.',
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
      title: 'Timers (optional)',
      paragraphs: [
        'The host can set a time limit for giving clues and for guessing. By default the timer is just a friendly nudge: it turns red when time is up, but nobody is forced to stop.',
        'If the host picks Strict, the turn passes to the other team the moment time runs out. A Spymaster who runs out of time passes the turn without giving a clue.',
      ],
    },
    {
      title: 'Teams, the host and people coming and going',
      paragraphs: [
        'Once the game starts, everyone stays on their team until it ends. Friends who arrive late can still join a team as an Operative, and an empty Spymaster seat can be taken by a newcomer or by an Operative of that team (but not its only Operative, who is needed to guess). Someone who has seen the key can only come back as that team’s Spymaster.',
      ],
      bullets: [
        'Only the host can start the game, shuffle the teams, change the settings and return everyone to the lobby.',
        'Shuffle teams keeps anyone who already took a Spymaster seat; it picks a random Spymaster only for a team without one, then spreads everyone else evenly (with an odd number of players, the extra one joins the team that doesn’t go first).',
        'If a team’s last Operative leaves, that team forfeits its turn. If its Spymaster leaves before giving the clue, the turn is forfeited too; once the clue is out, the Operatives play on. Any turn that starts while a seat is still empty is forfeited.',
        'If the player whose turn it is goes offline, everyone is told, and the host gets a button to skip their turn. The host can also skip a stuck turn at any point, except their own team’s guessing turn. It shows up in the game log.',
        'Back to lobby abandons the current game: the board and the log are gone for good.',
        'Anyone without a team is watching: they see the board and the clues like an Operative, never the key, and can take a seat whenever the rules above allow it.',
      ],
    },
  ],
  tips: [
    'Spymasters: a safe “2” beats a risky “4”. Check the assassin before every clue.',
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
