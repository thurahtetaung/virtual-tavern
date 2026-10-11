import { normaliseWord } from './words.ts';

/**
 * Word matching for clue and guess games, in three strengths:
 *
 * - `sameAnswer`: is a guess the answer? Strict: case, accents, punctuation, spacing, plurals
 *   and a short list of irregular plurals and US/UK spellings only, so "spiderman" is
 *   "Spider-Man" and "mice" is "MOUSE", but "numb" is never "NUMBER".
 * - `sameClue`: are two clues the same word? `sameAnswer`, plus simple verb endings ("run" and
 *   "running", "bake" and "baked"). Words that merely start alike ("corn" and "corner") differ.
 * - `containsWord`: does a clue give a word away? `sameClue`, or one is the other with a
 *   common ending or prefix ("sunny", "react"), or a compound of it ("sunflower"), checked both
 *   ways, or a whole word of a multi-word answer. A word hidden inside another ("cat" in
 *   "scatter", "ice" in "police") doesn't count.
 *
 * None of it knows a dictionary, so each rule is narrow on purpose.
 */

const LEADING_ARTICLES = new Set(['a', 'an', 'the']);
/** Small words of a multi-word answer that a clue may still use. */
const FILLER = new Set([
  'a',
  'an',
  'the',
  'and',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'by',
  'or',
  'from',
  'n',
]);
const MIN_STEM = 3;
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/** Irregular plurals, looked up before the regular plural rules. */
const IRREGULAR: Record<string, string> = {
  men: 'man',
  women: 'woman',
  children: 'child',
  mice: 'mouse',
  geese: 'goose',
  feet: 'foot',
  teeth: 'tooth',
  people: 'person',
  oxen: 'ox',
  lice: 'louse',
  wolves: 'wolf',
  knives: 'knife',
  wives: 'wife',
  leaves: 'leaf',
  loaves: 'loaf',
  halves: 'half',
  shelves: 'shelf',
  lives: 'life',
  thieves: 'thief',
  calves: 'calf',
  elves: 'elf',
  scarves: 'scarf',
  hooves: 'hoof',
  cacti: 'cactus',
  fungi: 'fungus',
  potatoes: 'potato',
  tomatoes: 'tomato',
  heroes: 'hero',
  echoes: 'echo',
  volcanoes: 'volcano',
  mosquitoes: 'mosquito',
};

/** UK spellings (and a few casual ones) mapped to one form, after plurals are dropped. */
const SPELLINGS: Record<string, string> = {
  colour: 'color',
  favour: 'favor',
  flavour: 'flavor',
  honour: 'honor',
  humour: 'humor',
  labour: 'labor',
  neighbour: 'neighbor',
  harbour: 'harbor',
  rumour: 'rumor',
  behaviour: 'behavior',
  armour: 'armor',
  odour: 'odor',
  vapour: 'vapor',
  parlour: 'parlor',
  grey: 'gray',
  mum: 'mom',
  theatre: 'theater',
  centre: 'center',
  metre: 'meter',
  litre: 'liter',
  fibre: 'fiber',
  spectre: 'specter',
  defence: 'defense',
  offence: 'offense',
  licence: 'license',
  tyre: 'tire',
  aluminium: 'aluminum',
  jewellery: 'jewelry',
  pyjama: 'pajama',
  plough: 'plow',
  catalogue: 'catalog',
  dialogue: 'dialog',
  programme: 'program',
  aeroplane: 'airplane',
  moustache: 'mustache',
  doughnut: 'donut',
  cosy: 'cozy',
  sceptic: 'skeptic',
  mould: 'mold',
  yoghurt: 'yogurt',
  sulphur: 'sulfur',
  axe: 'ax',
};

/** Regular plurals: the first rule whose result keeps `MIN_STEM` letters wins. */
const PLURALS: { test: RegExp; replace: string }[] = [
  { test: /ies$/, replace: 'y' }, // berries → berry
  { test: /(?<=(?:s|x|z|ch|sh))es$/, replace: '' }, // boxes → box, wishes → wish
  { test: /(?<![isu])s$/, replace: '' }, // cats → cat; not glass, bus, tennis
];

function singular(word: string): string {
  const irregular = IRREGULAR[word];
  if (irregular) return irregular;
  for (const { test, replace } of PLURALS) {
    if (!test.test(word)) continue;
    const cut = word.replace(test, replace);
    if (cut.length >= MIN_STEM) return cut;
  }
  return word;
}

/** One word in its plain form: singular, one spelling, and "pixie" / "pixy" read alike. */
function baseWord(word: string): string {
  let w = singular(word);
  w = SPELLINGS[w] ?? w;
  // -ise and -ize verbs ("realise", "realize"); short words like "prise" are left alone.
  if (w.length >= 6) w = w.replace(/is(e|ed|es|ing|ation)$/, 'iz$1');
  if (w.length > MIN_STEM && w.endsWith('ie')) w = `${w.slice(0, -2)}y`;
  return w;
}

/** The normalised text without a leading article ("the moon" → "moon"). */
function plain(s: string): string {
  const words = normaliseWord(s).split(' ');
  if (words.length > 1 && LEADING_ARTICLES.has(words[0]!)) words.shift();
  return words.join(' ');
}

