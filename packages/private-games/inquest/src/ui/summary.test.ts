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
    const parts = settingsSummary(base, roleName);
    expect(parts).toEqual([
      'Accomplice',
      'Witness',
      'events',
      'final accusations',
      'random Forensic Scientist',
    ]);
    // The live check's summary, cut mid-word at 360 and 390 px: the roles and options now show.
    expect(fitted(parts, 360)).toBe('Accomplice · Witness · events · +2 more');
    expect(fitted(parts, 390)).toBe('Accomplice · Witness · events · final accusations · +1 more');
  });

  it('leads with a Forensic Scientist choice that asks something of the guests', () => {
    expect(settingsSummary({ ...base, fsMode: 'volunteers' }, roleName)[0]).toBe(
      'Volunteer Forensic Scientist',
    );
    expect(settingsSummary({ ...base, fsMode: 'host' }, roleName)[0]).toBe(
      'Host picks Forensic Scientist',
    );
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
    const parts = settingsSummary(busy, roleName);
    expect(parts).toHaveLength(11);
    for (const width of [360, 390]) {
      const text = fitted(parts, width);
      expect(summaryFits(text, 'Settings', width)).toBe(true);
      // The live check showed only the long Forensic Scientist part and Allies: now a role too.
      expect(text).toMatch(/^Volunteer Forensic Scientist · Allies · Accomplice · .*\+\d+ more$/);
    }
  });
});
