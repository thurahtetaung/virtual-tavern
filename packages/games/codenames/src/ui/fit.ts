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
 * for letter spacing and rounding. It never goes below 7px: the very longest words on the
 * narrowest phones wrap there instead.
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
