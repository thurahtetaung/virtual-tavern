import type { GameGuide, GuideContext, GuideFooter, GuideOption, GuideTile } from '@vt/game-sdk';
import { type Manifest, asManifest, assetUrl, clean, footerOf } from './manifest.ts';
import { OURS_PREFIX, type RedHerringView, chosenSets } from './types.ts';

export { type Manifest, deckNames, footerOf } from './manifest.ts';

/** Art for the guide, from the private manifest. */
export interface GuideArt {
  back?: string;
  notebook?: string;
  pencil?: string;
  vp?: string;
  lobby?: string;
}

const TWICE: GuideOption = { key: 'twice', label: 'Twice around' };
const OPEN_VOTE: GuideOption = { key: 'openVote', label: 'Open vote in turn' };
const SECRET_VOTE: GuideOption = { key: 'openVote', label: 'Open vote in turn', off: true };
const NO_TALK: GuideOption = { key: 'noDiscussion', label: 'No Discussion' };
const TALK: GuideOption = { key: 'noDiscussion', label: 'No Discussion', off: true };
const RULEBOOK: GuideOption = { key: 'rulebook', label: 'Rulebook scoring' };
const CAUGHT: GuideOption = { key: 'caught', label: 'Score only a catch' };
const FUN: GuideOption = { key: 'fun', label: 'Just for fun' };
const BALANCED: GuideOption = { key: 'balanced', label: 'Balanced deal' };
const TOPIC: GuideOption = { key: 'topic', label: 'Thematic Game' };
const OURS: GuideOption = { key: 'ours', label: 'A picture set from our other games' };

