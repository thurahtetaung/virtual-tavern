import { describe, expect, it } from 'vitest';
import { buildFigures, figureCounters } from './figures.ts';

/** Sums the counters of a list of events the way the store does. */
function tally(events: [string, Record<string, unknown>][]) {
  const m = new Map<string, number>();
  for (const [type, props] of events)
    for (const [k, v] of figureCounters('inquest', type, props)) m.set(k, (m.get(k) ?? 0) + v);
  return buildFigures('inquest', (k) => m.get(k) ?? 0, m.keys());
}

describe('Inquest figures', () => {
  it('count the Allies roles’ sides and the Change of Heart switches', () => {
    const figs = tally([
      [
        'outcome',
        {
          winner: 'murderer',
          players: 9,
          allies: true,
          labTech: 'a',
          insideMan: 'b',
          protective: null,
          perfectCrimes: 1,
          fsSwitched: true,
        },
      ],
      [
        'outcome',
        {
          winner: 'investigators',
          players: 9,
          allies: true,
          labTech: 'a',
          insideMan: 'b',
          protective: 'c',
          perfectCrimes: 1,
          fsSwitched: false,
          solvedRound: 3,
          solvedFinal: true,
        },
      ],
      ['event', { kind: 'perfect-crime' }],
    ]);
    const by = Object.fromEntries(figs.map((f) => [f.id, f]));
    expect(by['allies-sides']).toMatchObject({
      kind: 'matrix',
      columns: ['Lab Technician', 'Inside Man', 'Protective Detail'],
      rows: [{ values: [50, 50, 100] }],
    });
    expect(by['perfect-crime-switch']).toMatchObject({ kind: 'percent', value: 50 });
    const parts = (id: string) => (by[id] as { parts: { label: string; value: number }[] }).parts;
    expect(parts('solves-by-round')).toContainEqual({ label: 'Final accusations', value: 1 });
    expect(parts('events')).toContainEqual({ label: 'Change of Heart', value: 1 });
  });

  it('show nothing about the Allies expansion until a game used it', () => {
    const figs = tally([['outcome', { winner: 'murderer', players: 5 }]]);
    expect(figs.map((f) => f.id)).not.toContain('allies-sides');
    const events = figs.find((f) => f.id === 'events')!;
    expect(JSON.stringify(events)).not.toContain('Change of Heart');
  });
});
