import type { WordListSummary } from '@vt/game-sdk';
import { TimerSettings, WordListPicker } from '@vt/ui';
import type { CodenamesAction, Settings as SettingsT } from '../logic/types.ts';

interface Props {
  settings: SettingsT;
  wordLists: WordListSummary[];
  editable: boolean;
  act: (a: CodenamesAction) => Promise<boolean>;
}

export function Settings({ settings, wordLists, editable, act }: Props) {
  return (
    <div className="space-y-4">
      <WordListPicker
        selectedIds={settings.wordListIds}
        wordLists={wordLists}
        editable={editable}
        onSave={(ids) => act({ type: 'update-settings', wordListIds: ids })}
      />
      <TimerSettings
        values={settings}
        editable={editable}
        onChange={(patch) => void act({ type: 'update-settings', ...patch })}
        clueHelp="Time for the Spymaster to give a clue."
        guessHelp="Time for the team to make its guesses."
        strictHelp="the turn passes to the other team automatically"
      />
    </div>
  );
}
