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
