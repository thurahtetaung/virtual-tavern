import type { Disc } from './types.ts';

/**
 * The words the table sees for the discs. The repository only holds these neutral placeholders;
 * unlocked browsers get the real ones from the private manifest. Player-facing text is written
 * with tokens (`{rose}`, `{thorns}`, `{Thorn}`…) that `fillNames` replaces; a capitalised token
 * capitalises the word, for the start of a sentence.
 */
export interface Names {
  title: string;
  rose: string;
  roses: string;
  thorn: string;
  thorns: string;
  /** The lent disc, as it reads mid-sentence. */
  chance: string;
}

export const PLACEHOLDER_NAMES: Names = {
  title: 'Thorns',
  rose: 'rose',
  roses: 'roses',
  thorn: 'thorn',
  thorns: 'thorns',
  chance: 'Last Chance disc',
};

/** The emoji drawn on a placeholder disc. */
export const DISC_EMOJI: Record<Disc, string> = { rose: '🌹', thorn: '💀', chance: '🍀' };

const KEYS = new Set<string>(['rose', 'roses', 'thorn', 'thorns', 'chance']);

export const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const word = (k: string, names: Names): string | null => {
  if (KEYS.has(k)) return names[k as keyof Names];
  const lower = k[0]!.toLowerCase() + k.slice(1);
  return k !== lower && KEYS.has(lower) ? capitalise(names[lower as keyof Names]) : null;
};

/**
 * Replaces the name tokens in `text`. `{thorn}` is the word as named, `{Thorn}` the same word
 * capitalised, and "a {rose}" becomes "an …" when the name starts with a vowel. Anything else in
 * braces is left alone.
 */
export function fillNames(text: string, names: Names): string {
  return text.replace(
    /(\b(?:[Aa]n?) )?\{([A-Za-z]+)\}/g,
    (m, article: string | undefined, k: string) => {
      const w = word(k, names);
      if (w === null) return m;
      if (!article) return w;
      const an = /^[aeiou]/i.test(w);
      const a = article[0]!;
      return `${an ? `${a}n` : a} ${w}`;
    },
  );
}

/** A disc's name, singular or plural, from the names. */
export const discName = (names: Names, disc: Disc, n = 1) =>
  disc === 'chance'
    ? names.chance
    : disc === 'rose'
      ? n === 1
        ? names.rose
        : names.roses
      : n === 1
        ? names.thorn
        : names.thorns;
