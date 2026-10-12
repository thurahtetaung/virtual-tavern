import { describe, expect, it } from 'vitest';
import {
  nameFigure,
  MAX_SPLIT_PARTS,
  cloudSize,
  figureModel,
  isTileFigure,
  matrixCell,
  settingLabel,
} from './figures.ts';
import { fixtureFor, fixtureGame, fixtureOverview } from './fixtures.ts';
import { ago, delta, duration, pointsDelta } from './format.ts';
import { sortPlayers } from './players.ts';

describe('figures by kind', () => {
  it('renders numbers as stat tiles', () => {
    const m = figureModel({
      id: 'n',
      label: 'Best run',
      kind: 'number',
      value: 1234,
      unit: 'cards',
    });
    expect(m).toEqual({ kind: 'stat', id: 'n', label: 'Best run', value: '1.2K', unit: 'cards' });
    expect(isTileFigure(m)).toBe(true);
  });

  it('renders percents (0–100) as meters, clamping to the meter', () => {
    expect(figureModel({ id: 'p', label: 'Red wins', kind: 'percent', value: 53.7 })).toEqual({
      kind: 'meter',
      id: 'p',
      label: 'Red wins',
      value: '54%',
      ratio: 0.537,
    });
    expect(figureModel({ id: 'p', label: 'x', kind: 'percent', value: 300 })).toMatchObject({
      ratio: 1,
    });
    expect(figureModel({ id: 'p', label: 'x', kind: 'percent', value: NaN })).toMatchObject({
      value: '0%',
    });
  });

  it('renders splits as shares in order, folding the tail into Other', () => {
    const m = figureModel({
      id: 's',
      label: 'Ends',
      kind: 'split',
      parts: [
        { label: 'A', value: 3 },
        { label: 'B', value: 1 },
        { label: 'Zero', value: 0 },
      ],
    });
    expect(m).toEqual({
      kind: 'split',
      id: 's',
      label: 'Ends',
      total: 4,
      parts: [
        { label: 'A', value: 3, share: 0.75, slot: 0 },
        { label: 'B', value: 1, share: 0.25, slot: 1 },
      ],
    });
    expect(isTileFigure(m)).toBe(false);

    const many = figureModel({
      id: 's',
      label: 'Many',
      kind: 'split',
      parts: Array.from({ length: 9 }, (_, i) => ({ label: `P${i}`, value: 10 - i })),
    });
    if (many.kind !== 'split') throw new Error('expected a split');
    expect(many.parts).toHaveLength(MAX_SPLIT_PARTS);
    expect(many.parts.at(-1)).toMatchObject({ label: 'Other', value: 5 + 4 + 3 + 2, slot: -1 });
    expect(many.parts[0]).toMatchObject({ label: 'P0', slot: 0 });
  });

  it('renders histograms as labelled columns', () => {
    expect(
      figureModel({
        id: 'h',
        label: 'Scores',
        kind: 'histogram',
        bins: [
          { label: '0–2', value: 1 },
          { label: '3–5', value: 4 },
        ],
      }),
    ).toEqual({
      kind: 'histogram',
      id: 'h',
      label: 'Scores',
      labels: ['0–2', '3–5'],
      values: [1, 4],
    });
  });

  it('names settings keys and sizes cloud words', () => {
    expect(settingLabel('wordList')).toBe('Word lists');
    expect(settingLabel('roundLimit')).toBe('Round limit');
    expect(settingLabel('hint_mode')).toBe('Hint mode');
    expect(cloudSize(10, 10)).toBe(30);
    expect(cloudSize(0, 10)).toBe(13);
    expect(cloudSize(1, 0)).toBe(13);
    expect(cloudSize(25, 100)).toBeLessThan(cloudSize(100, 100));
  });
});

