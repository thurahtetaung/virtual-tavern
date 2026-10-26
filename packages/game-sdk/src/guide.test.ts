import { describe, expect, it } from 'vitest';
import { isOn } from './guide.ts';

describe('isOn', () => {
  const on = { key: 'cities', label: 'Cities' };
  const off = { key: 'cities', label: 'Without Cities', off: true };

  it('shows everything without a room', () => {
    expect(isOn(on, undefined)).toBe(true);
    expect(isOn(off, undefined)).toBe(true);
    expect(isOn(undefined, { options: [] })).toBe(true);
  });

  it('greys an option’s section where it is off, and an `off` one where it is on', () => {
    expect(isOn(on, { options: ['cities'] })).toBe(true);
    expect(isOn(on, { options: [] })).toBe(false);
    expect(isOn(off, { options: ['cities'] })).toBe(false);
    expect(isOn(off, { options: ['strongholds'] })).toBe(true);
  });
});
