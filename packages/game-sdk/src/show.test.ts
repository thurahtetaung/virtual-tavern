import { describe, expect, it } from 'vitest';
import {
  CONFETTI_MS,
  type Frame,
  type Moment,
  type Profile,
  type Rig,
  STALE_MS,
  type ScheduleCtx,
  type Scheduled,
  countAt,
  momentEnd,
  playsOn,
  profileFor,
  schedule,
  trackEnd,
  trackKeyframes,
  trackOf,
  variantOf,
} from './show.ts';

// A made-up rig: a "box" part that grows and fades out, and a "box" pop.
const frame = (k: number, alpha = 1): Frame => [k, 0, 0, k, 10 * k, 0, alpha];
const tracks: Rig['tracks'] = {
  box: {
    Grow: { ms: 400, frames: [frame(1), frame(1.5), frame(2, 0.5)] },
    Pop: { ms: 100, frames: [frame(1)] },
  },
};

const AT = 10_000;
const ctx = (over: Partial<ScheduleCtx> = {}): ScheduleCtx => ({
  profile: 'phone-full',
  you: 'ana',
  reduced: false,
  low: false,
  tracks,
  ...over,
});
const at = (moment: Moment, elapsed: number, over: Partial<ScheduleCtx> = {}) =>
  schedule(moment, AT + elapsed, ctx(over));
const kinds = (list: Scheduled[]) => list.map((s) => s.step.kind);

const sold: Moment = {
  id: 'sold:lot-1',
  at: AT,
  steps: [
    { t: 0, kind: 'text', target: 'word', text: 'SOLD!' },
    { t: 0, kind: 'anim', target: 'stamp', track: 'box.Grow' },
    { t: 0, kind: 'sfx', clip: 'sold', ms: 900 },
    { t: 1000, kind: 'set', target: 'slab', attr: 'data-tone', value: 'good' },
    { t: 1000, kind: 'count', target: 'word', from: 1200, to: 2000, ms: 600, format: 'money' },
    { t: 2000, kind: 'haptic', pattern: [20] },
    { t: 2000, kind: 'flash', colour: 'success' },
    {
      t: 2500,
      kind: 'css',
      target: 'profit',
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      ms: 300,
    },
  ],
};

describe('tracks', () => {
  it('finds a track by part and label, or null', () => {
    expect(trackOf(tracks, 'box.Grow')?.ms).toBe(400);
    expect(trackOf(tracks, 'box.Nope')).toBeNull();
    expect(trackOf(tracks, 'nope.Grow')).toBeNull();
    expect(trackOf(tracks, 'box')).toBeNull();
  });

  it('turns a track into evenly spaced keyframes with matrices and opacity', () => {
    const kf = trackKeyframes(tracks.box!.Grow!);
    expect(kf.map((k) => k.offset)).toEqual([0, 0.5, 1]);
    expect(kf[1]).toEqual({ transform: 'matrix(1.5,0,0,1.5,15,0)', opacity: 1, offset: 0.5 });
    expect(trackKeyframes(tracks.box!.Pop!)[0]!.offset).toBe(0);
    expect(trackEnd(tracks.box!.Grow!)).toEqual({
      transform: 'matrix(2,0,0,2,20,0)',
      opacity: 0.5,
    });
  });
});

describe('momentEnd', () => {
  it('is when the last step finishes', () => {
    expect(momentEnd(sold, tracks)).toBe(2800);
  });

  it('counts tracks, voice lines, confetti and sound lengths, and an empty moment ends at once', () => {
    const m = (steps: Moment['steps']): Moment => ({ id: 'x', at: AT, steps });
    expect(momentEnd(m([]), tracks)).toBe(0);
    expect(momentEnd(m([{ t: 100, kind: 'anim', target: 'a', track: 'box.Grow' }]), tracks)).toBe(
      500,
    );
    expect(momentEnd(m([{ t: 100, kind: 'anim', target: 'a', track: 'box.Gone' }]), tracks)).toBe(
      100,
    );
    const clips = [
      { clip: 'a', ms: 700 },
      { clip: 'b', ms: 300 },
    ];
    expect(momentEnd(m([{ t: 50, kind: 'voice', clips }]), tracks)).toBe(1050);
    expect(momentEnd(m([{ t: 0, kind: 'confetti', n: 40 }]), tracks)).toBe(CONFETTI_MS);
    expect(momentEnd(m([{ t: 0, kind: 'sfx', clip: 'x' }]), tracks)).toBe(0);
    expect(momentEnd(m([{ t: 10, kind: 'subtitle', text: 'hi', ms: 2000 }]), tracks)).toBe(2010);
  });
});

