import type { GameGuide, GuideStep } from '@vt/game-sdk';

const LEVELS: Record<string, 'basics' | 'details' | 'edge'> = {
  'Asking questions': 'basics',
  'The vote': 'basics',
  'The spy’s last chance': 'basics',
  Scoring: 'details',
  'Coming and going': 'edge',
};
const STEPS: [string, string][] = [
  ['Everyone gets a card', '🗺️'],
  ['Ask a question out loud', '❓'],
  ['Answer, then ask the next', '🤫'],
  ['Vote for the spy', '🗳️'],
  ['The spy’s last guess', '🎯'],
  ['Points each round', '🏆'],
];

/** The stepper for a quick start (Masquerade's, or an edition's own). */
export const stepsFor = (quickStart: readonly string[]): GuideStep[] =>
  STEPS.map(([title, icon], i) => ({ title, icon, text: quickStart[i] ?? '' }));

/**
 * The rules guide. Any other edition shares it, with its own sentence about its locations (kept
 * in that edition's package, so it never ships with the public game).
 */
export function makeGuide(pack: string): GameGuide {
  const guide = text(pack);
  return {
    ...guide,
    sections: guide.sections.map((sec) => ({ ...sec, level: LEVELS[sec.title] ?? 'details' })),
    roles: guide.roles!.map((r, i) => ({ ...r, icon: i === 0 ? '🏠' : '🕶️' })),
    steps: stepsFor(guide.quickStart!),
    reference: [
      {
        title: 'Scoring',
        head: ['What happened', 'Spy', 'Locals'],
        rows: [
          ['The spy escapes the vote', '2', '0'],
          ['Caught, names the location', '2', '0'],
          ['Caught, guesses wrong', '0', '1 each, +1 for voting for them'],
        ],
        note: 'With two spies, each spy is scored on their own.',
      },
    ],
  };
}

function text(pack: string): GameGuide {
  return {
    tagline: 'Everyone knows where you are, except the spy. Talk, bluff, then vote the spy out.',
    players: '3 to 12',
    duration: '5 minutes a round',
    goal: 'If you know the location, find the spy without giving the place away. If you’re the spy, blend in, escape the vote, or name the location if you’re caught.',
    quickStart: [
      'Everyone gets a card: the locals see the same location, the spy sees only “You’re the spy”.',
      'The app names who asks first. Ask anyone a question about the location, out loud.',
      'They answer, then ask someone else. Keep answers vague enough that the spy can’t guess.',
      'When the clock runs out or everyone is Ready to vote, vote in secret for the spy.',
      'A caught spy gets one guess at the location: right, and the spy steals the round.',
      'Points go to the spy or the locals each round; the most points after the last round wins.',
    ],
    setup: [
      'Everyone sits round a table or gets on a call: the questions are asked out loud.',
      `The host picks the round length (4, 5 or 6 minutes), the number of rounds (as many as there are players by default) and, with 7 or more players, whether to play with two spies. ${pack}`,
      'Each round, everyone gets a card. The locals all see the same location. The spy sees “You’re the spy” and nothing else.',
    ],
    roles: [
      {
        name: 'Locals',
        summary:
          'You know the location. Ask and answer so the others can tell you know it, but stay vague enough that the spy can’t work it out.',
      },
      {
        name: 'The spy',
        summary:
          'You don’t know the location. Listen, bluff and blend in. You can’t guess during the talk: only if the vote catches you do you get one guess at the location, to steal the round. Escape the vote and you score anyway.',
      },
    ],
    sections: [
      {
        title: 'Asking questions',
        bullets: [
          'For the first minute the app names who starts. They ask anyone a question about the location, out loud. Everyone starts one round before anyone starts a second, even as people come and go.',
          'That player answers, then asks someone else, but not the person who just asked them.',
          'The app doesn’t track the asking: just talk. Use the Ideas tab for questions to ask, and the Locations tab to cross places off.',
          'Nobody can accuse or guess during the round: the talking is the whole round.',
        ],
      },
      {
        title: 'The vote',
        bullets: [
          'When the clock runs out, or once everyone has tapped “Done talking? Ready to vote”, there is one secret vote. Tap it again to take it back.',
          'Everyone votes for who they think the spy is, the spy too. The spy’s vote counts like any other, so a spy can vote to force a tie at the top and escape. Only how many have voted shows until the vote is complete; then everyone’s votes are shown together.',
          'The vote lasts at most 45 seconds. Anyone who hasn’t voted by then abstains, and only the votes cast count: if few vote, one vote can decide it.',
          'The spy is caught only if they alone have the most votes. A tie at the top, or anyone else on top, and the spy escapes. The result shows each player’s vote count.',
          'With two spies, the top two are named. A tie for first between two players names both; a tie for second names only the leader; a three-way tie at the top names nobody. Each named spy is caught. The result says who the vote named, and, while a caught spy guesses, whether the other spy is still hidden.',
        ],
      },
      {
        title: 'The spy’s last chance',
        bullets: [
          'A caught spy, and only a caught spy, then picks the location from the board. They have 30 seconds; no pick counts as wrong.',
          'Right: the spy steals the round. Wrong: the locals win it.',
          'If a caught spy leaves before guessing, it counts as a wrong guess.',
        ],
      },
      {
        title: 'Scoring',
        bullets: [
          'The spy escapes the vote: the spy scores 2.',
          'The spy is caught, then names the location: the spy scores 2, and nobody else scores for that spy, not even the locals who voted for them.',
          'The spy is caught and guesses wrong: every local scores 1, and locals who voted for that spy score 1 more.',
          'With two spies, each spy is scored on their own: one can escape or steal while the locals still score for catching the other.',
          'A location that has been played won’t come up again in the same game until every place has been played. The board marks played places.',
          'After the last round, the most points wins.',
        ],
      },
      {
        title: 'Coming and going',
        bullets: [
          'If a spy leaves before the vote is over, the round is void and dealt again. Once the vote is over, the round finishes: a caught spy who leaves counts as a wrong guess.',
          'If anyone else leaves, the round carries on without them (votes for them are dropped).',
          'Players who join during a game watch until the next round. When all 12 seats are taken, newcomers watch and take a seat as soon as one frees up.',
          'With two spies on, a round with fewer than 7 players gets one spy; the round says so.',
          'With fewer than 3 players, the game goes back to the lobby.',
        ],
      },
    ],
    tips: [
      'Good answers stay vague: true for this place, but true for a few others too.',
      'Locals: an answer that’s too exact hands the spy the location. Too vague, and you look like the spy.',
      'Spy: answer with feelings and opinions, and listen for answers that agree.',
      'Keep a shortlist on the Locations board (tap a place to cross it off, ☆ to star it), so a caught spy can guess fast. With two editions in play, the board shows each one as its own list.',
      'Tap your card to cover it, so your neighbours can’t peek.',
    ],
    glossary: [
      { term: 'Local', meaning: 'Anyone who knows the location this round.' },
      { term: 'Spy', meaning: 'The player who doesn’t know the location.' },
      { term: 'Named', meaning: 'Voted out by the table: the top vote-getter (or top two).' },
      { term: 'Steal', meaning: 'A caught spy naming the location: the round is theirs.' },
    ],
  };
}

export const guide: GameGuide = makeGuide(
  'The pack has 30 places, from a swimming pool to a wild-west saloon.',
);
