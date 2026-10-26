import { afterEach, describe, expect, it, vi } from 'vitest';
import { lowOf } from './profile.ts';

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
});
