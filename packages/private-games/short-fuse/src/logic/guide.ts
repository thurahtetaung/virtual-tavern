import type { GameGuide, GuideContext, GuideFooter, GuideOption, GuideTile } from '@vt/game-sdk';
import { CARDS, CARD_TYPES, type CardType, type SetId } from './cards.ts';
import { GLYPHS, type Names, PLACEHOLDER_NAMES, RULES, fillNames } from './names.ts';
import type { ShortFuseView } from './types.ts';

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
const X2_CARDS: CardType[] = [
  'shelter',
  'superskip',
  'peek5',
  'alter5',
  'swap',
  'recycle',
  'stack',
  'mark',
  'blind',
];
const X3_CARDS: CardType[] = [
  'twin',
  'vault',
  'mine',
  'bury',
  'self3',
  'potluck',
  'share3',
  'alter3now',
];
const X4_CARDS: CardType[] = [
  'revive',
  'dig',
  'ghostattack',
  'feed',
  'copy',
  'seer',
  'robber',
  'shufflenow',
];

const CATS = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5'] as const;
const cardLine = (t: CardType) =>
  t === 'cat1'
    ? `Cats (5 kinds: ${CATS.map((c) => `{c:${c}}`).join(', ')}): ${RULES[t]}`
    : `{c:${t}}: ${RULES[t]}`;

