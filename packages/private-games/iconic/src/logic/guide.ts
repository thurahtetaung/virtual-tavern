import type {
  GameGuide,
  GuideCatalogGroup,
  GuideContext,
  GuideFooter,
  GuideOption,
  GuideTile,
} from '@vt/game-sdk';
import { GROUPS, GROUP_EMOJI, GROUP_LABELS, GROUP_TEXT, iconsOf } from './board.ts';
import {
  type Manifest,
  asManifest,
  clean,
  footerOf,
  iconMeanings,
  iconName,
  iconPlaceholder,
} from './manifest.ts';
import { CUBE_CAP, type IconicView, LEVEL_LABELS, WORDS_TO_END } from './types.ts';

export { type Manifest, footerOf, iconName, iconMeanings } from './manifest.ts';

const SCORING: GuideOption = { key: 'scoring', label: 'Scoring' };
const BONUS: GuideOption = { key: 'bonus', label: 'Difficulty bonus' };
const CLOCK: GuideOption = { key: 'clock', label: 'Round clock' };
const STRICT: GuideOption = { key: 'strict', label: 'Strict round clock' };
const PAIR: GuideOption = { key: 'pair', label: 'Two clue givers' };

/** What the guide knows about each icon: its name, meanings and art (from the manifest). */
export interface IconInfo {
  name: (n: number) => string;
  meanings: (n: number) => string[];
  art: (n: number) => string | undefined;
}

const PLAIN: IconInfo = { name: iconPlaceholder, meanings: () => [], art: () => undefined };

export interface GuideArt {
  /** The main ? marker, a sub-set ! marker, the board, the box. */
  main?: string;
  sub?: string;
  box?: string;
}

