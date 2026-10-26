import type { GameGuide, GuideContext, GuideFooter, GuideOption, GuideTile } from '@vt/game-sdk';
import { HAND_SIZE, deckFor } from './cards.ts';
import { type Manifest, artOf, clean, footerOf } from './manifest.ts';
import { rewordAll, wordsOf } from './names.ts';
import { type EncoreView, TWO_PLAYER_CHIPS } from './types.ts';

export { type Manifest, footerOf } from './manifest.ts';

/** Art for the guide, from the private manifest. */
export interface GuideArt {
  card?: string;
  start?: string;
  back?: string;
  chip?: string;
  marker?: string;
  hat?: string;
  tagline?: string;
}

const TWO: GuideOption = { key: 'two', label: '2 players' };
const TWICE: GuideOption = { key: 'twoEach', label: 'Two rounds each' };
const DOUBLE: GuideOption = { key: 'double', label: '3 to 5 players' };

const TAGLINE =
  'Play stronger sets and runs from a hand you can’t rearrange, or recruit a card from the table to build your next show.';

function base(art: GuideArt): GameGuide {
  const tiles: GuideTile[] = [
    {
      id: 'cards',
      name: 'The cards',
      icon: '🃏',
      text: 'Every card has two different numbers from 1 to 10, one at each end. Only the big number at the top counts; the small one shows what the card would be the other way up. You can’t reorder your hand or turn single cards round.',
      meta: '45 cards, all different · 36 with 3 players, 44 with 2 or 4',
      tone: 'neutral',
      ...(art.card && { art: art.card, card: art.card }),
    },
    {
      id: 'single',
      name: 'Single card',
      icon: '1️⃣',
      text: 'Any one card is a group of one. It beats another single only with a higher number. Any two cards beat any single.',
      tone: 'neutral',
    },
    {
      id: 'run',
      name: 'Run',
      icon: '📶',
      text: 'Cards side by side in your hand with numbers in a row, going up or down (4-5-6 or 6-5-4). Direction doesn’t matter. 3-1-2 is not a run.',
      tone: 'neutral',
    },
    {
      id: 'set',
      name: 'Set',
      icon: '🟰',
      text: 'Cards side by side in your hand with the same number (7-7-7). A set beats a run of as many cards.',
      tone: 'good',
    },
    {
      id: 'chip',
      name: 'Chip',
      icon: '🎟️',
      text: `With 3 to 5 players, whoever showed the set on the table gets a chip each time someone recruits from it. With 2 players, each player gets ${TWO_PLAYER_CHIPS} chips a round and pays one to recruit. Each chip is a point.`,
      meta: 'Unlimited with 3 to 5 players',
      tone: 'own',
      ...(art.chip && { art: art.chip }),
    },
    {
      id: 'marker',
      name: 'Recruit & Show',
      icon: '🎪',
      text: 'Once a round, recruit a card and then show straight away, in one turn. The Show must beat what is left on the table. Not used with 2 players; an unused one scores nothing.',
      meta: 'One each, every round',
      tone: 'own',
      option: DOUBLE,
      ...(art.marker && { art: art.marker }),
    },
    {
      id: 'start',
      name: 'The 1/2 card',
      icon: '🎩',
      text: 'Whoever is dealt the card with 1 and 2 starts the first round. If nobody has it (with 2 players, half the cards wait for round 2), a random player starts.',
      tone: 'neutral',
      ...((art.hat ?? art.start) && { art: (art.hat ?? art.start)! }),
      ...(art.start && { card: art.start }),
    },
  ];
  return {
    tagline: art.tagline ?? TAGLINE,
    players: '2 to 5 (best with 4 or 5)',
    duration: '20 minutes',
    goal: 'Score the most points over all the rounds: a point for every card you capture and every chip, minus a point for every card still in your hand when a round ends.',
    quickStart: [
      'Your hand stays in the order it was dealt. At the start of a round you may turn the whole hand round, once.',
      'On your turn, Show cards side by side that beat the set on the table, and capture it.',
      'Or Recruit: take a card from either end of the table into any gap in your hand, either way up. Its owner gets a chip.',
      'Once a round, Recruit & Show: recruit, then show at once.',
      'A round ends when someone empties their hand, or when a Show comes back round unbeaten.',
      'Captured cards and chips score a point each; cards left in hand lose one each.',
    ],
    steps: [
      {
        title: 'A hand you can’t rearrange',
        text: 'Your cards stay in the order they were dealt; only the big number counts. At the round’s start, keep your hand or turn it all round, which reverses it and flips every card.',
        icon: '🃏',
        ...(art.card && { art: art.card }),
      },
      {
        title: 'Show to beat the table',
        text: 'Play one card, or cards side by side that make a set (7-7) or a run (4-5-6). More cards win; a set beats an equal run; then the higher lowest number. You capture what you beat.',
        icon: '🎪',
      },
      {
        title: 'Or recruit a performer',
        text: 'Take a card from either end of the table and slip it into any gap in your hand, either way up, to build a bigger show. Whoever showed it gets a chip.',
        icon: '🤝',
        ...(art.chip && { art: art.chip }),
      },
      {
        title: 'Recruit & Show, once a round',
        text: 'Recruit a card, then show at once in the same turn. Use it when the card you need is on the table.',
        icon: '🎟️',
        ...(art.marker && { art: art.marker }),
      },
      {
        title: 'The round ends',
        text: 'When a hand is empty, or when everyone else just recruited and play comes back to an unbeaten Show. That player loses nothing for their hand.',
        icon: '👏',
      },
      {
        title: 'Score and go again',
        text: 'A point per captured card and chip, minus one per card in hand. Everyone starts one round; the best total wins.',
        icon: '🏆',
      },
    ],
    stepsDone: 'Tap 📖 Rules any time to read the details.',
    setup: [
      'Everyone sits down; 2 to 5 can play, more can watch. It is best with 4 or 5.',
      'The cards are shuffled with each card a random way up and dealt out: 12 each with 3 players (no 10s), 11 each with 4 (no 9/10 card), 9 each with 5 (every card).',
      'Everyone looks at their hand and decides, in secret, whether to keep it or turn it all round. Play starts once everyone has chosen.',
      'The holder of the 1/2 card starts the first round; each later round starts one seat further round.',
    ],
    sections: [
      {
        title: 'Your hand',
        level: 'basics',
        bullets: [
          'Your hand stays in the order it was dealt. You can never reorder it or turn single cards round.',
          'Only the big number on each card counts; the small one is the number at the other end.',
          'Once, at the start of each round, you may turn your whole hand round: the order reverses and every card shows its other number. You see both versions before you choose.',
          'Everyone sees how many cards each player holds, but never which.',
        ],
      },
      {
        title: 'Show',
        level: 'basics',
        bullets: [
          'Play one card, or several that sit side by side in your hand and make a set (all the same number) or a run (numbers in a row, up or down).',
          'On an empty table any group will do. Otherwise it must beat the set on the table.',
          'Strength: more cards beat fewer; with as many cards, a set beats a run; with the same count and kind, the higher lowest number wins. Equal is never enough.',
          'You capture the beaten set face down (a point per card), and your cards are the new set on the table.',
        ],
      },
      {
        title: 'Recruit',
        level: 'basics',
        bullets: [
          'Take one card from either end of the set on the table, and put it in any gap in your hand (or at either end), either way up.',
          'Whoever showed the set gets a chip. The rest of the set stays on the table, still theirs.',
          'You may recruit even when you could show. If the last card is taken, the next player shows whatever they like.',
          'Where you put the card and which way up stay secret.',
        ],
      },
      {
        title: 'Recruit & Show',
        level: 'details',
        option: DOUBLE,
        bullets: [
          'Once a round, recruit and then show in the same turn. The owner still gets their chip.',
          'Your Show must beat what is left on the table after the recruit, and needn’t use the recruited card. If you take the last card, any Show will do.',
          'It is all or nothing: the app only sends it with a Show that works, so nothing is lost by trying.',
          'An unused Recruit & Show scores nothing.',
        ],
      },
      {
        title: 'When a round ends',
        level: 'details',
        bullets: [
          'At once when a player empties their hand by showing.',
          'Or when play comes back to the owner of the set on the table and everyone in between only recruited: nobody beat it. This is checked as play reaches the owner, so the last player before them can still Show or Recruit & Show to keep it going. It still ends if those recruits took every card.',
          'With 3 players that is just two recruits in a row, so rounds can be short.',
          'The set left on the table scores for nobody.',
        ],
      },
      {
        title: 'Scoring',
        level: 'details',
        bullets: [
          'Each captured card and each chip: +1.',
          'Each card still in your hand: −1, except for the player whose Show went unbeaten (they lose nothing).',
          'Round scores can be negative; they add up over the game.',
          'After as many rounds as there are players (each starts one), the highest total wins. Ties share the win.',
        ],
      },
      {
        title: 'Two players',
        level: 'details',
        option: TWO,
        bullets: [
          `The 9/10 card is left out. Each player gets 11 cards; the other 22 wait for the second round. Each round, each player takes ${TWO_PLAYER_CHIPS} chips. There is no Recruit & Show.`,
          'Recruiting costs one of your own chips (it goes to the middle, not to your opponent), and you go again: recruit more, or show. A Show passes the turn.',
          'If you can’t beat the set, you must recruit while you have chips. With no chip left and no Show that beats it, the round ends, and your opponent loses nothing for their hand.',
          'Score: captured cards plus unused chips, minus cards in hand. Two rounds, and the other player starts the second. Nobody holds the 1/2 card half the time: then a random player starts the first round.',
        ],
      },
      {
        title: 'Two rounds each',
        level: 'edge',
        option: TWICE,
        bullets: [
          'The host can make the game twice as long: everyone starts two rounds.',
          'With 2 players that is four rounds: a fresh deck is shuffled for the third.',
        ],
      },
      {
        title: 'Timers and leaving',
        level: 'edge',
        bullets: [
          'By default each turn has a 60-second reminder, and the host may tap Act for to play a turn for someone. The host can change the time or turn the clock off.',
          'In Strict mode, a player out of time has the app’s best move made for them (the same one the playtest bots make); a flip they haven’t chosen is made the same way. The log marks those moves with ⏱.',
          'Someone who leaves mid-game keeps their seat, and the table plays for them the same way after a short pause. If they come back, they carry on.',
          'Between rounds, everyone taps Ready; the host can deal the next round without waiting.',
          'Players joining during a game watch, and are seated at the next one if there is room.',
        ],
      },
    ],
    tiles: {
      label: 'Cards',
      blurb: '45 cards · sets, runs, chips',
      intro: 'The cards and what you can make with them. Tap one to read it.',
      shape: 'square',
      items: tiles,
    },
    reference: [
      {
        title: 'What beats what',
        head: ['Step', 'Rule', 'Example'],
        rows: [
          ['1', 'More cards beat fewer', '2-3 beats 9'],
          ['2', 'As many cards: a set beats a run', '4-4 beats 7-8'],
          ['3', 'Same count and kind: higher lowest number', '5-6-7 beats 4-5-6'],
          ['–', 'Equal never beats', '3-2-1 can’t beat 1-2-3'],
        ],
      },
      {
        title: 'On your turn: one of',
        head: ['Action', 'What happens'],
        rows: [
          ['Show', 'Beat the table, capture it (+1 a card)'],
          ['Recruit', 'Take an end card into any gap, either way up; owner +1 chip'],
          ['Recruit & Show', 'Once a round (3 to 5 players): recruit, then show'],
        ],
      },
      {
        title: 'Setup by players',
        head: ['Players', 'Cards', 'Each hand', 'Rounds'],
        rows: [2, 3, 4, 5].map((n) => [
          `${n}`,
          `${deckFor(n).length}`,
          n === 2 ? `${HAND_SIZE[n]} (22 for round 2)` : `${HAND_SIZE[n]}`,
          `${n}`,
        ]),
      },
      {
        title: 'Round score',
        head: ['', 'Points'],
        rows: [
          ['Each captured card', '+1'],
          ['Each chip', '+1'],
          ['Each card in hand', '−1 (not for an unbeaten Show’s owner)'],
        ],
      },
    ],
    tips: [
      'Look for the card that splits two groups: show it, and they join up.',
      'A recruited card can be turned either way up: the glowing gaps show what it would make.',
      'Recruiting hands a point to the owner, but it can turn two small groups into one big Show.',
      'Before the last player ahead of an unbeaten set acts, think twice: one more recruit ends the round.',
      'The flip screen shows both versions of your hand with their sets and runs: pick the one with longer groups.',
    ],
    glossary: [
      { term: 'Show', meaning: 'Play cards from your hand that beat the set on the table.' },
      { term: 'Recruit', meaning: 'Take an end card of the table into your hand.' },
      { term: 'Set', meaning: 'Cards side by side with the same number.' },
      { term: 'Run', meaning: 'Cards side by side with numbers in a row, up or down.' },
      { term: 'Owner', meaning: 'Whoever showed the set now on the table.' },
    ],
  };
}

