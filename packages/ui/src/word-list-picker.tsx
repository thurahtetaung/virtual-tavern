import type { WordListSummary } from '@vt/game-sdk';
import { type Choice, ChoicePicker } from './choice-picker.tsx';

interface Props {
  selectedIds: string[];
  wordLists: WordListSummary[];
  editable: boolean;
  /** Persist the new selection; resolve true on success to close the picker. */
  onSave: (ids: string[]) => Promise<boolean>;
  /** The line under the heading, given the chosen lists and their word total. Defaults to the 25-word board. */
  summary?: (chosen: Choice[], total: number) => string;
}

const boardSummary = (chosen: Choice[], total: number) =>
  `The board draws 25 random words from ${chosen.length === 1 ? 'this list' : 'these lists'} (${total} words).`;

/** Word-list flavour of the shared ChoicePicker. */
export function WordListPicker({
  selectedIds,
  wordLists,
  editable,
  onSave,
  summary = boardSummary,
}: Props) {
  return (
    <ChoicePicker
      selectedIds={selectedIds}
      editable={editable}
      onSave={onSave}
      choices={wordLists.map((l) => ({
        id: l.id,
        name: l.name,
        description: l.description,
        count: l.wordCount,
      }))}
      labels={{
        title: 'Word lists',
        unit: 'words',
        noun: 'list',
        change: 'Change word lists',
        summary,
      }}
    />
  );
}

/**
 * The chosen lists for a one-line summary: "Starter words", "3 word lists", "no word list". Several
 * are only counted, so a summary never shows this count next to its own "+N more".
 */
export function wordListsLine(
  selectedIds: readonly string[],
  wordLists: readonly WordListSummary[],
) {
  const names = wordLists.filter((l) => selectedIds.includes(l.id)).map((l) => l.name);
  if (!names.length) return 'no word list';
  return names.length === 1 ? names[0]! : `${names.length} word lists`;
}
