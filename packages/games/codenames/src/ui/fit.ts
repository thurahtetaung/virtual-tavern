/** A text's width in em (its width at a 1px font size). */
export type Measure = (text: string) => number;

/** Bold capitals average about 0.8em in the widest common system fonts. */
export const estimate: Measure = (text) => text.length * 0.8;

/**
 * The width (in em) of the longer line when `word` is set on at most two lines, split between
 * its words as evenly as possible. A single word is one line: it never breaks.
 */
export function longerLine(word: string, measure: Measure): number {
  const parts = word.trim().toUpperCase().split(/\s+/);
  let best = measure(parts.join(' '));
  for (let i = 1; i < parts.length; i++) {
    const longer = Math.max(
      measure(parts.slice(0, i).join(' ')),
      measure(parts.slice(i).join(' ')),
    );
    best = Math.min(best, longer);
  }
  return best;
}

/**
 * A CSS font size at which `word` fits its card (a size container) on two lines, with 6% to spare
 * for letter spacing and rounding. It never goes below 7px: a word still too long there (11+
 * letters on the narrowest phones) breaks at its soft hyphen instead (`softBreaks`).
 */
export const fitSize = (word: string, measure: Measure) =>
  `max(0.4375rem, ${(94 / longerLine(word, measure)).toFixed(2)}cqw)`;

/**
 * Measures bold text in `fontFamily` with a canvas, or falls back to `estimate` where there is no
 * canvas (tests, very old browsers).
 */
export function canvasMeasure(fontFamily: string): Measure {
  const ctx =
    typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!ctx) return estimate;
  ctx.font = `700 100px ${fontFamily}`;
  const cache = new Map<string, number>();
  return (text) => {
    let width = cache.get(text);
    if (width === undefined) {
      width = ctx.measureText(text).width / 100;
      cache.set(text, width);
    }
    return width;
  };
}

/** Words this long may break, at one soft hyphen; shorter words never break. */
export const BREAKABLE = 11;
const SOFT_HYPHEN = '­';
const VOWEL = /[aeiouy]/i;
const LETTER = /\p{L}/u;
/** Letter pairs that sound as one, never split. */
const DIGRAPH = /^(?:ch|sh|th|ph|wh|ck|gh|qu)$/i;
const consonant = (c: string | undefined) => c !== undefined && LETTER.test(c) && !VOWEL.test(c);

/**
 * The best place to split a long word (an index into it), or -1. A rough syllable rule, at least
 * four letters from either end and as near the middle as possible: before a capital in a joined
 * name ("PLAY|STATION"), between two consonants ("STORM|TROOPER", not inside the clusters that
 * start a syllable: tr, bl, st, ch…), or after a vowel before one consonant ("SKATE|BOARDING");
 * failing those, the looser `relaxed` rules.
 */
export function breakPoint(word: string, relaxed = false): number {
  const mid = word.length / 2;
  let best = -1;
  let bestScore = Infinity;
  for (let i = 4; i <= word.length - 4; i++) {
    const a = word[i - 1]!;
    const b = word[i]!;
    if (!LETTER.test(a) || !LETTER.test(b) || DIGRAPH.test(a + b)) continue;
    // Keep tr, bl, …, the end of a "gh", and s + consonant together (but "cheer|leader").
    if (consonant(a) && !/[lmnr]/i.test(a) && /[rl]/i.test(b)) continue;
    if (/h/i.test(a) && /g/i.test(word[i - 2] ?? '')) continue;
    if (!relaxed && /s/i.test(a) && consonant(b) && !/s/i.test(b)) continue;
    const capital = b !== b.toLowerCase() && a === a.toLowerCase();
    const consonants = consonant(a) && consonant(b);
    const syllable = VOWEL.test(a) && consonant(b) && (relaxed || VOWEL.test(word[i + 1] ?? ''));
    if (!capital && !consonants && !syllable) continue;
    const score =
      Math.abs(i - mid) +
      (capital ? -3 : consonants ? 0 : 1.5) -
      (VOWEL.test(word[i + 1] ?? '') ? 0.5 : 0);
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  }
  // No clean split: take a looser one rather than let the word break anywhere.
  return best < 0 && !relaxed ? breakPoint(word, true) : best;
}

/**
 * `text` with a soft hyphen in each word of `BREAKABLE` letters or more, so a word too long for
 * its card even at the smallest size breaks there (with a hyphen) instead of anywhere. Words
 * already joined by a hyphen break at it, so they are left alone.
 */
export function softBreaks(text: string): string {
  return text
    .split(/(\s+)/)
    .map((part) => {
      if (part.length < BREAKABLE || /[-\s]/.test(part)) return part;
      const at = breakPoint(part);
      return at < 0 ? part : part.slice(0, at) + SOFT_HYPHEN + part.slice(at);
    })
    .join('');
}
