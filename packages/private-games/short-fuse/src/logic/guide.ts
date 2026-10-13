import type { GameGuide, GuideFooter } from '@vt/game-sdk';
import { CARD_TYPES, type CardType } from './cards.ts';
import { type Names, PLACEHOLDER_NAMES, RULES, fillNames } from './names.ts';

/**
 * Short Fuse's rules, written with name tokens (`{c:attack}`, `{bomb}`, `{Bombs}`…). The guide
 * every browser gets uses the neutral placeholders; unlocked players see it named from the
 * private manifest (`nameGuide`), with the original game's credit as its footer.
 */

const CORE_CARDS: CardType[] = [
  'bomb',
  'defuse',
  'attack',
  'skip',
  'favor',
  'shuffle',
  'peek3',
  'nope',
  'cat1',
];
const X1_CARDS: CardType[] = ['void', 'wild', 'aim', 'reverse', 'bottom', 'alter3'];

const cardLine = (t: CardType) =>
  t === 'cat1' ? `Cats (5 kinds): ${RULES[t]}` : `{c:${t}}: ${RULES[t]}`;

const RAW: GameGuide = {
  tagline: 'Play your cards, draw one, and pray it isn’t a {bomb}. Last one standing wins.',
  players: '2 to 10 players',
  duration: '10–25 minutes',
  goal: 'Be the last player who hasn’t exploded. Every turn ends with a draw, and the pile hides {bombs}.',
  quickStart: [
    'On your turn, play as many cards as you like (or none), then draw one card. Drawing ends your turn.',
    'Draw a {bomb} and it explodes, unless you play a {c:defuse}: then hide the {bomb} back in the pile wherever you like.',
    'Explode and you’re out. The last player standing wins.',
    '{c:attack} and {c:skip} end your turn without drawing; an {c:attack} makes the next player take 2 turns.',
    'Anyone holding a {c:nope} can stop almost any play, even off their turn, while the short countdown runs.',
    'The pile always shows how many cards and {bombs} are left. Pairs of matching cats steal a card.',
  ],
  setup: [
    'Sit down in the lobby (2 to 10 players). The host picks a deck: Classic, the 18+ Adult deck (same rules, different art) or the Party deck, and can add Expansion 1.',
    'Everyone gets a {c:defuse} and 7 cards. {Bombs} go into the pile: one fewer than the players.',
    'A random player starts; play goes round the table in seat order.',
  ],
  sections: [
    {
      title: 'Your turn',
      bullets: [
        'Play any number of cards, one at a time (each one waits out the {c:nope} countdown first).',
        'Then draw the top card. That ends your turn, unless you owe more turns.',
        '{c:skip}, {c:attack} and some other cards end a turn without drawing.',
      ],
    },
    {
      title: '{Bombs} and {c:defuse}',
      bullets: [
        'Drawing a {bomb} shows it to everyone. With a {c:defuse} you survive: hide the {bomb} anywhere in the pile (top, bottom, anywhere) without anyone seeing where.',
        'Without one you explode: your hand leaves the game and you watch the rest.',
        'The pile shows its card count and how many {bombs} are still out there, never a percentage.',
      ],
    },
    {
      title: 'The {c:nope} countdown',
      paragraphs: [
        'After every play, everyone sees the same short countdown (4 seconds unless the host changes it). Only players holding a {c:nope} get the button, and the countdown always runs its full length, so nobody can tell who holds one.',
        'A {c:nope} cancels the play and restarts the countdown, so someone can {c:nope} the {c:nope} (that makes it go ahead again), and so on. The cards stay spent either way. {Bombs} and {c:defuse} can’t be Noped.',
      ],
    },
    {
      title: 'Attacks and owed turns',
      bullets: [
        'An {c:attack} ends your turn without drawing, and the next player takes 2 turns in a row.',
        'Attacks stack: attacked and attacking straight back sends 4 turns on; after taking one of your 2 turns, an {c:attack} sends 3.',
        'The badge on a player shows how many turns they owe. {c:skip} ends only one of them.',
        'If you explode while owing turns, they vanish; the next player takes a normal turn.',
      ],
    },
    {
      title: 'Combos',
      bullets: [
        'Any two cards with the same name: steal a random card from another player.',
        'Any three with the same name: name a card; if they have it, they hand it over.',
        'Combos ignore what the cards say, and they can be Noped. Players with no cards can’t be picked.',
      ],
    },
    {
      title: 'The cards',
      bullets: CORE_CARDS.map(cardLine),
    },
    {
      title: 'When Expansion 1 is on',
      paragraphs: [
        'The {c:void} replaces one of the {bombs}. The first time it’s drawn it goes back face up, and from then on everyone sees it in the side of the pile (exact for a short pile, roughly for a tall one).',
      ],
      bullets: X1_CARDS.map(cardLine),
    },
    {
      title: 'Party deck and big tables',
      bullets: [
        'The Party deck plays 2 to 10 with its own cards (including {c:aim}, {c:bottom} and {c:alter3}), picking the right subset for the table size.',
        'The Classic deck above 5 players adds cards from a second deck, about 10 a player, and more {c:defuse} cards.',
        'Faster game takes a third of the pile out at random before the {bombs} go in.',
      ],
    },
    {
      title: 'House and legacy rules',
      bullets: [
        'Five different cards (legacy): play 5 cards with different names to take any card from the discard pile.',
        'Non-stacking attacks (legacy): an attacked player’s {c:attack} passes on just 2 turns.',
        'Timers: a soft reminder clock is on by default; with strict timing the clock plays safe moves for you (draw, hide at random, keep the order, give a random card).',
      ],
    },
  ],
  tips: [
    'Save a {c:nope} for the {c:attack} that’s coming your way.',
    'Watch the pile count: fewer cards with the same {bombs} means danger.',
    'After you defuse, hiding the {bomb} on top is a gift for the next player.',
    'Count the {c:nope} cards: an even number means the play goes ahead after all.',
  ],
  glossary: CARD_TYPES.filter((t) => !/^cat[2-5]$/.test(t)).map((t) => ({
    term: t === 'cat1' ? 'Cats' : `{c:${t}}`,
    meaning: RULES[t],
  })),
};

const fillDeep = <T>(v: T, names: Names): T => {
  if (typeof v === 'string') return fillNames(v, names) as T;
  if (Array.isArray(v)) return (v as unknown[]).map((x) => fillDeep(x, names)) as T;
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fillDeep(x, names)]),
    ) as T;
  return v;
};

/** The guide in an edition's words (unlocked browsers), with an optional credits footer. */
export function nameGuide(names: Names, footer?: GuideFooter): GameGuide {
  const g = fillDeep(RAW, names);
  return footer ? { ...g, footer } : g;
}

export const guide: GameGuide = nameGuide(PLACEHOLDER_NAMES);

export { type Manifest, footerOf, namesOf } from './manifest.ts';