describe('formatting', () => {
  it('describes deltas against the previous window', () => {
    expect(delta(12, 10)).toEqual({ direction: 'up', text: '+20%' });
    expect(delta(5, 10)).toEqual({ direction: 'down', text: '−50%' });
    expect(delta(3, 0)).toEqual({ direction: 'new', text: 'new' });
    expect(delta(0, 0)).toEqual({ direction: 'flat', text: '±0%' });
    expect(pointsDelta(0.82, 0.78)).toEqual({ direction: 'up', text: '+4 pts' });
  });

  it('formats durations and ages', () => {
    expect(duration(0.5)).toBe('30 s');
    expect(duration(23)).toBe('23 min');
    expect(duration(65)).toBe('1 h 05 min');
    expect(ago(1000, 1000)).toBe('just now');
    expect(ago(0, 3 * 60_000)).toBe('3 min ago');
    expect(ago(0, 3 * 86_400_000)).toBe('3 days ago');
  });

  it('sorts the leaderboard by a column, ties by name', () => {
    const p = (name: string, games: number, wins: number) => ({
      id: name,
      name,
      aliases: [name],
      firstSeen: 0,
      lastSeen: 0,
      games,
      wins,
      minutes: 0,
      byGame: {},
    });
    const rows = [p('Cy', 3, 1), p('Ana', 3, 2), p('Ben', 5, 0)];
    expect(sortPlayers(rows, 'games').map((r) => r.name)).toEqual(['Ben', 'Ana', 'Cy']);
    expect(sortPlayers(rows, 'wins').map((r) => r.name)).toEqual(['Ana', 'Cy', 'Ben']);
    expect(rows[0]!.name).toBe('Cy');
  });
});

describe('fixtures', () => {
  it('answers every page endpoint with a matching window', () => {
    const o = fixtureOverview(new URLSearchParams('range=7d&bucket=day'));
    expect(o.window).toMatchObject({ from: '2026-10-04', to: '2026-10-10', bucket: 'day' });
    expect(o.activity).toHaveLength(7);
    expect(o.calendar).toHaveLength(7);
    expect(o.weekHour).toHaveLength(7 * 24);
    expect(o.totals.gamesStarted).toBe(o.activity.reduce((s, p) => s + (p.values._all ?? 0), 0));
    expect(fixtureGame('echo', new URLSearchParams('range=today')).totals.gamesStarted).toBe(0);
    for (const path of [
      'live',
      'overview?range=1y&bucket=month',
      'games/echo',
      'players',
      'fun',
      'words?game=echo&kind=clue',
    ]) {
      expect(fixtureFor(`/api/admin/stats/${path}`)).toBeDefined();
    }
    expect(fixtureFor('/api/admin/stats/nope')).toBeUndefined();
  });
});

describe('matrix figures', () => {
  it('shade each column on its own scale and keep the raw values', () => {
    const m = figureModel({
      id: 'roles',
      label: 'Roles',
      kind: 'matrix',
      columns: ['Games', 'Won'],
      units: ['count', 'percent'],
      rows: [
        { label: 'Seer', values: [4, 50] },
        { label: 'Robber', values: [2, 100] },
      ],
    });
    expect(isTileFigure(m)).toBe(false);
    expect(m).toMatchObject({
      kind: 'matrix',
      rows: ['Seer', 'Robber'],
      values: [
        [4, 50],
        [2, 100],
      ],
      shades: [
        [1, 0.5],
        [0.5, 1],
      ],
    });
    expect(matrixCell(50, 'percent')).toBe('50%');
    expect(matrixCell(4, 'count')).toBe('4');
  });
});

describe('private placeholders in figure labels', () => {
  const fig = {
    id: 'top-means',
    label: 'Means used most',
    kind: 'split' as const,
    parts: [
      { label: '{card:means-4}', value: 3 },
      { label: 'Round 1', value: 1 },
    ],
  };

  it('names them through the game’s labeler', () => {
    const named = nameFigure(fig, (kind, id) =>
      kind === 'card' && id === 'means-4' ? 'Rope' : undefined,
    );
    expect(named).toMatchObject({ parts: [{ label: 'Rope' }, { label: 'Round 1' }] });
  });

  it('falls back to readable ids without one', () => {
    expect(nameFigure(fig, null)).toMatchObject({
      parts: [{ label: 'Means 4' }, { label: 'Round 1' }],
    });
  });
});