/** The words of a phrase, split on spaces, hyphens and other punctuation. */
function parts(s: string): string[] {
  return plain(s)
    .replace(/'/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * The forms a phrase is compared by, all run together without spaces or punctuation: each word
 * in its base form ("spider men" → "spiderman"), and the whole run-together text in its base
 * form ("monstersinc"), so "Monsters Inc" and "MONSTERSINC" meet either way.
 */
function forms(s: string): string[] {
  const words = parts(s);
  if (words.length === 0) return [];
  return [...new Set([words.map(baseWord).join(''), baseWord(words.join(''))])];
}

/** Is a guess the answer? Plurals, spelling variants, spacing and punctuation only. */
export function sameAnswer(guess: string, answer: string): boolean {
  const want = new Set(forms(answer));
  return forms(guess).some((f) => want.has(f));
}

/** Consonant, vowel, consonant at the end, as in "hat" or "run" (but not "row" or "box"). */
function endsShort(w: string): boolean {
  const [a, b, c] = [w.at(-3), w.at(-2), w.at(-1)];
  return (
    !!a && !!b && !!c && !VOWELS.has(a) && VOWELS.has(b) && !VOWELS.has(c) && !'wxy'.includes(c)
  );
}

/** `derived` is `base` with a verb ending: "run" → "running", "bake" → "baked", "carry" → "carried". */
function inflects(base: string, derived: string): boolean {
  if (base.length < MIN_STEM || derived.length <= base.length) return false;
  const endings = ['ing', 'ed'];
  const stems: string[] = [];
  if (base.endsWith('e') && !base.endsWith('ee')) {
    stems.push(base.slice(0, -1)); // bake → baking, baked
  } else if (base.endsWith('y') && base.length > MIN_STEM && !VOWELS.has(base.at(-2)!)) {
    if (derived === `${base.slice(0, -1)}ied`) return true; // carry → carried
    stems.push(base); // carry → carrying
  } else if (endsShort(base)) {
    stems.push(base + base.at(-1)); // run → running, stop → stopped
    // A three-letter word always doubles: "hat" → "hatted", so "hated" isn't "hat".
    if (base.length > MIN_STEM) stems.push(base);
  } else {
    stems.push(base); // play → playing, jump → jumped
  }
  return stems.some((stem) => endings.some((e) => derived === stem + e));
}

/** Are two clues the same word? `sameAnswer`, plus simple verb endings ("run", "running"). */
export function sameClue(a: string, b: string): boolean {
  const fa = forms(a);
  const fb = forms(b);
  return fa.some((x) => fb.some((y) => x === y || inflects(x, y) || inflects(y, x)));
}

/** Endings that make a new word from an old one ("sunny", "salty", "player", "fearless"). */
const SUFFIXES = new Set([
  's',
  'es',
  'ed',
  'ing',
  'ings',
  'er',
  'ers',
  'est',
  'y',
  'ly',
  'ies',
  'ied',
  'ier',
  'iest',
  'ness',
  'less',
  'ful',
  'ish',
  'ism',
  'ist',
  'able',
  'ment',
  'hood',
  'ship',
]);
/** Beginnings that make a new word from an old one ("unhappy", "react", "outrun"). */
const PREFIXES = new Set([
  'un',
  're',
  'dis',
  'mis',
  'pre',
  'non',
  'anti',
  'over',
  'under',
  'out',
  'super',
  'sub',
]);
/** Short words that often make compounds ("snowman", "bathtub", "sunday" does not count). */
const SHORT_PARTS = new Set([
  'man',
  'men',
  'box',
  'cup',
  'pot',
  'way',
  'top',
  'fly',
  'bed',
  'bag',
  'cap',
  'hat',
  'pan',
  'pin',
  'tub',
  'boy',
  'dog',
  'cat',
  'egg',
  'eye',
  'key',
  'lid',
  'map',
  'mat',
  'net',
  'oil',
  'pen',
  'pie',
  'pig',
  'tea',
  'toe',
  'toy',
  'web',
  'car',
]);

/** What's left once `part` is taken off, if it is a compound part (four letters or a known short word). */
const compound = (rest: string) => rest.length >= 4 || SHORT_PARTS.has(rest);

/** `long` is `short` with an ending, a prefix, or another word joined on. */
function affixed(long: string, short: string): boolean {
  if (short.length < MIN_STEM || long.length <= short.length) return false;
  // Ways `short` can begin a longer word: as it is, with its final e dropped ("baker"), its
  // final y as i ("happiness"), or its last letter doubled ("sunny").
  const starts: string[] = [short];
  if (short.endsWith('e')) starts.push(short.slice(0, -1));
  if (short.endsWith('y')) starts.push(`${short.slice(0, -1)}i`);
  if (endsShort(short)) starts.push(short + short.at(-1));
  for (const start of starts) {
    if (!long.startsWith(start)) continue;
    const rest = long.slice(start.length);
    if (SUFFIXES.has(rest) || (start === short && compound(rest))) return true;
  }
  if (long.endsWith(short)) {
    const rest = long.slice(0, -short.length);
    if (PREFIXES.has(rest) || compound(rest)) return true;
  }
  // A prefix and an ending together ("unhappily").
  for (const prefix of PREFIXES) {
    const rest = long.slice(prefix.length);
    if (long.startsWith(prefix) && rest.length > short.length && affixed(rest, short)) return true;
  }
  return false;
}

/**
 * Does `clue` give `word` away? It does when it is the same clue, a form of the word with an
 * ending or prefix, a compound of it (or the word a compound of the clue), or the same as a
 * whole word of a multi-word answer ("Monsters" for MONSTERS INC). A word merely hidden inside
 * another ("cat" in "scatter", "ice" in "police") does not.
 */
export function containsWord(clue: string, word: string): boolean {
  if (sameClue(clue, word)) return true;
  const words = parts(word).filter((w) => w.length >= MIN_STEM && !FILLER.has(w));
  const targets = new Set([...forms(word), ...words, ...words.map(baseWord)]);
  const raw = parts(clue).join('');
  const clues = new Set([...forms(clue), raw]);
  for (const t of targets) {
    for (const c of clues) {
      if (c === t || inflects(c, t) || inflects(t, c) || affixed(c, t) || affixed(t, c)) {
        return true;
      }
    }
  }
  return false;
}
