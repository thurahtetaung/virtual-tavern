import type { GameGuide, GuideContext, GuideFooter, GuideOption, GuideTile } from '@vt/game-sdk';
import {
  BASE_SUITS,
  type DeckOptions,
  SUIT_NAME,
  SUIT_SYMBOL,
  type Suit,
  deckFor,
  handSize,
  maxScore,
} from './cards.ts';
import { type Manifest, artOf, cardKey, footerOf } from './manifest.ts';
import type { SkyfireView } from './types.ts';

export { type Manifest, footerOf } from './manifest.ts';

/** Art for the guide, from the private manifest. */
export interface GuideArt {
  suits?: Partial<Record<Suit, string>>;
  back?: string;
  clue?: string;
  fuse?: string;
  tagline?: string;
}

const MULTI: GuideOption = { key: 'multicolour', label: 'Multicolour' };
const SIXTH: GuideOption = { key: 'multicolour-6th', label: 'Multicolour as a 6th colour' };
const ONE_EACH: GuideOption = { key: 'multicolour-one-each', label: 'Multicolour, one of each' };
const WILD: GuideOption = { key: 'multicolour-wild', label: 'Wild multicolour' };
const BLACK: GuideOption = { key: 'black-powder', label: 'Black powder' };
const EXPERT: GuideOption = { key: 'expert-ending', label: 'The expert ending' };
const NORMAL_END: GuideOption = {
  key: 'expert-ending',
  label: 'Without the expert ending',
  off: true,
};

