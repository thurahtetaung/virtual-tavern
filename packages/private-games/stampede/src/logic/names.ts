/**
 * The words the table sees for the cows. The repository holds plain placeholders; unlocked
 * browsers may get other words from the private manifest. Player-facing text is written with
 * tokens (`{pink}`, `{cows}`, `{Cow}`…) that `fillNames` replaces; a capitalised token capitalises
 * the word, for the start of a sentence.
 */
export interface Names {
  title: string;
  /** The odd one out's cow. */
  pink: string;
  cow: string;
  cows: string;
}

export const PLACEHOLDER_NAMES: Names = {
  title: 'Stampede',
  pink: 'Pink Cow',
  cow: 'cow',
  cows: 'cows',
};

const KEYS = new Set<string>(['pink', 'cow', 'cows']);

export const capitalise = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const word = (k: string, names: Names): string | null => {
  if (KEYS.has(k)) return names[k as keyof Names];
  const lower = k[0]!.toLowerCase() + k.slice(1);
  return k !== lower && KEYS.has(lower) ? capitalise(names[lower as keyof Names]) : null;
};

/**
 * Replaces the name tokens in `text`. `{cow}` is the word as named, `{Cow}` the same word
 * capitalised, and "a {cow}" becomes "an …" when the name starts with a vowel. Anything else in
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

/** "1 cow", "3 cows". */
export const cowCount = (names: Names, n: number) => `${n} ${n === 1 ? names.cow : names.cows}`;