function base(art: GuideArt): GameGuide {
  const tiles: GuideTile[] = [
    {
      id: 'picker',
      name: 'Word-picker',
      icon: '✏️',
      text: 'Plays a card, then writes a secret word that fits it and one more card in hand. Doesn’t know who the Conspirator is, and quietly hopes they get away.',
      meta: 'Everyone takes a turn',
      tone: 'own',
      win: 'Scores 4 when fewer than 2 players find the Conspirator.',
      ...(art.pencil && { art: art.pencil }),
    },
    {
      id: 'detective',
      name: 'Detective',
      icon: '🔍',
      text: 'Gets the word in their notebook. Plays two cards that fit it, without making it too easy, and votes for whoever seems to be bluffing.',
      meta: 'Everyone else but one',
      tone: 'good',
      win: 'Scores 3 for a vote on the Conspirator.',
    },
    {
      id: 'conspirator',
      name: 'Conspirator',
      icon: '🐟',
      text: 'Their notebook says they’re the Conspirator, with no word. Watches the cards already played, guesses what they share, and plays along as if they knew.',
      meta: 'One a round, at random',
      tone: 'evil',
      win: 'Scores 5 when fewer than 2 players find them.',
    },
    {
      id: 'notebook',
      name: 'Notebook',
      icon: '📓',
      text: 'Hold it to read it: a Detective’s shows the word, the Conspirator’s says they’re the Conspirator. Everyone’s looks and works the same way, so nobody can tell from your screen which you have.',
      meta: 'One each but the word-picker',
      tone: 'neutral',
      ...(art.notebook && { art: art.notebook }),
    },
    {
      id: 'points',
      name: 'Point tokens',
      icon: '🪙',
      text: 'Worth 3, 4 or 5. Most points wins; on a tie, whoever scored in more rounds wins, and if that ties too, they share the win.',
      meta: 'One per scoring round',
      tone: 'neutral',
      ...(art.vp && { art: art.vp }),
    },
  ];
  return {
    tagline:
      'Everyone gets the secret word but one: play pictures that fit it, explain them, and find who’s bluffing blind.',
    players: '4 to 10',
    duration: '30–60 minutes',
    goal: 'Score the most points: as a Detective by finding the Conspirator, as the Conspirator by blending in, and as the word-picker by helping them get away.',
    quickStart: [
      'Each round one player is the word-picker: they play a picture card, then write a secret word.',
      'Everyone else gets a notebook with the word, except one random player, the Conspirator, whose notebook has no word.',
      'Taking turns, everyone plays two cards face up that fit the word. The Conspirator plays along.',
      'The word is said out loud and everyone explains their two cards, the word-picker first.',
      'Everyone but the word-picker votes for who they think the Conspirator is.',
      'Fewer than 2 votes on the Conspirator: they score 5 and the word-picker 4. Each finder scores 3.',
    ],
    steps: [
      {
        title: 'A card, then a word',
        text: 'The word-picker plays a picture card face up, then writes a word that fits it and another card in their hand. One word plays best.',
        icon: '✏️',
        ...(art.pencil && { art: art.pencil }),
      },
      {
        title: 'One player plays blind',
        text: 'Everyone else gets a notebook with the word, except one: the Conspirator, chosen at random, whose notebook has no word. Nobody knows who, not even the word-picker.',
        icon: '📓',
        ...(art.notebook && { art: art.notebook }),
      },
      {
        title: 'Two laps of cards',
        text: 'Taking turns from the word-picker’s left, everyone plays a card face up; then the word-picker plays a second and everyone a second. The Conspirator watches and plays along.',
        icon: '🃏',
        ...(art.back && { art: art.back }),
      },
      {
        title: 'Explain yourself',
        text: 'The word is said out loud. The word-picker explains their two cards, then everyone else in turn. Then talk it over.',
        icon: '🗣️',
      },
      {
        title: 'Find the Conspirator',
        text: 'Everyone but the word-picker votes in secret for who they think played blind. Never yourself, never the word-picker.',
        icon: '🔍',
      },
      {
        title: 'Score and pass on',
        text: 'Each vote on the Conspirator scores 3. With fewer than 2 such votes, the Conspirator scores 5 and the word-picker 4. The next player picks the word.',
        icon: '🪙',
        ...(art.vp && { art: art.vp }),
      },
    ],
    stepsDone: 'Tap 📖 Rules any time to read the details.',
    setup: [
      'Everyone sits down; 4 to 10 can play, others can watch. The first word-picker is chosen at random.',
      'Everyone gets 6 picture cards. Every card you play is replaced at once while the deck lasts.',
    ],
    sections: [
      {
        title: 'A round',
        level: 'basics',
        bullets: [
          'The word-picker plays one card face up, then writes the word: it should fit that card and at least one more in their hand.',
          'Everyone else gets a notebook. Hold it to read it: a Detective’s shows the word, and the one Conspirator’s says they’re the Conspirator, with no word.',
          'From the word-picker’s left, everyone plays a card face up. Then the word-picker plays their second card, and everyone else a second, in the same order.',
          'You see whose turn it is, never who is thinking.',
        ],
      },
      {
        title: 'Explaining and talking',
        level: 'basics',
        option: TALK,
        bullets: [
          'Once everyone has two cards out, the word is shown to the whole table and said out loud.',
          'The word-picker explains why their two cards fit it, then everyone else in turn from their left. The explainer’s cards show large; they tap Done.',
          'Then the table talks it over. The host ends the discussion when everyone is ready to vote.',
          'You may never show the cards still in your hand.',
        ],
      },
      {
        title: 'The secret vote',
        level: 'basics',
        option: SECRET_VOTE,
        bullets: [
          'Everyone but the word-picker votes at once, in secret, for one player: never yourself and never the word-picker. The Conspirator votes too, to throw suspicion on someone else.',
          'You only see who has voted. The votes are revealed together once all are in.',
        ],
      },
      {
        title: 'Open vote in turn',
        level: 'details',
        option: OPEN_VOTE,
        bullets: [
          'The printed vote: one at a time, from the word-picker’s left, each vote shows as it is cast, so later voters see earlier votes.',
          'Never yourself and never the word-picker.',
        ],
      },
      {
        title: 'Scoring',
        level: 'basics',
        option: RULEBOOK,
        bullets: [
          'Each Detective who voted for the Conspirator scores 3.',
          'If fewer than 2 votes are on the Conspirator, the Conspirator scores 5 and the word-picker 4.',
          'With 2 or more votes on them, the Conspirator and the word-picker score nothing.',
          'Votes on Detectives cost nothing. The Conspirator’s own vote never scores.',
        ],
      },
      {
        title: 'Score only a catch',
        level: 'details',
        option: CAUGHT,
        bullets: [
          'For tables where Detectives play strange cards on purpose.',
          'Detectives who voted for the Conspirator score 3 only if the Conspirator is caught (2 or more votes).',
          'If the Conspirator gets away, only they (5) and the word-picker (4) score.',
        ],
      },
      {
        title: 'Just for fun',
        level: 'details',
        option: FUN,
        bullets: [
          'Nobody scores. The vote and the reveal still show who the Conspirator was and whether the table caught them.',
        ],
      },
      {
        title: 'The reveal and the end',
        level: 'details',
        bullets: [
          'The votes are shown, then who the Conspirator was, then the round’s points.',
          'The host moves on to the next round; the word-picker’s turn passes to the left.',
          'The game ends after everyone has picked the word once with 5 or more players, or twice with 4.',
          'Most points wins. On a tie, the player who scored in more rounds wins; if that ties too, they share the win.',
        ],
      },
      {
        title: 'Seat luck',
        level: 'details',
        bullets: [
          'A Conspirator sitting just after the word-picker has only one card to go on. That is why the word-picker’s first card goes down before the notebooks: everyone sees at least that one.',
        ],
      },
      {
        title: 'Twice around',
        level: 'edge',
        option: TWICE,
        bullets: ['Everyone picks the word twice, at any table size, for a longer game.'],
      },
      {
        title: 'No Discussion',
        level: 'edge',
        option: NO_TALK,
        bullets: [
          'A printed variant: the vote comes straight after the cards. The word isn’t said out loud and nobody explains.',
        ],
      },
      {
        title: 'Thematic Game',
        level: 'edge',
        option: TOPIC,
        bullets: [
          'A printed variant: the host writes a topic in the lobby (films, countries…). Every word must fit it, and it shows with the word.',
        ],
      },
      {
        title: 'Balanced deal',
        level: 'edge',
        option: BALANCED,
        bullets: [
          'The Conspirator is still a secret and still random, but always among the players who have been it the fewest times this game, so everyone gets the role about equally.',
        ],
      },
      {
        title: 'Card sets',
        level: 'edge',
        bullets: [
          'The host picks the card sets under Picture cards: the Classic deck and the Noir deck are both in by default.',
          'There must be a card for every play of the game: with many players (or twice around) the host may need to add a set before starting.',
          'Once the deck runs out, played cards simply aren’t replaced.',
        ],
      },
      {
        title: 'Picture sets from our other games',
        level: 'edge',
        option: OURS,
        bullets: [
          'Off by default: the host can add any of the picture sets from our other games, each on its own. Every card shows this game’s back.',
        ],
      },
      {
        title: 'Timers',
        level: 'edge',
        bullets: [
          'The host can time each turn (the word, each card, the vote), each explanation and the discussion. By default the timers are reminders, and the host may Act for a slow player.',
          'In Strict mode, when time runs out a random card is played, an explanation ends, the discussion ends, or a random vote is cast. The word is never written for anyone: its timer stays a reminder.',
          'Moves made for someone are marked ⏱.',
        ],
      },
      {
        title: 'Coming and going',
        level: 'edge',
        bullets: [
          'Players joining mid-game watch, and sit down for the next game.',
          'A player who leaves for good stays at the table, marked away: after a moment their card is played, their explanation ends and their vote is cast at random for them. They are never the Conspirator, and their turn as word-picker is skipped, so the game is a round shorter.',
          'A word-picker who leaves before writing the word: that round is dropped.',
          'The host can take out a player who has dropped out, the same as leaving.',
          'If fewer than 4 players are left, the game ends after the round, with the scores so far.',
        ],
      },
    ],
    tiles: {
      label: 'Roles',
      blurb: 'The word-picker, the Detectives and the Conspirator',
      intro: 'Who’s who at the table. Tap one to read it.',
      shape: 'square',
      items: tiles,
    },
    reference: [
      {
        title: 'Scoring',
        head: ['Votes on the Conspirator', 'Each finder', 'Conspirator', 'Word-picker'],
        rows: [
          ['0', '—', '5', '4'],
          ['1', '3 (0 when scoring only a catch)', '5', '4'],
          ['2 or more', '3', '0', '0'],
        ],
        note: 'Just for fun: nobody scores.',
      },
      {
        title: 'Rounds',
        head: ['Players', 'Each picks the word'],
        rows: [
          ['4', 'Twice (8 rounds)'],
          ['5 to 10', 'Once (twice with Twice around)'],
        ],
      },
    ],
    tips: [
      'As a Detective, play cards that fit the word but don’t give it away: the Conspirator is watching.',
      'As the Conspirator, look for what the cards already down have in common, and explain with confidence.',
      'A strange card isn’t proof: some hands just have nothing better.',
      'As word-picker, pick a word broad enough that the Conspirator can bluff along.',
    ],
    glossary: [
      { term: 'Word-picker', meaning: 'The player who writes this round’s word. They never vote.' },
      { term: 'Conspirator', meaning: 'The one player without the word this round.' },
      { term: 'Caught', meaning: 'Two or more votes landed on the Conspirator.' },
    ],
  };
}