function base(art: GuideArt): GameGuide {
  const suitTile = (suit: Suit): GuideTile => ({
    id: suit,
    name: `${SUIT_NAME[suit]} ${SUIT_SYMBOL[suit]}`,
    icon: SUIT_SYMBOL[suit],
    text: `Ten cards: three 1s, two each of 2, 3 and 4, and one 5. Its firework is built 1, 2, 3, 4, 5, and a ${SUIT_NAME[suit].toLowerCase()} clue touches every one.`,
    meta: 'Always in the game',
    group: 'Colours',
    tone: 'neutral',
    ...(art.suits?.[suit] && { art: art.suits[suit] }),
  });
  const tiles: GuideTile[] = [
    ...BASE_SUITS.map(suitTile),
    {
      id: 'multi',
      name: `Multicolour ${SUIT_SYMBOL.multi}`,
      icon: SUIT_SYMBOL.multi,
      text: 'A sixth firework, built 1 to 5 like the others. The host picks how it plays: as its own colour (10 cards), its own colour with one of each number (5 cards), or wild (10 cards that every colour clue touches and no clue can name).',
      meta: 'Host option · the top score becomes 30',
      group: 'Colours',
      tone: 'alien',
      option: MULTI,
      ...(art.suits?.multi && { art: art.suits.multi }),
    },
    {
      id: 'black',
      name: `Black powder ${SUIT_SYMBOL.black}`,
      icon: SUIT_SYMBOL.black,
      text: 'Ten black cards (three 5s, two each of 4, 3 and 2, one 1), built the other way: 5 first, 1 last. No colour clue touches them, so only numbers reach them. They add no points; each one missing costs 1.',
      meta: 'Host option',
      group: 'Colours',
      tone: 'evil',
      option: BLACK,
      ...(art.suits?.black && { art: art.suits.black }),
    },
    {
      id: 'clue',
      name: 'Clue tokens',
      icon: '💡',
      text: 'Eight of them. A clue spends one; a discard brings one back, and so does finishing a firework (unless all eight are back already).',
      meta: '8 on the table',
      group: 'Tokens',
      tone: 'good',
      ...(art.clue && { art: art.clue }),
    },
    {
      id: 'fuse',
      name: 'Fuses',
      icon: '🧨',
      text: 'Three of them. A card played where it doesn’t fit burns one. When the third burns, the show goes up in smoke: it scores 0.',
      meta: '3 on the table',
      group: 'Tokens',
      tone: 'evil',
      ...(art.fuse && { art: art.fuse }),
    },
    {
      id: 'expert',
      name: 'The expert ending',
      icon: '🏆',
      text: 'A perfect show or nothing. There is no last round: play goes on after the deck runs out. Losing the last copy of a needed card, the third fuse, or a player starting a turn with no cards loses the show.',
      meta: 'Host option',
      group: 'Variants',
      tone: 'own',
      option: EXPERT,
    },
  ];
  return {
    tagline:
      art.tagline ??
      'A cooperative fireworks show: see everyone’s cards but your own, and give careful clues.',
    players: '2 to 5 (best at 3 or 4)',
    duration: '20 minutes',
    goal: 'Together, build five fireworks, one per colour, each from 1 up to 5. You hold your cards facing away: you see everyone’s hand but your own, so the table has to tell you what you hold.',
    quickStart: [
      'You see every hand but your own: yours shows only the backs, with the clues you were given.',
      'On your turn do one thing: give a clue, play a card, or discard a card.',
      'A clue spends a token: tell one player every card of one colour, or every card of one number, they hold.',
      'Play a card: it goes on its colour’s firework if it’s the next number, else a fuse burns.',
      'Discard a card to win a clue token back. You draw after playing or discarding.',
      'Three fuses and the show is over. When the deck runs out, everyone gets one last turn.',
    ],
    steps: [
      {
        title: 'You can’t see your cards',
        text: 'Everyone sees your hand except you. Your cards show as backs, with whatever clues have told you about them.',
        icon: '🙈',
        ...(art.back && { art: art.back }),
      },
      {
        title: 'One thing a turn',
        text: 'Give a clue, play a card, or discard a card. There is no passing.',
        icon: '👆',
      },
      {
        title: 'Clues',
        text: 'Spend a clue token to point out every card of one colour, or every card of one number, in one other player’s hand.',
        icon: '💡',
        ...(art.clue && { art: art.clue }),
      },
      {
        title: 'Play in order',
        text: 'A played card goes on its colour’s firework if it is the next number (1, then 2…). If not, it is discarded and a fuse burns.',
        icon: '🎆',
        ...(art.suits?.red && { art: art.suits.red }),
      },
      {
        title: 'Discard for clues',
        text: 'Discarding wins a clue token back, but the card is gone. Watch for the last copy of a card you still need.',
        icon: '🗑️',
      },
      {
        title: 'The end',
        text: 'Three fuses end the show at 0. Otherwise, when the deck runs out everyone has one last turn; the score is the top card of every firework.',
        icon: '🏁',
        ...(art.fuse && { art: art.fuse }),
      },
    ],
    stepsDone: 'Tap 📖 Rules any time to read the details.',
    setup: [
      'Two to five sit down; anyone else watches. Best at 3 or 4.',
      'Hands: 5 cards each with 2 or 3 players, 4 cards each with 4 or 5.',
      'Eight clue tokens are ready and no fuse has burned. The first player is picked at random, then the next seat starts each new game.',
    ],
    sections: [
      {
        title: 'Your turn',
        level: 'basics',
        bullets: [
          'Do exactly one thing: give a clue, play a card, or discard a card. You can’t pass.',
          'You see every other hand, never your own. Your cards show as backs with the clues they got.',
          'Talk is up to the table, but the rules say: don’t coach the player whose turn it is.',
        ],
      },
      {
        title: 'Giving a clue',
        level: 'basics',
        bullets: [
          'Costs one clue token; with none left you can’t give a clue.',
          'Pick one other player and either one colour or one number.',
          'The clue points out every matching card in their hand, never just some of them. The app does the pointing, so it is always complete and true.',
          'By default a clue may touch no card at all (“you have no blue”). The host can switch empty clues off.',
        ],
      },
      {
        title: 'Playing a card',
        level: 'basics',
        bullets: [
          'Tap a card of yours and play it. You don’t pick the firework: it goes to its own colour.',
          'If it is the next number of its firework, it is added. A firework starts with a 1.',
          'If not, it goes to the discards and a fuse burns.',
          'Either way, you draw a new card, which arrives on the left of your hand.',
          'Finishing a firework with its 5 wins a clue token back (lost if all eight are back).',
        ],
      },
      {
        title: 'Discarding a card',
        level: 'basics',
        bullets: [
          'Put a card of yours in the discards, win a clue token back, and draw.',
          'You can’t discard while all eight clue tokens are back.',
          'The discards are open: anyone can look through them. The app sorts them and marks the last copies of cards still needed.',
        ],
      },
      {
        title: 'How the show ends',
        level: 'basics',
        option: NORMAL_END,
        bullets: [
          'The third fuse ends the show at once. It is lost and scores 0; the end screen still says what the fireworks reached.',
          'Every firework finished ends it at once with the top score.',
          'When someone draws the last card, everyone (them included) takes one more turn, then the show ends. Nobody draws in that round.',
        ],
      },
      {
        title: 'Scoring',
        level: 'details',
        bullets: [
          'Add up the top card of each firework: 25 at most, 30 with a multicolour suit.',
          '0–5: booed. 6–10: mediocre. 11–15: honourable. 16–20: excellent. 21–24: amazing. 25 and up: legendary. 30: divine.',
        ],
      },
      {
        title: 'Your hand',
        level: 'details',
        bullets: [
          'Drag your cards to put them in any order, as you would at the table. Everyone sees the new order.',
          'New cards arrive on the left, so your oldest card is on the right. Cards never move by themselves.',
        ],
      },
      {
        title: 'What the app remembers',
        level: 'details',
        bullets: [
          'The host picks how much help the app gives. Marks (the usual): every card shows the clues that touched it and what it is known not to be.',
          'Full help: each card of yours also lists what it can still be, counting every card you can see (the discards, the fireworks and the other hands).',
          'Memory: no marks, as at the table. A clue you see stays highlighted until the end of your next turn; the whole log comes back in the end replay.',
        ],
      },
      {
        title: 'Multicolour as a sixth colour',
        level: 'details',
        option: SIXTH,
        bullets: [
          'Ten multicolour cards (three 1s, two each of 2, 3 and 4, one 5) build a sixth firework.',
          'They are a colour of their own: a multicolour clue touches them, and no other colour clue does.',
          'The top score is 30: 25 to 29 is legendary, 30 divine.',
        ],
      },
      {
        title: 'Multicolour, one of each',
        level: 'details',
        option: ONE_EACH,
        bullets: [
          'As the sixth colour, but with one multicolour card of each number, five in all. Every one is a last copy.',
          'The top score is 30.',
        ],
      },
      {
        title: 'Wild multicolour',
        level: 'details',
        option: WILD,
        bullets: [
          'Ten multicolour cards build a sixth firework, 1 to 5.',
          'Every colour clue touches them as well: a red clue points out the red cards and the multicolour ones. No clue can name multicolour.',
          'A card touched by two different colour clues must be multicolour. “You have no red” also means no multicolour.',
          'The top score is 30.',
        ],
      },
      {
        title: 'Black powder',
        level: 'details',
        option: BLACK,
        bullets: [
          'A black firework is built the other way: 5 first, down to 1. Its ten cards are three 5s, two each of 4, 3 and 2, and one 1.',
          'Black cards are colourless: no colour clue touches them, and the app never offers “black” as a clue. Number clues reach them.',
          'Finishing it with the black 1 wins a clue token back, as any firework does.',
          'Black cards add no points: each black card missing from its firework costs 1, so it starts at −5 and a finished one adds nothing. A score can go below zero.',
        ],
      },
      {
        title: 'The expert ending',
        level: 'details',
        option: EXPERT,
        bullets: [
          'A perfect show wins; anything else loses and scores 0, though the end screen says what the fireworks reached.',
          'There is no last round: play goes on after the deck runs out, and hands shrink.',
          'The show is lost at once when the last copy of a card still needed is discarded or misplayed (the table sees which), when the third fuse burns, or when a player starts a turn with no cards.',
        ],
      },
      {
        title: 'Reactions',
        level: 'details',
        bullets: [
          'There is no chat during a game: talk out loud or on your call. After any turn, anyone may send a quick reaction (👏 🎆 😬 🙈 🤔 😂).',
          'At the end, the replay steps through every turn with every hand face up, yours included.',
        ],
      },
      {
        title: 'Timers and leaving',
        level: 'edge',
        bullets: [
          'The host can set a turn timer. By default it is a reminder, and the host may tap Act for to move for a player.',
          'In Strict mode, or when the host acts for a player, the app makes the safe move: discard their oldest unclued card if discarding is allowed; otherwise a random clue that touches a card; with no clue token and every card clued, discard their oldest card. It never plays a card for anyone. In the rare case with all eight tokens and no clue possible, it does nothing.',
          'A player who leaves keeps their hand; the app makes the safe move on their turns after a short pause. If they come back, they carry on.',
          'The host can end the show at any time: it ends as it stands, “ended early”, with what the fireworks reached as its score. It counts as no win and sets no room record.',
        ],
      },
      {
        title: 'Table rulings',
        level: 'edge',
        bullets: [
          'The expert ending lost (a needed card gone, or a player starting a turn with no cards) scores 0, like the third fuse; the end screen says what the fireworks reached. Only a perfect show wins.',
          'The safe move when every card is clued: a random clue if a token is left, else discard the oldest card. With all eight tokens and no clue possible, nothing is done and the host decides.',
          'Full help counts the copies you can see in the other hands too, as a careful player would.',
          'Playing from memory, a clue still lands for everyone and stays in your log until the end of your next turn; there is no full clue log until the end replay.',
          'A show the host ends early scores what the fireworks reached (not 0), counts as no win and sets no room record.',
          'With black powder a score can be negative: it is shown as it is, and anything up to 5 is booed.',
        ],
      },
    ],
    tiles: {
      label: 'Cards',
      blurb: 'Five colours, two extra suits, tokens and the expert ending',
      intro: 'Everything on the table. Tap one to read it.',
      shape: 'square',
      items: tiles,
    },
    reference: [
      {
        title: 'Your turn',
        head: ['Action', 'Tokens', 'Then'],
        rows: [
          ['Give a clue', '−1 clue', 'Next player'],
          ['Play a card that fits', 'A 5 wins +1 clue', 'Draw'],
          ['Play a card that doesn’t fit', 'A fuse burns', 'Draw'],
          ['Discard a card (not with all 8 back)', '+1 clue', 'Draw'],
        ],
      },
      {
        title: 'Hands and decks',
        head: ['Players', 'Cards each'],
        rows: [
          ['2 or 3', '5'],
          ['4 or 5', '4'],
        ],
        note: 'Deck: 50 cards; 60 with a ten-card multicolour suit or black powder, 55 with one of each, 70 with both.',
      },
      {
        title: 'The scale',
        head: ['Score', 'The crowd'],
        rows: [
          ['0–5', 'Booed'],
          ['6–10', 'Mediocre'],
          ['11–15', 'Honourable'],
          ['16–20', 'Excellent'],
          ['21–24', 'Amazing'],
          ['25–29', 'Legendary'],
          ['30', 'Divine'],
        ],
      },
    ],
    tips: [
      'A clue usually means “play this” or “keep this”: a teammate pointing at your newest card often wants it played.',
      'Discard your oldest unclued card (the right end): it is the one the table expects you to let go.',
      'Look through the discards before you let a card go: the last copy of a needed card caps its firework for good.',
      'Keep a clue token or two in hand: a player with nothing to say has to discard.',
      'The 5s have one copy each: save them with a number clue rather than let them be discarded.',
    ],
    glossary: [
      {
        term: 'Firework',
        meaning: 'The stack of one colour on the table, built 1 to 5 (black: 5 to 1).',
      },
      {
        term: 'Clue',
        meaning: 'One colour or one number, told to one player, pointing at every matching card.',
      },
      {
        term: 'Last copy',
        meaning: 'A card whose other copies are all in the discards; losing it caps its firework.',
      },
      {
        term: 'Oldest card',
        meaning:
          'The card longest in your hand: the right end, since new cards arrive on the left.',
      },
    ],
  };
}

