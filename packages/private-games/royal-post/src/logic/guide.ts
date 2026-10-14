import type { GameGuide, GuideContext, GuideOption, GuideTile } from '@vt/game-sdk';
import type { RoyalPostView } from './types.ts';

// The card names are the same in every edition; `nameGuide` adds each card's art from the
// private manifest.

type Card =
  | 'spy'
  | 'guard'
  | 'priest'
  | 'baron'
  | 'handmaid'
  | 'prince'
  | 'chancellor'
  | 'king'
  | 'countess'
  | 'princess';

export interface RoyalPostNames {
  /** A card's art (a URL), from the Classic deck where it has one. */
  art?: (card: Card) => string | undefined;
  back?: string;
}

const NEW_2019: GuideOption = { key: '2019', label: '2019 edition' };

/** Rank, copies (Classic, 2019) and what it does, in our words. */
const CARDS: [Card, string, number | null, number, number, string][] = [
  [
    'spy',
    'Spy',
    null,
    0,
    2,
    'No effect when played; at the end of the round, the only player still in who played one gains a bonus token.',
  ],
  [
    'guard',
    'Guard',
    5,
    1,
    6,
    'Name a card other than the Guard and choose a player. If they hold it, they are out.',
  ],
  ['priest', 'Priest', 2, 2, 2, 'Look at another player’s hand. Only you see it.'],
  [
    'baron',
    'Baron',
    2,
    3,
    2,
    'Compare hands in secret with another player; the lower card is out.',
  ],
  [
    'handmaid',
    'Handmaid',
    2,
    4,
    2,
    'You can’t be chosen by other players’ cards until your next turn.',
  ],
  [
    'prince',
    'Prince',
    2,
    5,
    2,
    'Any player, you included, discards their hand and draws a new card.',
  ],
  [
    'chancellor',
    'Chancellor',
    null,
    6,
    2,
    'Draw two, keep one of the three, put the other two on the bottom of the deck.',
  ],
  ['king', 'King', 1, 6, 1, 'Trade hands with another player.'],
  [
    'countess',
    'Countess',
    1,
    7,
    1,
    'No effect, but you must play her if your other card is the King or a Prince.',
  ],
  ['princess', 'Princess', 1, 8, 1, 'If you play or discard her, you are out.'],
];
const rank2019 = (c: Card, classic: number) =>
  c === 'chancellor' ? 6 : ['king', 'countess', 'princess'].includes(c) ? classic + 1 : classic;

const LEVELS: Record<string, 'basics' | 'details' | 'edge'> = {
  'A round': 'basics',
  'The cards (Classic)': 'basics',
  'The cards (2019 edition)': 'details',
  'Ties and winning': 'details',
  'Your notes': 'details',
};

