import type { GameGuide, GuideContext, GuideFooter, GuideOption, GuideTile } from '@vt/game-sdk';
import { CARDS, NOBLES } from './cards.ts';
import { LEVEL_NAME, TOKEN_EMOJI, TOKEN_NAME } from './gems.ts';
import { type Manifest, artOf, footerOf } from './manifest.ts';
import {
  DEFAULT_TARGET,
  GEMS,
  GEMS_FOR,
  GOLD_PIECES,
  type JewellerView,
  LEVELS,
  type Level,
  MAX_TARGET,
  type Token,
} from './types.ts';

export { type Manifest, footerOf } from './manifest.ts';

/** Art for the guide, from the private manifest. */
export interface GuideArt {
  tokens?: Partial<Record<Token, string>>;
  backs?: Partial<Record<Level, string>>;
  noble?: string;
  box?: string;
}

const TARGET: GuideOption = { key: 'target', label: 'Higher target' };
const SHOWN: GuideOption = { key: 'showReserved', label: 'Reserved cards shown' };

const TOKEN_TEXT: Record<Token, string> = {
  white: 'A white gem. Pay it for white costs; white cards give a lasting white discount.',
  blue: 'A blue gem. Pay it for blue costs; blue cards give a lasting blue discount.',
  green: 'A green gem. Pay it for green costs; green cards give a lasting green discount.',
  red: 'A red gem. Pay it for red costs; red cards give a lasting red discount.',
  black: 'A black gem. Pay it for black costs; black cards give a lasting black discount.',
  gold: 'Wild: pays for any colour. The only way to get one is to reserve a card.',
};

const LEVEL_TEXT: Record<Level, string> = {
  1: 'Cheap cards, mostly without points: build your discounts here first.',
  2: 'Mid-priced cards worth 1 to 3 points.',
  3: 'Expensive cards worth 3 to 5 points: the big finish.',
};

const count = (level: Level) => CARDS.filter((c) => c.level === level).length;

