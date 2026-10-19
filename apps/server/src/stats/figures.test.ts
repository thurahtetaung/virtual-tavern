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

describe('Short Fuse figures', () => {
  it('count explosions, defuses, Nopes, card plays and hiding spots', () => {
    const m = new Map<string, number>();
    const events: [string, Record<string, unknown>][] = [
      [
        'outcome',
        { players: 4, turns: 30, preset: 'classic', x1: true, longestChain: 3, maxOwed: 4 },
      ],
      ['outcome', { players: 3, turns: 20, preset: 'party', longestChain: 1, maxOwed: 2 }],
      ['play', { cards: ['attack'], kind: 'card' }],
      ['play', { cards: ['cat1', 'cat1'], kind: 'pair' }],
      ['noped', { chain: 1, kind: 'card', card: 'attack' }],
      ['bomb', { kind: 'bomb', saved: 'defuse' }],
      ['bomb', { kind: 'bomb', saved: 'none' }],
      ['explode', { kind: 'bomb', turn: 9, left: 4 }],
      ['placement', { kind: 'bomb', position: 0, of: 20 }],
      ['placement', { kind: 'bomb', position: 19, of: 20 }],
      ['placement', { kind: 'void', position: 3, of: 20 }],
    ];
    for (const [type, props] of events)
      for (const [k, v] of figureCounters('short-fuse', type, props))
        m.set(k, k.startsWith('max.') ? Math.max(m.get(k) ?? 0, v) : (m.get(k) ?? 0) + v);
    const figs = buildFigures('short-fuse', (k) => m.get(k) ?? 0, m.keys());
    const by = (id: string) => figs.find((f) => f.id === id)!;
    expect(by('explosions')).toMatchObject({ kind: 'number', value: 0.5 });
    expect(by('defused')).toMatchObject({ kind: 'percent', value: 50 });
    expect(by('noped')).toMatchObject({ kind: 'percent', value: 50 });
    expect(by('chain')).toMatchObject({ value: 3 });
    expect(by('owed')).toMatchObject({ value: 4 });
    expect(by('decks')).toMatchObject({
      parts: [
        { label: 'Classic deck', value: 1 },
        { label: 'Adult deck', value: 0 },
        { label: 'Party deck', value: 1 },
        { label: 'Ghosts deck', value: 0 },
        { label: 'Chaos (everything)', value: 0 },
      ],
    });
    expect(by('cards')).toMatchObject({ parts: [{ label: '{card:attack}', value: 1 }] });
    expect(by('spots')).toMatchObject({
      bins: [
        { label: 'On top', value: 1 },
        { label: '2nd', value: 0 },
        { label: '3rd', value: 0 },
        { label: 'Further down', value: 0 },
        { label: 'At the bottom', value: 1 },
      ],
    });
  });

  it('count the fourth expansion: its decks, revivals and Second Lives as saves', () => {
    const m = new Map<string, number>();
    const events: [string, Record<string, unknown>][] = [
      ['outcome', { players: 4, turns: 30, preset: 'zombie', x4: true, revives: 2 }],
      ['outcome', { players: 5, turns: 40, preset: 'chaos', x1: true, x4: true, revives: 0 }],
      ['outcome', { players: 3, turns: 20, preset: 'classic' }],
      ['revive', { target: 'ana' }],
      ['revive', { target: 'ben' }],
      ['revive', { target: null }],
      ['bomb', { kind: 'bomb', saved: 'revive' }],
      ['bomb', { kind: 'bomb', saved: 'none' }],
      ['play', { cards: ['dig'], kind: 'card' }],
    ];
    for (const [type, props] of events)
      for (const [k, v] of figureCounters('short-fuse', type, props))
        m.set(k, k.startsWith('max.') ? Math.max(m.get(k) ?? 0, v) : (m.get(k) ?? 0) + v);
    const figs = buildFigures('short-fuse', (k) => m.get(k) ?? 0, m.keys());
    const by = (id: string) => figs.find((f) => f.id === id)!;
    expect(by('revives')).toMatchObject({ kind: 'number', value: 1 });
    expect(by('defused')).toMatchObject({ value: 50 });
    const decks = by('decks');
    expect(decks.kind === 'split' && decks.parts.slice(3)).toEqual([
      { label: 'Ghosts deck', value: 1 },
      { label: 'Chaos (everything)', value: 1 },
    ]);
    expect(by('cards')).toMatchObject({ parts: [{ label: '{card:dig}', value: 1 }] });
  });
});

describe('Starlight figures', () => {
  it('count shown cards, round scores, the Dark and flipped words', () => {
    const m = new Map<string, number>();
    const events: [string, Record<string, unknown>][] = [
      ['word', { round: 1, flipped: true, dark: 'ana' }],
      ['word', { round: 2, flipped: false, dark: null }],
      ['show', { kind: 'spark' }],
      ['show', { kind: 'super' }],
      ['show', { kind: 'fall' }],
      ['show', { kind: 'spark' }],
      ['round', { points: 9, dark: true, fell: true }],
      ['round', { points: 3, dark: false, fell: false }],
      ['outcome', { endReason: 'rounds' }],
    ];
    for (const [type, props] of events)
      for (const [k, v] of figureCounters('starlight', type, props))
        m.set(k, k.startsWith('max.') ? Math.max(m.get(k) ?? 0, v) : (m.get(k) ?? 0) + v);
    const figs = buildFigures('starlight', (k) => m.get(k) ?? 0, m.keys());
    const by = (id: string) => figs.find((f) => f.id === id)!;
    expect(by('shown')).toMatchObject({
      parts: [
        { label: 'Sparks', value: 2 },
        { label: 'Super-Sparks', value: 1 },
        { label: 'Falls', value: 1 },
      ],
    });
    expect(by('round-score')).toMatchObject({ value: 6 });
    expect(by('best-round')).toMatchObject({ value: 9 });
    expect(by('dark-rounds')).toMatchObject({ value: 50 });
    expect(by('dark-fell')).toMatchObject({ value: 100 });
    expect(by('flipped')).toMatchObject({ value: 50 });
  });
});
