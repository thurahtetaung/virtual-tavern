import type { GameGuide, GuideContext, GuideFooter, GuideOption, GuideTile } from '@vt/game-sdk';
import { type Manifest, clean, footerOf, tileOf } from './manifest.ts';
import { COLOUR_EMOJI, COLOUR_NAME, SYMBOL } from './tiles.ts';
import {
  COLOURS,
  COLOUR_BONUS,
  COLUMN_BONUS,
  type Colour,
  DEFAULT_SECONDS,
  FACTORIES_FOR,
  FLOOR,
  type MosaicView,
  ROW_BONUS,
  TILES_EACH,
} from './types.ts';

export { type Manifest, footerOf } from './manifest.ts';

/** Art for the guide, from the private manifest. */
export interface GuideArt {
  tiles?: Partial<Record<Colour, string>>;
  first?: string;
  factory?: string;
  board?: string;
}

const STRICT: GuideOption = { key: 'strict', label: 'Strict turn timer' };

const floorText = FLOOR.map((n) => `${n}`).join(' ');

function base(art: GuideArt): GameGuide {
  const tiles: GuideTile[] = [
    ...COLOURS.map((c): GuideTile => ({
      id: c,
      name: `${COLOUR_NAME[c][0]!.toUpperCase()}${COLOUR_NAME[c].slice(1)} tiles`,
      icon: COLOUR_EMOJI[c],
      text: `${TILES_EACH} in the bag. Marked ${SYMBOL[c]} everywhere, so you never have to tell colours apart by shade. Each row and each column of the wall has one space for them.`,
      meta: `${TILES_EACH} tiles · symbol ${SYMBOL[c]}`,
      tone: 'neutral',
      ...(art.tiles?.[c] && { art: art.tiles[c] }),
    })),
    {
      id: 'first',
      name: 'First-player marker',
      icon: '1️⃣',
      text: 'Sits in the centre at the start of each round. The first player to take from the centre takes it too: it goes on their floor (−1 there, like a tile) and they start the next round.',
      meta: 'Not a colour · costs a floor space',
      tone: 'own',
      ...(art.first && { art: art.first }),
    },
    {
      id: 'factory',
      name: 'Factories',
      icon: '🏺',
      text: 'Each holds 4 tiles at the start of a round. Take every tile of one colour from one factory; the rest slide to the centre.',
      meta: `${FACTORIES_FOR[2]} / ${FACTORIES_FOR[3]} / ${FACTORIES_FOR[4]} for 2 / 3 / 4 players`,
      tone: 'neutral',
      ...(art.factory && { art: art.factory }),
    },
    {
      id: 'board',
      name: 'Your board',
      icon: '🧱',
      text: 'Five pattern lines on the left (holding 1 to 5 tiles), the 5 × 5 wall on the right, and the floor line below, where unwanted tiles cost points.',
      meta: 'Pattern lines · wall · floor',
      tone: 'good',
      ...(art.board && { art: art.board }),
    },
  ];
  return {
    tagline: 'Draft coloured tiles, fill your pattern lines and tile a wall that scores in runs.',
    players: '2 to 4',
    duration: '30 minutes',
    goal: 'Have the most points when the game ends. It ends after the round in which someone completes a full row of their wall.',
    quickStart: [
      'On your turn, take every tile of one colour from one factory, or from the centre.',
      'The rest of that factory slides to the centre.',
      'Put all the tiles you took in one pattern line. What doesn’t fit falls to your floor and costs points.',
      'When the table is empty, every full line moves one tile to your wall, scoring for the tiles it touches.',
      `The game ends after a round in which someone fills a wall row. Bonuses: +${ROW_BONUS} a row, +${COLUMN_BONUS} a column, +${COLOUR_BONUS} a colour.`,
    ],
    steps: [
      {
        title: 'Take one colour',
        text: 'Pick a factory (or the centre) and a colour: you take every tile of that colour there. The others from that factory slide to the centre.',
        icon: '🏺',
        ...(art.factory && { art: art.factory }),
      },
      {
        title: 'Fill a pattern line',
        text: 'All of them go in one line, which holds only one colour. Tiles that don’t fit fall to your floor. You can also put them straight on the floor.',
        icon: '🧩',
        ...(art.tiles?.blue && { art: art.tiles.blue }),
      },
      {
        title: 'Mind the floor',
        text: `Floor spaces cost ${floorText}. The first to take from the centre also takes the first-player marker onto their floor, and starts next round.`,
        icon: '⚠️',
        ...(art.first && { art: art.first }),
      },
      {
        title: 'Tile the wall',
        text: 'When every tile is taken, each full line moves one tile to the wall. A tile scores 1, or the length of the rows and columns it joins.',
        icon: '🧱',
        ...(art.board && { art: art.board }),
      },
      {
        title: 'Finish a row to end it',
        text: `After the round where someone completes a wall row, add bonuses: +${ROW_BONUS} a row, +${COLUMN_BONUS} a column, +${COLOUR_BONUS} for all 5 of a colour. Most points wins.`,
        icon: '🏆',
      },
    ],
    stepsDone: 'Tap 📖 Rules any time to read the details.',
    setup: [
      'Everyone sits down; 2 to 4 can play, others can watch. The first player is picked at random for the first game, then moves one seat on each game.',
      `All ${TILES_EACH * COLOURS.length} tiles go in the bag. Factories by players: ${FACTORIES_FOR[2]} for 2, ${FACTORIES_FOR[3]} for 3, ${FACTORIES_FOR[4]} for 4, each filled with 4 random tiles.`,
      'The first-player marker goes in the centre. Everyone starts on 0 points with an empty board.',
    ],
    sections: [
      {
        title: 'Your turn',
        level: 'basics',
        bullets: [
          'Take every tile of one colour from one factory; the rest of that factory slides to the centre. Or take every tile of one colour from the centre.',
          'The first player this round to take from the centre also takes the first-player marker: it goes on the leftmost free space of their floor.',
          'You can never pass. The round goes on until every factory and the centre are empty.',
        ],
      },
      {
        title: 'Placing tiles',
        level: 'basics',
        bullets: [
          'Put all the tiles you took in one pattern line (they hold 1, 2, 3, 4 and 5 tiles, top to bottom).',
          'A line holds one colour only, and you can’t start a colour in a line whose wall row already has it.',
          'Tiles that don’t fit fall to your floor, left to right. You may put any or all of them on the floor even when a line could take them.',
          'Two lines may hold the same colour at once. Tiles in a line stay there until it fills.',
        ],
      },
      {
        title: 'The floor',
        level: 'details',
        bullets: [
          `Floor spaces cost ${floorText}, left to right. The first-player marker counts like a tile.`,
          'Tiles past the seventh space go to the lid with no further cost: the floor can never cost more than −14 in a round.',
          'Your score never drops below 0.',
        ],
      },
      {
        title: 'Wall-tiling',
        level: 'details',
        bullets: [
          'When the table is empty, everyone tiles at once. Each full pattern line, top to bottom, moves its rightmost tile to the wall space of that colour in the same row; the rest of that line goes to the lid.',
          'Lines that aren’t full stay as they are for the next round.',
          'A tile with no neighbour scores 1. Otherwise, count the tiles in an unbroken row through it (if 2 or more) plus those in an unbroken column through it (if 2 or more); the new tile counts in both. Diagonals never count.',
          'Then the floor costs its points and is cleared. The marker goes to whoever took it: they start the next round.',
        ],
      },
      {
        title: 'Next round and the bag',
        level: 'details',
        bullets: [
          'The factories are filled with 4 tiles each from the bag. When the bag runs out mid-fill, the lid’s tiles are poured in and the filling goes on.',
          'If the bag and the lid are both empty, the round starts with the factories as they are.',
          'How many tiles of each colour are left in the bag and in the lid is open to everyone (the Scores tab); only the bag’s order is hidden.',
        ],
      },
      {
        title: 'The end',
        level: 'details',
        bullets: [
          'The game ends after the wall-tiling of the round in which at least one player completes a full row of 5. Everyone finishes that round’s tiling and floor first.',
          `Then add bonuses: +${ROW_BONUS} for every full row, +${COLUMN_BONUS} for every full column, +${COLOUR_BONUS} for every colour with all 5 tiles on your wall.`,
          'Most points wins. A tie goes to the most full rows; still tied, they share the win. Holding the marker at the end is worth nothing.',
        ],
      },
      {
        title: 'Rare cases',
        level: 'edge',
        bullets: [
          'If nobody takes from the centre in a round (every factory was a single colour), the same player starts the next round, with no cost.',
          'Taking the marker with a full floor: you still start the next round, with no extra cost.',
          'If a round would start with no tiles left anywhere (bag, lid and factories empty), the game ends as normal, bonuses and all.',
          'If no line can take a colour, you still take it: every tile goes to the floor.',
        ],
      },
      {
        title: 'Placing in the app',
        level: 'edge',
        bullets: [
          'Tap a tile to pick up its colour group; a sheet shows every line with what it would cost (tiles that would spill, the floor points, whether the line fills and what its tile would score), and what you leave in the centre.',
          'By default you pick a line and then tap Place. There is no undo after placing. You can switch the confirm step off in the sheet.',
          'After each round, the wall-tiling plays on every screen. The next round starts when everyone has tapped Next round, or after a few seconds; the host can skip it.',
        ],
      },
      {
        title: 'Strict turn timer',
        level: 'edge',
        option: STRICT,
        bullets: [
          'In Strict mode, a player out of time has the safe move made for them: the take that costs least and scores best, the same pick the app would suggest. It is never a random throw on the floor. The log marks it with ⏱.',
        ],
      },
      {
        title: 'Timers and leaving',
        level: 'edge',
        bullets: [
          `By default each turn has a ${DEFAULT_SECONDS}-second reminder; the host can change it, turn it off, or make it strict. When time is up, the host may tap Act for to make the safe move for that player.`,
          'Someone who leaves mid-game keeps their seat, and the table makes the safe move for them after 3 seconds. If they come back, they carry on.',
          'The host can remove a player who left: their pattern-line and floor tiles go to the lid, their board leaves play, and they no longer take turns, score or count for ties. If it was their turn, the next player goes on. If they held the first-player marker, the next seat starts the next round. With one player left, the game ends: they win, with bonuses scored as normal.',
          'Players joining during a game watch, and are seated at the next one if there is room.',
        ],
      },
    ],
    tiles: {
      label: 'Pieces',
      blurb: 'Tiles, the marker, factories and your board',
      intro: 'Everything on the table. Tap one to read it.',
      shape: 'square',
      items: tiles,
    },
    reference: [
      {
        title: 'Floor line',
        head: ['Space', '1', '2', '3', '4', '5', '6', '7'],
        rows: [['Cost', ...FLOOR.map((n) => `${n}`)]],
      },
      {
        title: 'Scoring a placed tile',
        head: ['Tile touches', 'Points'],
        rows: [
          ['Nothing', '1'],
          ['A row of 3 (itself included)', '3'],
          ['A column of 2', '2'],
          ['A row of 3 and a column of 3', '6 (3 + 3)'],
        ],
      },
      {
        title: 'End bonuses',
        head: ['For each', 'Points'],
        rows: [
          ['Full row', `+${ROW_BONUS}`],
          ['Full column', `+${COLUMN_BONUS}`],
          ['Colour with all 5 on the wall', `+${COLOUR_BONUS}`],
        ],
      },
      {
        title: 'Factories by players',
        head: ['Players', 'Factories', 'Tiles out each round'],
        rows: [2, 3, 4].map((n) => [`${n}`, `${FACTORIES_FOR[n]}`, `${FACTORIES_FOR[n]! * 4}`]),
      },
    ],
    tips: [
      'Look at what you leave behind: the sheet says which tiles you push to the centre. Leaving one colour for the next player can force them onto their floor.',
      'Fill short lines early for quick points; start the long bottom lines early too, as they take several rounds.',
      'Place tiles next to ones already on your wall: a tile that joins a row and a column scores both.',
      'Columns are worth +7 at the end and colours +10: they often decide the game.',
      'Taking the marker costs 1 but lets you choose first next round.',
    ],
    glossary: [
      { term: 'Factory', meaning: 'A display holding 4 tiles at the start of each round.' },
      { term: 'Centre', meaning: 'Where leftover tiles slide; take a whole colour from it too.' },
      { term: 'Pattern line', meaning: 'Your 5 lines (1 to 5 spaces) that feed the wall.' },
      { term: 'Floor', meaning: 'Where unwanted tiles land, costing points.' },
      { term: 'Lid', meaning: 'The discards: poured back into the bag when it runs out.' },
    ],
  };
}

