import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAME_SAMPLES, SAMPLE_AFTER_MS, SLOW_SAMPLES, judgeFrames, lowOf } from './profile.ts';

describe('show settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('plays low effects when switched on, or on auto when the device asked for it', () => {
    expect(lowOf({ setting: 'on', auto: false })).toBe(true);
    expect(lowOf({ setting: 'off', auto: true })).toBe(false);
    expect(lowOf({ setting: 'auto', auto: true })).toBe(true);
    expect(lowOf({ setting: 'auto', auto: false })).toBe(false);
  });

  it('keeps the battery-saver switch per device, and auto clears it', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    const { setLowEffects } = await import('./profile.ts');
    setLowEffects('on');
    expect(store.get('vt.show.low')).toBe('on');
    setLowEffects('auto');
    expect(store.has('vt.show.low')).toBe(false);
  });

  it('survives storage that refuses (a private window)', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const { setLowEffects } = await import('./profile.ts');
    expect(() => setLowEffects('on')).not.toThrow();
  });

  it('turns the battery saver on only for jank that lasts over several moments', () => {
    const slow = { frames: 30, slow: 12 };
    const fine = { frames: 60, slow: 2 };
    // One bad second (a page loading, a big decode) decides nothing.
    expect(judgeFrames([slow])).toBe('undecided');
    expect(judgeFrames([slow, slow])).toBe('undecided');
    expect(SLOW_SAMPLES).toBeGreaterThan(1);
    expect(judgeFrames(Array.from({ length: SLOW_SAMPLES }, () => slow))).toBe('slow');
    expect(judgeFrames([slow, fine, slow, slow])).toBe('slow');
    // Enough smooth seconds that it can't be slow any more: decided, and left alone.
    expect(judgeFrames(Array.from({ length: FRAME_SAMPLES - SLOW_SAMPLES + 1 }, () => fine))).toBe(
      'fine',
    );
    // A second with hardly a frame (a hidden or frozen page) counts for neither.
    expect(judgeFrames([slow, slow, { frames: 3, slow: 3 }])).toBe('undecided');
  });

  it('samples nothing while the page is still loading', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('document', { hidden: false });
    let now = 2000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { sampleFrames } = await import('./profile.ts');
    sampleFrames();
    expect(frames).toHaveLength(0);
    now = SAMPLE_AFTER_MS + 1;
    sampleFrames();
    expect(frames).toHaveLength(1);
    vi.restoreAllMocks();
  });
});