describe('schedule on time', () => {
  it('plays every step, in start order, each after its own delay', () => {
    const list = at(sold, 0);
    expect(list.map((s) => s.delay)).toEqual([0, 0, 0, 1000, 1000, 2000, 2000, 2500]);
    expect(list.every((s) => s.offset === 0)).toBe(true);
    expect(list.find((s) => s.step.kind === 'anim')).toMatchObject({ mode: 'play', ms: 400 });
    expect(list.find((s) => s.step.kind === 'set')).toMatchObject({ mode: 'end', ms: 0 });
  });

  it('waits for a moment that starts in the future', () => {
    const list = at(sold, -250);
    expect(list[0]!.delay).toBe(250);
    expect(list.at(-1)!.delay).toBe(2750);
  });

  it('keeps the moment order for steps at the same time, whatever order they were written in', () => {
    const m: Moment = {
      id: 'x',
      at: AT,
      steps: [
        { t: 500, kind: 'text', target: 'a', text: 'second' },
        { t: 0, kind: 'text', target: 'a', text: 'zero' },
        { t: 500, kind: 'text', target: 'a', text: 'third' },
      ],
    };
    expect(at(m, 0).map((s) => (s.step.kind === 'text' ? s.step.text : ''))).toEqual([
      'zero',
      'second',
      'third',
    ]);
    // Late, they all apply at once, still in that order: the last one written wins.
    expect(at(m, 900).map((s) => (s.step.kind === 'text' ? s.step.text : ''))).toEqual([
      'zero',
      'second',
      'third',
    ]);
  });
});

