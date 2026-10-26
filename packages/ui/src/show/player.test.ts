import type { Moment, Rig } from '@vt/game-sdk/show';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ShowEnv, play } from './player.ts';

// The player against stand-in elements: what it asks the browser to do, at which times.

interface FakeAnim {
  kf: Keyframe[];
  opts: KeyframeAnimationOptions;
  currentTime: number | null;
  playState: string;
  onfinish: (() => void) | null;
  cancel: () => void;
  finish: () => void;
  pause: () => void;
  commitStyles: () => void;
}

function fakeEl() {
  const anims: FakeAnim[] = [];
  const attrs: Record<string, string> = {};
  const el = {
    textContent: '' as string | null,
    style: {} as Record<string, string>,
    anims,
    attrs,
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
    animate(kf: Keyframe[], opts: KeyframeAnimationOptions) {
      const a: FakeAnim = {
        kf,
        opts,
        currentTime: null,
        playState: 'running',
        onfinish: null,
        cancel: () => {
          a.playState = 'idle';
        },
        finish: () => {
          a.playState = 'finished';
          a.onfinish?.();
        },
        pause: () => {
          a.playState = 'paused';
        },
        commitStyles: () => {
          const last = kf.at(-1) as { transform?: string };
          if (last.transform) el.style.transform = last.transform;
        },
      };
      anims.push(a);
      return a;
    },
  };
  return el;
}
type El = ReturnType<typeof fakeEl>;

const tracks: Rig['tracks'] = {
  box: {
    Grow: {
      ms: 400,
      frames: [
        [1, 0, 0, 1, 0, 0, 1],
        [2, 0, 0, 2, 5, 5, 0.5],
      ],
    },
  },
};

let now = 0;
let els: Record<string, El>;
let sounds: [string, number][];
const vibrate = vi.fn();