/** The guide, with art when there is some. */
export function makeGuide(art: GuideArt = {}, footer?: GuideFooter): GameGuide {
  const room = (raw: unknown, you: string): GuideContext | undefined => {
    const v = raw as RedHerringView;
    if (!v?.settings) return undefined;
    const s = v.settings;
    const seated = v.game?.players.length ?? v.seats.filter((x) => x.playing).length;
    const options = [
      s.twice && TWICE.key,
      s.openVote && OPEN_VOTE.key,
      s.noDiscussion && NO_TALK.key,
      s.scoring === 'rulebook' && RULEBOOK.key,
      s.scoring === 'caught' && CAUGHT.key,
      s.scoring === 'fun' && FUN.key,
      s.balanced && BALANCED.key,
      !!s.topic && TOPIC.key,
      chosenSets(s).some((id) => id.startsWith(OURS_PREFIX)) && OURS.key,
    ].filter((k): k is string => !!k);
    const ctx: GuideContext = {
      summary: [
        `${seated} players`,
        s.openVote ? 'open vote' : 'secret vote',
        s.scoring === 'fun' ? 'no points' : s.scoring === 'caught' ? 'score only a catch' : null,
        s.noDiscussion ? 'no discussion' : null,
        s.topic ? `topic: ${s.topic}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      options,
      inGame: {
        picker: 1,
        detective: Math.max(1, seated - 2),
        conspirator: 1,
        notebook: 1,
        points: 1,
      },
    };
    const r = v.game?.round;
    if (!r || v.phase !== 'playing') return ctx;
    if (r.picker === you)
      return {
        ...ctx,
        you: {
          name: 'Word-picker',
          icon: '✏️',
          text: 'You know the word, but not who the Conspirator is.',
          tile: 'picker',
        },
      };
    if (!r.notebook) return ctx;
    const blind = r.notebook.word === null;
    return {
      ...ctx,
      secret: true,
      you: blind
        ? {
            name: 'Conspirator',
            icon: '🐟',
            text: 'Your notebook has no word: blend in with the cards on the table.',
            tile: 'conspirator',
          }
        : {
            name: 'Detective',
            icon: '🔍',
            text: 'You have the word: fit it, and find who doesn’t.',
            tile: 'detective',
          },
    };
  };
  return {
    ...base(art),
    presets: [
      {
        id: 'standard',
        label: 'The usual game',
        context: {
          summary: 'Secret vote, rulebook scoring, explanations and a discussion.',
          options: [RULEBOOK.key],
        },
      },
      {
        id: 'printed',
        label: 'As printed',
        context: {
          summary: 'The vote in turn, in the open.',
          options: [RULEBOOK.key, OPEN_VOTE.key],
        },
      },
      {
        id: 'fun',
        label: 'Just for fun',
        context: { summary: 'No points: just the bluffing.', options: [FUN.key] },
      },
    ],
    ...(footer && { footer }),
    room,
  };
}

/** The guide without art, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

/** The guide with the manifest's art and credits. */
export function nameGuide(manifest: unknown): GameGuide {
  const m: Manifest | null = asManifest(manifest);
  const url = (p: unknown) => {
    const c = clean(p);
    return c ? assetUrl(c) : undefined;
  };
  const art: GuideArt = {};
  const pairs: [keyof GuideArt, string | undefined][] = [
    ['back', url(m?.back)],
    ['notebook', url(m?.components?.notebookCover)],
    ['pencil', url(m?.components?.pencil)],
    ['vp', url(m?.components?.vp?.['5'])],
    ['lobby', url(m?.components?.lobbyArt)],
  ];
  for (const [k, v] of pairs) if (v) art[k] = v;
  return makeGuide(art, footerOf(m));
}