function base(icons: IconInfo, art: GuideArt): GameGuide {
  const tiles: GuideTile[] = GROUPS.map((g) => ({
    id: g,
    name: GROUP_LABELS[g],
    icon: GROUP_EMOJI[g],
    text: GROUP_TEXT[g],
    meta: `${iconsOf(g).length} icons`,
    tone: 'neutral',
    catalog: g,
    ...(icons.art(iconsOf(g)[0]!) && { art: icons.art(iconsOf(g)[0]!)! }),
  }));
  const catalog: GuideCatalogGroup[] = GROUPS.map((g) => ({
    id: g,
    name: GROUP_LABELS[g],
    icon: GROUP_EMOJI[g],
    meta: `${iconsOf(g).length} icons`,
    items: iconsOf(g).map((n) => {
      const meanings = icons.meanings(n);
      const pic = icons.art(n);
      return {
        id: String(n),
        name: icons.name(n),
        text: meanings.length
          ? `${meanings.join(', ')}.`
          : `Icon ${n} of the ${GROUP_LABELS[g]} column.`,
        ...(pic && { art: pic, card: pic }),
      };
    }),
  }));
  return {
    tagline: 'Make the table guess a word using only markers and cubes on a board of icons.',
    players: '3 to 12',
    duration: '30 to 45 minutes',
    goal: 'Get your words guessed and guess the others’ words. Clue givers may not speak or type: they only put pieces on the board’s 118 icons.',
    quickStart: [
      'Each round one or two players are the clue givers. They pick a secret word from a card of nine.',
      'They put the green ? marker on the icon that best sums the word up, then cubes on icons that narrow it down.',
      'More ideas go in other colours: each ! set is a separate clue, like “a place that is blue, white and red”.',
      'Everyone else types guesses. The clue givers mark them wrong, close or right.',
      'The first right guess scores 2 and each clue giver 1. Then the next player round the table gives clues.',
      `The game ends when ${WORDS_TO_END} words have been guessed. Most points wins.`,
    ],
    steps: [
      {
        title: 'Pick a secret word',
        text: 'The clue givers see a card of nine words: three Easy, three Hard, three Challenging. They pick one. Nobody else sees it.',
        icon: '🃏',
      },
      {
        title: 'Place the ? first',
        text: 'The green ? marker goes on the icon closest to the word. Green cubes on other icons add detail to it.',
        icon: '❓',
        ...(art.main && { art: art.main }),
      },
      {
        title: 'Add ! sets for more ideas',
        text: 'Blue, red, yellow and black sets each make a separate idea: a ! marker for the idea, cubes to describe it.',
        icon: '❗',
        ...(art.sub && { art: art.sub }),
      },
      {
        title: 'Everyone guesses',
        text: 'Type as many guesses as you like. The clue givers mark them ✗ wrong, 🤏 close or ✓ right.',
        icon: '💬',
      },
      {
        title: 'Score and pass it on',
        text: 'The first right guess scores 2, each clue giver 1. The next player (or pair) round the table gives clues next.',
        icon: '🏆',
      },
      {
        title: 'Stuck?',
        text: 'Wipe the board and start over, invite a helper once the clock runs out, or pass. If every guesser gives up, the word is dropped.',
        icon: '🧹',
      },
    ],
    stepsDone: 'Tap 📖 Rules any time to read the details.',
    setup: [
      'Everyone sits down; 3 to 12 can play, others watch. The first clue giver is picked at random.',
      'The host picks the word lists for each level, one or two clue givers, the length, scoring and the round clock.',
    ],
    sections: [
      {
        title: 'A round',
        level: 'basics',
        bullets: [
          'The clue givers pick a word from their card of nine and keep it secret.',
          'They describe it only with pieces on the board. No talking, typing or pointing.',
          'Everyone else guesses, as often as they like, until someone gets it.',
          'Then the next clue giver (or pair) round the table takes a new card.',
        ],
      },
      {
        title: 'Placing pieces',
        level: 'basics',
        bullets: [
          'Pick a set with the chips above the board, then tap an icon. The first tap of a set puts its marker down; later taps add cubes.',
          'The green ? set is the main idea and goes first. The blue, red, yellow and black ! sets are sub-ideas, each its own clue.',
          'Tap an icon again to stack another cube on it: a stack means “a lot of this”. Long-press (or right-click) to take a piece off.',
          `Each set has its marker and ${CUBE_CAP.main} green or ${CUBE_CAP.sub1} other cubes. Cubes are numbered in the order they went down, because order can matter.`,
          'Move pieces around as much as you like, or wipe the board in one tap and start again.',
        ],
      },
      {
        title: 'Guessing and judging',
        level: 'basics',
        bullets: [
          'Type a guess and press Enter. New guesses join the bottom of the list, so nothing jumps while it is judged.',
          'The clue givers mark each guess ✗ wrong or 🤏 close (the table’s “yes, keep going”), or ✓ right.',
          'A guess that matches the word is flagged “looks right” for the clue givers, but only they award it.',
          'Marking a guess right asks to confirm, and can be undone for 5 seconds.',
        ],
      },
      {
        title: 'Scoring',
        level: 'details',
        option: SCORING,
        bullets: [
          'The first player to guess the word scores 2 points.',
          'Each clue giver scores 1 point, and so does a helper.',
          'A word nobody guesses scores nothing.',
          'With scoring off, the end screen counts the words each player guessed.',
        ],
      },
      {
        title: 'Difficulty bonus',
        level: 'details',
        option: BONUS,
        bullets: [
          'A host option, off by default.',
          'A Hard word gives 1 extra point, a Challenging word 2, to the guesser and to each clue giver.',
        ],
      },
      {
        title: 'Two clue givers',
        level: 'details',
        option: PAIR,
        bullets: [
          'With two clue givers (the default from 5 players), the first to pick a word proposes it.',
          'The partner agrees, or vetoes: then the partner picks instead. A veto of that second pick doesn’t count: it stands.',
          'Either may swap the card for a new one, once a turn, before anything is proposed.',
          'Both place pieces, in any order, and both judge guesses.',
        ],
      },
      {
        title: 'When nobody gets it',
        level: 'details',
        bullets: [
          'Wipe: clear the board in one tap and try a new angle.',
          'Helper: once the round clock has run out (or at any time without a clock), the clue givers may invite one guesser to help. The helper sees the word, places pieces and scores like a clue giver.',
          'Pass: the clue givers can drop the word. Nobody scores.',
          'Give up: any guesser can tap Give up (and take it back). Once every guesser has given up, the word is dropped. You can still guess after giving up.',
        ],
      },
      {
        title: 'End of the game',
        level: 'details',
        bullets: [
          `Usually the game ends once ${WORDS_TO_END} words have been guessed.`,
          'The host can pick a shorter game instead (it ends once every player has had a word of theirs guessed as a clue giver) or an endless one, which the host ends.',
          'Most points wins; ties share the win.',
        ],
      },
      {
        title: 'Timers',
        level: 'edge',
        option: CLOCK,
        bullets: [
          'Choosing a word has a 45-second reminder.',
          'The round clock (3, 5 or 8 minutes, 5 by default, or off) is a reminder: when it runs out, the clue givers may invite a helper or pass.',
          'There is no clock on each move.',
        ],
      },
      {
        title: 'Strict round clock',
        level: 'edge',
        option: STRICT,
        bullets: ['With the strict clock, the word is dropped when time runs out. Nobody scores.'],
      },
      {
        title: 'Coming and going',
        level: 'edge',
        bullets: [
          'Players who join mid-game sit down at the next round (up to 12).',
          'If a clue giver leaves, the word is dropped and the next clue givers take over.',
          'A helper who leaves just leaves the team. With only one player left, the game ends.',
          'The host can choose the word for a clue giver who has gone quiet.',
        ],
      },
    ],
    tiles: {
      label: 'Icons',
      blurb: '118 icons in 5 groups',
      intro: 'The board, column by column. Tap a group to see its icons and what they can mean.',
      shape: 'square',
      items: tiles,
    },
    catalog: {
      label: 'Board',
      blurb: '118 icons and what they can stand for',
      intro:
        'Every icon on the board, with the ideas it usually stands for. Any reading the table can follow is fair.',
      groups: catalog,
    },
    reference: [
      {
        title: 'The sets',
        head: ['Set', 'Pieces', 'Use'],
        rows: [
          ['? green', `Marker + ${CUBE_CAP.main} cubes`, 'The main idea, always first'],
          ['!1 blue', `Marker + ${CUBE_CAP.sub1} cubes`, 'A second idea'],
          ['!2 red', `Marker + ${CUBE_CAP.sub2} cubes`, 'A third idea'],
          ['!3 yellow', `Marker + ${CUBE_CAP.sub3} cubes`, 'A fourth idea'],
          ['!4 black', `Marker + ${CUBE_CAP.sub4} cubes`, 'A fifth idea'],
        ],
      },
      {
        title: 'Scoring',
        head: ['Who', 'Points', 'With the bonus'],
        rows: [
          ['First right guess', '2', `+1 ${LEVEL_LABELS.hard}, +2 ${LEVEL_LABELS.challenging}`],
          [
            'Each clue giver or helper',
            '1',
            `+1 ${LEVEL_LABELS.hard}, +2 ${LEVEL_LABELS.challenging}`,
          ],
          ['A dropped word', '0', '0'],
        ],
      },
      {
        title: 'Examples',
        head: ['Pieces', 'Could be'],
        rows: [
          [
            '? on Building, a cube on Metal · ! on Place, cubes on Blue, White and Red',
            'A metal building in a blue, white and red country: a famous tower',
          ],
          [
            '? on Film, cubes on Black and White · ! on Man and Big · ! on Man and Small',
            'Two men, one big, one small, from black-and-white films: a comedy pair',
          ],
          ['? on Conflict with three cubes stacked on it', 'A lot of fighting: a war'],
          [
            '? on Watercraft, cubes on Big and Cold · ! on Man, a cube on Film',
            'A chain: the famous ship, then the actor from the film about it',
          ],
        ],
        note: 'Icons are named by what they usually stand for; the board shows pictures.',
      },
    ],
    tips: [
      'Start broad: the ? on the right category (a person, a film, a place) helps more than any detail.',
      'Use a separate ! set for each idea, so “a building in a red, white and blue place” doesn’t read as “a red, white and blue building”.',
      'Watch the “close” marks: they tell you which guesses are on the right track.',
      'Stacked cubes say “very” or “many”: three cubes on Small is tiny.',
      'Lost? Wipe the board and come at the word from somewhere else.',
    ],
    glossary: [
      {
        term: 'Clue givers',
        meaning: 'The one or two players describing the secret word this round.',
      },
      { term: 'Marker', meaning: 'The big piece of a set: ? for the main idea, ! for a sub-idea.' },
      { term: 'Cube', meaning: 'A small piece that adds detail to its set’s idea.' },
      {
        term: 'Helper',
        meaning: 'A guesser invited onto the clue team after the round clock runs out.',
      },
    ],
  };
}