const optionsOf = (s: SkyfireView['settings']): string[] => [
  ...(s.multi !== 'off' ? [MULTI.key] : []),
  ...(s.multi === '6th' ? [SIXTH.key] : []),
  ...(s.multi === 'one-each' ? [ONE_EACH.key] : []),
  ...(s.multi === 'wild' ? [WILD.key] : []),
  ...(s.black ? [BLACK.key] : []),
  ...(s.expert ? [EXPERT.key] : []),
];

const inGameOf = (o: DeckOptions, expert: boolean): Record<string, number> => {
  const out: Record<string, number> = { clue: 8, fuse: 3, ...(expert && { expert: 1 }) };
  for (const c of deckFor(o)) out[c.suit] = (out[c.suit] ?? 0) + 1;
  return out;
};

/** The guide with art when there is some. */
export function makeGuide(art: GuideArt = {}, footer?: GuideFooter): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as SkyfireView;
    if (!v?.settings) return undefined;
    const seated = v.game?.players.length ?? v.seats.filter((s) => s.playing).length;
    const o: DeckOptions = { multi: v.settings.multi, black: v.settings.black };
    const extras = [
      ...(o.multi !== 'off' ? ['multicolour'] : []),
      ...(o.black ? ['black powder'] : []),
      ...(v.settings.expert ? ['expert ending'] : []),
    ];
    return {
      summary: `${seated} players · ${handSize(Math.max(2, seated))} cards each · top score ${maxScore(o)}${extras.length ? ` · ${extras.join(', ')}` : ''}`,
      options: optionsOf(v.settings),
      inGame: inGameOf(o, v.settings.expert),
    };
  };
  return {
    ...base(art),
    presets: [
      {
        id: 'base',
        label: 'The base game',
        context: {
          summary: 'Five colours, 50 cards.',
          options: [],
          inGame: inGameOf({ multi: 'off', black: false }, false),
        },
      },
      {
        id: 'wild',
        label: 'Wild multicolour',
        context: {
          summary: 'Six fireworks; every colour clue touches multicolour.',
          options: [MULTI.key, WILD.key],
          inGame: inGameOf({ multi: 'wild', black: false }, false),
        },
      },
      {
        id: 'black',
        label: 'Black powder',
        context: {
          summary: 'A colourless black firework, built 5 down to 1.',
          options: [BLACK.key],
          inGame: inGameOf({ multi: 'off', black: true }, false),
        },
      },
      {
        id: 'expert',
        label: 'The expert ending',
        context: {
          summary: 'A perfect show or nothing.',
          options: [EXPERT.key],
          inGame: inGameOf({ multi: 'off', black: false }, true),
        },
      },
    ],
    ...(footer && { footer }),
    room,
  };
}

