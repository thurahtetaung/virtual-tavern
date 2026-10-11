/** Combined word pool: trimmed, blanks dropped, case-insensitive duplicates removed (first spelling wins). */
export function wordPool(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const raw of words) {
    const word = raw.trim();
    const key = word.toLocaleLowerCase('en');
    if (word && !seen.has(key)) {
      seen.add(key);
      pool.push(word);
    }
  }
  return pool;
}

const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

/**
 * A word as players would read it: accents removed ("café" → "cafe"), lower case, single spaces,
 * no punctuation at either end, curly apostrophes made straight, and a possessive "'s" dropped
 * ("Dog's" → "dog").
 */
export function normaliseWord(s: string): string {
  const plain = s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en')
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(EDGE_PUNCTUATION, '');
  return plain.replace(/'s$/, '').replace(EDGE_PUNCTUATION, '');
}

const MIN_STEM = 3;
const LEADING_ARTICLES = new Set(['a', 'an', 'the']);
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/** One rule per group, tried in order; the first whose result keeps `MIN_STEM` letters wins. */
const PLURALS: { test: RegExp; replace: string }[] = [
  { test: /ies$/, replace: 'y' }, // berries → berry (and pixies → pixy, which meets pixie below)
  { test: /(?<=(?:s|x|z|ch|sh))es$/, replace: '' }, // boxes → box, buses → bus, wishes → wish
  { test: /(?<![isu])s$/, replace: '' }, // cats → cat; not glass, bus, tennis
];
const ENDINGS: { test: RegExp; replace: string }[] = [
  { test: /ing$/, replace: '' }, // running → runn
  { test: /ed$/, replace: '' }, // played → play
  { test: /er$/, replace: '' }, // runner → runn
];

function strip(word: string, rules: typeof PLURALS): string {
  for (const { test, replace } of rules) {
    if (!test.test(word)) continue;
    const cut = word.replace(test, replace);
    if (cut.length >= MIN_STEM) return cut;
  }
  return word;
}

function stem(word: string): string {
  // A plural first, then a verb ending, so crossings / crossing and players / player meet too.
  let w = strip(strip(word, PLURALS), ENDINGS);
  // A silent final e, so bake / baking / baker and horse / horses meet ("bak", "hors").
  if (w.length > MIN_STEM && w.endsWith('e') && !w.endsWith('ee')) w = w.slice(0, -1);
  // A doubled final consonant, so run / running and ball / balls meet ("run", "bal").
  const last = w.at(-1);
  if (w.length > MIN_STEM && last && !VOWELS.has(last) && w.at(-2) === last) w = w.slice(0, -1);
  // A final y reads as i, so berry / berries and pixie / pixies meet ("berri", "pixi").
  if (w.length > MIN_STEM && w.endsWith('y')) w = `${w.slice(0, -1)}i`;
  return w;
}

/**
 * The key two clues are compared by: `normaliseWord` plus a deliberately light English stemmer,
 * so "Cat", "cats" and "CAT", or "run", "runner" and "running", count as the same clue.
 *
 * The stemmer knows no dictionary, so it over-cancels on purpose rather than let near-identical
 * clues through: "sing" and "singer" meet, and so do "hat", "hate" and "hated". It never
 * shortens a word below three letters, which keeps short words like "bus" and "red" intact and
 * apart from "busy" or "reed". Words with a shared stem but different spelling ("sing" and
 * "song") stay apart. A leading article is dropped from a phrase ("A pixie" and "pixie" meet),
 * but a lone "a" or "the" stays itself.
 */
export function wordKey(s: string): string {
  const parts = normaliseWord(s).split(' ');
  if (parts.length > 1 && LEADING_ARTICLES.has(parts[0]!)) parts.shift();
  return parts
    .map((part) => (/^[\p{L}']+$/u.test(part) ? stem(part.replace(/'/g, '')) : part))
    .join(' ');
}

/** One word: letters (with any accents), digits, apostrophes and hyphens only. */
export function isSingleWord(s: string): boolean {
  return /^[\p{L}\p{M}\p{N}'’-]+$/u.test(s);
}

/** Nothing but digits, such as "42". */
export function isNumberOnly(s: string): boolean {
  return /^\p{N}+$/u.test(s);
}
