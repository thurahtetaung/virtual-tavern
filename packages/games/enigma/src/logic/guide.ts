import type { GameGuide } from '@vt/game-sdk';

export const guide: GameGuide = {
  tagline: 'Pass secret codes to your team with clues, while the other team tries to crack them.',
  players: '4 or more (best with 6–8)',
  duration: '30–45 minutes',
  goal: 'Get your codes across to your own team, and intercept the other team’s codes twice before they intercept yours.',
  setup: [
    'Split into two teams, Red and Blue, with at least 2 players each.',
    'The host presses Start. Each team gets 4 secret keywords, numbered 1 to 4, that only your team can see.',
    'Use the team chat to talk privately. The other team can’t read it, so don’t say guesses out loud!',
  ],
  roles: [
    {
      name: 'Encryptor',
      summary:
        'Changes every round. Gets a secret 3-number code (like 3-1-4) and writes one clue for each number, pointing at that keyword without making it obvious.',
    },
    {
      name: 'Decoders',
      summary:
        'The rest of the Encryptor’s team. Work out which keyword each clue points to, and so the code.',
    },
    {
      name: 'Interceptors',
      summary:
        'The other team, from round 2. Study the clue history and try to crack the code too, without knowing the keywords.',
    },
  ],
  sections: [
    {
      title: 'A round, step by step',
      bullets: [
        'Each team’s Encryptor sees a code made of 3 different numbers from 1 to 4, for example 2-4-1.',
        'They write 3 clues in that order. For keyword 2 “Ocean”, a clue could be “salty”.',
        'Their team picks the code they think the clues mean, and the other team tries to intercept it.',
        'The real code is revealed. Every clue is filed under its keyword number for everyone to see.',
      ],
    },
    {
      title: 'Agreeing on a guess',
      paragraphs: [
        'Pick three numbers in the code slots. Your teammates see your picks live. When you’re sure, press Lock in. A guess only goes through when everyone on your side has locked in the same code; change your pick and your lock is cleared.',
      ],
    },
    {
      title: 'Tokens',
      bullets: [
        'Your team guesses its own code wrong: you get a miscommunication (black) token.',
        'You guess the other team’s code right: you get an interception (white) token.',
        'Nobody can intercept in round 1, because there is no clue history yet.',
      ],
    },
    {
      title: 'Winning',
      bullets: [
        'At the end of a round, a team with 2 interceptions wins.',
        'A team with 2 miscommunications loses.',
        'If both happen at once, or after round 8, the team with the better score wins (interceptions minus miscommunications). An even score is a draw.',
      ],
    },
    {
      title: 'The clue history is everything',
      paragraphs: [
        'Every past clue sits under its keyword number on both teams’ sheets. Your team can see what the other team said for their keyword 3 in every round, so after a few rounds you may work out what it is. Use the shared notes to write your team’s best guess for each of their keywords.',
      ],
    },
    {
      title: 'Turn order (chosen by the host)',
      bullets: [
        'Simultaneous: both Encryptors write at the same time, then both teams guess at the same time. Faster.',
        'Alternating: one team’s code is played all the way through, then the other’s. Closer to the tabletop pace.',
      ],
    },
    {
      title: 'Timers (optional)',
      paragraphs: [
        'The host can time the clue writing and the guessing. By default the timer is just a reminder. If the host picks Strict, running out of time counts as a failure: no clues means a miscommunication, and no agreed guess means no decode or interception.',
      ],
    },
  ],
  tips: [
    'Encryptors: vary your clues each round. If you say “salty” every time, the other team will crack you.',
    'Be clear enough for your team, but sneaky enough for the other team. Inside jokes are perfect.',
    'Interceptors: line up the other team’s clues per number and look for the common thread.',
    'Write the other team’s likely keywords in the shared notes as soon as you have a hunch.',
  ],
  glossary: [
    { term: 'Keyword', meaning: 'One of your team’s 4 secret words, numbered 1–4.' },
    {
      term: 'Code',
      meaning:
        'Three different numbers from 1–4, such as 3-1-4, that the Encryptor must get across.',
    },
    {
      term: 'Interception',
      meaning: 'Correctly guessing the other team’s code. Two wins the game.',
    },
    {
      term: 'Miscommunication',
      meaning: 'Your team failing to guess its own code. Two loses the game.',
    },
  ],
};