const X1: GuideOption = { key: 'x1', label: 'Expansion 1' };
const X2: GuideOption = { key: 'x2', label: 'Expansion 2' };
const X3: GuideOption = { key: 'x3', label: 'Expansion 3' };
const X4: GuideOption = { key: 'x4', label: 'Expansion 4' };
const EXPANSIONS = { x1: X1, x2: X2, x3: X3, x4: X4 } as const;
const PARTY: GuideOption = { key: 'party', label: 'Party deck' };
const LEVELS: Record<string, { level: 'basics' | 'details' | 'edge'; option?: GuideOption }> = {
  'Your turn': { level: 'basics' },
  '{Bombs} and {c:defuse}': { level: 'basics' },
  'The {c:nope} countdown': { level: 'basics' },
  'Attacks and owed turns': { level: 'details' },
  Combos: { level: 'details' },
  'The cards': { level: 'details' },
  'When Expansion 1 is on': { level: 'details', option: X1 },
  'When Expansion 2 is on': { level: 'details', option: X2 },
  'When Expansion 3 is on': { level: 'details', option: X3 },
  'When Expansion 4 is on': { level: 'details', option: X4 },
  'Ghosts and the other expansions': { level: 'edge', option: X4 },
  'Party deck and big tables': { level: 'edge' },
  'House and legacy rules': { level: 'edge' },
};

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
    'Sit down in the lobby (2 to 10 players). The host picks a deck: Classic, the 18+ Adult deck (same rules, different art), the Party deck, Zombie (Classic with Expansion 4) or Chaos (everything at once), and can add Expansions 1 to 4 in any mix.',
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
      title: 'When Expansion 2 is on',
      paragraphs: [
        'One more {bomb} goes in (as many as there are players). Hold a {c:shelter} and the next {bomb} you draw stays quietly in your hand instead of exploding; lose the {c:shelter} (stolen, given, put in the pile) and that {bomb} goes off on you. Anyone who takes a {bomb} from your hand has to deal with it.',
        'A {c:blind} turns your hand face down and shuffled: every card you play is a random one, a card that can’t be played that way is lost, and with a {bomb} you turn cards over one at a time hoping for a {c:defuse}. Drawing a card safely takes the blindfold off.',
      ],
      bullets: X2_CARDS.map(cardLine),
    },
    {
      title: 'When Expansion 3 is on',
      paragraphs: [
        'Six cards are dealt face down as the Stash before the hands. Whoever plays the {c:vault} wears it with the Stash for the rest of the game: anything stolen from them (a {c:favor}, a pair, three of a kind) comes from the Stash at random until it’s empty.',
        'NOW cards can be played by anyone between actions, even off their turn.',
      ],
      bullets: X3_CARDS.map(cardLine),
    },
    {
      title: 'When Expansion 4 is on',
      paragraphs: [
        'Everyone starts with a {c:revive} instead of a {c:defuse} (up to five players; from the sixth on, the rest get a {c:defuse}), and no spare {c:defuse} cards go in the pile.',
        'Explode and you don’t leave: you become a ghost. You keep your hand and take no turns, but you can still play {c:nope} and NOW cards, and nobody can take cards from you. Ghosts can’t win.',
        'A {c:revive} saves you from a {bomb}. If anyone is a ghost you must bring one back: then you hide your {bomb} and theirs back in the pile, one after the other, in secret. Nobody can {c:nope} it, but everyone gets the usual countdown, in which {c:seer} lets its holders watch the hiding.',
      ],
      bullets: X4_CARDS.map(cardLine),
    },
    {
      title: 'Party deck and big tables',
      bullets: [
        'The Party deck plays 2 to 10 with its own cards (including {c:aim}, {c:bottom} and {c:alter3}), picking the right subset for the table size.',
        'The Classic deck above 5 players adds cards from a second deck, about 10 a player, and more {c:defuse} cards.',
        'Faster game takes a third of the pile out at random before the {bombs} go in (with Expansion 4 alone, the pile is cut to 15, 20, 25, 30 or 35 cards by table size).',
        'Chaos (all four expansions) keeps at most 12 cards a player in the pile before the {bombs} go in, so games stay party-length.',
        'At two players Expansion 4 leaves out {c:ghostattack}, {c:robber}, {c:feed} and its two {c:superskip} cards.',
      ],
    },
    {
      title: 'Ghosts and the other expansions',
      bullets: [
        'Exploding as a ghost discards anything face up in front of you; a {c:vault} and its Stash stay with you.',
        '{c:recycle} and {c:potluck} skip ghosts; {c:share3} still shows the cards to a ghost in the next seat.',
        'A ghost holding the other {c:twin} may stay silent: a {c:twin} never barks at a ghost. Killed by the {c:twin} cards, both go back into the pile, shuffled, if you’re brought back.',
        'A {c:void} that killed you goes back face up when you’re brought back; a {c:revive} never answers a face-up {c:void}.',
        'Blindfolded ghosts stay blindfolded. Lose your {c:shelter} as a ghost while hiding a {bomb}, and it goes off the moment you’re back.',
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
    'As a ghost, keep your {c:nope} cards: you can still spoil the living players’ plans.',
  ],
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

/** "a {bomb}" → "an Ember" when the name starts with a vowel (and "an {c:x}" → "a Bolt"). */
export function fillArticles(text: string, names: Names): string {
  return text.replace(
    /\b([Aa])n? (\{(?:c:[\w-]+|bombs?|Bombs?)\})/g,
    (_m, a: string, token: string) => {
      const word = fillNames(token, names);
      return `${/^[AEIOUaeiou]/.test(word) ? `${a}n` : a} ${token}`;
    },
  );
}

/** What the browser knows about a card's art (URLs) and printed text. */
export interface CardArt {
  face?: (t: CardType) => string | undefined;
  text?: (t: CardType) => string | undefined;
  back?: string;
}

/** The guide in an edition's words (unlocked browsers), with an optional credits footer. */
export function nameGuide(names: Names, footer?: GuideFooter, art: CardArt = {}): GameGuide {
  const fill = <T>(v: T) => fillDeep(articled(v, names), names);
  const g = fill(RAW);
  const card = (t: CardType) => names.cards[t];
  const face = (t: CardType) => art.face?.(t);
  const tiles: GuideTile[] = CARD_TYPES.map((t) => {
    const set: SetId = CARDS[t].set;
    const exp = set === 'core' ? undefined : set;
    const f = face(t);
    return {
      id: t,
      name: card(t),
      text: fill(RULES[t]),
      group: exp ? (names.sets[exp] ?? EXPANSIONS[exp].label) : 'Core',
      icon: GLYPHS[t],
      tone:
        t === 'bomb' || t === 'void'
          ? 'evil'
          : t === 'defuse' || t === 'revive'
            ? 'good'
            : 'neutral',
      ...(art.text?.(t) && { meta: `On the card: “${art.text(t)}”` }),
      ...(exp && {
        option: { ...EXPANSIONS[exp], label: names.sets[exp] ?? EXPANSIONS[exp].label },
      }),
      ...(f && { art: f }),
    };
  });
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as ShortFuseView;
    if (!v?.settings) return undefined;
    const s = v.settings;
    const players = v.seats.filter((x) => x.playing).length;
    const on = (['x1', 'x2', 'x3', 'x4'] as const).filter((x) => s[x]);
    const types = CARD_TYPES.filter((t) => {
      const set = CARDS[t].set;
      // Super Skip comes with the second, third and fourth expansions.
      if (t === 'superskip') return on.some((x) => x !== 'x1');
      return set === 'core' || on.some((x) => x === set);
    });
    return {
      summary: [
        names.sets[s.core === 'party' ? 'party' : s.art === 'adult' ? 'adult' : 'classic'],
        ...on.map((x) => names.sets[x] ?? EXPANSIONS[x].label),
        `${players} ${players === 1 ? 'player' : 'players'}`,
        `${s.nopeSeconds} s ${card('nope')} countdown`,
      ].join(' · '),
      options: [...on, ...(s.core === 'party' ? [PARTY.key] : [])],
      inGame: Object.fromEntries(types.map((t) => [t, 1])),
    };
  };
  const stepArt = (t: CardType) => (face(t) ? { art: face(t)! } : {});
  return {
    ...g,
    sections: g.sections.map((sec, i) => ({ ...sec, ...LEVELS[RAW.sections[i]!.title] })),
    steps: [
      {
        title: 'Play cards, then draw',
        text: g.quickStart![0]!,
        icon: '🃏',
        ...(art.back && { art: art.back }),
      },
      { title: fill('Drew a {bomb}?'), text: g.quickStart![1]!, icon: '💣', ...stepArt('defuse') },
      { title: 'Explode and you’re out', text: g.quickStart![2]!, icon: '💥', ...stepArt('bomb') },
      { title: 'Dodge your draw', text: g.quickStart![3]!, icon: '⏭️', ...stepArt('attack') },
      { title: fill('{c:nope}!'), text: g.quickStart![4]!, icon: '✋', ...stepArt('nope') },
      {
        title: 'Watch the pile, pair your cats',
        text: g.quickStart![5]!,
        icon: '🐱',
        ...stepArt('cat1'),
      },
    ],
    tiles: {
      label: 'Cards',
      blurb: 'Every card, with what it does',
      intro: 'Every card in the box. Tap one to see it big and read what it does.',
      shape: 'card',
      items: tiles,
    },
    reference: [
      {
        title: 'Combos',
        head: ['Play', 'You get'],
        rows: [
          ['Two with the same name', 'A random card from another player'],
          ['Three with the same name', 'Name a card: they hand it over if they have it'],
          [fill('Five different (legacy)'), 'Any card from the discard pile'],
        ],
      },
      {
        title: 'Owed turns',
        head: ['When', 'The next player owes'],
        rows: [
          [fill('An {c:attack} on a normal turn'), '2 turns'],
          [fill('An {c:attack} straight back (owing 2)'), '4 turns'],
          [fill('An {c:attack} after one of your 2 turns'), '3 turns'],
          ['You explode while owing', 'Nothing: the turns vanish'],
          [fill('A {c:ghostattack} (Expansion 4)'), '3 turns for every ghost, plus any owed'],
        ],
      },
      {
        title: fill('Ghosts (Expansion 4)'),
        head: ['As a ghost, can you…', 'Answer'],
        rows: [
          ['keep your hand (and any Vault)?', 'Yes'],
          ['take turns?', 'No'],
          [fill('play {c:nope} and NOW cards?'), 'Yes, any time'],
          ['be picked for a Favor, a pair or three of a kind?', 'No'],
          ['come back?', fill('Yes, with someone else’s {c:revive}')],
          ['win?', 'No: only a living player wins'],
        ],
      },
    ],
    presets: [
      {
        id: 'classic',
        label: names.sets.classic ?? 'Classic deck',
        context: {
          summary: 'The core cards only.',
          options: [],
          inGame: Object.fromEntries(
            CARD_TYPES.filter((t) => CARDS[t].set === 'core').map((t) => [t, 1]),
          ),
        },
      },
      {
        id: 'party',
        label: names.sets.party ?? 'Party deck',
        context: {
          summary: 'The Party deck: the core cards for up to 10 players.',
          options: [PARTY.key],
          inGame: Object.fromEntries(
            CARD_TYPES.filter((t) => CARDS[t].set === 'core').map((t) => [t, 1]),
          ),
        },
      },
      ...(['x1', 'x2', 'x3', 'x4'] as const).map((x) => ({
        id: x,
        label: `+ ${names.sets[x] ?? EXPANSIONS[x].label}`,
        context: {
          summary: `The core cards with ${names.sets[x] ?? EXPANSIONS[x].label}.`,
          options: [x],
          inGame: Object.fromEntries(
            CARD_TYPES.filter((t) => CARDS[t].set === 'core' || CARDS[t].set === x).map((t) => [
              t,
              1,
            ]),
          ),
        },
      })),
      {
        id: 'chaos',
        label: 'Chaos (everything)',
        context: {
          summary: 'The core cards with all four expansions.',
          options: ['x1', 'x2', 'x3', 'x4'],
          inGame: Object.fromEntries(CARD_TYPES.map((t) => [t, 1])),
        },
      },
    ],
    room,
    ...(footer && { footer }),
  };
}

/** Fixes the article before each name token in every string of `v`. */
const articled = <T>(v: T, names: Names): T => {
  if (typeof v === 'string') return fillArticles(v, names) as T;
  if (Array.isArray(v)) return (v as unknown[]).map((x) => articled(x, names)) as T;
  if (v && typeof v === 'object' && !(v instanceof Function))
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, articled(x, names)]),
    ) as T;
  return v;
};

export const guide: GameGuide = nameGuide(PLACEHOLDER_NAMES);

export { type Manifest, faceOf, footerOf, namesOf } from './manifest.ts';
