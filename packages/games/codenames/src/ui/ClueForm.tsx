import type { ActOptions } from '@vt/game-sdk';
import { Button, RefusalSlot } from '@vt/ui';
import { type FormEvent, useState } from 'react';
import type { CodenamesAction } from '../logic/types.ts';

/** Where the server's refusal of a clue shows, right under the form. */
const CLUE_ANCHOR = 'codenames-clue';

const COUNTS = Array.from({ length: 9 }, (_, i) => i + 1);

interface Props {
  act: (a: CodenamesAction, options?: ActOptions) => Promise<boolean>;
  /** Agents the team still has to find: the engine rejects a higher number. */
  max: number;
}

export function ClueForm({ act, max }: Props) {
  const [word, setWord] = useState('');
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (await act({ type: 'give-clue', word: word.trim(), count }, { anchor: CLUE_ANCHOR }))
      setWord('');
    setBusy(false);
  };

  return (
    <>
      <form
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
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
          <div className="mt-1 grid grid-cols-9 gap-1">
            {COUNTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={count === c}
                disabled={c > max}
                title={c > max ? `Only ${max} left to find` : undefined}
                onClick={() => setCount(c)}
                className={
                  'h-11 min-w-8 rounded-lg text-sm font-bold ring-1 transition disabled:cursor-not-allowed disabled:opacity-40 ' +
                  (count === c
                    ? 'bg-amber-500 text-stone-950 ring-amber-600'
                    : 'bg-white ring-stone-300 hover:bg-stone-100 dark:bg-stone-800 dark:ring-stone-600')
                }
              >
                {c}
              </button>
            ))}
          </div>
        </fieldset>
        <Button type="submit" size="lg" disabled={!word.trim() || busy || count > max}>
          Give clue
        </Button>
      </form>
      <RefusalSlot anchor={CLUE_ANCHOR} />
    </>
  );
}