describe('schedule late (seeking)', () => {
  it('seeks an animation that is under way', () => {
    const anim = at(sold, 150).find((s) => s.step.kind === 'anim')!;
    expect(anim).toMatchObject({ mode: 'play', delay: 0, offset: 150, ms: 400 });
  });

  it('shows a finished animation, count-up or css motion at its end', () => {
    const list = at(sold, 5000);
    for (const kind of ['anim', 'count', 'css'] as const) {
      const s = list.find((x) => x.step.kind === kind)!;
      expect(s.mode, kind).toBe('end');
      expect(s.offset, kind).toBe(s.ms);
      expect(s.delay, kind).toBe(0);
    }
  });

  it('applies past state steps at once', () => {
    const list = at(sold, 1001);
    const set = list.find((s) => s.step.kind === 'set')!;
    expect(set).toMatchObject({ mode: 'end', delay: 0 });
    const count = list.find((s) => s.step.kind === 'count')!;
    expect(count).toMatchObject({ mode: 'play', offset: 1 });
  });

  it('starts a sound part-way inside STALE_MS and drops it beyond', () => {
    expect(at(sold, 600).find((s) => s.step.kind === 'sfx')).toMatchObject({
      mode: 'play',
      delay: 0,
      offset: 600,
    });
    expect(kinds(at(sold, 900))).not.toContain('sfx'); // over: it lasts 900 ms
    const noLength: Moment = { id: 'n', at: AT, steps: [{ t: 0, kind: 'sfx', clip: 'x' }] };
    expect(kinds(at(noLength, STALE_MS))).toEqual(['sfx']);
    expect(kinds(at(noLength, STALE_MS + 1))).toEqual([]);
  });

  it('fires haptics and flashes a little late, never stale ones', () => {
    expect(kinds(at(sold, 2000 + STALE_MS - 400))).toContain('haptic');
    const late = at(sold, 2000 + STALE_MS + 1);
    expect(kinds(late)).not.toContain('haptic');
    expect(kinds(late)).not.toContain('flash');
    // A flash still inside its own length plays its rest; one that has finished doesn't.
    expect(at(sold, 2100).find((s) => s.step.kind === 'flash')).toMatchObject({ offset: 100 });
    expect(kinds(at(sold, 2400))).not.toContain('flash');
  });

  it('plays the rest of a voice line clip by clip, from where it is', () => {
    const m: Moment = {
      id: 'v',
      at: AT,
      steps: [
        {
          t: 0,
          kind: 'voice',
          clips: [
            { clip: 'a', ms: 1000 },
            { clip: 'b', ms: 2500 },
            { clip: 'c', ms: 500 },
          ],
        },
      ],
    };
    expect(at(m, 0).map((s) => [s.clip?.clip, s.delay, s.offset])).toEqual([
      ['a', 0, 0],
      ['b', 1000, 0],
      ['c', 3500, 0],
    ]);
    // 1.2 s in: "a" is over, "b" is 200 ms in, "c" still to come.
    expect(at(m, 1200).map((s) => [s.clip?.clip, s.delay, s.offset])).toEqual([
      ['b', 0, 200],
      ['c', 2300, 0],
    ]);
    // 3 s in: "b" is 2 s late (stale) though not over; "c" still plays.
    expect(at(m, 3000).map((s) => s.clip?.clip)).toEqual(['c']);
    expect(at(m, 4000)).toEqual([]);
  });

  it('drops a timed subtitle once said and keeps an open one', () => {
    const m: Moment = {
      id: 's',
      at: AT,
      steps: [
        { t: 0, kind: 'subtitle', text: 'Going once', ms: 1000 },
        { t: 1000, kind: 'subtitle', text: 'Sold!' },
      ],
    };
    expect(at(m, 500).map((s) => s.step.kind === 'subtitle' && s.step.text)).toEqual([
      'Going once',
      'Sold!',
    ]);
    expect(at(m, 9000).map((s) => s.step.kind === 'subtitle' && s.step.text)).toEqual(['Sold!']);
  });

  it('plays the rest of a shake or confetti burst and nothing once it is over', () => {
    const m: Moment = {
      id: 'c',
      at: AT,
      steps: [
        { t: 0, kind: 'shake', target: 'scene', ms: 300, px: 8 },
        { t: 0, kind: 'confetti', n: 50 },
      ],
    };
    const ctxStage = { profile: 'stage' as Profile, you: null };
    expect(at(m, 200, ctxStage).map((s) => [s.step.kind, s.offset])).toEqual([
      ['shake', 200],
      ['confetti', 200],
    ]);
    expect(kinds(at(m, 400, ctxStage))).toEqual(['confetti']);
    expect(at(m, CONFETTI_MS, ctxStage)).toEqual([]);
  });

  it('shows everything at its end for a device that arrives after the moment', () => {
    const list = at(sold, momentEnd(sold, tracks) + 10_000);
    expect(kinds(list)).toEqual(['text', 'anim', 'set', 'count', 'css']);
    expect(list.every((s) => s.mode === 'end' && s.delay === 0)).toBe(true);
  });
});

describe('who plays what', () => {
  const m: Moment = {
    id: 'who',
    at: AT,
    steps: [
      { t: 0, kind: 'text', target: 'all', text: 'everyone' },
      { t: 0, kind: 'sfx', clip: 'yelp', on: ['stage', 'phone-full'] },
      { t: 0, kind: 'haptic', pattern: [30], for: 'you', on: ['phone-quiet', 'phone-full'] },
      { t: 0, kind: 'flash', colour: 'danger', for: 'ben' },
      { t: 0, kind: 'confetti', n: 40, on: ['stage'] },
    ],
  };

  it('plays the table sounds and confetti on the stage, never personal cues', () => {
    expect(kinds(at(m, 0, { profile: 'stage', you: null }))).toEqual(['text', 'sfx', 'confetti']);
  });

  it('keeps a quiet phone to its own cues', () => {
    expect(kinds(at(m, 0, { profile: 'phone-quiet', you: 'ana' }))).toEqual(['text', 'haptic']);
    expect(kinds(at(m, 0, { profile: 'phone-quiet', you: 'ben' }))).toEqual([
      'text',
      'haptic',
      'flash',
    ]);
  });

  it('gives a phone without a table screen the table sounds too', () => {
    expect(kinds(at(m, 0, { profile: 'phone-full', you: 'ana' }))).toEqual([
      'text',
      'sfx',
      'haptic',
    ]);
  });

  it('gives a watcher without a seat only what is for everyone', () => {
    expect(kinds(at(m, 0, { profile: 'phone-full', you: null }))).toEqual(['text', 'sfx']);
  });

  it('reads `on` and `for` the same way alone', () => {
    const step = m.steps[3]!;
    expect(playsOn(step, { profile: 'stage', you: 'ben' })).toBe(true);
    expect(playsOn(step, { profile: 'stage', you: null })).toBe(false);
  });
});

