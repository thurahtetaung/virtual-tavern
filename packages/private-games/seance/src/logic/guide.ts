import type { GameGuide } from '@vt/game-sdk';

export const guide: GameGuide = {
  tagline: 'A ghost who cannot speak, a table of psychics, and seven hours to read its visions.',
  players: '3 to 7 (one ghost, 2 to 6 psychics)',
  duration: '40–60 minutes',
  goal: 'Everyone plays together. The ghost knows who was there, where it happened and with what, but can only send picture cards. Each psychic must find their own suspect, place and object before the seventh hour ends; then one last shared vision points to the culprit, and the psychics vote. Pick the right one and everyone wins.',
  quickStart: [
    'One player is the ghost; everyone else is a psychic. The ghost never speaks: no words, no faces, no nods.',
    'Each psychic secretly has a suspect, a place and an object among the cards on the table. Only the ghost knows which.',
    'Each hour the ghost sends every psychic one or more picture cards (visions) that point to their current card.',
    'Psychics talk it over out loud, tap the card they think it is, and tap Ready. Right: on to the next card. Wrong: keep the visions and get more next hour.',
    'Bet on each other’s guesses with ✓ and ✗ clairvoyance tokens: every right bet makes you more clear-sighted for the final.',
    'Find everything within 7 hours, then read the ghost’s shared vision of the culprit, and vote. The more clear-sighted you are, the more of it you see first.',
  ],
  setup: [
    'Sit down (3 to 7 players). The host chooses how the ghost is picked: at random, the host picks, or at random among volunteers. Psychics may pick which psychic (colour) they play.',
    'The host chooses the difficulty: more cards on the table make it harder, and fewer ravens leave the ghost stuck with bad cards. The host can also switch card sets on and off and set the turn timer.',
    'The game lays out suspect, place and object cards face up and secretly deals each psychic one of each. The rest are decoys. The ghost gets a hand of 7 vision cards.',
    'The ghost is best played on a tablet or a computer: comparing seven pictures with a target is easier on a big screen.',
  ],
  roles: [
    {
      name: 'Ghost',
      summary:
        'Knows every answer and helps only with vision cards. Silent all game: the app gives no way to type, and your friends will hold you to it out loud.',
    },
    {
      name: 'Psychic',
      summary:
        'Reads the visions, talks it through with the others, and guesses a suspect, then a place, then an object.',
    },
  ],
  sections: [
    {
      title: 'Difficulty',
      bullets: [
        'Cards on the table per kind (by players, ghost included, 3 → 7): Easy 5, 5, 6, 6, 7; Medium 6, 6, 7, 8, 8; Hard 7, 7, 8, 9, 9.',
        'Ravens let the ghost throw away any of their hand and draw back up to 7: Easy once every hour, Medium 3 times a game, Hard once a game. A raven can be used at any moment, even in the final.',
      ],
    },
    {
      title: 'An hour: visions',
      bullets: [
        'The ghost picks a psychic who is still searching, chooses one or more cards from their hand, and sends them. The hand fills back up to 7.',
        'Each psychic gets exactly one vision per hour; the ghost works round the table until everyone still searching has one.',
        'Psychics may start guessing as soon as their own vision arrives. Several psychics may pick the same card, but each card belongs to at most one of them.',
        'Once every vision is out, the timer starts (2 minutes by default). Talk freely; the ghost may listen but never react. Tap Ready when you are happy; the hour ends early when everyone still searching is ready. Psychics who have found all three can still play tokens until then.',
        'The host chooses what 0:00 does: a reminder (the host can lock the guesses in) or strict (the guesses lock by themselves; no guess counts as wrong).',
      ],
    },
    {
      title: 'Clairvoyance tokens',
      paragraphs: [
        'With 4 or more players, each psychic has clairvoyance tokens (4 each with 4–5 players, 6 each with 6–7). Put a ✓ on another psychic’s guess if you think it is right, or a ✗ if you think it is wrong; at most one token per guess, and never on your own. You can move or take them back until the guesses lock.',
        'Every token is spent when the hour ends, and they all come back at the start of hour IV. Each token that turns out right moves you one step along the clairvoyance track.',
      ],
    },
    {
      title: 'An hour: the verdicts',
      bullets: [
        'The app judges every guess at once (the ghost doesn’t have to).',
        'Right: the psychic takes that card, discards their visions and moves on to the next kind (suspect, then place, then object).',
        'Wrong: they keep their visions, and the ghost adds more next hour.',
        'A psychic who finds all three moves along the track one step for each hour left on the clock (finishing in hour IV is worth 3), then keeps helping the others and can still play tokens.',
        'Then the clock moves on. If anyone is still searching at the end of hour VII, the connection is lost and everyone loses.',
      ],
    },
    {
      title: 'The final: the culprit',
      bullets: [
        'Each psychic’s three cards become a numbered group. One of them is the real culprit’s.',
        'Line-up: while the ghost chooses, study the groups and talk freely. From the moment the shared vision is out, nobody speaks until every vote is in.',
        'The ghost picks the culprit’s group and three cards from their hand: one pointing to its suspect, one to its place, one to its object. The app shuffles them, so nobody knows which is which.',
        'The cards turn over one at a time. Psychics low on the track vote after the first card, those in the middle after the second, and the most clear-sighted after all three (with 4–5 players: up to 4, 5–6, 7 and up; with 6–7: up to 6, 7–9, 10 and up). Vote in silence: votes stay hidden until everyone has voted.',
        'With 3 players there are no tokens and no track: all three cards are face up for both psychics.',
        'The group with the most votes is the verdict. A tie goes to the tied group chosen by the psychic furthest along the track, then by whoever found their three cards first, then by seat order.',
        'If the verdict is the culprit’s group, everyone wins, the ghost included. At the end you see what the ghost meant by each card.',
      ],
    },
    {
      title: 'If someone drops out',
      bullets: [
        'If a psychic leaves, their seat stays: anyone watching can take it over and carry on with the same cards.',
        'If the ghost goes away, the game simply waits for them. The host can hand the ghost’s seat to someone watching (or a new joiner), never to a psychic, who would then see the answers. If the ghost leaves the room for good, anyone watching can take the seat.',
      ],
    },
  ],
  tips: [
    'Ghost: look for shapes, colours and details that only your target shares. Several cards that agree are clearer than one.',
    'Psychics: say out loud what you see in your visions, and compare them with the other psychics’ visions too: a card that suits someone else’s vision is probably not yours.',
    'Tap a card to see it big. The compare view keeps your vision pinned while you swipe through the candidates.',
    'Tokens are cheap until hour IV: use them.',
  ],
  glossary: [
    { term: 'Vision', meaning: 'A picture card the ghost sends to point at something.' },
    { term: 'Guess', meaning: 'The card a psychic picks this hour (their intuition).' },
    {
      term: 'Clairvoyance',
      meaning: 'How clear-sighted a psychic is: it decides how much of the final vision they see.',
    },
    { term: 'Raven', meaning: 'The ghost throws away cards from their hand and draws new ones.' },
  ],
};
