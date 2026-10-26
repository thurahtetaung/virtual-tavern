import type { GameGuide, GuideContext, GuideFooter, GuideOption, GuideTile } from '@vt/game-sdk';
import {
  GROUP_WORDS,
  HAND_SIZE,
  PRESETS,
  TYPES,
  TYPE_IDS,
  type TypeId,
  dessertsFor,
  fullMenu,
} from './cards.ts';
import {
  type Manifest,
  type Names,
  PLAIN_NAMES,
  artOf,
  clean,
  footerOf,
  namesOf,
} from './manifest.ts';
import type { ConveyorView } from './types.ts';

export { type Manifest, footerOf } from './manifest.ts';

/** Art for the guide, from the private manifest. */
export interface GuideArt {
  /** Each dish's picture (its menu tile, else a card). */
  types?: Partial<Record<TypeId, string>>;
  back?: string;
  tagline?: string;
}

const TWO: GuideOption = { key: 'two', label: '2 players' };
const PILES: GuideOption = { key: 'drawPile', label: 'Draw piles (2 players)' };
const BOTH: GuideOption = { key: 'passBoth', label: 'Pass both ways' };
const GOLF: GuideOption = { key: 'golf', label: 'Golf: lowest wins' };

const TAGLINE =
  'Pick a dish from your hand, pass the rest along, and build the tastiest tray over three rounds.';