/** The guide with art when there is some. */
export function makeGuide(art: GuideArt = {}, footer?: GuideFooter): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as EncoreView;
    if (!v?.settings) return undefined;
    const seated = v.game?.players.length ?? v.seats.filter((s) => s.playing).length;
    const n = Math.min(5, Math.max(2, seated));
    const options = [
      ...(n === 2 ? [TWO.key] : [DOUBLE.key]),
      ...(v.settings.twoEach ? [TWICE.key] : []),
    ];
    const rounds = n * (v.settings.twoEach ? 2 : 1);
    return {
      summary: `${seated} players · ${rounds} rounds${n === 2 ? ' · 2-player rules' : ''}`,
      options,
      inGame: {
        cards: deckFor(n).length,
        single: 1,
        run: 1,
        set: 1,
        chip: 1,
        ...(n > 2 && { marker: 1 }),
        start: 1,
      },
    };
  };
  return {
    ...base(art),
    presets: [
      {
        id: 'four',
        label: '3 to 5 players',
        context: { summary: 'The usual game.', options: [DOUBLE.key] },
      },
      {
        id: 'two',
        label: '2 players',
        context: { summary: 'The 2-player rules.', options: [TWO.key] },
      },
    ],
    ...(footer && { footer }),
    room,
  };
}