/** The guide with art when there is some. */
export function makeGuide(art: GuideArt = {}, footer?: GuideFooter): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as MosaicView;
    if (!v?.settings) return undefined;
    const seated = v.game?.players.length ?? v.seats.filter((s) => s.playing).length;
    const n = Math.min(4, Math.max(2, seated));
    const strict = v.settings.timerMode === 'strict' && v.settings.seconds !== null;
    return {
      summary: `${seated} players · ${FACTORIES_FOR[n]} factories${v.settings.seconds ? ` · ${v.settings.seconds} s turns${strict ? ' (strict)' : ''}` : ''}`,
      options: strict ? [STRICT.key] : [],
      inGame: {
        ...Object.fromEntries(COLOURS.map((c) => [c, TILES_EACH])),
        first: 1,
        factory: FACTORIES_FOR[n]!,
        board: seated,
      },
    };
  };
  return {
    ...base(art),
    presets: [
      { id: 'two', label: '2 players', context: { summary: '5 factories.', options: [] } },
      { id: 'four', label: '4 players', context: { summary: '9 factories.', options: [] } },
    ],
    ...(footer && { footer }),
    room,
  };
}

/** The guide without art, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const url = (path: string) => `/api/backroom/assets/mosaic/${path.replace(/^\/+/, '')}`;

/** The guide with the manifest's art and credits. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = (manifest && typeof manifest === 'object' ? manifest : null) as Manifest | null;
  const a = (p: string | undefined) => (p ? url(p) : undefined);
  const art: GuideArt = { tiles: {} };
  for (const c of COLOURS) {
    const u = a(tileOf(m?.tiles, c));
    if (u) art.tiles![c] = u;
  }
  const first = a(clean(m?.first));
  if (first) art.first = first;
  const factory = a(clean(m?.factory));
  if (factory) art.factory = factory;
  const board = a(clean(m?.board?.colour));
  if (board) art.board = board;
  return makeGuide(art, footerOf(m));
}