/** What each dish does, in plain words. */
function texts(n: Names): Record<TypeId, { text: string; more?: string[] }> {
  const t = (id: TypeId) => n.type(id);
  return {
    nigiri: {
      text: `Egg 1, salmon 2, squid 3 points. On a ${t('wasabi')}, triple.`,
      more: ['4 egg, 5 salmon, 3 squid.'],
    },
    wasabi: {
      text: `Worth nothing alone. The next nigiri you play goes on it and scores triple. One nigiri per ${t('wasabi')}; several can wait.`,
      more: [
        `An egg still has to go on it if it is your next nigiri.`,
        'Same colour as nigiri for tea and soy sauce.',
      ],
    },
    maki: {
      text: 'Count the roll icons on your cards. Most icons 6, second most 3. With 6 or more players: 6, 4 and 2. Ties all score in full; you need at least one card.',
      more: [
        'Cards show 1, 2 or 3 icons.',
        'After a tie for most, the next count down is still second.',
      ],
    },
    temaki: {
      text: 'Most cards +4. Fewest, even none, −4 (not with 2 players). Ties take the full amount.',
      more: ['If everyone has as many, nobody scores.'],
    },
    uramaki: {
      text: 'A race: the first to have 10 icons scores 8 at once and discards them, the next 5, the next 2. At the round’s end, whoever has the most icons left takes the next place still free.',
      more: [
        'Reached in the same turn: more icons first; still tied, both take that place and the next is skipped.',
        'At the round’s end only one place is scored, and you need at least one card.',
      ],
    },
    tempura: { text: 'Each pair scores 5. An odd one scores nothing.' },
    sashimi: { text: 'Each set of three scores 10. One or two score nothing.' },
    dumpling: { text: '1, 3, 6, 10, then 15 for five or more.' },
    eel: { text: 'One alone is −3. Two or more score 7 (once).' },
    tofu: { text: 'One 2, two 6, three or more 0. Stop at two!' },
    onigiri: {
      text: 'Four shapes. Each set of different shapes scores 1, 4, 9 or 16 for 1 to 4 shapes. You can score several sets.',
      more: ['Two of each shape: ● ▲ ■ ▬.'],
    },
    edamame: {
      text: 'Each scores 1 for every other player with any edamame, up to 4. Alone it is worth nothing.',
      more: ['Only with 3 or more players.'],
    },
    miso: {
      text: 'Worth 3, unless two or more are played in the same turn (by anyone, any way): then all of them are discarded.',
    },
    chopsticks: {
      text: `Nothing now. On a later turn, call it with your pick: after the reveal, play a second card from your hand, then put the ${t('chopsticks')} back in the hand you pass on.`,
      more: ['One bonus (chopsticks or spoon) a turn.', 'Numbered 1 to 3: they act first.'],
    },
    spoon: {
      text: `Nothing now. On a later turn, call it with your pick: after the reveal, name a dish (or one exact card). The first player to your left holding it gives you one, which you play at once, and your ${t('spoon')} goes into their hand.`,
      more: [
        'Nobody has it: the spoon is discarded.',
        'Only you and the giver see what you asked for.',
        'Only with 3 or more players. Numbered 4 to 6.',
      ],
    },
    menu: {
      text: 'When played, draw 4 cards from the deck, play one of them (not another menu) and shuffle the rest back. The menu is then discarded.',
      more: ['Only with 2 to 6 players. Numbered 7 to 9.'],
    },
    takeout: {
      text: 'When played, turn any of your cards from earlier turns this round face down. Each is worth 2 at the round’s end. The box is discarded.',
      more: [
        'Zero is fine.',
        'A face-down wasabi lets its nigiri back to face value; a face-down nigiri leaves its wasabi used.',
        'Numbered 10 to 12: they act last.',
      ],
    },
    order: {
      text: 'Copies a card you played on an earlier turn this round, and scores as it. You choose what it copies when you pick it.',
      more: [
        'Copying a nigiri gives a plain nigiri, which goes on an empty wasabi; copying a wasabi gives an empty one.',
        'A copied dessert is kept like one, and counts as one for the tiebreak.',
        'A copied face-down card is face down too. Nothing to copy: it is discarded.',
        'Only with 2 to 6 players.',
      ],
    },
    soy: {
      text: 'At the round’s end, count the colours of your cards. If you have the most (or tie), each soy sauce scores 4.',
      more: [
        'This round’s desserts count; desserts from earlier rounds don’t.',
        'Face-down cards are a colour of their own.',
      ],
    },
    tea: {
      text: 'At the round’s end, scores 1 for each card of your biggest single colour (cards, not points). Each tea scores.',
      more: ['Nigiri and wasabi are one colour. Face-down cards are a colour of their own.'],
    },
    pudding: {
      text: 'Kept to the end. Most +6, fewest (even none) −6 (not with 2 players). Ties take the full amount.',
    },
    icecream: { text: 'Kept to the end. Each set of four scores 12.' },
    fruit: {
      text: 'Kept to the end. For each fruit (🍉 🍍 🍊), count its icons: 0 → −2, 1 → 0, 2 → 1, 3 → 3, 4 → 6, 5+ → 10.',
      more: ['Cards show two of one fruit or one each of two.', 'No fruit at all costs 6.'],
    },
  };
}

const PLAYERS_LINE = (t: TypeId) => {
  const [lo, hi] = TYPES[t].players;
  return lo === 2 && hi === 8 ? '' : ` · ${lo} to ${hi} players`;
};

