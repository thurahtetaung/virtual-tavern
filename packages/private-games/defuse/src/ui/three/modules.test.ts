import { describe, expect, it } from 'vitest';
import { sampled } from './modules.ts';

describe('sampled clips', () => {
  it('reads between samples and holds both ends', () => {
    const v = [0, 10, 20];
    expect(sampled(v, 0.5, 0.25)).toBe(5);
    expect(sampled(v, 0.5, -1)).toBe(0);
    expect(sampled(v, 0.5, 1)).toBe(20);
    // A clip that finished long ago (or never started: −∞ start) stays at its last sample.
    expect(sampled(v, 0.5, Infinity)).toBe(20);
  });
});
