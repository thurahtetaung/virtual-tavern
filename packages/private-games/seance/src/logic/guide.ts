import type { GameGuide, GuideContext, GuideTile } from '@vt/game-sdk';
import { COLORS, type PsychicColor, type SeanceView } from './types.ts';

// The plain guide calls the psychics by seat colour; `nameGuide` gives them their names and
// portraits from the private manifest.

export interface SeanceNames {
  psychic?: (color: PsychicColor) => { name?: string; art?: string } | undefined;
  /** The vision cards' back. */
  back?: string;
}

const COLOR_WORD: Record<PsychicColor, string> = {
  blue: 'Blue',
  white: 'White',
  red: 'Red',
  yellow: 'Yellow',
  purple: 'Purple',
  brown: 'Brown',
};

const LEVELS: Record<string, 'basics' | 'details' | 'edge'> = {
  'An hour: visions': 'basics',
  'An hour: the verdicts': 'basics',
  'The final: the culprit': 'basics',
  'Clairvoyance tokens': 'details',
  Difficulty: 'details',
  'Story cards': 'details',
  'Extra visions': 'details',
  'Extra suspects and places': 'details',
  'If someone drops out': 'edge',
};
const ORDER = Object.keys(LEVELS);
const OPTIONS: Record<string, { key: string; label: string }> = {
  'Clairvoyance tokens': { key: 'tokens', label: '4 or more players' },
  'Story cards': { key: 'stories', label: 'Stories as the third pillar' },
  'Extra visions': { key: 'pools', label: 'Extra vision pools' },
  'Extra suspects and places': { key: 'extras', label: 'Extra suspects and places' },
};

/** The card kinds, as tiles: what each one is for. */
const CARD_TILES: GuideTile[] = [
  {
    id: 'vision',
    name: 'Visions',
    text: 'The picture cards the ghost sends. They point at a card on the table without saying anything.',
    icon: '👁️',
  },
  {
    id: 'suspect',
    name: 'Suspects',
    text: 'The first thing each psychic looks for: who was there.',
    icon: '🧑',
  },
  {
    id: 'place',
    name: 'Places',
    text: 'The second thing each psychic looks for: where it happened.',
    icon: '🏚️',
  },
  {
    id: 'object',
    name: 'Objects',
    text: 'The third thing each psychic looks for: with what. Played unless the host picks stories.',
    icon: '🗝️',
  },
  {
    id: 'story',
    name: 'Stories',
    text: 'Scenes that can take the place of objects as the third pillar: the same rules, harder pictures. Best for players who know the game.',
    icon: '📜',
    meta: 'Host option',
  },
].map((t) => ({ ...t, group: 'Cards', tone: 'neutral' as const }));

