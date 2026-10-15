import { fitSummary, summaryFits, summaryText } from '@vt/ui';
import { describe, expect, it } from 'vitest';
import { roleName } from '../logic/names.ts';
import type { Settings } from '../logic/types.ts';
import { settingsSummary } from './summary.ts';

const fitted = (parts: string[], width: number) =>
  summaryText(
    parts,
    fitSummary(parts, (t) => summaryFits(t, 'Settings', width)),
  );

const base = {
  fsMode: 'random',
  accomplice: true,
  witness: true,
  events: true,
  finalAccusations: true,
} as Settings;

describe('the guests’ settings summary', () => {
  it('names the hidden roles and options first and the default random Forensic Scientist last', () => {
    const parts = settingsSummary(base, 'Random', roleName);
    expect(parts).toEqual([
      'Accomplice',
      'Witness',
      'events',
      'final accusations',
      'Forensic Scientist: random',
    ]);
    // The live check's summary, cut mid-word at 360 and 390 px: the roles and options now show.
    expect(fitted(parts, 360)).toBe('Accomplice · Witness · events · +2 more');
    expect(fitted(parts, 390)).toBe('Accomplice · Witness · events · final accusations · +1 more');
  });

  it('leads with a Forensic Scientist choice that asks something of the guests', () => {
    expect(
      settingsSummary({ ...base, fsMode: 'volunteers' }, 'Random volunteer', roleName)[0],
    ).toBe('Forensic Scientist: random volunteer');
  });

  it('fits two lines at 360 and 390 px with Allies and every option on', () => {
    const busy = {
      ...base,
      fsMode: 'host-volunteers',
      allies: true,
      labTech: true,
      insideMan: true,
      protective: true,
      unknownLocation: true,
      presentations: true,
    } as Settings;
    const parts = settingsSummary(busy, 'Host picks a volunteer', roleName);
    expect(parts).toHaveLength(11);
    for (const width of [360, 390]) {
      const text = fitted(parts, width);
      expect(summaryFits(text, 'Settings', width)).toBe(true);
      expect(text).toMatch(/^Forensic Scientist: host picks a volunteer · Allies · .*\+\d+ more$/);
    }
  });
});