function base(art: GuideArt, n: Names): GameGuide {
  const words = texts(n);
  const count = (t: TypeId) => TYPES[t].variants.reduce((s, x) => s + x.count, 0);
  const tiles: GuideTile[] = TYPE_IDS.map((t) => {
    const info = TYPES[t];
    const pic = art.types?.[t];
    return {
      id: t,
      name: n.type(t),
      group: GROUP_WORDS[info.group][1].replace(/^./, (c) => c.toUpperCase()),
      icon: info.emoji,
      text: words[t].text,
      meta: `${count(t)} cards${PLAYERS_LINE(t)}`,
      tone: info.group === 'desserts' ? 'good' : info.group === 'specials' ? 'own' : 'neutral',
      ...(pic && { art: pic, card: pic }),
      ...(words[t].more && { more: { title: 'Details', items: words[t].more } }),
    };
  });
  return {
    tagline: art.tagline ?? TAGLINE,
    players: '2 to 8 (best with 4 or 5)',
    duration: '10 to 15 minutes',
    goal: 'Score the most points over three rounds by picking the right dishes, while watching what your neighbours need.',
    quickStart: [
      'Everyone picks one card from their hand at the same time, in secret.',
      'All the picks turn over together and go in front of their owners.',
      'Then everyone passes the rest of their hand to the next player.',
      'When the hands are empty, the round is scored. Desserts wait for the end.',
      'After three rounds, the most points wins.',
    ],
    steps: [
      {
        title: 'Pick one',
        text: 'Choose one card from your hand and lock it in. Nobody sees it until everyone has picked; you can change your mind until then.',
        icon: '🍣',
      },
      {
        title: 'Reveal together',
        text: 'Every pick turns over at once and goes in front of its owner. Some specials act now, in their card number order.',
        icon: '🎴',
      },
      {
        title: 'Pass the rest',
        text: 'Your hand goes to the next player and you get your neighbour’s. Watch what they collect: you may want to take a card they need.',
        icon: '🔄',
      },
      {
        title: 'Score the round',
        text: 'When the hands are empty, every tray is scored dish by dish. Desserts are kept to the end.',
        icon: '🧮',
      },
      {
        title: 'Three rounds',
        text: 'Fresh hands each round. After round 3 the desserts score, and the most points wins. A tie goes to most desserts.',
        icon: '🏆',
      },
    ],
    stepsDone: 'Tap 📖 Rules any time; the menu strip shows what each dish does.',
    setup: [
      'The host picks a menu: one of eight suggested ones, a random one, or their own (nigiri, 1 roll, 3 appetizers, 2 specials, 1 dessert).',
      'Hands: 10 cards each with 2 or 3 players, 9 with 4 or 5, 8 with 6 or 7, 7 with 8.',
      'Desserts go into the deck before each round: 5, 3, 2 with up to 5 players; 7, 5, 3 with 6 or more.',
    ],
    sections: [
      {
        title: 'A turn',
        level: 'basics',
        bullets: [
          'Pick one card from your hand. Nobody sees which until everyone has picked; until then you can change it.',
          'When everyone has picked, all the picks turn over together and go in front of their owners.',
          'Then everyone passes the rest of their hand to the next player (left), and the next turn starts.',
          'Cards in front of you stay there until the round ends.',
        ],
      },
      {
        title: 'The menu',
        level: 'basics',
        bullets: [
          'Each game uses nigiri plus 1 roll, 3 appetizers, 2 specials and 1 dessert: the menu.',
          'The strip at the top of the table shows the menu; tap a dish to read what it does.',
          'Some dishes only work with some table sizes: the lobby greys them out.',
        ],
      },
      {
        title: 'Scoring',
        level: 'basics',
        bullets: [
          'When every hand is empty, each dish in front of you scores (see each dish).',
          'Desserts are set aside and scored after round 3.',
          'Then all the other cards are shuffled back into the deck, new desserts go in, and fresh hands are dealt.',
          'Scores can go below zero. The most points after three rounds wins; a tie goes to whoever has more desserts, then it is shared.',
        ],
      },
      {
        title: 'Chopsticks and spoons',
        level: 'details',
        bullets: [
          'They do nothing on the turn you play them. On a later turn, call one when you pick (one a turn).',
          'Chopsticks: after the reveal, play a second card from your hand; the chopsticks go back into the hand you pass on.',
          'Spoon: after the reveal, ask for a dish or an exact card. The first player to your left with one in hand gives it to you (they choose which, for a whole dish), and you play it at once. Your spoon goes into their hand. If nobody has it, the spoon is discarded.',
          'A spoon called on the last turn always misses: the hands are empty.',
        ],
      },
      {
        title: 'What happens after the reveal',
        level: 'details',
        bullets: [
          'Everyone’s pick goes down first.',
          'Then the numbered cards act, lowest first: chopsticks (1–3), spoons (4–6), menus (7–9), takeout boxes (10–12).',
          'A card you get from a spoon or a menu acts at once.',
          'Then the uramaki race is checked, then miso clashes, and the hands are passed.',
        ],
      },
      {
        title: 'Desserts',
        level: 'details',
        bullets: [
          'Desserts you play are kept in your dessert jar and scored only after round 3.',
          'Each round adds new desserts to the deck: 5, 3 and 2 with up to 5 players; 7, 5 and 3 with 6 or more.',
          'Only this round’s desserts count as a colour for tea and soy sauce.',
        ],
      },
      {
        title: 'Two players',
        level: 'details',
        option: TWO,
        bullets: [
          'Spoon and edamame are left out. Temaki and pudding take nothing from the player with fewest.',
          'Menu, special order, takeout box and miso soup work well with two.',
        ],
      },
      {
        title: 'Draw piles',
        level: 'edge',
        option: PILES,
        bullets: [
          'A host option for 2 players: you start each round with 5 cards in hand and 5 in your own face-down pile.',
          'On turns 2 to 6, after the hands are passed, you draw the top card of your own pile. So you never know the whole of your opponent’s hand.',
        ],
      },
      {
        title: 'Pass both ways',
        level: 'edge',
        option: BOTH,
        bullets: ['Rounds 1 and 3 pass to the left, round 2 to the right.'],
      },
      {
        title: 'Golf',
        level: 'edge',
        option: GOLF,
        bullets: [
          'The lowest score wins instead. Scoring is the same.',
          'A tie goes to whoever has fewer desserts, then it is shared.',
        ],
      },
      {
        title: 'Table rulings',
        level: 'edge',
        bullets: [
          'Chopsticks: you choose the second card after seeing everyone’s reveal.',
          'Maki: after a tie for most, the next count down is still second. Uramaki skips the place after a tie.',
          'Temaki and pudding: if everyone has as many, nobody scores.',
          'Uramaki at the round’s end needs at least one card, and only the next free place is scored.',
          'Special order: you choose what it copies when you pick it. Brought by chopsticks, a spoon or a menu, it may also copy this turn’s card. It never copies a used menu or takeout box, or cards that left your tray.',
          'A takeout box may turn nothing over. A face-down wasabi lets its nigiri back to face value; a face-down nigiri leaves its wasabi used.',
          'Spoon: only its player and the giver see the request. A giver who must choose has 15 seconds, then a random card that fits is given.',
          'Several wasabis wait for one nigiri each; a nigiri never triples twice.',
        ],
      },
      {
        title: 'Timers and leaving',
        level: 'edge',
        bullets: [
          'By default each pick and each choice has a 30-second reminder, and the host may tap Act for to choose for someone. The host can change the time or turn the clock off.',
          'In Strict mode, a player out of time gets a random card (and a random target or dish); a takeout box turns nothing over. The log marks those with ⏱.',
          'Someone who leaves mid-game keeps their seat (their hand must keep moving), and the table picks for them the same way after a short pause. If they come back, they carry on.',
          'Between rounds everyone taps Ready; the next round starts by itself after 30 seconds, or when the host deals.',
        ],
      },
    ],
    tiles: {
      label: 'Dishes',
      blurb: '23 dishes · each game uses 8',
      intro: 'Every dish and what it scores. Tap one to read it.',
      shape: 'square',
      items: tiles,
    },
    reference: [
      {
        title: 'Hands and desserts',
        head: ['Players', 'Hand', 'Desserts by round'],
        rows: [2, 3, 4, 5, 6, 7, 8].map((k) => [
          `${k}`,
          `${HAND_SIZE[k]}`,
          [1, 2, 3].map((r) => dessertsFor(k, r)).join(' · '),
        ]),
      },
      {
        title: 'Quick scores',
        head: ['Dish', 'Scores'],
        rows: TYPE_IDS.map((t) => [n.type(t), TYPES[t].short]),
      },
      {
        title: 'Suggested menus',
        head: ['Menu', 'Dishes'],
        rows: PRESETS.map((p) => [
          n.menu(p.id, p.name),
          fullMenu(p.types)
            .map((t) => n.type(t))
            .join(', '),
        ]),
      },
    ],
    tips: [
      'Watch the player you pass to: if they need one more sashimi, think twice before passing it.',
      'Wasabi early, squid later: a squid on wasabi is 9.',
      'Two tofu is great; a third ruins them.',
      'Desserts are slow points; with pudding, having none costs 6.',
      'Chopsticks shine when a hand has two cards you want.',
    ],
    glossary: [
      { term: 'Tray', meaning: 'The cards in front of you this round.' },
      { term: 'Dessert jar', meaning: 'Your desserts, kept to the end of the game.' },
      { term: 'Bonus', meaning: 'Chopsticks or a spoon called on a later turn.' },
      {
        term: 'Face down',
        meaning: 'Turned over by a takeout box: worth 2, no longer the dish it was.',
      },
    ],
  };
}

