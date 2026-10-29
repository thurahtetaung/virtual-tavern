import {
  type GameGuide,
  type GuideContext,
  type GuideFooter,
  type GuideOption,
  shapeGuide,
} from '@vt/game-sdk';
import { FILM_GENRES, GOALS, MODES, STYLES, STYLE_IDS, TV_GENRES, goalFor } from './genres.ts';
import { type Manifest, type Names, footerOf, namesOf } from './manifest.ts';
import type { CliffhangerView } from './types.ts';

export { type Manifest, footerOf, namesOf } from './manifest.ts';

const NO_SEQUELS: GuideOption = { key: 'noSequels', label: 'No Sequels' };
const CHALLENGE: GuideOption = { key: 'challenge', label: 'Challenge' };
const NEW_WORDS: GuideOption = { key: 'newWordsOnly', label: 'New Words Only' };
const NO_ADVANTAGE: GuideOption = { key: 'noAdvantage', label: 'No advantage' };
const COMEBACK: GuideOption = { key: 'comebackPick', label: 'Comeback category' };
const SUDDEN: GuideOption = { key: 'suddenDeath', label: 'Sudden death' };
const OPENING: GuideOption = { key: 'openingClock', label: 'Opening clock' };
const STRICT: GuideOption = { key: 'strict', label: 'Strict timers' };
const TV: GuideOption = { key: 'tv', label: 'TV shows' };
const GENRES: GuideOption = { key: 'genres', label: 'Chosen genres' };
const TWO_EACH: GuideOption = { key: 'twoEach', label: 'Two of each' };