const env = (over: Partial<ShowEnv> = {}): ShowEnv => ({
  clock: () => now,
  profile: 'phone-full',
  you: 'ana',
  reduced: false,
  low: false,
  tracks,
  el: (t) => (els[t] as unknown as HTMLElement | undefined) ?? null,
  audio: { play: (clip, offset) => sounds.push([clip, offset]) },
  words: (t) => t.replace('{p:ana}', 'Ana'),
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  now = 100_000;
  els = { stamp: fakeEl(), word: fakeEl(), slab: fakeEl(), subtitle: fakeEl(), flash: fakeEl() };
  sounds = [];
  vibrate.mockClear();
  vi.stubGlobal('navigator', { vibrate });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sold = (at: number): Moment => ({
  id: 'sold',
  at,
  steps: [
    { t: 0, kind: 'text', target: 'word', text: 'SOLD to {p:ana}' },
    { t: 0, kind: 'anim', target: 'stamp', track: 'box.Grow' },
    { t: 0, kind: 'sfx', clip: 'sold' },
    { t: 500, kind: 'set', target: 'slab', attr: 'data-tone', value: 'good' },
    { t: 500, kind: 'count', target: 'word', from: 1000, to: 2000, ms: 300, format: 'money' },
    { t: 900, kind: 'haptic', pattern: [20] },
    { t: 900, kind: 'flash', colour: 'success' },
    { t: 1000, kind: 'subtitle', text: 'What a windfall', ms: 800 },
  ],
});

describe('play on time', () => {
  it('animates the track with WAAPI, fills placeholders and plays the sound at once', () => {
    play(sold(now), env());
    const a = els.stamp!.anims[0]!;
    expect(a.opts).toMatchObject({ duration: 400, delay: 0, fill: 'forwards', easing: 'linear' });
    expect(a.kf).toHaveLength(2);
    expect(a.kf[1]).toMatchObject({ transform: 'matrix(2,0,0,2,5,5)', opacity: 0.5, offset: 1 });
    expect(els.word!.textContent).toBe('SOLD to Ana');
    expect(sounds).toEqual([['sold', 0]]);
  });

  it('runs later steps on their timers, counting up to the final value', () => {
    play(sold(now), env());
    expect(els.slab!.attrs['data-tone']).toBeUndefined();
    now += 500;
    vi.advanceTimersByTime(500);
    expect(els.slab!.attrs['data-tone']).toBe('good');
    vi.advanceTimersByTime(400);
    expect(els.word!.textContent).toBe('$2,000');
    expect(vibrate).toHaveBeenCalledWith([20]);
    expect(els.flash!.attrs['data-colour']).toBe('success');
    vi.advanceTimersByTime(100);
    expect(els.subtitle!.textContent).toBe('What a windfall');
    vi.advanceTimersByTime(800);
    expect(els.subtitle!.textContent).toBe('');
  });

  it('leaves nothing running at rest: a finished animation commits its pose and is dropped', () => {
    play(sold(now), env());
    const a = els.stamp!.anims[0]!;
    a.finish();
    expect(a.playState).toBe('idle');
    expect(els.stamp!.style.transform).toBe('matrix(2,0,0,2,5,5)');
  });

  it('never buzzes the table screen', () => {
    play(sold(now - 900), env({ profile: 'stage', you: null }));
    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('play late', () => {
  it('seeks the animation and starts the sound part-way', () => {
    play(sold(now - 200), env());
    expect(els.stamp!.anims[0]!.currentTime).toBe(200);
    expect(sounds).toEqual([['sold', 200]]);
  });

  it('arriving after the end shows every end state and plays no sound, buzz or flash', () => {
    play(sold(now - 10_000), env());
    expect(els.stamp!.anims).toHaveLength(0);
    expect(els.stamp!.style).toEqual({ transform: 'matrix(2,0,0,2,5,5)', opacity: '0.5' });
    expect(els.slab!.attrs['data-tone']).toBe('good');
    expect(els.word!.textContent).toBe('$2,000');
    expect(sounds).toEqual([]);
    expect(vibrate).not.toHaveBeenCalled();
    expect(els.flash!.anims).toHaveLength(0);
  });

  it('drops a sound whose timer fires stale (a throttled tab)', () => {
    const m: Moment = { id: 's', at: now, steps: [{ t: 1000, kind: 'sfx', clip: 'late' }] };
    play(m, env());
    now += 5000; // the timer ran four seconds late
    vi.advanceTimersByTime(1000);
    expect(sounds).toEqual([]);
  });
});

describe('reduced motion and cancelling', () => {
  it('reduced motion places parts at their end, fading in one still to come', () => {
    play({ ...sold(now + 300) }, env({ reduced: true }));
    expect(els.stamp!.anims).toHaveLength(0);
    now += 300;
    vi.advanceTimersByTime(300);
    expect(els.stamp!.style.transform).toBe('matrix(2,0,0,2,5,5)');
    expect(els.stamp!.anims[0]!.opts).toMatchObject({ duration: 150 });
    expect(sounds).toEqual([['sold', 0]]);
  });

  it('cancel stops what is to come and drops the animations', () => {
    const p = play(sold(now), env());
    p.cancel();
    vi.advanceTimersByTime(5000);
    expect(els.stamp!.anims[0]!.playState).toBe('idle');
    expect(els.slab!.attrs['data-tone']).toBeUndefined();
  });

  it('pause and finish reach every animation (a hidden page and its return)', () => {
    const p = play(sold(now), env());
    p.pause();
    expect(els.stamp!.anims[0]!.playState).toBe('paused');
    p.finish();
    expect(els.stamp!.anims[0]!.playState).toBe('idle');
    expect(els.stamp!.style.transform).toBe('matrix(2,0,0,2,5,5)');
  });

  it('skips steps whose target is missing or whose track the rig lacks', () => {
    const m: Moment = {
      id: 'x',
      at: now,
      steps: [
        { t: 0, kind: 'anim', target: 'nobody', track: 'box.Grow' },
        { t: 0, kind: 'anim', target: 'stamp', track: 'box.Missing' },
      ],
    };
    expect(() => play(m, env())).not.toThrow();
    expect(els.stamp!.anims).toHaveLength(0);
  });
});

describe('voice', () => {
  it('plays each clip in turn and shows its words', () => {
    const m: Moment = {
      id: 'v',
      at: now - 300,
      steps: [
        {
          t: 0,
          kind: 'voice',
          clips: [
            { clip: 'a', ms: 1000, text: 'Going once' },
            { clip: 'b', ms: 500, text: 'Going twice' },
          ],
        },
      ],
    };
    play(m, env());
    expect(sounds).toEqual([['a', 300]]);
    expect(els.subtitle!.textContent).toBe('Going once');
    now += 700;
    vi.advanceTimersByTime(700);
    expect(sounds).toEqual([
      ['a', 300],
      ['b', 0],
    ]);
    expect(els.subtitle!.textContent).toBe('Going twice');
  });
});
