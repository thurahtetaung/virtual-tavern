import type { WordListSummary } from '@vt/game-sdk';
import { ChoicePicker } from './choice-picker.tsx';

interface Props {
  selectedIds: string[];
  wordLists: WordListSummary[];
  editable: boolean;
  /** Persist the new selection; resolve true on success to close the picker. */
  onSave: (ids: string[]) => Promise<boolean>;
}

/** Word-list flavour of the shared ChoicePicker. */
export function WordListPicker({ selectedIds, wordLists, editable, onSave }: Props) {
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
        summary: (chosen, total) =>
          `The board draws 25 random words from ${chosen.length === 1 ? 'this list' : 'these lists'} (${total} words).`,
      }}
    />
  );
}
