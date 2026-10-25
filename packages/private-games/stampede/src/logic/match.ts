import { type PlayerId, normaliseWord, wordKey } from '@vt/game-sdk';
import type { Group } from './types.ts';

/** An answer as stored: trimmed, with runs of spaces collapsed. */
export const tidyAnswer = (text: string) => text.replace(/\s+/g, ' ').trim();

/** How an answer is shown: first letter capitalised. */
export const displayAnswer = (text: string) => {
  const tidy = tidyAnswer(text);
  return tidy.charAt(0).toLocaleUpperCase('en') + tidy.slice(1);
};

/**
 * Edit distance with swapped neighbours counted as one edit ("teh" / "the"), so slips of the
 * finger look close.
 */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** Shortest answer (in letters and digits) a typo is forgiven in: "Mars" and "Mass" stay apart. */
export const FUZZY_MIN_LENGTH = 5;
/** From this length, two slips are forgiven ("chocolate cake" / "chocolat cak"). */
export const FUZZY_LONG_LENGTH = 10;

/** One answer's comparison forms, its words run together in order and sorted. */
interface Forms {
  /** Its `wordKey` words (plurals and stems folded), for exact matches. */
  run: string;
  sorted: string;
  /** Its plain words (`normaliseWord`, no stems), for forgiving a slip of the finger. */
  plainRun: string;
  plainSorted: string;
}

/** Splits into words, apostrophes dropped. */
const words = (text: string) =>
  text
    .split(' ')
    .map((w) => w.replace(/['‘’ʼ`´]/g, ''))
    .filter(Boolean);
/** Hyphens, dashes and other punctuation read as spaces. */
const spaced = (answer: string) => answer.replace(/[^\p{L}\p{M}\p{N}\s'‘’ʼ`´]/gu, ' ');

export function formsOf(answer: string): Forms {
  const keyed = words(wordKey(spaced(answer)));
  const plain = words(normaliseWord(spaced(answer)));
  return {
    run: keyed.join(''),
    sorted: [...keyed].sort().join(''),
    plainRun: plain.join(''),
    plainSorted: [...plain].sort().join(''),
  };
}

/** One slip forgiven from 5 letters, two from 10; shorter answers must match exactly. */
const slip = (a: string, b: string) => {
  const shorter = Math.min(a.length, b.length);
  if (shorter < FUZZY_MIN_LENGTH) return false;
  return editDistance(a, b) <= (shorter >= FUZZY_LONG_LENGTH ? 2 : 1);
};

/**
 * Whether two answers count as the same. They do when they are the same words under `wordKey`
 * (case, accents, punctuation, plurals, simple stems, a leading article), whatever the spacing,
 * dashes or word order ("ice cream", "ice-cream", "icecream", "cream ice"), or when one is a
 * slip of the other as typed: one edit apart for answers of 5 or more letters, two from 10.
 * Shorter answers get no slips ("Mars" and "Mass" stay apart), and synonyms or abbreviations
 * never match ("USA" isn't "America").
 */
export function sameAnswer(a: string, b: string): boolean {
  const x = formsOf(a);
  const y = formsOf(b);
  if (!x.plainRun || !y.plainRun) return false;
  if (x.run === y.run || x.sorted === y.sorted) return true;
  return slip(x.plainRun, y.plainRun) || slip(x.plainSorted, y.plainSorted);
}

/**
 * Groups the answers automatically: answers that are `sameAnswer` share a group, and so do
 * answers linked through one another. Players without an answer are in no group. The result
 * depends only on the answers, never on who typed them first: groups come in the order players
 * first gave them, and each lists its players in seat order.
 */
export function autoGroups(
  players: readonly PlayerId[],
  answers: Readonly<Record<PlayerId, string>>,
): Group[] {
  const ids = players.filter((id) => answers[id] !== undefined);
  const parent = ids.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (find(i) !== find(j) && sameAnswer(answers[ids[i]!]!, answers[ids[j]!]!)) {
        parent[Math.max(find(i), find(j))] = Math.min(find(i), find(j));
      }
    }
  }
  const byRoot = new Map<number, Group>();
  ids.forEach((id, i) => {
    const root = find(i);
    const group = byRoot.get(root);
    if (group) group.members.push(id);
    else byRoot.set(root, { id: `g${byRoot.size + 1}`, members: [id] });
  });
  return [...byRoot.values()];
}

/** A group's answer as shown: its most common spelling (the first given on a tie). */
export function groupLabel(group: Group, answers: Readonly<Record<PlayerId, string>>): string {
  const counts = new Map<string, { text: string; n: number }>();
  for (const id of group.members) {
    const text = answers[id];
    if (text === undefined) continue;
    const key = normaliseWord(text);
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { text: displayAnswer(text), n: 1 });
  }
  let best: { text: string; n: number } | undefined;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  return best?.text ?? '';
}
