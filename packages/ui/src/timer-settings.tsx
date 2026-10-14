import { cn } from './cn.ts';

export type TimerMode = 'soft' | 'strict';

export interface TimerValues {
  clueSeconds: number | null;
  guessSeconds: number | null;
  timerMode?: TimerMode;
}

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

/**
 * Clue/guess timer pickers plus the reminder-or-strict choice, shared by every timed game. A game
 * with a single timer leaves out `guessHelp` and names its timer with `clueLabel`; a game whose
 * phases aren't clues and guesses renames both with `clueLabel` and `guessLabel`.
 */
export function TimerSettings({
  values,
  editable,
  onChange,
  clueHelp,
  guessHelp,
  clueLabel = 'Clue timer',
  guessLabel = 'Guess timer',
  strictHelp,
}: {
  values: TimerValues;
  editable: boolean;
  onChange: (patch: Partial<TimerValues>) => void;
  clueHelp: string;
  /** Omit to show only the first timer. */
  guessHelp?: string;
  clueLabel?: string;
  guessLabel?: string;
  /** What "strict" does in this game, e.g. "the turn passes to the other team". */
  strictHelp: string;
}) {
  const modes = [
    {
      mode: 'soft' as const,
      title: 'Just a reminder',
      help: 'The timer turns red when time is up. Nobody is forced to stop.',
    },
    { mode: 'strict' as const, title: 'Strict', help: `When time runs out, ${strictHelp}.` },
  ];
  const timed = values.clueSeconds !== null || values.guessSeconds !== null;
  const current = values.timerMode ?? 'soft';

  const select = (key: 'clueSeconds' | 'guessSeconds', label: string, help: string) => (
    <label className="block">
      <span className="text-sm font-semibold">{label}</span>
      <span className="block text-xs text-stone-500 dark:text-stone-400">{help}</span>
      {editable ? (
        <select
          className="mt-1 min-h-11 w-full rounded-lg bg-white px-3 py-2 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
          value={values[key] ?? ''}
          onChange={(e) =>
            onChange({ [key]: e.target.value === '' ? null : Number(e.target.value) })
          }
        >
          {TIMER_OPTIONS.map((o) => (
            <option key={o.label} value={o.value ?? ''}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="mt-1 block">{timerLabel(values[key])}</span>
      )}
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {select('clueSeconds', clueLabel, clueHelp)}
        {guessHelp !== undefined && select('guessSeconds', guessLabel, guessHelp)}
      </div>
      {/* What happens at zero only matters once a timer is set, so until then it isn't shown. */}
      {!timed ? null : !editable ? (
        <p className="text-sm">
          <span className="font-semibold">When time runs out:</span>{' '}
          {modes.find((m) => m.mode === current)!.help}
        </p>
      ) : (
        <fieldset>
          <legend className="text-sm font-semibold">When time runs out</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {modes.map((m) => (
              <button
                key={m.mode}
                type="button"
                aria-pressed={current === m.mode}
                onClick={() => onChange({ timerMode: m.mode })}
                className={cn(
                  'rounded-lg px-3 py-2 text-left ring-1 transition',
                  current === m.mode
                    ? 'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/10 dark:ring-amber-500'
                    : 'ring-line hover:bg-panel dark:ring-stone-700 dark:hover:bg-stone-800',
                )}
              >
                <span className="block font-semibold">{m.title}</span>
                <span className="block text-xs text-stone-500 dark:text-stone-400">{m.help}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