/** The guide for these icons, with art when there is some. */
export function makeGuide(
  icons: IconInfo = PLAIN,
  art: GuideArt = {},
  footer?: GuideFooter,
): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as IconicView;
    if (!v?.settings) return undefined;
    const s = v.settings;
    const seated = v.game?.order.length ?? v.seats.filter((x) => x.playing).length;
    const pair = s.givers === 2 || (s.givers === 'auto' && seated >= 5);
    const options = [
      ...(s.scoring ? [SCORING.key] : []),
      ...(s.scoring && s.bonus ? [BONUS.key] : []),
      ...(s.roundMinutes !== null ? [CLOCK.key] : []),
      ...(s.roundMinutes !== null && s.timerMode === 'strict' ? [STRICT.key] : []),
      ...(pair ? [PAIR.key] : []),
    ];
    const length =
      s.length === 'twelve'
        ? `to ${WORDS_TO_END} words`
        : s.length === 'each'
          ? 'one word each'
          : 'endless';
    return {
      summary: `${seated} players · ${pair ? 'two clue givers' : 'one clue giver'} · ${length} · ${s.scoring ? 'scored' : 'no score'}`,
      options,
    };
  };
  return {
    ...base(icons, art),
    presets: [
      {
        id: 'standard',
        label: 'The usual game',
        context: {
          summary: `Scored, to ${WORDS_TO_END} words, with a 5-minute reminder.`,
          options: [SCORING.key, CLOCK.key, PAIR.key],
        },
      },
      {
        id: 'relaxed',
        label: 'No score, no clock',
        context: { summary: 'Just guessing for fun.', options: [PAIR.key] },
      },
    ],
    ...(footer && { footer }),
    room,
  };
}

/** The guide without art, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const url = (path: string) => `/api/backroom/assets/iconic/${path.replace(/^\/+/, '')}`;

/** The guide in the manifest's icon names and meanings, with its art and the credits. */
export function nameGuide(manifest: unknown): GameGuide {
  const m: Manifest | null = asManifest(manifest);
  const a = (p: unknown) => (clean(p, 300) ? url(clean(p, 300)!) : undefined);
  const icons: IconInfo = {
    name: (n) => iconName(m, n),
    meanings: (n) => iconMeanings(m, n),
    art: (n) => a(m?.icons?.[String(n)]?.art),
  };
  const art: GuideArt = {};
  if (a(m?.markers?.main)) art.main = a(m?.markers?.main)!;
  if (a(m?.markers?.sub1)) art.sub = a(m?.markers?.sub1)!;
  if (a(m?.box)) art.box = a(m?.box)!;
  return makeGuide(icons, art, footerOf(m));
}
