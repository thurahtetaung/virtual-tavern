import { type ContentProvider, type Rng, type WordListSummary, wordKey } from '@vt/game-sdk';
import {
  type CardWord,
  DECK_SIZE,
  LEVELS,
  type Level,
  MAX_WORD_LENGTH,
  WORDS_PER_LEVEL,
} from './types.ts';

/** The word lists this room may offer: what `ctx.content` returns, which is only the game's own. */
export const offeredLists = (content: ContentProvider): WordListSummary[] =>
  content.wordLists().map((l) => ({
    id: l.id,
    name: l.name,
    wordCount: l.wordCount,
    ...(l.description && { description: l.description }),
  }));

const LEVEL_WORDS: Record<Level, RegExp> = {
  easy: /\beasy\b/i,
  hard: /\bhard\b/i,
  challenging: /\bchalleng/i,
};

/**
 * A level's lists when the room has none chosen: the offered lists named for that level ("…:
 * Easy"), else the first offered list.
 */
export function defaultLists(level: Level, lists: readonly WordListSummary[]): string[] {
  const named = lists.filter((l) => LEVEL_WORDS[level].test(l.name)).map((l) => l.id);
  if (named.length) return named;
  return lists.length ? [lists[0]!.id] : [];
}

/** Keeps a saved selection to the lists still offered; an empty one falls back to the default. */
export function keptLists(
  selected: Record<Level, string[]> | undefined,
  lists: readonly WordListSummary[],
): Record<Level, string[]> {
  const offered = new Set(lists.map((l) => l.id));
  const out = {} as Record<Level, string[]>;
  for (const level of LEVELS) {
    const kept = (selected?.[level] ?? []).filter((id) => offered.has(id));
    out[level] = kept.length ? kept : defaultLists(level, lists);
  }
  return out;
}

/** Distinct usable words from the chosen lists (first spelling kept, at most 40 characters). */
export function wordsFrom(content: ContentProvider, listIds: readonly string[]): string[] {
  const seen = new Set<string>();
  return content.words(listIds).flatMap((raw) => {
    const word = raw.trim().replace(/\s+/g, ' ');
    const key = wordKey(word);
    if (!word || !key || word.length > MAX_WORD_LENGTH || seen.has(key)) return [];
    seen.add(key);
    return [word];
  });
}

/** Browser tests only: the first word of every card (Easy), so a spec knows the answer. */
let testWord: string | null = null;
export function setTestWord(word: string | null) {
  testWord = word?.trim() || null;
}

/**
 * Draws a card of nine words, three of each level, from the decks, putting them on the spent
 * piles. A deck running short is topped up from its spent pile, reshuffled (never with a word on
 * the card being drawn).
 */
export function drawCard(
  deck: Record<Level, string[]>,
  spent: Record<Level, string[]>,
  rng: Rng,
): CardWord[] {
  const card: CardWord[] = [];
  for (const level of LEVELS) {
    if (deck[level].length < WORDS_PER_LEVEL) {
      deck[level].push(...rng.shuffle(spent[level]));
      spent[level] = [];
    }
    const words = deck[level].splice(0, WORDS_PER_LEVEL);
    spent[level].push(...words);
    for (const word of words) card.push({ word, level });
  }
  if (testWord && card[0]) card[0] = { word: testWord, level: card[0].level };
  return card;
}

/** A level's deck for a new game: up to `DECK_SIZE` of its words, shuffled. */
export const newDeck = (words: readonly string[], rng: Rng) =>
  rng.shuffle(words).slice(0, DECK_SIZE);
