import type { GameGuide } from '@vt/game-sdk';

export const guide: GameGuide = {
  tagline: 'One card in hand, one letter to deliver: deduce, protect and outlast to win favour.',
  players: '2 to 4 (Classic) or 2 to 6 (2019 edition)',
  duration: '20 minutes',
  goal: 'Win rounds to collect favour tokens. You win a round by being the last player standing, or by holding the highest card when the deck runs out. The first to the token target wins the game.',
  quickStart: [
    'You hold one secret card. On your turn, draw a second, then play one of the two face up.',
    'Do what the played card says: guess a hand, peek at one, compare, swap or protect yourself.',
    'If a card knocks you out, you sit out the rest of the round.',
    'The last player standing, or the highest card when the deck runs out, wins the round and a favour token.',
    'Watch the discards: every card played tells you what is left.',
    'The first to the token target wins the game.',
  ],
  setup: [
    'Everyone sits down; others can watch. The host picks the edition: Classic (16 cards, 2 to 4 players) or 2019 (21 cards, 2 to 6 players, with the Spy and the Chancellor).',
    'Each round the deck is shuffled and one card is set aside face down, unseen. With two players, three more are set aside face up for everyone to see.',
    'Everyone gets one card. Only you can see your hand.',
  ],
  roles: [
    {
      name: 'Your turn',
      summary:
        'Draw a card so you hold two, then play one of them face up and do what it says. The other stays in your hand.',
    },
    {
      name: 'Everyone else',
      summary:
        'Watches the discards closely: every card played narrows down what the others might be holding.',
    },
  ],
  sections: [
    {
      title: 'A round',
      bullets: [
        'Players take turns round the table: draw one, play one.',
        'Cards that target a player can’t pick someone who is protected by the Handmaid or already out. If nobody can be chosen, the card is played with no effect (the Prince can always pick you).',
        'When you are knocked out, your hand is shown and you sit out the rest of the round.',
        'The round ends when only one player is left, or when the deck is empty after a turn. Then everyone still in shows their card and the highest wins a favour token.',
      ],
    },
    {
      title: 'The cards (Classic)',
      bullets: [
        '1 · Guard (×5): name a card other than the Guard and choose a player. If they hold it, they are out.',
        '2 · Priest (×2): look at another player’s hand. Only you see it.',
        '3 · Baron (×2): compare hands in secret with another player; the lower card is out. A tie does nothing.',
        '4 · Handmaid (×2): you can’t be chosen by other players’ cards until your next turn.',
        '5 · Prince (×2): choose any player, yourself included. They discard their hand and draw a new card (the set-aside card if the deck is empty). Discarding the Princess knocks them out.',
        '6 · King (×1): trade hands with another player.',
        '7 · Countess (×1): no effect, but you must play her if your other card is the King or a Prince.',
        '8 · Princess (×1): if you play or discard her, you are out.',
      ],
    },
    {
      title: 'The cards (2019 edition)',
      paragraphs: [
        'The 2019 deck has 21 cards. It adds the Spy and the Chancellor and has one more Guard; the King, Countess and Princess move up a rank.',
      ],
      bullets: [
        '0 · Spy (×2): no effect when played. At the end of the round, if exactly one player still in has played or discarded a Spy, they gain a bonus token, even if they didn’t win the round.',
        '1 · Guard (×6), 2 · Priest (×2), 3 · Baron (×2), 4 · Handmaid (×2), 5 · Prince (×2): as in Classic. The Guard may also name the Spy.',
        '6 · Chancellor (×2): draw two cards, keep one of the three in your hand, and put the other two on the bottom of the deck in the order you choose.',
        '7 · King (×1), 8 · Countess (×1), 9 · Princess (×1): as in Classic.',
      ],
    },
    {
      title: 'Ties and winning',
      bullets: [
        'Classic: if the highest cards tie, the tied player whose discards add up to more wins. If that is a tie too, nobody wins the round.',
        '2019: every tied player wins a token.',
        'Tokens to win, Classic: 7 with 2 players, 5 with 3, 4 with 4.',
        'Tokens to win, 2019: 6 with 2 players, 5 with 3, 4 with 4, 3 with 5 or 6.',
        'The winner of a round starts the next one (one of them at random after a tie). If several players reach the target together, the most tokens wins, and an equal count shares the win.',
      ],
    },
    {
      title: 'Coming and going',
      bullets: [
        'Players joining during a game watch it, and are dealt in when the host starts the next one, if the edition has a seat free. When the host picks an edition with more seats, whoever was waiting for one sits down.',
        'Between games, in the lobby or on the final podium, anyone can tap Take a seat or Just watch. Someone who chose to watch stays watching until they take a seat again.',
        'Someone who leaves mid-round is knocked out and their hand is shown. With fewer than two players left the game ends, and the most tokens wins.',
      ],
    },
    {
      title: 'Timers (optional)',
      paragraphs: [
        'The host can set a time for each turn. By default it is just a reminder. In Strict mode, a player who runs out of time plays their lower card (the Countess if they must) at a random player, and a Guard names a random card. A Chancellor who runs out of time keeps a random card.',
      ],
    },
  ],
  tips: [
    'Count the discards: the deck holds a known number of each card, so what’s been played tells you what’s left. The Card count tab does the sum for you.',
    'Tap any card name, in the log, your notes or a result, to read the card in full.',
    'Keeping the Princess makes you a target. A Prince or a lucky Guard can knock you out.',
    'The Priest and the Baron tell you something nobody else knows. Use it before a King swaps it away.',
    'Playing the Countess doesn’t always mean you hold the King or a Prince; sometimes it’s a bluff.',
  ],
  glossary: [
    { term: 'Favour token', meaning: 'What you win for a round; collect enough to win the game.' },
    { term: 'Protected', meaning: 'Played the Handmaid: can’t be chosen until their next turn.' },
    {
      term: 'Set aside',
      meaning: 'The card removed face down at the start, so nobody can count every card.',
    },
    {
      term: 'Notes',
      meaning: 'What only you have learned this game, from a Priest, Baron or King.',
    },
  ],
};