export function makeGuide(names: SeanceNames = {}): GameGuide {
  const psychicName = (c: PsychicColor) =>
    names.psychic?.(c)?.name ?? `the ${COLOR_WORD[c]} psychic`;
  const named = COLORS.some((c) => names.psychic?.(c)?.name);
  const plain = base();
  const tiles: GuideTile[] = [
    {
      id: 'ghost',
      name: 'The ghost',
      text: plain.roles![0]!.summary,
      icon: '👻',
      group: 'Roles',
      tone: 'own',
      ...(names.back && { art: names.back }),
    },
    ...COLORS.map((c): GuideTile => {
      const art = names.psychic?.(c)?.art;
      const name = names.psychic?.(c)?.name ?? `${COLOR_WORD[c]} psychic`;
      return {
        id: c,
        name,
        text: plain.roles![1]!.summary,
        icon: '🔮',
        group: 'Psychics',
        tone: 'good',
        meta: `A psychic (the ${c} seat)`,
        ...(art && { art }),
      };
    }),
    ...CARD_TILES,
  ];
  const room = (raw: unknown, you: string): GuideContext | undefined => {
    const v = raw as SeanceView;
    if (!v?.settings) return undefined;
    const players = v.seats.filter((x) => x.playing).length;
    const stories = (v.game?.third ?? v.settings.third) === 'story';
    const pools = v.settings.pools?.length ?? 0;
    const extras = v.settings.extras ?? false;
    const ctx: GuideContext = {
      summary: `${v.settings.difficulty[0]!.toUpperCase()}${v.settings.difficulty.slice(1)} · ${v.settings.sets.length} card ${v.settings.sets.length === 1 ? 'set' : 'sets'}${stories ? ' · stories' : ''}${pools ? ` · ${pools} extra vision ${pools === 1 ? 'pool' : 'pools'}` : ''}${extras ? ' · extra suspects and places' : ''} · ${players} at the table`,
      options: [
        ...(players >= 4 ? ['tokens'] : []),
        ...(stories ? ['stories'] : []),
        ...(pools ? ['pools'] : []),
        ...(extras ? ['extras'] : []),
      ],
    };
    const g = v.game;
    if (g && v.me?.id === you) {
      const ghost = g.ghost === you;
      const mine = g.me;
      const tile = tiles.find((t) => t.id === (ghost ? 'ghost' : mine));
      if (tile && (ghost || mine)) {
        ctx.you = {
          name: tile.name,
          text: ghost
            ? 'Silent all game. Send each psychic a vision every hour.'
            : `Find your suspect, then your place, then your ${stories ? 'story' : 'object'}.`,
          tile: tile.id,
          ...(tile.art && { art: tile.art }),
          ...(g.stage === 'visions' || g.stage === 'reveal'
            ? {
                now: `🕰️ Hour ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][g.hour - 1] ?? g.hour} of VII`,
              }
            : g.stage === 'shared' || g.stage === 'vote'
              ? { now: '⚖️ The final' }
              : {}),
        };
      }
    }
    return ctx;
  };
  const sections = [...plain.sections]
    .sort((a, b) => ORDER.indexOf(a.title) - ORDER.indexOf(b.title))
    .map((s) => ({
      ...s,
      level: LEVELS[s.title] ?? 'details',
      ...(OPTIONS[s.title] && { option: OPTIONS[s.title] }),
    }));
  return {
    ...plain,
    setup: plain.setup.map((line) =>
      named
        ? line.replace(
            'Psychics may pick which psychic (colour) they play.',
            `Psychics may pick which psychic they play (${COLORS.map(psychicName).join(', ')}).`,
          )
        : line,
    ),
    sections,
    steps: [
      {
        title: 'One silent ghost',
        text: plain.quickStart![0]!,
        icon: '👻',
        ...(names.back && { art: names.back }),
      },
      { title: 'Your suspect, place and object', text: plain.quickStart![1]!, icon: '🔍' },
      { title: 'Visions each hour', text: plain.quickStart![2]!, icon: '🖼️' },
      { title: 'Talk, guess, Ready', text: plain.quickStart![3]!, icon: '🗣️' },
      { title: 'Bet on each other', text: plain.quickStart![4]!, icon: '✓✗' },
      { title: 'The final vision', text: plain.quickStart![5]!, icon: '⚖️' },
    ],
    tiles: {
      label: 'Ghost, psychics & cards',
      blurb: '1 ghost · 6 psychics · 5 kinds of card',
      intro: 'One ghost, up to six psychics and the cards they play with. Tap one to read it.',
      items: tiles,
    },
    reference: [
      {
        title: 'Cards on the table, per kind',
        head: ['Players (ghost included)', '3', '4', '5', '6', '7'],
        rows: [
          ['Easy', '5', '5', '6', '6', '7'],
          ['Medium', '6', '6', '7', '8', '8'],
          ['Hard', '7', '7', '8', '9', '9'],
        ],
      },
      {
        title: 'Ravens and tokens',
        head: ['', 'Easy', 'Medium', 'Hard'],
        rows: [['Ravens', 'once an hour', '3 a game', '1 a game']],
        note: 'Clairvoyance tokens: 4 each with 4–5 players, 6 each with 6–7, none with 3. They all come back at the start of hour IV.',
      },
    ],
    room,
  };
}

