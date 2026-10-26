import { describe, expect, it } from 'vitest';
import { type RevealAnswer, type RevealInput, revealMood, revealMoments } from './reveal-show.ts';
import { type Moment, type Rig, schedule } from './show.ts';

const answers: RevealAnswer[] = [
  {
    index: 0,
    text: 'a cat',
    truth: true,
    house: false,
    authors: [],
    voters: ['bo'],
    points: { bo: 1100 },
  },
  {
    index: 1,
    text: 'a dog',
    truth: false,
    house: false,
    authors: ['cy'],
    voters: ['ana', 'dee'],
    points: { cy: 1000 },
  },
  { index: 2, text: 'a cow', truth: false, house: true, authors: [], voters: ['eve'], points: {} },
  { index: 3, text: 'a pig', truth: false, house: false, authors: ['ana'], voters: [], points: {} },
];
const AT = 50_000;
const input = (over: Partial<RevealInput> = {}): RevealInput => ({
  key: 'r1-d1',
  at: AT,
  order: [2, 1, 0],
  answers,
  stepMs: 3000,
  flipMs: 1400,
  parts: {
    card: ['card-ramp', 'card-bubble'],
    chooser: ['chooser-playerName'],
    author: ['author-tf'],
  },
  ...over,
});
const tracks: Rig['tracks'] = {
  'card-ramp': { Appear: { ms: 367, frames: [[1, 0, 0, 1, 0, 0, 1]] } },
};
const at = (
  m: Moment,
  t: number,
  profile: 'stage' | 'phone-quiet' | 'phone-full',
  you: string | null,
) => schedule(m, m.at + t, { profile, you, reduced: false, low: false, tracks });

describe('revealMoments', () => {
  it('makes one moment per answer turned over, stepMs apart, with stable ids', () => {
    const ms = revealMoments(input());
    expect(ms.map((m) => [m.id, m.at])).toEqual([
      ['r1-d1:step0', AT],
      ['r1-d1:step1', AT + 3000],
      ['r1-d1:step2', AT + 6000],
    ]);
    expect(revealMoments(input())).toEqual(ms);
  });

  it('keeps every step inside its own step', () => {
    for (const m of revealMoments(input()))
      for (const s of m.steps)
        expect(s.t + ('ms' in s && s.kind === 'sfx' ? (s.ms ?? 0) : 0)).toBeLessThan(3000);
  });

  it('shakes to a drumroll cut just after the slide, then slams a name on per chooser before the flip (the original’s order)', () => {
    const lie = revealMoments(input())[1]!;
    const hits = lie.steps.filter((s) => s.kind === 'sfx' && s.clip === 'reveal.hit');
    expect(hits).toHaveLength(2);
    const roll = lie.steps.find((s) => s.kind === 'sfx' && s.clip === 'reveal.drumroll')!;
    const slide = lie.steps.find((s) => s.kind === 'sfx' && s.clip === 'reveal.slide')!;
    expect(roll.t).toBe(0);
    expect(roll.t + (roll.kind === 'sfx' ? roll.ms! : 0)).toBe(slide.t + 150);
    for (const h of hits) {
      expect(h.t).toBeGreaterThan(slide.t);
      expect(h.t).toBeLessThan(1400);
    }
    // The author's sting by their slot, the grunt after the flip.
    const withSlots = revealMoments(input({ slotOf: () => 3 }))[1]!;
    expect(withSlots.steps).toContainEqual(
      expect.objectContaining({ kind: 'sfx', clip: 'sting#3', t: 1800 }),
    );
    expect(lie.steps).toContainEqual(
      expect.objectContaining({ kind: 'sfx', clip: 'voice:reveal.no#1', t: 2100 }),
    );
  });

  it('flips a lie to its author with the points, a house answer to the decoy, the truth last', () => {
    const [house, lie, truth] = revealMoments(input());
    const face = (m: Moment) =>
      m.steps
        .filter((s) => s.kind === 'set' && s.attr === 'data-face')
        .map((s) => [s.t, s.kind === 'set' && s.value]);
    expect(face(house!)).toEqual([
      [0, 'up'],
      [1400, 'house'],
    ]);
    expect(face(lie!)).toEqual([
      [0, 'up'],
      [1400, 'lie'],
    ]);
    expect(face(truth!)).toEqual([
      [0, 'up'],
      [1400, 'truth'],
    ]);
    expect(lie!.steps).toContainEqual(
      expect.objectContaining({ kind: 'text', target: 'author.points', text: '+1,000' }),
    );
    expect(lie!.steps).toContainEqual(
      expect.objectContaining({ kind: 'text', target: 'author.name', text: '{p:cy}' }),
    );
    expect(house!.steps).toContainEqual(
      expect.objectContaining({ kind: 'anim', track: 'chooser-playerName.Decoy' }),
    );
    expect(truth!.steps).toContainEqual(
      expect.objectContaining({ kind: 'text', target: 'chip:0.points', text: '+1,100' }),
    );
    expect(truth!.steps).toContainEqual(
      expect.objectContaining({ kind: 'sfx', clip: 'reveal.mood.okay' }),
    );
  });

  it('gives each player their own cue, never on the table screen', () => {
    const lie = revealMoments(input())[1]!;
    const mine = (you: string) =>
      at(lie, 1400, 'phone-quiet', you)
        .filter((s) => s.step.for)
        .map((s) => s.step.kind);
    expect(mine('ana')).toEqual(expect.arrayContaining(['flash', 'haptic', 'text']));
    expect(mine('cy')).toEqual(expect.arrayContaining(['flash', 'haptic', 'sfx', 'text']));
    expect(mine('bo')).toEqual([]);
    expect(at(lie, 1400, 'stage', null).some((s) => s.step.for)).toBe(false);
  });

  it('leaves a quiet phone only its own list, cues and sounds (routed by the game): no card art', () => {
    const lie = revealMoments(input())[1]!;
    const quiet = at(lie, 0, 'phone-quiet', 'bo').map((s) => s.step);
    expect(quiet.some((s) => s.kind === 'anim')).toBe(false);
    expect(quiet.some((s) => s.kind === 'sfx' && s.clip === 'reveal.hit')).toBe(true);
    expect(quiet.some((s) => s.kind === 'css' && s.target === 'board:1')).toBe(true);
  });

  it('makes nothing to animate without the rig parts', () => {
    const ms = revealMoments(input({ parts: { card: [], chooser: [], author: [] } }));
    expect(ms.flatMap((m) => m.steps).some((s) => s.kind === 'anim')).toBe(false);
  });

  it('judges the mood of the truth', () => {
    expect(revealMood(0, 4)).toBe('bad');
    expect(revealMood(1, 4)).toBe('okay');
    expect(revealMood(2, 4)).toBe('great');
    // Three players: never great (the original's rule).
    expect(revealMood(2, 3)).toBe('okay');
  });
});
