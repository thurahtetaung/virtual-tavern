import type { WordListSummary } from '@vt/game-sdk';
import { cn } from '@vt/ui';
import type { CodenamesAction, Settings as SettingsT } from '../logic/types.ts';
import { WordLists } from './WordLists.tsx';

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
      <WordLists
        selectedIds={settings.wordListIds}
        wordLists={wordLists}
        editable={editable}
        act={act}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {timerSelect('clueSeconds', 'Clue timer', 'Time for the Spymaster to give a clue.')}
        {timerSelect('guessSeconds', 'Guess timer', 'Time for the team to make its guesses.')}
      </div>
      <TimerModePicker settings={settings} editable={editable} act={act} />
    </div>
  );
}

const TIMER_MODES = [
  {
    mode: 'soft',
    title: 'Just a reminder',
    help: 'The timer turns red when time is up. Nobody is forced to stop.',
  },
  {
    mode: 'strict',
    title: 'Strict',
    help: 'When time runs out, the turn passes to the other team automatically.',
  },
] as const;

function TimerModePicker({ settings, editable, act }: Omit<Props, 'wordLists'>) {
  const timed = settings.clueSeconds !== null || settings.guessSeconds !== null;
  const current = settings.timerMode ?? 'soft';
  if (!editable) {
    if (!timed) return null;
    const mode = TIMER_MODES.find((m) => m.mode === current)!;
    return (
      <p className="text-sm">
        <span className="font-semibold">When time runs out:</span> {mode.help}
      </p>
    );
  }
  return (
    <fieldset disabled={!timed} className={cn(!timed && 'opacity-50')}>
      <legend className="text-sm font-semibold">When time runs out</legend>
      {!timed && <p className="text-xs text-stone-500">Set a clue or guess timer to choose.</p>}
      <div className="mt-1 grid gap-2 sm:grid-cols-2">
        {TIMER_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            aria-pressed={current === m.mode}
            onClick={() => void act({ type: 'update-settings', timerMode: m.mode })}
            className={cn(
              'rounded-lg px-3 py-2 text-left ring-1 transition disabled:cursor-not-allowed',
              current === m.mode
                ? 'bg-amber-50 ring-2 ring-amber-500 dark:bg-amber-500/10'
                : 'ring-stone-200 hover:bg-stone-100 dark:ring-stone-700 dark:hover:bg-stone-800',
            )}
          >
            <span className="block font-semibold">{m.title}</span>
            <span className="block text-xs text-stone-500">{m.help}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
