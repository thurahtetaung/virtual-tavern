import {
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  bool,
  leaders,
  num,
  str,
} from '@vt/game-sdk';

/** Tavern night recap awards for Defuse, from its `insights` events (`module`, `strike`, `expert`, `outcome`). */

const outcome = (g: GameEvents) => g.of('outcome').at(-1);
const defuserOf = (g: GameEvents) => outcome(g)?.playerId ?? null;
const defused = (g: GameEvents) => bool(outcome(g), 'defused') === true;
const left = (g: GameEvents) => num(outcome(g), 'left');

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const one = (who: string | null | undefined, value: number): AwardCandidate[] =>
  who ? [{ players: [who], value }] : [];

const rules: AwardRule[] = [
  {
    id: 'df.clutch',
    emoji: '⏱️',
    title: 'Calm Under One Second',
    valence: 'glory',
    weight: 5,
    kind: 'moment',
    family: 'clock',
    copy: {
      cheeky: [
        '{who} defused it with under a second left. Show-off',
        '{who} stopped the clock a blink from zero',
      ],
      wholesome: [
        '{who} defused it with under a second to spare',
        '{who} kept calm right to the last blink',
      ],
    },
    compute: (g) => {
      const l = left(g);
      return defused(g) && l !== undefined && l < 1000 ? one(defuserOf(g), l) : [];
    },
  },
  {
    id: 'df.cool-hand',
    emoji: '😎',
    title: 'Cool Hand',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'clock',
    copy: {
      cheeky: [
        '{who} defused it with seconds to spare. Nerves of steel',
        '{who} cut it fine and walked away',
      ],
      wholesome: [
        '{who} defused the bomb with seconds to spare',
        '{who} stayed calm as the clock ran down',
      ],
    },
    compute: (g) => {
      const l = left(g);
      return defused(g) && l !== undefined && l >= 1000 && l < 10_000 ? one(defuserOf(g), l) : [];
    },
  },
  {
    id: 'df.clean',
    emoji: '🧼',
    title: 'Clean Sweep',
    valence: 'glory',
    weight: 3,
    kind: 'team',
    family: 'result',
    copy: {
      cheeky: [
        '{who} defused a bomb without a single strike. Smug',
        '{who}: no strikes, no sweat, no fun',
      ],
      wholesome: [
        '{who} defused a bomb without a single strike',
        '{who} worked it out with no strikes at all',
      ],
    },
    compute: (g) =>
      defused(g) && num(outcome(g), 'strikes') === 0 && g.players.length
        ? [{ players: [...g.players].sort(), value: num(outcome(g), 'modules') ?? 0 }]
        : [],
  },
  {
    id: 'df.wrong-wire',
    emoji: '✂️',
    title: 'Snipped the Wrong One',
    wholesomeTitle: 'Brave Snipper',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'strike',
    copy: {
      cheeky: [
        '{who} cut the wrong wire {n|time}. Snip snip',
        '{who} and the wires: it is complicated',
      ],
      wholesome: ['{who} made a bold cut or two ({n})', '{who} was brave with the wire cutters'],
    },
    compute: (g) => {
      const n = g
        .of('strike')
        .filter((e) => /wires|wire-sequence/.test(str(e, 'kind') ?? '')).length;
      return n ? one(defuserOf(g), n) : [];
    },
  },
  {
    id: 'df.boom',
    emoji: '💥',
    title: 'Big Bang',
    wholesomeTitle: 'Brave Attempt',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'result',
    copy: {
      cheeky: ['{who} held the bomb when it went off', 'The bomb went off in the hands of {who}'],
      wholesome: [
        '{who} gave a tough bomb a brave try',
        '{who} took on the bomb and nearly had it',
      ],
    },
    compute: (g) =>
      defused(g) || !outcome(g) ? [] : one(defuserOf(g), num(outcome(g), 'solved') ?? 0),
  },
  {
    id: 'df.scholar',
    emoji: '📖',
    title: 'Manual Scholar',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'manual',
    copy: {
      cheeky: [
        '{who} claimed {n} manual pages. Bookworm',
        '{who} read {n} pages aloud and never blinked',
      ],
      wholesome: [
        '{who} covered {n} pages of the manual',
        '{who} read {n} manual pages for the team',
      ],
    },
    compute: (g) => {
      if (!defused(g)) return [];
      const tally = new Map<string, number>();
      for (const e of g.of('expert')) if (e.playerId) tally.set(e.playerId, num(e, 'pages') ?? 0);
      return leaders(tally, { min: 2 });
    },
  },
  {
    id: 'df.quick',
    emoji: '⚡',
    title: 'Quick Fingers',
    valence: 'glory',
    weight: 2,
    kind: 'award',
    family: 'speed',
    copy: {
      cheeky: [
        '{who} solved a module in {s} seconds. Slow down',
        '{who} was done with a module in {s} seconds',
      ],
      wholesome: [
        '{who} solved a module in just {s} seconds',
        '{who} cleared a module in {s} seconds flat',
      ],
    },
    compute: (g) => {
      const times = g
        .of('module')
        .flatMap((e) =>
          bool(e, 'solved') && num(e, 'seconds') !== undefined ? [num(e, 'seconds')!] : [],
        );
      const best = Math.min(...times);
      return Number.isFinite(best) && best < 10
        ? [{ players: [defuserOf(g)!].filter(Boolean), value: best, params: { s: best } }]
        : [];
    },
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'df.closest',
    emoji: '⏱️',
    interest: 3,
    record: 'min',
    compute: (games) => {
      const ls = games.flatMap((g) => (defused(g) && left(g) !== undefined ? [left(g)!] : []));
      if (!ls.length) return null;
      const v = Math.min(...ls);
      return { value: v, text: `Closest call: defused with ${(v / 1000).toFixed(2)} s left` };
    },
  },
  {
    id: 'df.defused',
    emoji: '💣',
    interest: 2,
    compute: (games) => {
      const n = games.filter(defused).length;
      return n >= 2 ? { value: n, text: `${n} bombs defused` } : null;
    },
  },
];

const HOW: Record<string, string> = { strikes: 'too many strikes', time: 'the clock ran out' };

function history(g: GameEvents): string[] {
  const o = outcome(g);
  const no = num(o, 'bomb');
  const l = left(g);
  if (no === undefined || l === undefined) return [];
  if (defused(g)) return [`Bomb ${no}: defused with ${clock(l)} left`];
  return [`Bomb ${no}: it went off (${HOW[str(o, 'how') ?? ''] ?? 'boom'})`];
}

export const defuseAwards: AwardModule = { rules, nuggets, history, stripSize: 2 };

/** For tests: a rule's candidates. */
export const candidatesOf = (id: string, g: GameEvents): AwardCandidate[] =>
  rules.find((r) => r.id === id)?.compute?.(g) ?? [];