function text(names: Names): GameGuide {
  return {
    tagline:
      'Two teams, one film at a time: win the face-off, then describe films in one word, a quote or a mime to collect every genre.',
    players: '4 to 16, in two teams (best with 6 or more)',
    duration: '30–45 minutes',
    goal: 'Be the first team to collect a film of every genre: eight by default. Each round starts with a face-off between one player from each team, then both teams get 30 seconds to describe their films.',
    quickStart: [
      'Split into two teams. The first team to collect a film of every chosen genre wins.',
      'Face-off: one player per team takes turns naming a film that fits the category, then pressing their button. Each press gives the other 15 seconds.',
      'Whoever runs out of time loses. The winner gets six films, keeps the easiest three and hands the hardest three to the loser.',
      'Each of you puts your three films on your team’s squares: One Word, Quote It and Act It.',
      'Your team gets 30 seconds. Describe each film the way its square says; tap Got it when your team names it.',
      'Got your three with time left? Steal the other team’s films the same way.',
    ],
    setup: [
      'Everyone joins a team; the host can shuffle them. Teams can be uneven, but each needs at least 2 players. Up to 16 play; anyone else watches.',
      'The host picks how you are playing (same room, video call, voice call or a mix), Films or TV shows, the packs, the clocks and any extra rules.',
      'Players face off in turn: each team goes round its own players, so everyone gets a go.',
    ],
    sections: [
      {
        title: 'The face-off',
        bullets: [
          'The next two players are named during the round before. A 3-2-1 counts down, then the category turns over on every screen.',
          'Either player can go first: say a film that fits out loud and press your button. Now your opponent has 15 seconds (or the host’s 10 or 20) to say another and press theirs.',
          'Keep trading films until one of you runs out of time. That player loses the face-off.',
          'It’s one on one: teammates can’t speak, but they can mime clues, as big as they like.',
          'Before anyone has answered, either player can ask for a new category.',
          'Nobody checks the answers but you. Doubt one? Press Pause: the player who gave it can concede (and lose), or you let it stand and the clock goes on. If you can’t agree, the host decides.',
        ],
      },
      {
        title: 'The films',
        bullets: [
          'The face-off winner gets six films, keeps the three they think easiest and passes the other three to the loser. Only the player holding them sees them.',
          'Each of you places your three films on your team’s three squares, one per square. The squares say how to describe them (see Styles).',
          'Placing has 15 seconds. Anything left empty is filled for you.',
          'The loser places while the winner’s team plays, so nobody waits.',
        ],
      },
      {
        title: 'Your team’s turn',
        bullets: [
          'After a 3-2-1, your team has 30 seconds (or the host’s 45 or 60). The face-off player describes; teammates shout guesses.',
          'Describe each film the way its square says. Switch between your three as often as you like; a skipped one waits for you.',
          'When a teammate names the film, tap Got it. Wrong guesses cost nothing.',
          'The other team sees your films and can flash a Foul note if you slip, but the table settles it, not the app.',
          'Got all three with time left? The other team’s films open up: steal them by describing them the same way. The face-off winner’s team plays first, then the other team.',
          'Films you got go into your team’s collection. Films nobody got are thrown away at the end of the round.',
        ],
      },
      {
        title: 'Three for one',
        bullets: [
          'After both turns, a team with three films of the same genre may give those three up to take any one film from the other team’s collection.',
          'Each team may do this once a round. The face-off winner’s team chooses first.',
        ],
      },
      {
        title: 'Winning',
        bullets: [
          'Collect one film of every genre in play to win: the eight first genres unless the host picks others. A team is checked as its turn ends and after a three-for-one, so the first to finish wins at once.',
        ],
      },
      {
        title: 'How are you playing?',
        bullets: [
          `${MODES.room.name}: ${MODES.room.blurb}.`,
          `${MODES.video.name}: ${MODES.video.blurb}.`,
          `${MODES.voice.name}: ${MODES.voice.blurb}. Nothing needs a camera.`,
          `${MODES.mix.name}: the host ticks three styles, or ticks more and has three dealt fresh every round.`,
          'On a call while the others are together? Switch on “I’m on a call”: on your turn, Act It becomes Describe It Badly.',
        ],
      },
      {
        title: 'TV shows',
        option: TV,
        bullets: [
          'The host can play with TV shows instead of films: the same game, with eight TV genres, TV categories and a deck of shows.',
          'By default the goal is one show of each of the eight TV genres.',
        ],
      },
      {
        title: 'Choosing the genres',
        option: GENRES,
        bullets: [
          'The host picks the genres to collect, at least four: any of the twelve film genres, or of the eight TV genres. The line under them says what wins, such as “Collect 1 of each of 7 genres”.',
          'Quick picks set them in one tap: the first eight, all twelve, or two of each of the four extra genres.',
          'Films and shows of the other genres are left out of the deck. The face-off categories stay the same.',
          'A genre with too few titles in the chosen packs is flagged, and the game won’t start until it has more or is turned off, so a long game never runs out.',
        ],
      },
      {
        title: 'Two of each',
        option: TWO_EACH,
        bullets: ['The host can ask for two of each genre instead of one: a longer game.'],
      },
      {
        title: 'Extra rule: No Sequels',
        option: NO_SEQUELS,
        bullets: [
          'In the face-off, once a film from a series is said, every other film of that series is off the table.',
        ],
      },
      {
        title: 'Extra rule: Challenge',
        option: CHALLENGE,
        bullets: [
          'A doubted face-off answer ends the face-off. If the answer was wrong, the doubter wins; if it was right, the answerer wins.',
          'Without this rule, a doubted answer the host strikes doesn’t count: the clock goes back to the player who gave it, with the time they had left.',
        ],
      },
      {
        title: 'Extra rule: New Words Only',
        option: NEW_WORDS,
        bullets: ['In One Word and Quote It, you can’t say any word from the title.'],
      },
      {
        title: 'House rule: no advantage',
        option: NO_ADVANTAGE,
        bullets: ['Off by default. Both face-off players get five films each and keep three.'],
      },
      {
        title: 'House rule: comeback category',
        option: COMEBACK,
        bullets: [
          'Off by default. While one team has fewer genres, its face-off player picks the category from two.',
        ],
      },
      {
        title: 'House rule: sudden death',
        option: SUDDEN,
        bullets: [
          'Off by default. When both teams are one genre away, the face-off decides the game: its winner’s team wins.',
        ],
      },
      {
        title: 'House rule: opening clock',
        option: OPENING,
        bullets: [
          'Off by default. The first answer must come within 15 seconds of the flip. If nobody answers, a new category turns over for the same two players.',
        ],
      },
      {
        title: 'Clocks',
        level: 'edge',
        bullets: [
          'The face-off, placing and the team turns always run on hard clocks.',
          'The comeback category pick and the three-for-one are a reminder by default: once their time is up the host can move on. With strict timers, time running out decides (a random category, or no trade).',
        ],
      },
      {
        title: 'Coming and going',
        level: 'edge',
        bullets: [
          'A new player joins the smaller team and takes their turn at the end of its rotation.',
          'If a face-off player or describer leaves, the next teammate in the rotation takes over their films and their clock.',
          'If a team is down to one player, the game ends with no winner.',
          'If the deck runs out, every film not collected or in play is shuffled back in.',
        ],
      },
    ],
    tips: [
      'Keep the films you know best: the loser gets the hard ones.',
      'Put the film you can mime on Act It, and the one with a famous line on Quote It.',
      'Stuck on one? Switch to another and come back.',
      'Mime for your face-off player: you can’t speak, but you can help.',
    ],
    glossary: [
      {
        term: 'Face-off',
        meaning: 'One on one: trade films that fit the category until someone runs out of time.',
      },
      {
        term: 'Square',
        meaning: 'One of your team’s three spots, each with a way to describe its film.',
      },
      {
        term: 'Steal',
        meaning:
          'Describe the other team’s films after getting your own three, or trade three of a genre for one of theirs.',
      },
      {
        term: 'Genre',
        meaning: `One of the collection’s sets: ${FILM_GENRES.slice(0, 8)
          .map((g) => names.genres.films[g.id])
          .join(', ')}.`,
      },
    ],
  };
}

