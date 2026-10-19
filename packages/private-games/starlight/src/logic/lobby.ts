import type { ContentProvider, WordListSummary } from '@vt/game-sdk';

/** The word lists this room may offer: what `ctx.content` returns, which is only the game's own. */
export const offeredLists = (content: ContentProvider): WordListSummary[] =>
  content.wordLists().map((l) => ({ id: l.id, name: l.name, wordCount: l.wordCount }));

/**
 * The lists a room starts with: the first offered list, which is the game's own list when there
 * is one (`forGame` puts lists made only for this game first).
 */
export const defaultListIds = (lists: readonly WordListSummary[]) =>
  lists.length ? [lists[0]!.id] : [];

/**
 * Keeps a saved selection to the lists still offered (an admin may have switched one off or
 * deleted it); an empty selection falls back to the default.
 */
export function keptListIds(selected: readonly string[], lists: readonly WordListSummary[]) {
  const offered = new Set(lists.map((l) => l.id));
  const kept = selected.filter((id) => offered.has(id));
  return kept.length ? kept : defaultListIds(lists);
}

/**
 * Distinct words from the chosen lists, first spelling kept (case-insensitive). An entry written
 * `Top / Bottom` (a printed card's two words) gives both as words of their own.
 */
export function wordsFrom(content: ContentProvider, listIds: readonly string[]): string[] {
  const seen = new Set<string>();
  return content.words(listIds).flatMap((raw) =>
    raw.split(' / ').flatMap((side) => {
      const word = side.trim();
      const key = word.toLocaleLowerCase();
      if (!word || seen.has(key)) return [];
      seen.add(key);
      return [word];
    }),
  );
}
