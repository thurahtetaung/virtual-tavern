import type { WordListSummary } from '@vt/game-sdk';
import { cn } from '@vt/ui';
import type { CodenamesAction, Settings as SettingsT } from '../logic/types.ts';

const TIMER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'No limit', value: null },
  { label: '30 seconds', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '90 seconds', value: 90 },
  { label: '2 minutes', value: 120 },
  { label: '3 minutes', value: 180 },
  { label: '5 minutes', value: 300 },
];

const timerLabel = (v: number | null) =>
  TIMER_OPTIONS.find((o) => o.value === v)?.label ?? `${v} seconds`;

interface Props {
  settings: SettingsT;
  wordLists: WordListSummary[];
  editable: boolean;
  act: (a: CodenamesAction) => Promise<boolean>;
}

export function Settings({ settings, wordLists, editable, act }: Props) {
  const selected = new Set(settings.wordListIds);

  const toggleList = (id: string) => {
    const next = selected.has(id)
      ? settings.wordListIds.filter((x) => x !== id)
      : [...settings.wordListIds, id];
    if (next.length) void act({ type: 'update-settings', wordListIds: next });
  };

  const timerSelect = (key: 'clueSeconds' | 'guessSeconds', label: string, help: string) => (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <span className="block text-xs text-stone-500">{help}</span>
      {editable ? (
        <select
          className="mt-1 w-full rounded-lg bg-white px-3 py-2 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
          value={settings[key] ?? ''}
          onChange={(e) =>
            void act({
              type: 'update-settings',
              [key]: e.target.value === '' ? null : Number(e.target.value),
            })
          }
        >
          {TIMER_OPTIONS.map((o) => (
            <option key={o.label} value={o.value ?? ''}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="mt-1 block">{timerLabel(settings[key])}</span>
      )}
    </label>
  );

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="text-sm font-semibold">Word lists</legend>
        <p className="text-xs text-stone-500">
          {editable ? 'Mix as many as you like. ' : ''}The board draws 25 random words from these.
        </p>
        <ul className="mt-2 space-y-1">
          {wordLists.map((list) => {
            const on = selected.has(list.id);
            if (!editable && !on) return null;
            return (
              <li key={list.id}>
                <label
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-lg px-3 py-2 ring-1',
                    on
                      ? 'bg-amber-50 ring-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/40'
                      : 'ring-stone-200 dark:ring-stone-700',
                    editable && 'cursor-pointer',
                  )}
                >
                  <span className="flex items-center gap-2">
                    {editable && (
                      <input
                        type="checkbox"
                        className="size-4 accent-amber-600"
                        checked={on}
                        disabled={on && selected.size === 1}
                        onChange={() => toggleList(list.id)}
                      />
                    )}
                    {list.name}
                  </span>
                  <span className="text-xs text-stone-500">{list.wordCount} words</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        {timerSelect('clueSeconds', 'Clue timer', 'Time for the Spymaster to give a clue.')}
        {timerSelect('guessSeconds', 'Guess timer', 'Time for the team to make its guesses.')}
      </div>
    </div>
  );
}
