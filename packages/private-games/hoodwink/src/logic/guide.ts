import type { GameGuide } from '@vt/game-sdk';

export const guide: GameGuide = {
  tagline: 'Write fake answers to bizarre true questions, fool your friends, and find the truth.',
  players: '3 to 10 (best with 4–8)',
  duration: '15–30 minutes',
  goal: 'Score the most points. Each round everyone sees a strange but true fact with a word missing. Make up a believable fake answer to fool the others, then try to spot the real one among everybody’s lies.',
  setup: [
    'Up to 10 players can play; anyone else in the room just watches. Use “Just watch” to sit out.',
    'The host picks the question decks and the number of rounds: 5, 7 or 10.',
    'The host presses Start. You need at least 3 players.',
  ],
  sections: [
    {
      title: 'A round, step by step',
      bullets: [
        'Everyone sees the same question: a fact with a blank where the answer goes, or a question to answer.',
        'Each player secretly writes a lie: a fake answer that sounds like it could be true. You can change it until the last lie is in.',
        'The real answer is shuffled in with everyone’s lies. Each player votes for the answer they think is true. You can’t vote for your own lie, and you can change your vote until everyone has voted.',
        'The reveal shows the real answer, who wrote each lie, and who fell for what. The host then moves on to the next round.',
      ],
    },
    {
      title: 'Writing a lie',
      bullets: [
        'Keep it to one line: at most 160 characters. Match the length and style of what the real answer might be.',
        'If you happen to write the real answer (or a spelling of it), the game tells you so and you write a different one. Capitals, accents and plurals are ignored when checking.',
        'If two players write the same lie, it appears once on the board and counts for both of them.',
        'Stuck? Press “Lie for me” and the game hands you a ready-made fake, when the question has some. It counts as your lie but scores half. You can still type your own to replace it.',
      ],
    },
    {
      title: 'Scoring',
      bullets: [
        'Find the real answer: 1,000 points.',
        'Every player who votes for your lie: 500 points to you. A lie written by several players shares those points between them.',
        'In small games the board is topped up to four answers with house fakes. They belong to nobody: picking one scores nothing.',
        'A lie the game picked for you (“Lie for me”, or filled in when the strict timer runs out) scores half: 250 points per player fooled.',
        'The final round counts double.',
        'After the last round, the highest score wins. Ties are shared. There are also awards for the Best liar (who fooled the most players) and the Truth seeker (who found the truth most often).',
      ],
    },
    {
      title: 'Timers (optional)',
      paragraphs: [
        'The host can time the lie writing (the “clue timer”) and the voting (the “guess timer”). By default the timer is just a reminder. With Strict timers, running out of time moves the game on: anyone who hasn’t written a lie gets a ready-made fake (worth half) when the question has some, or has none on the board, and anyone who hasn’t voted scores nothing for finding the truth. If nobody wrote a lie, the round goes straight to the reveal with no points.',
      ],
    },
    {
      title: 'Coming and going',
      bullets: [
        'Players who join during a game watch until the next round, then play.',
        'If a player leaves while lies are being written, their lie is dropped. Once voting has started, their lie stays on the board.',
        'If fewer than 3 players are left, the game ends with the scores so far.',
      ],
    },
  ],
  tips: [
    'The best lies sound like the kind of odd detail that only a true story would have.',
    'Match the style of the question: a date for a date, a name for a name, something oddly specific for an odd fact.',
    'Real answers are often stranger than you think. Don’t dismiss the weirdest option.',
  ],
  glossary: [
    { term: 'Lie', meaning: 'A fake answer written by a player to fool the others.' },
    { term: 'Truth', meaning: 'The real answer, hidden among the lies.' },
  ],
};