export function makeGuide(names: RoyalPostNames = {}): GameGuide {
  const plain = base();
  const tiles: GuideTile[] = CARDS.map(([id, name, classic, rank, n2019, text]) => {
    const art = names.art?.(id);
    const only2019 = classic === null;
    return {
      id,
      name,
      text,
      badge: String(rank),
      group: only2019 ? '2019 only' : 'Both editions',
      icon: '✉️',
      meta: only2019
        ? `Rank ${rank} · ×${n2019} · 2019 edition only`
        : `Rank ${rank}${rank2019(id, rank) !== rank ? ` (${rank2019(id, rank)} in the 2019 edition)` : ''} · ×${classic} (×${n2019} in 2019)`,
      ...(only2019 && { option: NEW_2019 }),
      ...(art && { art }),
    };
  });
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as RoyalPostView;
    if (!v?.settings) return undefined;
    const e2019 = v.settings.edition === '2019';
    return {
      summary: `${e2019 ? '2019 edition (21 cards)' : 'Classic (16 cards)'} · first to ${v.target} tokens${v.settings.short ? ' (short game)' : ''}`,
      options: e2019 ? [NEW_2019.key] : [],
      inGame: Object.fromEntries(
        CARDS.filter(([, , classic]) => e2019 || classic !== null).map(
          ([id, , classic, , n2019]) => [id, e2019 ? n2019 : classic!],
        ),
      ),
    };
  };
  const art = (c: Card) => (names.art?.(c) ? { art: names.art(c)! } : {});
  return {
    ...plain,
    sections: plain.sections.map((sec) => ({
      ...sec,
      level: LEVELS[sec.title] ?? 'edge',
      ...(sec.title === 'The cards (2019 edition)' && { option: NEW_2019 }),
    })),
    steps: [
      {
        title: 'One secret card',
        text: plain.quickStart![0]!,
        icon: '🂠',
        ...(names.back && { art: names.back }),
      },
      { title: 'Draw one, play one', text: plain.quickStart![1]!, icon: '🃏', ...art('guard') },
      { title: 'Knocked out?', text: plain.quickStart![2]!, icon: '💥', ...art('baron') },
      { title: 'Win the round', text: plain.quickStart![3]!, icon: '👑', ...art('princess') },
      { title: 'Count the discards', text: plain.quickStart![4]!, icon: '👀' },
      { title: 'First to the target', text: plain.quickStart![5]!, icon: '🏆' },
    ],
    tiles: {
      label: 'Cards',
      blurb: '8 cards (+2 in the 2019 edition)',
      intro: 'The 8 Classic cards, and the 2 the 2019 edition adds. Tap one to read it.',
      shape: 'card',
      items: tiles,
    },
    reference: [
      {
        title: 'The deck',
        head: ['Card', 'Rank', 'Classic', '2019'],
        rows: CARDS.map(([id, name, classic, rank, n2019]) => [
          name,
          classic === null
            ? String(rank)
            : rank2019(id, rank) === rank
              ? String(rank)
              : `${rank} (2019: ${rank2019(id, rank)})`,
          classic === null ? '–' : `×${classic}`,
          `×${n2019}`,
        ]),
      },
      {
        title: 'Tokens to win',
        head: ['Players', '2', '3', '4', '5–6'],
        rows: [
          ['Classic', '7', '5', '4', '–'],
          ['2019 edition', '6', '5', '4', '3'],
        ],
        note: 'A short game plays to 2 tokens fewer (never fewer than 2).',
      },
    ],
    presets: (['classic', '2019'] as const).map((ed) => ({
      id: ed,
      label: ed === 'classic' ? 'Classic (16 cards)' : '2019 edition (21 cards)',
      context: {
        summary:
          ed === 'classic'
            ? 'The Classic deck, for 2 to 4 players.'
            : 'The 2019 deck, for 2 to 6 players: the Spy and the Chancellor join.',
        options: ed === '2019' ? [NEW_2019.key] : [],
        inGame: Object.fromEntries(
          CARDS.filter(([, , classic]) => ed === '2019' || classic !== null).map(
            ([id, , classic, , n2019]) => [id, ed === '2019' ? n2019 : classic!],
          ),
        ),
      },
    })),
    room,
  };
}