describe('reduced motion and low effects', () => {
  const m: Moment = {
    id: 'fx',
    at: AT,
    steps: [
      { t: 0, kind: 'anim', target: 'stamp', track: 'box.Grow' },
      { t: 0, kind: 'css', target: 'pop', keyframes: [{ opacity: 0 }, { opacity: 1 }], ms: 200 },
      { t: 0, kind: 'count', target: 'n', from: 0, to: 10, ms: 500 },
      { t: 0, kind: 'set', target: 'stamp', attr: 'data-face', value: 'value' },
      { t: 0, kind: 'sfx', clip: 'sold' },
      { t: 0, kind: 'voice', clips: [{ clip: 'v', ms: 800 }] },
      { t: 0, kind: 'haptic', pattern: [20] },
      { t: 0, kind: 'flash', colour: 'accent' },
      { t: 0, kind: 'shake', target: 'scene', ms: 300, px: 6 },
      { t: 0, kind: 'confetti', n: 30 },
      { t: 0, kind: 'sprite', target: 'sand', sheet: 'sand@15', ms: 900 },
      { t: 0, kind: 'subtitle', text: 'Sold!' },
    ],
  };
  const byKind = (list: Scheduled[]) => new Map(list.map((s) => [s.step.kind, s]));

  it('reduced motion keeps every state change and sound but no movement', () => {
    const list = byKind(at(m, 0, { reduced: true, profile: 'stage', you: null }));
    expect([...list.keys()]).toEqual([
      'anim',
      'css',
      'count',
      'set',
      'sfx',
      'voice',
      'haptic',
      'sprite',
      'subtitle',
    ]);
    for (const k of ['anim', 'css', 'count', 'sprite'] as const) {
      expect(list.get(k)!.mode, k).toBe('end');
    }
    expect(list.get('sfx')!.mode).toBe('play');
  });

  it('reduced motion still waits for a future animation to reach its end state', () => {
    const later = { ...m, at: AT + 300 };
    const anim = schedule(later, AT, ctx({ reduced: true })).find((s) => s.step.kind === 'anim');
    expect(anim).toMatchObject({ mode: 'end', delay: 300 });
  });

  it('low effects drops flashes, shakes, confetti and sprites, and settles count-ups', () => {
    const list = byKind(at(m, 0, { low: true, profile: 'stage', you: null }));
    expect([...list.keys()]).toEqual([
      'anim',
      'css',
      'count',
      'set',
      'sfx',
      'voice',
      'haptic',
      'subtitle',
    ]);
    expect(list.get('anim')!.mode).toBe('play'); // the stage keeps its vector motion
    expect(list.get('count')!.mode).toBe('end');
  });

  it('low effects on a phone also stills the vector art', () => {
    const list = byKind(at(m, 0, { low: true, profile: 'phone-quiet', you: 'ana' }));
    expect(list.get('anim')!.mode).toBe('end');
    expect(list.get('css')!.mode).toBe('play');
  });
});

describe('helpers', () => {
  it('picks the same variant for the same key on every device, spread over all of them', () => {
    expect(variantOf(42, 4)).toBe(variantOf('42', 4));
    const seen = new Set(Array.from({ length: 200 }, (_, i) => variantOf(i, 4)));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    expect(variantOf('x', 0)).toBe(0);
  });

  it('counts up with an ease-out, clamped to its ends', () => {
    expect(countAt(100, 200, 0)).toBe(100);
    expect(countAt(100, 200, 1)).toBe(200);
    expect(countAt(100, 200, 2)).toBe(200);
    expect(countAt(100, 200, -1)).toBe(100);
    expect(countAt(0, 100, 0.5)).toBeGreaterThan(50);
  });

  it('makes phones quiet only while a table screen is paired', () => {
    expect(profileFor(undefined)).toBe('phone-full');
    expect(profileFor({ present: false })).toBe('phone-full');
    expect(profileFor({ present: true })).toBe('phone-quiet');
    expect(profileFor({ present: true }, true)).toBe('stage');
  });
});