/** The guide without art, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const url = (path: string) => `/api/backroom/assets/encore/${path.replace(/^\/+/, '')}`;

/** The guide with the manifest's art and credits. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = (manifest && typeof manifest === 'object' ? manifest : null) as Manifest | null;
  const a = (p: string | undefined) => (p ? url(p) : undefined);
  const art: GuideArt = {};
  const cards = m?.cards && typeof m.cards === 'object' ? m.cards : {};
  const card = a(artOf(cards['3-8']) ?? artOf(Object.values(cards)[0]));
  if (card) art.card = card;
  const start = a(artOf(cards['1-2']));
  if (start) art.start = start;
  const back = a(clean(m?.back));
  if (back) art.back = back;
  const chip = a(clean(m?.chip));
  if (chip) art.chip = chip;
  const marker = a(clean(m?.marker));
  if (marker) art.marker = marker;
  const hat = a(clean(m?.startHat));
  if (hat) art.hat = hat;
  const tagline = clean(m?.guide?.tagline);
  if (tagline) art.tagline = tagline;
  const footer = footerOf(m);
  const words = wordsOf(m);
  // The room hook keeps its own words (it names no action).
  const { room, ...rest } = makeGuide(art, footer);
  return { ...rewordAll(rest, words), ...(room && { room }) };
}