/** The guide with art and names when there are some. */
export function makeGuide(
  art: GuideArt = {},
  footer?: GuideFooter,
  names: Names = PLAIN_NAMES,
): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as ConveyorView;
    if (!v?.settings) return undefined;
    const seated = v.game?.players.length ?? v.seats.filter((s) => s.playing).length;
    const menu = v.game ? fullMenu(v.game.menu) : null;
    const preset =
      v.game?.preset ??
      (v.settings.menu !== 'random' && v.settings.menu !== 'custom' ? v.settings.menu : null);
    const presetName = preset ? PRESETS.find((p) => p.id === preset) : undefined;
    const options = [
      ...(seated === 2 ? [TWO.key] : []),
      ...(seated === 2 && v.settings.drawPile ? [PILES.key] : []),
      ...(v.settings.passBoth ? [BOTH.key] : []),
      ...(v.settings.golf ? [GOLF.key] : []),
    ];
    return {
      summary: `${seated} players · ${presetName ? names.menu(presetName.id, presetName.name) : v.settings.menu === 'random' ? 'random menu' : 'own menu'}${v.settings.golf ? ' · golf' : ''}`,
      options,
      ...(menu && {
        inGame: Object.fromEntries(
          menu.map((t) => [t, TYPES[t].variants.reduce((s, x) => s + x.count, 0)]),
        ),
      }),
    };
  };
  return {
    ...base(art, names),
    presets: PRESETS.map((p) => ({
      id: p.id,
      label: names.menu(p.id, p.name),
      context: {
        summary: p.blurb,
        inGame: Object.fromEntries(
          fullMenu(p.types).map((t) => [t, TYPES[t].variants.reduce((s, x) => s + x.count, 0)]),
        ),
      },
    })),
    ...(footer && { footer }),
    room,
  };
}

/** The guide without art, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const url = (path: string) => `/api/backroom/assets/conveyor/${path.replace(/^\/+/, '')}`;

/** The guide with the manifest's names, art and credits. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = (manifest && typeof manifest === 'object' ? manifest : null) as Manifest | null;
  const art: GuideArt = { types: {} };
  const cards = m?.cards && typeof m.cards === 'object' ? m.cards : {};
  const tiles = m?.tiles && typeof m.tiles === 'object' ? m.tiles : {};
  for (const t of TYPE_IDS) {
    const path = artOf(tiles[t]) ?? artOf(cards[TYPES[t].variants[0]!.id]);
    if (path) art.types![t] = url(path);
  }
  const back = artOf(m?.back);
  if (back) art.back = url(back);
  const tagline = clean(m?.guide?.tagline);
  if (tagline) art.tagline = tagline;
  return makeGuide(art, footerOf(m), namesOf(m));
}
