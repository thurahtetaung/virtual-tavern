import type { ActOptions } from '@vt/game-sdk';
import { Button, RefusalSlot } from '@vt/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
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
  // No number is preselected, so a Spymaster never sends "· 1" by accident.
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const clue = word.trim();
  const spaced = /\s/.test(clue);

  // Focus the clue box only with a mouse or trackpad, and without scrolling: on a phone the
  // keyboard would cover the board, and the jump would hide the timer and the turn hint.
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) input.current?.focus({ preventScroll: true });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (count === null || spaced) return;
    setBusy(true);
    if (await act({ type: 'give-clue', word: clue, count }, { anchor: CLUE_ANCHOR })) {
      setWord('');
      setCount(null);
    }
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
            ref={input}
            value={word}
            onChange={(e) => setWord(e.target.value)}
            aria-invalid={spaced}
            aria-describedby={spaced ? 'clue-one-word' : undefined}
            maxLength={32}
            placeholder="e.g. Ocean"
            className="mt-1 block w-full rounded-lg bg-white px-3 py-2 text-lg font-semibold uppercase ring-1 ring-stone-300 placeholder:normal-case placeholder:font-normal dark:bg-stone-800 dark:ring-stone-600"
          />
          {spaced && (
            <span id="clue-one-word" className="mt-1 block text-sm text-red-700 dark:text-red-400">
              One word only: try {clue.replace(/\s+/g, '-').toUpperCase()} or a single word.
            </span>
          )}
        </label>
        <fieldset>
          <legend className="text-sm font-semibold">
            How many of your agents does it point to?
          </legend>
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
                    ? 'bg-accent dark:bg-amber-500 text-accent-fg dark:text-stone-950 ring-accent dark:ring-amber-600'
                    : 'bg-white ring-stone-300 hover:bg-stone-100 dark:bg-stone-800 dark:ring-stone-600')
                }
              >
                {c}
              </button>
            ))}
          </div>
        </fieldset>
        <Button
          type="submit"
          size="lg"
          disabled={!clue || spaced || count === null || busy || count > max}
        >
          {count === null && clue && !spaced ? 'Pick a number' : 'Give clue'}
        </Button>
      </form>
      <RefusalSlot anchor={CLUE_ANCHOR} />
    </>
  );
}
