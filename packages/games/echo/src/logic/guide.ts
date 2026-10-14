import { type GameGuide, shapeGuide } from '@vt/game-sdk';

const text: GameGuide = {
  tagline: 'Everyone writes a one-word clue for the guesser, but matching clues cancel out.',
  players: '3 to 7 (best with 5 or more)',
  duration: '15–30 minutes',
  goal: 'Work together to get as many secret words as you can across the deck. Each round one player guesses a word from the one-word clues everyone else writes, but any clue that someone else also wrote is cancelled before the guesser sees it.',
  quickStart: [
    'Each card, one player is the guesser and picks one of 5 hidden words by number.',
    'Everyone else sees the word and writes a one-word clue for it, without talking.',
    'Clues that match another clue (even as plurals or close spellings) are cancelled.',
    'The guesser sees only the clues left and gets one guess, or can pass.',
    'Right scores a point; a pass loses that card; a wrong guess loses that card and the next.',
    'The guesser moves round the table; score as many cards as you can together.',
  ],
  setup: [
    'Up to 7 players can play; anyone else in the room watches until a seat frees up. Use “Sit out (watch)” to step out and “Take a seat” to come back.',
    'The host picks the word lists and the deck length: 8 cards (quick), 13 (standard) or 20 (long).',
    'The host presses Start. You need at least 3 players.',
  ],
  roles: [
    {
      name: 'Guesser',
      summary:
        'Changes every card, going round the table in the order shown by the numbers in the Players list. Never sees the secret word until the end of the card. The reveal names the next guesser.',
    },
    {
      name: 'Clue writers',
      summary:
        'Everyone else who is playing. They see the secret word and each write a one-word clue for it, without talking to each other.',
    },
  ],
  sections: [
    {
      title: 'A card, step by step',
      bullets: [
        'The guesser gets a card of 5 hidden words and picks one of them blind, by number.',
        'Everyone else sees that word and writes one clue for it. With only 3 players, the two clue writers write two clues each.',
        'Once every clue is in, matching clues cancel each other out. The guesser only sees the clues that survive.',
        'The guesser has one try to say the word, or can pass.',
        'Everyone then sees the word, every clue and who wrote it, and what was cancelled. Anyone at the table can deal the next card.',
      ],
    },
    {
      title: 'What cancels',
      paragraphs: [
        'Two clues cancel when they are the same word, even if they look a little different. Capitals, accents, spaces, hyphens, plurals (also “mice” and “mouse”), British and American spellings (“colour” and “color”) and simple verb endings are ignored, so “Cat” and “cats” cancel, and so do “Café” and “cafe”, “ice-cream” and “icecream”, or “run” and “running”. Every copy is cancelled, not just the second one.',
        'Different words that merely start alike, such as “corn” and “corner” or “bus” and “busy”, do not cancel.',
      ],
    },
    {
      title: 'Clues that aren’t allowed',
      bullets: [
        'More than one word. Hyphens and apostrophes are fine (“ice-cream”, “dog’s”).',
        'Just a number, such as “42”.',
        'The secret word itself, any form of it, or a word built from it (for “sun”, not “sunny” or “sunflower”). It works both ways: for “sunflower”, not “sun”. A word that only hides it inside, such as “scatter” for “cat” or “police” for “ice”, is fine.',
        'For an answer of several words, any of its words or the whole answer run together (for “ice cream”, not “ice”, “cream” or “icecream”).',
        'Your two clues (with 3 players) being the same word.',
        'If a clue is refused you can fix it and send again. You can also change your clues until the last one is in.',
      ],
    },
    {
      title: 'Guessing and scoring',
      bullets: [
        'Right: the card scores a point.',
        'Pass: the card is set aside, with no point.',
        'Wrong: the card is lost, and so is the next card in the deck. On the last card there is no next card, so you give back a card you had already won instead (one point less, never below 0). A wrong guess costs more than a pass, so pass when you have no idea.',
        'Close enough counts on its own: capitals, accents, spaces, hyphens, plurals (also “mice” for “mouse”) and British or American spelling are all right (“spiderman” for “Spider-Man”). Anything else is a miss, including a typo, a word one letter away (“house” for “horse”), part of the word or a longer or shorter word (“corn” for “corner”). Nobody has to judge.',
        'The game ends when the deck runs out. The list of cards played counts any card a wrong guess cost.',
      ],
    },
    {
      title: 'How did you do?',
      paragraphs: [
        'Your score is the number of cards you got right. For a 13-card deck: 13 is Perfect, 12 Amazing, 10–11 Great, 7–9 Good, 4–6 A good start, and 0–3 Try again. Shorter and longer decks are rated in the same proportion.',
      ],
    },
    {
      title: 'Timers (optional)',
      paragraphs: [
        'The host can time the clue writing and the guessing. By default the timer is just a reminder. With Strict timers, running out of time moves the game on: a guesser who hasn’t picked gets a random word, clue writers who are late simply have no clue, and a guesser who hasn’t answered passes. The screen always says when the timer made the call (⏱), so nobody is blamed for it. A clue that was typed but not sent in time doesn’t count, so send it before the clock runs out.',
      ],
    },
    {
      title: 'Coming and going',
      bullets: [
        'Players who join during a game wait for the next card, then join the rotation.',
        'If the guesser leaves, the next player becomes the guesser. The card goes back on top of the deck without the word that had been picked.',
        'If a clue writer leaves while clues are being written, the others carry on without them (down to two writers before anyone has sent, each writes two clues). If one is offline, the host can press “Go on without them”.',
        'If fewer than 3 players are left, the game ends.',
      ],
    },
  ],
  tips: [
    'Think about what the others will write, and pick something a little different, so your clue doesn’t cancel.',
    'The most obvious clue is the most likely to be cancelled. A second-most-obvious clue often works better.',
    'Guessers: if nothing survives or the clues make no sense, pass rather than risk losing two cards.',
  ],
  glossary: [
    { term: 'Card', meaning: '5 hidden words. The guesser picks one of them by number.' },
    {
      term: 'Cancelled',
      meaning: 'A clue that someone else also wrote. Cancelled clues are hidden from the guesser.',
    },
  ],
};

export const guide: GameGuide = shapeGuide(text, {
  steps: [
    ['One guesser, a hidden word', '🙈'],
    ['Everyone else writes a clue', '✍️'],
    ['Matching clues cancel', '💥'],
    ['One guess (or pass)', '🤔'],
    ['Score as a team', '🧮'],
    ['Next guesser', '🔁'],
  ],
  levels: {
    'A card, step by step': 'basics',
    'What cancels': 'basics',
    'Guessing and scoring': 'basics',
    'Clues that aren’t allowed': 'details',
    'How did you do?': 'details',
  },
  roleIcons: ['🙈', '✍️'],
  reference: [
    {
      title: 'A guess',
      head: ['Result', 'The card', 'The deck'],
      rows: [
        ['Right', 'Scores a point', '—'],
        ['Pass', 'Set aside, no point', '—'],
        ['Wrong', 'Lost', 'The next card is lost too (on the last card, a won card)'],
      ],
    },
    {
      title: 'How did you do? (13 cards)',
      head: ['Score', 'Rating'],
      rows: [
        ['13', 'Perfect'],
        ['12', 'Amazing'],
        ['10–11', 'Great'],
        ['7–9', 'Good'],
        ['4–6', 'A good start'],
        ['0–3', 'Try again'],
      ],
    },
  ],
});