function base(): GameGuide {
  return {
    tagline: 'One card in hand, one letter to deliver: deduce, protect and outlast to win favour.',
    players: '2 to 4 (Classic) or 2 to 6 (2019 edition)',
    duration: '20 minutes',
    goal: 'Win rounds to collect favour tokens. You win a round by being the last player standing, or by holding the highest card when the deck runs out. The first to the token target wins the game.',
    quickStart: [
      'You hold one secret card. On your turn, draw a second, then play one of the two face up.',
      'Do what the played card says: guess a hand, peek at one, compare, swap or protect yourself.',
      'If a card knocks you out, you sit out the rest of the round.',
      'The last one standing, or the highest card when the deck runs out, wins a favour token. A tie the discards can’t break gives every tied player one.',
      'Watch the discards: every card played tells you what is left.',
      'The first to the token target wins the game.',
    ],
    setup: [
      'Everyone sits down; others can watch. The host picks the edition: Classic (16 cards, 2 to 4 players) or 2019 (21 cards, 2 to 6 players, with the Spy and the Chancellor).',
      'Each round the deck is shuffled and one card is set aside face down, unseen. With two players, three more are set aside face up for everyone to see: they are out of this round, so nobody holds them, and seeing them makes the cards in play easier to count.',
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
          'The round ends when only one player is left, or when the deck is empty after a turn. Then everyone still in shows their card and the highest wins a favour token. The result also shows how many tokens everyone has. The face-down set-aside card is never shown.',
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
          '0 · Spy (×2): no effect when played. At the end of the round, if exactly one player still in has played or discarded a Spy, they gain a bonus token, even if they didn’t win the round. If two players still in have both played one, nobody gets the bonus, and the result says so. A 🕶️ badge marks every player still in who has played a Spy.',
          '1 · Guard (×6), 2 · Priest (×2), 3 · Baron (×2), 4 · Handmaid (×2), 5 · Prince (×2): as in Classic. The Guard may also name the Spy.',
          '6 · Chancellor (×2): draw two cards, keep one of the three in your hand, and put the other two on the bottom of the deck in the order you choose. Your notes remember which cards you put there, and the Card count shows them as still in the deck until they are drawn.',
          '7 · King (×1), 8 · Countess (×1), 9 · Princess (×1): as in Classic.',
        ],
      },
      {
        title: 'Ties and winning',
        bullets: [
          'Classic: if the highest cards tie, the tied player whose discards add up to more wins. If that is a tie too, every player still tied wins a token, and the result says “Still tied on discards, so each of them wins a token”.',
          '2019: every tied player wins a token.',
          'Tokens to win, Classic: 7 with 2 players, 5 with 3, 4 with 4.',
          'Tokens to win, 2019: 6 with 2 players, 5 with 3, 4 with 4, 3 with 5 or 6.',
          'Short game: the host can choose a short game in the settings, which plays to 2 tokens fewer (never fewer than 2), for about half as many rounds.',
          'The winner of a round starts the next one (one of them at random after a tie). If several players reach the target together, the most tokens wins, and an equal count shares the win.',
        ],
      },
      {
        title: 'Coming and going',
        bullets: [
          'Players joining during a game watch it, and are dealt in when the host starts the next one, if the edition has a seat free. When the host picks an edition with more seats, whoever was waiting for one sits down.',
          'Between games, in the lobby or on the final podium, anyone can tap Take a seat or Sit out (watch). Someone who chose to watch stays watching until they take a seat again.',
          'Someone who leaves mid-round is knocked out and their hand is shown. If they leave while choosing which card to keep after a Chancellor, the two cards they drew go back to the bottom of the deck unseen, and only the card they held before is shown. With fewer than two players left the game ends, and the most tokens wins.',
        ],
      },
      {
        title: 'Timers (optional)',
        paragraphs: [
          'The host can set a time for each turn. By default it is just a reminder. In Strict mode, a player who runs out of time plays their lower card (the Countess if they must) at a random player, and a Guard names a random card. A Chancellor who runs out of time keeps a random card. The log marks every card the timer played with ⏱, so nobody mistakes it for a choice.',
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
      {
        term: 'Favour token',
        meaning: 'What you win for a round; collect enough to win the game.',
      },
      { term: 'Protected', meaning: 'Played the Handmaid: can’t be chosen until their next turn.' },
      {
        term: 'Set aside',
        meaning: 'The card removed face down at the start, so nobody can count every card.',
      },
      {
        term: 'Notes',
        meaning:
          'What only you have learned this round, from a Priest, Baron, King or Chancellor, or that someone’s Priest saw your card.',
      },
    ],
  };
}

/** The guide without art, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const url = (path: string) => `/api/backroom/assets/royal-post/${path.replace(/^\/+/, '')}`;

/** The guide with the card art from the manifest (Classic's, else the 2019 edition's). */
export function nameGuide(manifest: unknown): GameGuide {
  const editions = obj(obj(manifest).editions);
  const classic = obj(editions.classic);
  const e2019 = obj(editions['2019']);
  const back = str(classic.back);
  return makeGuide({
    art: (c) => {
      const a = str(obj(obj(classic.cards)[c]).art) ?? str(obj(obj(e2019.cards)[c]).art);
      return a && url(a);
    },
    ...(back && { back: url(back) }),
  });
}