function base(): GameGuide {
  return {
    tagline: 'A ghost who cannot speak, a table of psychics, and seven hours to read its visions.',
    players: '3 to 7 (one ghost, 2 to 6 psychics)',
    duration: '40–60 minutes',
    goal: 'Everyone plays together. The ghost knows who was there, where it happened and with what, but can only send picture cards. Each psychic must find their own suspect, place and object before the seventh hour ends; then one last shared vision points to the culprit, and the psychics vote. Pick the right one and everyone wins.',
    quickStart: [
      'One player is the ghost; everyone else is a psychic. The ghost never speaks: no words, no faces, no nods.',
      'Each psychic secretly has a suspect, a place and an object among the cards on the table. Only the ghost knows which.',
      'Each hour the ghost sends every psychic one or more picture cards (visions) that point to their current card.',
      'Psychics talk it over, tap Guess on their card, then Ready; the ghost reveals. Right: on to the next card. Wrong: keep the visions and get more next hour.',
      'Bet on each other’s guesses with ✓ and ✗ clairvoyance tokens: every right bet makes you more clear-sighted for the final.',
      'Find everything within 7 hours, then read the ghost’s shared vision of the culprit, and vote. The more clear-sighted you are, the more of it you see first.',
    ],
    setup: [
      'Sit down (3 to 7 players). The host chooses how the ghost is picked: at random, the host picks, or at random among volunteers. Psychics may pick which psychic (colour) they play.',
      'The host chooses the difficulty: more cards on the table make it harder, and fewer ravens leave the ghost stuck with bad cards. The host can also switch card sets on and off, play stories instead of objects, add extra vision pools or extra suspects and places, and set the turn timer.',
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
          'The ghost picks a psychic still searching, chooses one or more cards from their hand and sends them. The hand fills back up to 7.',
          'Each psychic gets exactly one vision per hour; the ghost works round the table until everyone still searching has one.',
          'Psychics may start guessing as soon as their own vision arrives. Several psychics may pick the same card, but each card belongs to at most one of them.',
          'Once every vision is out, the timer starts (2 minutes by default). Talk freely; the ghost listens but never reacts. Tap Ready when you are happy.',
          'When everyone still searching is Ready, the ghost reveals the verdicts. Until then, moving a guess or token takes your Ready back.',
          'The timer is a reminder, or strict (the hour ends at 0:00; no guess counts as wrong). The host can lock the guesses in at any time.',
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
          'The app judges every guess at once (the ghost doesn’t have to), and says what ended the hour: the ghost’s reveal, the host’s lock or the strict timer.',
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
        title: 'Story cards',
        bullets: [
          'The host may play story cards instead of objects as the third pillar. Read “object” as “story” everywhere: each psychic finds a suspect, a place, then a story, and the ghost’s shared vision points to the culprit’s story.',
          'Stories are dark scenes full of detail, so they are harder to read than objects. Try them once everyone knows the game.',
          'Story cards come with the second expansion and the promos: those sets must be on.',
        ],
      },
      {
        title: 'Extra visions',
        bullets: [
          'The host may shuffle extra vision pools into the deck: picture cards from other games. They are off by default, and nothing else changes.',
          'More visions means more variety in the ghost’s hand. One of the pools is at a lower resolution, so it looks softer when zoomed in.',
        ],
      },
      {
        title: 'Extra suspects and places',
        bullets: [
          'The host may add 20 extra suspects and 20 extra places from another edition of the game. They join the cards the table’s suspects and places are drawn from, so any of them can be someone’s target or a decoy. Off by default.',
          'Objects and stories have no extra cards: the third pillar stays as it is. The final line-up can mix extra cards with the rest.',
        ],
      },
      {
        title: 'If someone drops out',
        bullets: [
          'If a psychic leaves, their seat stays: anyone watching can take it over and carry on with the same cards. While it is empty, the ghost needn’t send it visions and its guess isn’t judged.',
          'If nobody will take the seat, the host can retire it before the line-up: its found cards go back on the table, and the others play on without it (no visions, no group in the line-up, no vote). The line-up waits for every seat still in the game, so retire it before the clock runs out.',
          'If the ghost goes away, the game simply waits for them. The host can hand the ghost’s seat to someone watching (or a new joiner), never to a psychic, who would then see the answers. If the ghost leaves the room for good, anyone watching can take the seat.',
        ],
      },
    ],
    tips: [
      'The line under the steps always says what the hour waits for: the ghost’s visions, who is Ready, or the ghost’s reveal.',
      'Ghost: look for shapes, colours and details that only your target shares. Every other card on the table is on your screen too (in each psychic’s cards, and as the other cards in Compare): steer away from the look-alikes. Several cards that agree are clearer than one.',
      'Psychics: say out loud what you see in your visions, and compare them with the other psychics’ visions too: a card that suits someone else’s vision is probably not yours.',
      'Tap any card to see it full screen: swipe for the next, pinch or double-tap to zoom. Tap your vision to pin it above the candidates and swipe through them.',
      'Tokens are cheap until hour IV: use them.',
    ],
    glossary: [
      { term: 'Vision', meaning: 'A picture card the ghost sends to point at something.' },
      { term: 'Guess', meaning: 'The card a psychic picks this hour (their intuition).' },
      {
        term: 'Clairvoyance',
        meaning:
          'How clear-sighted a psychic is: it decides how much of the final vision they see.',
      },
      {
        term: 'Ready',
        meaning:
          'A psychic is happy with their guess. Once everyone still searching is Ready, the ghost reveals the verdicts.',
      },
      { term: 'Raven', meaning: 'The ghost throws away cards from their hand and draws new ones.' },
    ],
  };
}

/** The guide in the plain words, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const url = (path: string) => `/api/backroom/assets/seance/${path.replace(/^\/+/, '')}`;

/** The guide with the psychics' names and portraits from the manifest. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = obj(manifest);
  const psychics = obj(m.psychics);
  const back = str(m.back);
  return makeGuide({
    psychic: (c) => {
      const p = obj(psychics[c]);
      const name = str(p.name);
      const art = str(p.art);
      return { ...(name && { name }), ...(art && { art: url(art) }) };
    },
    ...(back && { back: url(back) }),
  });
}
