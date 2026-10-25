import { type PlayerId, normaliseWord, wordKey } from '@vt/game-sdk';
import type { Group, Suggestion } from './types.ts';

/** An answer as stored: trimmed, with runs of spaces collapsed. */
export const tidyAnswer = (text: string) => text.replace(/\s+/g, ' ').trim();

/** How an answer is shown: first letter capitalised. */
export const displayAnswer = (text: string) => {
  const tidy = tidyAnswer(text);
  return tidy.charAt(0).toLocaleUpperCase('en') + tidy.slice(1);
};

/**
 * The automatic grouping: answers equal under `wordKey` (case, accents, punctuation, plurals,
 * simple stems and a leading article) share a group, in the order players first gave them.
 * Players without an answer are in no group.
 */
export function autoGroups(
  players: readonly PlayerId[],
  answers: Readonly<Record<PlayerId, string>>,
): Group[] {
  const byKey = new Map<string, Group>();
  for (const id of players) {
    const answer = answers[id];
    if (answer === undefined) continue;
    const key = wordKey(answer);
    const group = byKey.get(key);
    if (group) group.members.push(id);
    else byKey.set(key, { id: `g${byKey.size + 1}`, members: [id] });
  }
  return [...byKey.values()];
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

/** Shortest answer a typo is looked for in. */
export const TYPO_MIN_LENGTH = 5;
/** Suggestions shown at once. */
export const MAX_SUGGESTIONS = 8;

/**
 * Groups that look like a typo of each other, for the host to merge if they agree; never merged
 * by themselves. Both answers have at least `TYPO_MIN_LENGTH` letters and differ by one edit
 * (two from 8 letters). The smaller group is offered into the bigger one.
 */
export function typoSuggestions(
  groups: readonly Group[],
  answers: Readonly<Record<PlayerId, string>>,
): Suggestion[] {
  const plain = groups.map((g) =>
    normaliseWord(groupLabel(g, answers)).replace(/[^\p{L}\p{N}]/gu, ''),
  );
  const out: Suggestion[] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const a = plain[i]!;
      const b = plain[j]!;
      const shorter = Math.min(a.length, b.length);
      if (shorter < TYPO_MIN_LENGTH || a === b) continue;
      if (editDistance(a, b) > (shorter >= 8 ? 2 : 1)) continue;
      const [from, into] = groups[j]!.members.length > groups[i]!.members.length ? [i, j] : [j, i];
      out.push({ from: groups[from]!.id, into: groups[into]!.id });
      if (out.length >= MAX_SUGGESTIONS) return out;
    }
  }
  return out;
}
