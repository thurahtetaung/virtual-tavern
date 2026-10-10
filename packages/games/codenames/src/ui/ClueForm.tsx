import { Button } from '@vt/ui';
import { type FormEvent, useState } from 'react';
import type { CodenamesAction } from '../logic/types.ts';

const COUNTS: { label: string; value: number | null }[] = [
  ...Array.from({ length: 9 }, (_, i) => ({ label: String(i + 1), value: i + 1 })),
  { label: '0', value: 0 },
  { label: '∞', value: null },
];

export function ClueForm({ act }: { act: (a: CodenamesAction) => Promise<boolean> }) {
  const [word, setWord] = useState('');
  const [count, setCount] = useState<number | null>(1);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await act({ type: 'give-clue', word: word.trim(), count })) setWord('');
    setBusy(false);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex-1">
        <span className="text-sm font-semibold">Your clue (one word)</span>
        <input
          autoFocus
          value={word}
          onChange={(e) => setWord(e.target.value.replace(/\s/g, ''))}
          maxLength={32}
          placeholder="e.g. Ocean"
          className="mt-1 block w-full rounded-lg bg-white px-3 py-2 text-lg font-semibold uppercase ring-1 ring-stone-300 placeholder:normal-case placeholder:font-normal dark:bg-stone-800 dark:ring-stone-600"
        />
      </label>
      <fieldset>
        <legend className="text-sm font-semibold">How many cards?</legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {COUNTS.map((c) => (
            <button
              key={c.label}
              type="button"
              aria-pressed={count === c.value}
              onClick={() => setCount(c.value)}
              className={
                'size-9 rounded-lg text-sm font-bold ring-1 transition ' +
                (count === c.value
                  ? 'bg-amber-500 text-stone-950 ring-amber-600'
                  : 'bg-white ring-stone-300 hover:bg-stone-100 dark:bg-stone-800 dark:ring-stone-600')
              }
            >
              {c.label}
            </button>
          ))}
        </div>
      </fieldset>
      <Button type="submit" size="lg" disabled={!word.trim() || busy}>
        Give clue
      </Button>
    </form>
  );
}