/** The guide without art, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const url = (path: string) => `/api/backroom/assets/skyfire/${path.replace(/^\/+/, '')}`;

/** The guide with the manifest's art and credits. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = (manifest && typeof manifest === 'object' ? manifest : null) as Manifest | null;
  const a = (p: string | undefined) => (p ? url(p) : undefined);
  const art: GuideArt = {};
  const cards = m?.cards && typeof m.cards === 'object' ? m.cards : {};
  const suits: Partial<Record<Suit, string>> = {};
  for (const suit of [...BASE_SUITS, 'multi', 'black'] as const) {
    const u = a(artOf(m?.suits?.[suit]) ?? artOf(cards[cardKey(suit, 5)]));
    if (u) suits[suit] = u;
  }
  if (Object.keys(suits).length) art.suits = suits;
  const back = a(artOf(m?.back));
  if (back) art.back = back;
  const clue = a(artOf(m?.tokens?.clue));
  if (clue) art.clue = clue;
  const fuses = m?.tokens?.fuse;
  const fuse = a(Array.isArray(fuses) ? artOf(fuses[1]?.unused ?? fuses[0]?.unused) : artOf(fuses));
  if (fuse) art.fuse = fuse;
  const tagline = typeof m?.guide?.tagline === 'string' ? m.guide.tagline.trim().slice(0, 200) : '';
  if (tagline) art.tagline = tagline;
  return makeGuide(art, footerOf(m));
}
