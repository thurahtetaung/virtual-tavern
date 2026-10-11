import type { GameFigure } from '@vt/protocol';
import { compact, percent } from './format.ts';

// Games report their own figures (`GameStats.figures`); the page renders them by kind without
// knowing anything about the game. This is the pure half: what each kind turns into.

export type FigureModel =
  | { kind: 'stat'; id: string; label: string; value: string; unit?: string }
  | { kind: 'meter'; id: string; label: string; value: string; ratio: number }
  | {
      kind: 'split';
      id: string;
      label: string;
      total: number;
      parts: { label: string; value: number; share: number; slot: number }[];
    }
  | { kind: 'histogram'; id: string; label: string; labels: string[]; values: number[] }
  | {
      kind: 'matrix';
      id: string;
      label: string;
      columns: string[];
      rows: string[];
      /** Raw values, row by row. */
      values: number[][];
      /** Each cell's value as a share of its column's largest, for the shading. */
      shades: number[][];
      units: ('count' | 'percent')[];
    };

/** A matrix cell's text: a count, or a percent from the 0–100 contract. */
export const matrixCell = (value: number, unit: 'count' | 'percent') =>
  unit === 'percent' ? percent(value / 100) : compact(value);

/** Splits show at most this many parts; the rest fold into "Other" (never a generated colour). */
export const MAX_SPLIT_PARTS = 6;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function figureModel(fig: GameFigure): FigureModel {
  switch (fig.kind) {
    case 'number':
      return {
        kind: 'stat',
        id: fig.id,
        label: fig.label,
        value: compact(fig.value),
        unit: fig.unit,
      };
    case 'percent': {
      // The contract carries a percent, 0–100.
      const ratio = clamp01(fig.value / 100);
      return { kind: 'meter', id: fig.id, label: fig.label, value: percent(ratio), ratio };
    }
    case 'split': {
      let parts = fig.parts.filter((p) => p.value > 0);
      if (parts.length > MAX_SPLIT_PARTS) {
        const sorted = [...parts].sort((a, b) => b.value - a.value);
        const kept = sorted.slice(0, MAX_SPLIT_PARTS - 1);
        const other = sorted.slice(MAX_SPLIT_PARTS - 1).reduce((s, p) => s + p.value, 0);
        // Keep the reported order for the parts that stay.
        parts = [...fig.parts.filter((p) => kept.includes(p)), { label: 'Other', value: other }];
      }
      const total = parts.reduce((s, p) => s + p.value, 0);
      return {
        kind: 'split',
        id: fig.id,
        label: fig.label,
        total,
        parts: parts.map((p, i) => ({
          label: p.label,
          value: p.value,
          share: total ? p.value / total : 0,
          // "Other" takes the neutral colour, signalled with -1.
          slot:
            p.label === 'Other' && i === parts.length - 1 && fig.parts.length > MAX_SPLIT_PARTS
              ? -1
              : i,
        })),
      };
    }
    case 'histogram':
      return {
        kind: 'histogram',
        id: fig.id,
        label: fig.label,
        labels: fig.bins.map((b) => b.label),
        values: fig.bins.map((b) => b.value),
      };
    case 'matrix': {
      const values = fig.rows.map((r) => fig.columns.map((_, c) => r.values[c] ?? 0));
      const tops = fig.columns.map((_, c) => Math.max(0, ...values.map((r) => r[c]!)));
      return {
        kind: 'matrix',
        id: fig.id,
        label: fig.label,
        columns: fig.columns,
        rows: fig.rows.map((r) => r.label),
        values,
        shades: values.map((r) => r.map((v, c) => (tops[c]! > 0 ? clamp01(v / tops[c]!) : 0))),
        units: fig.columns.map((_, c) => fig.units[c] ?? 'count'),
      };
    }
  }
}

/** Single-value figures go in the tile row; charts get their own cards. */
export const isTileFigure = (m: FigureModel) => m.kind === 'stat' || m.kind === 'meter';

const SETTING_LABELS: Record<string, string> = {
  wordList: 'Word lists',
  timerMode: 'Timer',
  deckSize: 'Deck size',
  flow: 'Flow',
  cardSet: 'Card sets',
  questionDeck: 'Question decks',
  rounds: 'Rounds',
};

/** A settings key as a heading: known keys get a friendly name, others are split from camelCase. */
export function settingLabel(key: string): string {
  const known = SETTING_LABELS[key];
  if (known) return known;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Font size (px) for a word in the cloud: square-root scaled so one runaway word can't swamp the rest. */
export function cloudSize(count: number, max: number): number {
  if (max <= 0) return 13;
  return Math.round(13 + Math.sqrt(Math.min(count, max) / max) * 17);
}
