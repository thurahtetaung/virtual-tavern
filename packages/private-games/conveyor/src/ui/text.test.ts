import { describe, expect, it } from 'vitest';
import { PLAIN_NAMES } from '../logic/manifest.ts';
import type { ConveyorView, LogEntry, StepView } from '../logic/types.ts';
import { type NameOf, logLine, statusFor } from './text.ts';

// The viewer is "You" in every line about them: "Your …", "You are", "You win", never "You’s".

const ME = 'me';
const OTHER = 'ben';
const youName: NameOf = (id) => (id === ME ? 'You' : id === OTHER ? 'Ben' : 'Someone');

const WRONG = /You’s|You's|you’s|\bYou is\b|\bYou wins\b|\bYou has\b/;

type Kind = LogEntry['kind'];
type Body<K extends Kind> = Omit<Extract<LogEntry, { kind: K }>, 'id' | 'round' | 'turn' | 'auto'>;

/** One entry of every kind, each with `by` (and every other player in it) as given. */
function entries(by: string, other: string): LogEntry[] {
  const all: { [K in Kind]: Body<K>[] } = {
    round: [{ kind: 'round' }],
    reveal: [
      {
        kind: 'reveal',
        plays: [
          { by, k: 'nigiri-salmon' },
          { by: other, k: 'order', copy: 'tofu', bonus: 'spoon-4' },
        ],
      },
    ],
    wasabi: [{ kind: 'wasabi', by, k: 'nigiri-salmon' }],
    steal: [
      { kind: 'steal', by, from: other, k: 'tofu', worth: 6 },
      { kind: 'steal', by: other, from: by, k: 'tofu', worth: 6 },
    ],
    chop: [{ kind: 'chop', by, k: 'tempura' }],
    spoon: [
      { kind: 'spoon', by, from: other, k: 'tofu' },
      { kind: 'spoon', by, from: null, k: null },
    ],
    menu: [
      { kind: 'menu', by, k: 'tofu' },
      { kind: 'menu', by, k: null },
    ],
    copy: [
      { kind: 'copy', by, k: 'tofu' },
      { kind: 'copy', by, k: null },
    ],
    takeout: [
      { kind: 'takeout', by, ks: ['tofu', 'tempura'] },
      { kind: 'takeout', by, ks: [] },
    ],
    uramaki: [{ kind: 'uramaki', claims: [{ by, icons: 10, points: 8 }] }],
    miso: [{ kind: 'miso', by: [by, other] }],
    end: [{ kind: 'end', points: { [by]: 3 } }],
    left: [{ kind: 'left', player: by }],
    back: [{ kind: 'back', player: by }],
    over: [
      { kind: 'over', winners: [by] },
      { kind: 'over', winners: [by, other] },
    ],
  };
  return Object.values(all)
    .flat()
    .map((e, i) => ({ id: i, round: 1, turn: 1, ...e }));
}

const lines = (by: string, other: string) =>
  entries(by, other).flatMap((e) => {
    const l = logLine(e, youName, PLAIN_NAMES);
    return l ? [l] : [];
  });

describe('log lines about the viewer', () => {
  it('say "Your …", never "You’s", and agree with "You"', () => {
    const mine = lines(ME, OTHER);
    expect(mine.length).toBeGreaterThan(15);
    for (const l of mine) expect(l).not.toMatch(WRONG);
    expect(mine).toContain('Your Salmon nigiri lands on Wasabi: triple!');
    expect(mine.filter((l) => l.startsWith('Your '))).toHaveLength(7);
    expect(mine).toContain('You win.');
    expect(mine.some((l) => l.includes('Ben took a Tofu you needed (+6 for you).'))).toBe(true);
  });

  it('keep the name’s possessive for everyone else', () => {
    const theirs = lines(OTHER, ME);
    for (const l of theirs) expect(l).not.toMatch(/\bYou’s|\bYou is/);
    expect(theirs).toContain('Ben’s Salmon nigiri lands on Wasabi: triple!');
    expect(theirs).toContain('Ben wins.');
  });
});

describe('status lines about the viewer', () => {
  const view = (step: StepView) =>
    ({
      phase: 'playing',
      settings: {},
      log: [],
      game: {
        round: 1,
        rounds: 3,
        turn: 1,
        turns: 9,
        stage: 'resolve',
        step,
        players: [ME, OTHER].map((id) => ({ id, done: false })),
      },
    }) as unknown as ConveyorView;
  const steps = (me: string, other: string): StepView[] => [
    { kind: 'chop', players: [me], done: [me] },
    { kind: 'chop', players: [me, other], done: [me] },
    { kind: 'spoon', by: me, no: 4 },
    { kind: 'give', by: me, from: other, request: null, options: null },
    { kind: 'give', by: other, from: me, request: null, options: null },
    { kind: 'menu', by: me, no: 7, drawn: null, count: 4 },
    { kind: 'copy', by: me },
    { kind: 'takeout', by: me, no: 11 },
  ];

  it('never say "You’s" or "You is", from either side', () => {
    for (const [a, b] of [
      [ME, OTHER],
      [OTHER, ME],
    ] as const)
      for (const s of steps(a, b))
        expect(statusFor(view(s), ME, youName, PLAIN_NAMES).text).not.toMatch(WRONG);
    expect(
      statusFor(view({ kind: 'chop', players: [ME], done: [ME] }), ME, youName, PLAIN_NAMES).text,
    ).toMatch(/^You are using/);
    expect(
      statusFor(
        view({ kind: 'give', by: OTHER, from: ME, request: null, options: null }),
        ME,
        youName,
        PLAIN_NAMES,
      ).text,
    ).toMatch(/^Ben’s .* asks you/);
  });
});