function base(names: Names): GameGuide {
  return shapeGuide(text(names), {
    steps: [
      ['Two teams', '👥'],
      ['Face-off: trade films', '⏱️'],
      ['Winner keeps the easy three', '🎞️'],
      ['Place them on your squares', '🧩'],
      ['30 seconds to describe', '🗣️'],
      ['Collect every genre', '🏆'],
    ],
    levels: {
      'The face-off': 'basics',
      'The films': 'basics',
      'Your team’s turn': 'basics',
      'Three for one': 'basics',
      Winning: 'basics',
      'How are you playing?': 'details',
      'TV shows': 'details',
      'Extra rule: No Sequels': 'details',
      'Extra rule: Challenge': 'details',
      'Extra rule: New Words Only': 'details',
      'House rule: no advantage': 'edge',
      'House rule: comeback category': 'edge',
      'House rule: sudden death': 'edge',
      'House rule: opening clock': 'edge',
    },
    tiles: {
      label: 'Styles & genres',
      blurb: 'The four ways to describe, and every genre to collect',
      intro: 'Tap one to read it.',
      shape: 'square',
      items: [
        ...STYLE_IDS.map((id) => ({
          id,
          name: names.styles[id],
          icon: STYLES[id].emoji,
          tone: 'neutral' as const,
          text: STYLES[id].how,
          meta: STYLES[id].voiceSafe ? 'Works on a call' : 'Needs to be seen',
        })),
        ...FILM_GENRES.map((g, i) => ({
          id: g.id,
          name: names.genres.films[g.id]!,
          icon: g.emoji,
          tone: 'good' as const,
          text:
            i < 8 ? 'One of the eight genres to collect.' : 'An extra genre for the host to add.',
          meta: i < 8 ? 'Films' : 'Films: extra genre',
        })),
        ...TV_GENRES.map((g) => ({
          id: `tv-${g.id}`,
          name: names.genres.tv[g.id]!,
          icon: g.emoji,
          tone: 'good' as const,
          text: 'One of the eight TV genres to collect.',
          meta: 'TV shows',
        })),
      ],
    },
    reference: [
      {
        title: 'Goals',
        head: ['Goal', 'To win'],
        rows: [
          ['Films (default)', 'One of each of the eight genres'],
          ['All twelve', 'One of each of all twelve film genres'],
          ['The extra four', 'Two of each of the four extra film genres'],
          ['TV shows', 'One of each of the eight TV genres'],
          ['Your own', 'Any 4 or more genres, 1 or 2 of each'],
        ],
      },
      {
        title: 'Clocks',
        head: ['Step', 'Time'],
        rows: [
          ['Face-off answer', '15 s per press (10 or 20)'],
          ['Placing films', '15 s, then filled for you'],
          ['Team turn', '30 s (45 or 60)'],
          ['Comeback pick, three for one', '15 s reminder (strict: decides)'],
        ],
      },
    ],
  });
}

/** The guide in the given names, with the credits when there are some. */
export function makeGuide(names: Names = namesOf(null), footer?: GuideFooter): GameGuide {
  const room = (raw: unknown): GuideContext | undefined => {
    const v = raw as CliffhangerView;
    if (!v?.settings) return undefined;
    const s = v.settings;
    const options = [
      ...(s.deck === 'tv' ? [TV.key] : []),
      ...(s.noSequels ? [NO_SEQUELS.key] : []),
      ...(s.challenge ? [CHALLENGE.key] : []),
      ...(s.newWordsOnly ? [NEW_WORDS.key] : []),
      ...(s.noAdvantage ? [NO_ADVANTAGE.key] : []),
      ...(s.comebackPick ? [COMEBACK.key] : []),
      ...(s.suddenDeath ? [SUDDEN.key] : []),
      ...(s.openingClock ? [OPENING.key] : []),
      ...(s.timerMode === 'strict' ? [STRICT.key] : []),
    ];
    const goal = v.target ?? goalFor(s);
    const usual = GOALS[s.deck === 'tv' ? 'tv' : 'base'].genres;
    if (goal.genres.length !== usual.length || goal.genres.some((g) => !usual.includes(g)))
      options.push(GENRES.key);
    if (goal.each > 1) options.push(TWO_EACH.key);
    const styles =
      v.round?.styles ?? (s.mode === 'mix' ? s.mixStyles.slice(0, 3) : MODES[s.mode].styles);
    const inGame: Record<string, number> = {};
    for (const id of styles) inGame[id] = 1;
    for (const g of goal.genres) inGame[s.deck === 'tv' ? `tv-${g}` : g] = goal.each;
    const noun = s.deck === 'tv' ? 'shows' : 'films';
    return {
      summary: `${MODES[s.mode].name} · ${noun} · ${goal.genres.length} genres${goal.each > 1 ? ` × ${goal.each}` : ''}`,
      options,
      inGame,
    };
  };
  return { ...base(names), ...(footer && { footer }), room };
}

/** The guide with our own names, before (or without) the manifest. */
export const guide: GameGuide = makeGuide();

/** The guide in the manifest's names, with the credits. */
export function nameGuide(manifest: unknown): GameGuide {
  const m = (manifest && typeof manifest === 'object' ? manifest : null) as Manifest | null;
  return makeGuide(namesOf(m), footerOf(m));
}
