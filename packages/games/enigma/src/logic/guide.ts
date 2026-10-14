import { type GameGuide, shapeGuide } from '@vt/game-sdk';

const text: GameGuide = {
  tagline: 'Pass secret codes to your team with clues, while the other team tries to crack them.',
  players: '4 or more (best with 6–8)',
  duration: '30–45 minutes',
  goal: 'Get your codes across to your own team without two miscommunications, and intercept the other team’s codes twice before they intercept yours. If nobody has managed either by the end of round 8, the better score wins.',
  quickStart: [
    'Join Red or Blue (at least 2 each). Your team gets 4 secret keywords, numbered 1 to 4.',
    'Each round, one player is the Encryptor and gets a 3-number code, like 3-1-4.',
    'The Encryptor writes one clue per number, pointing at those keywords without making it obvious.',
    'Teammates pick a number for each clue and press Lock in. A guess only counts once everyone agrees.',
    'From round 2 the other team tries to crack your code too, using your past clues.',
    'Two interceptions win; two miscommunications lose. After round 8 the better score wins.',
  ],
  setup: [
    'Split into two teams, Red and Blue, with at least 2 players each.',
    'The host presses Start. Each team gets 4 secret keywords, numbered 1 to 4, that only your team can see.',
    'Use the team chat to talk privately. The other team can’t read it, so don’t say guesses out loud!',
  ],
  roles: [
    {
      name: 'Encryptor',
      summary:
        'Changes every round: whoever on the team has been Encryptor the fewest times goes next (ties in seat order), so leaving, rejoining or a rematch never skips anyone. The reveal names the next Encryptor. Gets a secret 3-number code (like 3-1-4) and writes one clue for each number, pointing at that keyword without making it obvious.',
    },
    {
      name: 'Decoders',
      summary:
        'The rest of the Encryptor’s team. Work out which keyword each clue points to, and so the code.',
    },
    {
      name: 'Interceptors',
      summary:
        'The other team, from round 2. Study the clue history and try to crack the code too, without knowing the keywords. Their own Encryptor votes on the interception too, but can only use the team chat and notes once their own code is revealed.',
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
        'The host presses Next round when everyone has had a look. Which team transmits first swaps every round, and again for each rematch.',
      ],
    },
    {
      title: 'Writing clues',
      bullets: [
        'A clue is a single line of up to 40 characters.',
        'It can’t be one of your own keywords, in any form: not its plural, not without its accents (“Cafe” for CAFÉ), and not as a word inside a longer clue (“the moon” for MOON).',
        'It can’t be a number or contain one, in any form: no digits (“3”, “#3”, “3rd”), no “one” to “four”, and no Roman numerals (“III”).',
        'The three clues must all be different.',
        'From the moment you see your code until it is revealed, you can’t post in the team chat or edit the team’s notes, not even about the interception. You can still pick and lock in an interception guess, and you can watch your team’s picks. Chat and notes open again at the reveal.',
      ],
    },
    {
      title: 'Agreeing on a guess',
      paragraphs: [
        'Pick three numbers in the code slots. Your teammates see your picks live. When you’re sure, press Lock in. A guess only goes through when everyone on your side has locked in the same code; change your pick and your lock is cleared.',
        'Nothing is final until every side has agreed at the same time: your team’s decode and the interception, on both teams’ codes when they are played together. Until then the screen shows which code your team is locked on, and anyone can press Change my pick to reopen it. Only a strict timer running out, or a code that never got its clues, settles a side early.',
        'Whoever is on your side when guessing starts has to agree. If you join a team mid-round, you watch until the next clues are written. If someone leaves, the rest of the side carries on without them. If someone goes offline, the host can skip their vote, and the rest of the side decides.',
      ],
    },
    {
      title: 'Tokens',
      bullets: [
        'Your team guesses its own code wrong (or doesn’t agree on one): you get a 💥 miscommunication token.',
        'You guess the other team’s code right: you get a 🕵️ interception token.',
        'The scoreboard shows each team’s tokens as 🕵️ 0/2 and 💥 0/2, with the round number (“Round 1 of 8”) in the middle. Tap the round to show or hide this legend.',
        'Nobody can intercept in round 1, because there is no clue history yet.',
      ],
    },
    {
      title: 'Winning',
      bullets: [
        'At the end of a round, a team with 2 🕵️ interceptions wins.',
        'A team with 2 💥 miscommunications loses.',
        'The game ends at the end of the round in which a team reaches 2 of either token, so both teams always finish the round. When that happens mid-round, a banner says the game ends after this round.',
        'When a round decides the game, the reveal says who won and why, and the host’s button changes to See results.',
        'If both happen at once, or after round 8, the team with the better score wins (interceptions minus miscommunications). An even score is a draw.',
        '“Both at once” includes one team doing both in the same round: it reaches its 2nd interception and its 2nd miscommunication together. Then the score decides too, and the end screen says so.',
      ],
    },
    {
      title: 'The clue history is everything',
      paragraphs: [
        'Every past clue sits under its keyword number on both teams’ sheets (the Clues tab on a phone), so after a few rounds you may work out the other team’s keywords. Under each of their keyword numbers your team can fill in one shared guess, and below them is a list of team notes that anyone on your team can add to or remove from (the other team never sees either). If a teammate changes a guess while you’re typing yours, theirs is kept and yours stays on screen so you can use it instead. When you intercept, their past clues and your guesses sit right above the code picker.',
      ],
    },
    {
      title: 'Host options',
      bullets: [
        'Turn order. Simultaneous: both Encryptors write, then both teams guess, at the same time (faster). Alternating: one team’s code is played all the way through, then the other’s; the second Encryptor only sees their code once it’s their turn.',
        'Timers. By default just a reminder. With Strict timers, running out of time counts as a failure: no clues means a miscommunication (and nothing to intercept), and no agreed guess means no decode or interception.',
      ],
    },
    {
      title: 'Timers (optional)',
      paragraphs: [
        'The host can time the clue writing and the guessing. By default the timer is just a reminder. If the host picks Strict, running out of time counts as a failure: clues typed but not sent don’t count, so no clues means a miscommunication, and no agreed guess means no decode or interception. A code that never got its clues can’t be intercepted either. The reveal says when the timer was the reason. Give Encryptors 2–3 minutes: three careful clues take a while.',
      ],
    },
    {
      title: 'Coming and going',
      bullets: [
        'Once you’ve seen a team’s keywords you belong to that team for the rest of the game, even if you leave the room and come back.',
        'Anyone without a team is watching: they see both teams’ clues and the codes as they are revealed, but no keywords and no team chat. They can join a team at any time.',
        'An Encryptor who leaves before sending clues is replaced by the teammate who has encrypted least, and the turn doesn’t count as theirs.',
        'A team down to its Encryptor keeps its turn open: a teammate who comes back before the clues are sent decodes as usual. Clues nobody is left to decode count as a miscommunication, and a team with nobody at all can’t transmit.',
      ],
    },
  ],
  tips: [
    'Encryptors: vary your clues each round. If you say “salty” every time, the other team will crack you.',
    'Be clear enough for your team, but sneaky enough for the other team. Inside jokes are perfect.',
    'Interceptors: line up the other team’s clues per number and look for the common thread.',
  ],
  glossary: [
    { term: 'Keyword', meaning: 'One of your team’s 4 secret words, numbered 1–4.' },
    {
      term: 'Code',
      meaning:
        'Three different numbers from 1–4, such as 3-1-4, that the Encryptor must get across.',
    },
    {
      term: 'Interception 🕵️',
      meaning: 'Correctly guessing the other team’s code. Two wins the game.',
    },
    {
      term: 'Miscommunication 💥',
      meaning: 'Your team failing to guess its own code. Two loses the game.',
    },
  ],
};

export const guide: GameGuide = shapeGuide(text, {
  steps: [
    ['Your team’s 4 keywords', '🔑'],
    ['The Encryptor gets a code', '🎲'],
    ['Three clues', '✍️'],
    ['Agree and lock in', '🔒'],
    ['The other team listens', '🕵️'],
    ['Two tokens decide it', '🏆'],
  ],
  levels: {
    'A round, step by step': 'basics',
    'Writing clues': 'basics',
    'Agreeing on a guess': 'basics',
    Tokens: 'basics',
    Winning: 'details',
    'The clue history is everything': 'details',
  },
  roleIcons: ['✍️', '🧩', '🕵️'],
  reference: [
    {
      title: 'Tokens and winning',
      head: ['Token', 'You get it when', 'Two of them'],
      rows: [
        ['🕵️ Interception', 'You guess the other team’s code', 'Your team wins'],
        ['💥 Miscommunication', 'Your team misses its own code', 'Your team loses'],
      ],
      note: 'Both at once, or no decision after round 8: interceptions minus miscommunications decides; an even score is a draw.',
    },
  ],
});