function base(art: GuideArt): GameGuide {
  const tiles: GuideTile[] = [
    ...(['white', 'blue', 'green', 'red', 'black', 'gold'] as const).map((t): GuideTile => ({
      id: t,
      name: TOKEN_NAME[t],
      icon: TOKEN_EMOJI[t],
      text: TOKEN_TEXT[t],
      meta:
        t === 'gold'
          ? `${GOLD_PIECES} pieces`
          : `${GEMS_FOR[2]} / ${GEMS_FOR[3]} / ${GEMS_FOR[4]} pieces for 2 / 3 / 4 players`,
      tone: t === 'gold' ? 'own' : 'neutral',
      ...(art.tokens?.[t] && { art: art.tokens[t] }),
    })),
    ...LEVELS.map((l): GuideTile => ({
      id: `level-${l}`,
      name: `Level ${LEVEL_NAME[l]} cards`,
      icon: '🃏',
      text: `${LEVEL_TEXT[l]} Every card gives one lasting discount in its colour.`,
      meta: `${count(l)} cards · 4 face up`,
      tone: 'neutral',
      ...(art.backs?.[l] && { art: art.backs[l] }),
    })),
    {
      id: 'nobles',
      name: 'Nobles',
      icon: '👑',
      text: 'Each noble wants cards (not gems) in certain colours. Own enough and the noble visits you at the end of your turn: 3 points, free.',
      meta: `${NOBLES.length} in the box · players + 1 on the table`,
      tone: 'good',
      ...(art.noble && { art: art.noble }),
    },
  ];
  return {
    tagline: 'Collect gems, buy cards for lasting discounts and points, and win the nobles over.',
    players: '2 to 4',
    duration: '30 minutes',
    goal: `Have the most points when the game ends. Once someone reaches ${DEFAULT_TARGET} points, the round is finished and the game ends.`,
    quickStart: [
      'On your turn, do one thing: take gems, reserve a card, or buy a card.',
      'Take 3 gems of different colours, or 2 of one colour from a pile of 4 or more.',
      'Buy a card by paying its cost in gems. Each card you own is a lasting discount in its colour.',
      'Reserve a card to keep it for later and take a gold, which pays for any colour.',
      'Own the cards a noble wants and they visit you: 3 points.',
      `First to ${DEFAULT_TARGET} points ends the game at the end of that round. Most points wins.`,
    ],
    steps: [
      {
        title: 'Take gems',
        text: 'Take 3 gems of different colours, or 2 of the same colour from a pile that has at least 4. Hold at most 10 pieces at the end of your turn.',
        icon: '💎',
        ...(art.tokens?.white && { art: art.tokens.white }),
      },
      {
        title: 'Buy cards',
        text: 'Pay a card’s cost and keep it. Each card is a lasting discount: a red card takes one red off every later cost. Many cards also score points.',
        icon: '🃏',
        ...(art.backs?.[1] && { art: art.backs[1] }),
      },
      {
        title: 'Reserve for later',
        text: 'Take a face-up card (or the top of a deck) into your hand, plus a gold, which pays for any colour. Up to 3 in hand; buy them on a later turn.',
        icon: '🟡',
        ...(art.tokens?.gold && { art: art.tokens.gold }),
      },
      {
        title: 'Nobles come to you',
        text: 'Each noble wants a number of cards in certain colours. Have them at the end of your turn and the noble visits: 3 points.',
        icon: '👑',
        ...(art.noble && { art: art.noble }),
      },
      {
        title: 'Race to the target',
        text: `When someone reaches ${DEFAULT_TARGET} points, finish the round so everyone has had as many turns. Most points wins; a tie goes to fewer cards bought.`,
        icon: '🏆',
      },
    ],
    stepsDone: 'Tap 📖 Rules any time to read the details.',
    setup: [
      'Everyone sits down; 2 to 4 can play, others can watch. The first player is picked at random.',
      'Each level’s cards are shuffled, and 4 of each are dealt face up.',
      `Gem piles: ${GEMS_FOR[2]} of each colour with 2 players, ${GEMS_FOR[3]} with 3, ${GEMS_FOR[4]} with 4, and ${GOLD_PIECES} gold. One more noble than there are players goes on the table.`,
    ],
    sections: [
      {
        title: 'Your turn',
        level: 'basics',
        bullets: [
          'Do exactly one of these: take 3 gems of different colours, take 2 gems of one colour, reserve a card, or buy a card.',
          'Two of one colour are only allowed from a pile with at least 4 in it before you take.',
          'Gold is never taken: you get one only by reserving.',
          'Buy a face-up card or one you reserved. Your cards’ discounts come off first; pay the rest in gems and gold.',
          'A bought or reserved face-up card is replaced from its deck at once.',
        ],
      },
      {
        title: 'Discounts and points',
        level: 'basics',
        bullets: [
          'Every card shows its colour, its points and its cost.',
          'Each card you own takes one gem of its colour off every later purchase, for the rest of the game.',
          'If your discounts cover a colour completely, you pay nothing in it.',
          'Your score is the points on your cards plus 3 for each noble.',
        ],
      },
      {
        title: 'Gem rules in detail',
        level: 'details',
        bullets: [
          'When fewer than 3 colours are left in the piles, you may take one of each colour that is left (2, or 1). Only then.',
          'At the end of your turn you may hold at most 10 pieces, gold included. Hand back any you choose, even ones you just took.',
          'Gold pays for any colour on any purchase, even when you hold that colour. The app pays with gems first; you can switch pieces to gold.',
          'Spent pieces go back to the piles.',
        ],
      },
      {
        title: 'Reserving',
        level: 'details',
        bullets: [
          'Take a face-up card, or the top card of a deck without showing it, into your hand. Then take a gold if any are left (if not, you still reserve).',
          'You may hold up to 3 reserved cards. They leave your hand only when you buy them.',
          'Reserved cards are kept like a hand: the others see how many you have and their level, not which cards.',
        ],
      },
      {
        title: 'Nobles',
        level: 'details',
        bullets: [
          'At the end of your turn, if your cards (not your gems) meet a noble’s needs, that noble visits you: 3 points. You can’t refuse.',
          'At most one noble visits per turn. If you qualify for more than one, you choose.',
          'A noble you still qualify for may visit at the end of a later turn, if nobody else has taken it.',
          'A noble visit is not an action: it happens whatever you did that turn.',
        ],
      },
      {
        title: 'The end',
        level: 'details',
        bullets: [
          `When a player has ${DEFAULT_TARGET} or more points at the end of their turn (a noble counts), the round is finished: play on until the player before the first player has had their turn.`,
          'The most points wins. A tie goes to whoever bought the fewest cards; still tied, they share the win.',
          'Reserved cards don’t count as bought, and cost nothing at the end.',
        ],
      },
      {
        title: 'A higher target',
        level: 'edge',
        option: TARGET,
        bullets: [
          `The host can set the target anywhere from ${DEFAULT_TARGET} to ${MAX_TARGET} points, for a longer game. The round is still finished once someone reaches it.`,
        ],
      },
      {
        title: 'Reserved cards shown',
        level: 'edge',
        option: SHOWN,
        bullets: [
          'The host can show cards reserved from the face-up rows to everyone, for a friendlier table.',
          'A card reserved from the top of a deck stays hidden: nobody else ever saw it.',
        ],
      },
      {
        title: 'Passing',
        level: 'edge',
        bullets: [
          'You can only pass when there is nothing at all you may do: no gems to take, 3 cards reserved, and nothing you can afford. The app offers Pass only then.',
        ],
      },
      {
        title: 'Timers and leaving',
        level: 'edge',
        bullets: [
          'The host can set a time for each turn. By default it is a reminder, and the host may tap Act for to play a turn for someone.',
          'In Strict mode, a player out of time takes gems (the fullest piles); if they can’t, they reserve, then buy the cheapest card they can, then pass. Pieces over 10 go back from what they hold most of, gold last, and the first noble that qualifies visits. The log marks those moves with ⏱.',
          'Someone who leaves mid-game keeps their seat, and the table plays their turns the same way after a short pause. If they come back, they carry on.',
          'Players joining during a game watch, and are seated at the next one if there is room.',
        ],
      },
    ],
    tiles: {
      label: 'Pieces',
      blurb: 'Gems, gold, card levels and nobles',
      intro: 'Everything on the table. Tap one to read it.',
      shape: 'square',
      items: tiles,
    },
    reference: [
      {
        title: 'Your turn: one of',
        head: ['Action', 'What you get', 'Limits'],
        rows: [
          ['Take 3 different', '3 gems, 3 colours', 'Fewer colours left: one of each'],
          ['Take 2 the same', '2 gems, 1 colour', 'Pile has 4 or more'],
          ['Reserve', 'A card in hand + a gold', 'Up to 3 in hand'],
          ['Buy', 'A card: discount and points', 'Discounts first, then gems, gold for anything'],
        ],
      },
      {
        title: 'End of your turn',
        head: ['Step', 'What happens'],
        rows: [
          ['Over 10 pieces?', 'Hand back pieces of your choice'],
          ['A noble qualifies?', 'It visits (pick one if several)'],
          [`${DEFAULT_TARGET}+ points?`, 'Finish the round, then the game ends'],
        ],
      },
      {
        title: 'Setup by players',
        head: ['Players', 'Gems per colour', 'Gold', 'Nobles'],
        rows: [2, 3, 4].map((n) => [`${n}`, `${GEMS_FOR[n]}`, `${GOLD_PIECES}`, `${n + 1}`]),
      },
    ],
    tips: [
      'Early on, cheap cards are worth more than points: every discount makes the next card cheaper.',
      'Watch the nobles: a few cards in their colours are 3 free points.',
      'Reserve a card someone else is about to buy, and you get a gold for it.',
      'Near 10 pieces, buying beats taking: you can’t keep more than 10.',
      'Glowing cards are ones you can buy now; the numbers show what each still costs you.',
    ],
    glossary: [
      {
        term: 'Discount (bonus)',
        meaning: 'The gem on each card you own: one off that colour, forever.',
      },
      { term: 'Reserve', meaning: 'Take a card into your hand to buy later, with a gold.' },
      { term: 'Pieces', meaning: 'Your gems and gold. At most 10 at the end of your turn.' },
    ],
  };
}

