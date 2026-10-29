import {
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  bool,
  mostBy,
  num,
  ph,
  str,
  strs,
} from '@vt/game-sdk';
import { TEAM_NAMES } from './types.ts';

/**
 * Tavern night recap awards for Cliffhanger, read from its `insights` events (`faceoff`, `got`,
 * `turn`, `steal3`, `genre`, `outcome`).
 */

const teamName = (t: string | undefined) => (t === 'a' || t === 'b' ? TEAM_NAMES[t] : 'Mystery');

const rules: AwardRule[] = [
  {
    id: 'cl.faceoff-king',
    emoji: '🥊',
    title: 'Face-off Champ',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'faceoff',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} won {n} face-offs. Nobody wants to go next',
        '{who} took {n} face-offs. Show-off',
      ],
      wholesome: ['{who} won {n} face-offs', '{who} never ran out of films: {n} face-offs won'],
    },
    compute: (g) => mostBy(g.of('faceoff'), undefined, { min: 2 }),
  },
  {
    id: 'cl.longest-rally',
    emoji: '🏓',
    title: 'Endless Rally',
    valence: 'glory',
    weight: 3,
    kind: 'moment',
    family: 'faceoff',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{n} answers in one face-off. Someone get a stopwatch',
        'A face-off of {n} answers. Epic',
      ],
      wholesome: [
        'One face-off went {n} answers deep',
        '{n} answers back and forth in one face-off',
      ],
    },
    compute: (g) => {
      const best = Math.max(0, ...g.of('faceoff').map((e) => num(e, 'answers') ?? 0));
      return best >= 8 ? [{ players: [], value: best }] : [];
    },
  },
  {
    id: 'cl.steal-king',
    emoji: '🦝',
    title: 'Light Fingers',
    wholesomeTitle: 'Bonus Round',
    valence: 'chaos',
    weight: 4,
    kind: 'award',
    family: 'steal',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} stole {n|time} from the other team. Cheeky',
        '{who} pinched {n} of their films',
      ],
      wholesome: [
        '{who} got {n} of the other team’s films too',
        '{who} had time to spare {n|time}',
      ],
    },
    compute: (g) =>
      mostBy(
        g.of('got').filter((e) => bool(e, 'steal') === true),
        undefined,
        { min: 1 },
      ),
  },
  {
    id: 'cl.clean-sweep',
    emoji: '🧹',
    title: 'Clean Sweep',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'describe',
    minPlayers: 4,
    copy: {
      cheeky: ['{who} got all three {n|time}. Too easy?', '{who} cleared the board {n|time}'],
      wholesome: ['{who} got all three in a turn {n|time}', '{who} cleared all three {n|time}'],
    },
    compute: (g) =>
      mostBy(
        g.of('turn').filter((e) => bool(e, 'clean') === true),
        undefined,
        { min: 1 },
      ),
  },
  {
    id: 'cl.quick-draw',
    emoji: '⚡',
    title: 'Quick Draw',
    valence: 'glory',
    weight: 3,
    kind: 'moment',
    family: 'describe',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} got one in {s} seconds. Did they peek?',
        '{who}: guessed in {s} seconds flat',
      ],
      wholesome: ['{who}’s team got one in {s} seconds', '{who} described one in just {s} seconds'],
    },
    compute: (g) => {
      // The first card of a turn, timed from the turn's start.
      const quick = g
        .of('got')
        .filter((e) => e.playerId && (num(e, 'ms') ?? Infinity) <= 4000)
        .sort((x, y) => num(x, 'ms')! - num(y, 'ms')!);
      const best = quick[0];
      if (!best) return [];
      const s = Math.max(1, Math.round(num(best, 'ms')! / 100) / 10);
      return [{ players: [best.playerId!], value: 10 - s, params: { s } }];
    },
  },
  {
    id: 'cl.trader',
    emoji: '🔁',
    title: 'Three for One',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'steal',
    minPlayers: 4,
    copy: {
      cheeky: [
        '{who} traded three for one {n|time}. Ruthless',
        '{who} swapped three for one {n|time}',
      ],
      wholesome: ['{who} made {n} clever trades', '{who} traded three for one {n|time}'],
    },
    compute: (g) => mostBy(g.of('steal3'), undefined, { min: 1 }),
  },
  {
    id: 'cl.comeback',
    emoji: '🎬',
    title: 'Comeback Kids',
    valence: 'glory',
    weight: 5,
    kind: 'team',
    family: 'outcome',
    minPlayers: 4,
    copy: {
      cheeky: [
        'Team {team} was {n} genres down and won. Plot twist',
        'Team {team}: {n} behind, then won',
      ],
      wholesome: [
        'Team {team} came back from {n} genres down',
        'Team {team} never gave up: {n} down, won',
      ],
    },
    compute: (g) => {
      const out = g.of('outcome').at(-1);
      if (!out || bool(out, 'comeback') !== true) return [];
      return [
        {
          players: strs(out, 'winners').length ? strs(out, 'winners') : g.winners,
          value: num(out, 'behind') ?? 2,
          params: { team: teamName(str(out, 'winner')) },
        },
      ];
    },
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'cl.rally-record',
    emoji: '🏓',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const best = Math.max(
        0,
        ...games.flatMap((g) => g.of('faceoff').map((e) => num(e, 'answers') ?? 0)),
      );
      return best >= 6 ? { value: best, text: `Longest face-off: ${best} answers` } : null;
    },
  },
  {
    id: 'cl.fastest-got',
    emoji: '⚡',
    interest: 2,
    record: 'min',
    compute: (games) => {
      const times = games.flatMap((g) => g.of('got').map((e) => num(e, 'ms') ?? Infinity));
      const best = Math.min(Infinity, ...times);
      if (!Number.isFinite(best) || best > 10000) return null;
      const s = Math.max(0.1, Math.round(best / 100) / 10);
      return { value: s, text: `Fastest guess: ${s} seconds into a turn` };
    },
  },
  {
    id: 'cl.titles-got',
    emoji: '🎞️',
    interest: 2,
    compute: (games) => {
      const n = games.reduce((sum, g) => sum + g.of('got').length, 0);
      return n >= 6 ? { value: n, text: `${n} titles guessed` } : null;
    },
  },
];

/** One line per round, in order. */
function history(g: GameEvents): string[] {
  return g.of('faceoff').map((e) => {
    const n = num(e, 'round') ?? 0;
    const answers = num(e, 'answers') ?? 0;
    const turns = g.of('turn').filter((t) => num(t, 'round') === n);
    const got = turns.map((t) => `${teamName(str(t, 'team'))} ${num(t, 'got') ?? 0}`).join(', ');
    const face = e.playerId
      ? `${ph.p(e.playerId)} won the face-off${answers ? ` (${answers} answers)` : ''}`
      : 'Face-off';
    return `Round ${n}: ${face}${got ? `; got ${got}` : ''}`;
  });
}

export const cliffhangerAwards: AwardModule = { rules, nuggets, history, stripSize: 3 };
