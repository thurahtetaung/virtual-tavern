import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXPLOSION_MS,
  INTERACTION_MS,
  SELECTION_GAP_MS,
  SELECTION_MS,
  hapticOf,
  hapticPattern,
  haptics,
} from './haptics.ts';

describe('hapticPattern', () => {
  it('gives every interaction the original 0.15 s at full strength', () => {
    for (const mod of [1, 0.6, 0.5, 0.25, 0.2])
      expect(hapticPattern('KeypadButton', mod)).toEqual([INTERACTION_MS]);
    expect(INTERACTION_MS).toBe(150);
  });

  it('scales the length below a fifth of the modifier, never under the floor', () => {
    expect(hapticPattern('Interaction', 0.1)).toEqual([75]);
    expect(hapticPattern('Interaction', 0.01)).toEqual([30]);
  });

  it('gives a release (−0.35) nothing, as the original clamps it to 0', () => {
    expect(hapticPattern('ButtonRelease', -0.35)).toEqual([]);
  });

  it('gives the explosion 0.7 s, strikes two pulses, the needy warning one', () => {
    expect(hapticPattern('Explosion')).toEqual([EXPLOSION_MS]);
    expect(EXPLOSION_MS).toBe(700);
    expect(hapticPattern('Strike')).toEqual([150, 90, 150]);
    expect(hapticPattern('NeedyWarning')).toEqual([150]);
  });

  it('gives a highlight change a light tick', () => {
    expect(hapticPattern('Selection')).toEqual([SELECTION_MS]);
    expect(SELECTION_MS).toBeGreaterThanOrEqual(20);
    expect(SELECTION_MS).toBeLessThan(INTERACTION_MS);
  });
});

describe('hapticOf', () => {
  it('names each part as the original does', () => {
    expect(hapticOf('snip', { op: 'cut' })).toBe('WireSnip');
    expect(hapticOf('tone', { op: 'press' })).toBe('SimonButton');
    expect(hapticOf('bb-press-in', { op: 'down' })).toBe('ButtonHold');
    expect(hapticOf('switch', { op: 'down' })).toBe('SpringedSwitch');
    expect(hapticOf('switch', { op: 'turn' })).toBe('ToggleSwitch');
    expect(hapticOf('press-in', { op: 'press' })).toBe('KeypadButton');
    expect(hapticOf('press-in', { op: 'submit' })).toBe('Interaction');
    expect(hapticOf('switch', { op: 'up' }, true)).toBe('ButtonRelease');
  });
});

describe('haptics', () => {
  let calls: (number | number[])[];
  let now = 1000;
  beforeEach(() => {
    calls = [];
    // Well clear of the last test's buzzes (the device's vibration is one for the page).
    now += 100_000;
    vi.stubGlobal('navigator', {
      vibrate: (p: number | number[]) => {
        calls.push(p);
        return true;
      },
    });
    vi.stubGlobal('performance', { now: () => now });
    haptics.enabled = true;
    haptics.log = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('vibrates and logs what the browser answered', () => {
    haptics.buzz('WireSnip', 1);
    expect(calls).toEqual([150]);
    expect(haptics.log.at(-1)).toMatchObject({ type: 'WireSnip', route: 'vibrate', ok: true });
  });

  it('stays still when switched off', () => {
    haptics.enabled = false;
    haptics.buzz('Explosion');
    expect(calls).toEqual([]);
    expect(haptics.log.at(-1)?.route).toBe('off');
  });

  it('throttles highlight ticks and never cuts into a buzz', () => {
    haptics.buzz('Selection');
    now += SELECTION_GAP_MS - 10;
    haptics.buzz('Selection');
    now += 20;
    haptics.buzz('Selection');
    expect(calls).toEqual([SELECTION_MS, SELECTION_MS]);
    haptics.buzz('KeypadButton');
    now += 100;
    haptics.buzz('Selection');
    expect(calls).toHaveLength(3);
    now += 150;
    haptics.buzz('Selection');
    expect(calls).toHaveLength(4);
  });

  it('does nothing where the browser has no vibration', () => {
    vi.stubGlobal('navigator', {});
    haptics.buzz('WireSnip');
    expect(haptics.log.at(-1)).toMatchObject({ route: 'none', ok: false });
  });

  it("plays a buzz refused before the first tap on that tap's lift, and logs the activation", () => {
    const page = new EventTarget();
    let active = false;
    vi.stubGlobal('window', page);
    vi.stubGlobal('navigator', {
      userActivation: {
        get hasBeenActive() {
          return active;
        },
      },
      vibrate: (p: number | number[]) => {
        calls.push(p);
        return active;
      },
    });
    haptics.buzz('KeypadButton');
    expect(haptics.log.at(-1)).toMatchObject({ ok: false, activated: false });
    // The lift is what activates the page; then the buzz goes again.
    active = true;
    page.dispatchEvent(new Event('pointerup'));
    expect(haptics.log.at(-1)).toMatchObject({ ok: true, activated: true, deferred: true });
    expect(calls).toEqual([150, 150]);
    // Once activated, nothing waits.
    haptics.buzz('WireSnip');
    page.dispatchEvent(new Event('pointerup'));
    expect(calls).toEqual([150, 150, 150]);
  });
});