/** The guide with art when there is some. */
export function makeGuide(art: GuideArt = {}, footer?: GuideFooter): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as JewellerView;
    if (!v?.settings) return undefined;
    const seated = v.game?.players.length ?? v.seats.filter((s) => s.playing).length;
    const target = v.settings.target;
    const options = [
      ...(target !== DEFAULT_TARGET ? [TARGET.key] : []),
      ...(v.settings.showReserved ? [SHOWN.key] : []),
    ];
    const n = Math.min(4, Math.max(2, seated));
    return {
      summary: `${seated} players · first to ${target} points${v.settings.showReserved ? ' · reserved cards shown' : ''}`,
      options,
      inGame: {
        ...Object.fromEntries(GEMS.map((g) => [g, GEMS_FOR[n]!])),
        gold: GOLD_PIECES,
        'level-1': count(1),
        'level-2': count(2),
        'level-3': count(3),
        nobles: n + 1,
      },
    };
  };
  return {
    ...base(art),
    presets: [
      {
        id: 'standard',
        label: `First to ${DEFAULT_TARGET}`,
        context: { summary: 'The usual game.', options: [] },
      },
      {
        id: 'long',
        label: 'Higher target',
        context: { summary: 'A longer game, with a higher target.', options: [TARGET.key] },
      },
    ],
    ...(footer && { footer }),
    room,
  };
}

/** The guide without art, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const url = (path: string) => `/api/backroom/assets/jeweller/${path.replace(/^\/+/, '')}`;

/** The guide with the manifest's art and credits. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = (manifest && typeof manifest === 'object' ? manifest : null) as Manifest | null;
  const a = (p: string | undefined) => (p ? url(p) : undefined);
  const art: GuideArt = { tokens: {}, backs: {} };
  for (const t of ['white', 'blue', 'green', 'red', 'black', 'gold'] as const) {
    const u = a(typeof m?.tokens?.[t] === 'string' ? m.tokens[t] : undefined);
    if (u) art.tokens![t] = u;
  }
  for (const l of LEVELS) {
    const u = a(typeof m?.backs?.[`${l}`] === 'string' ? m.backs[`${l}`] : undefined);
    if (u) art.backs![l] = u;
  }
  const noble = a(artOf(m?.nobles?.[NOBLES[0]!.id]));
  if (noble) art.noble = noble;
  const box = a(typeof m?.box === 'string' ? m.box : undefined);
  if (box) art.box = box;
  return makeGuide(art, footerOf(m));
}
