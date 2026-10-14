import type { ActOptions } from '@vt/game-sdk';
import { Button, RefusalSlot } from '@vt/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { ClueCount, CodenamesAction } from '../logic/types.ts';

/** Where the server's refusal of a clue shows, right under the form. */
const CLUE_ANCHOR = 'codenames-clue';

const COUNTS = Array.from({ length: 9 }, (_, i) => i + 1);
/** The clues that lift the guess limit, with what they mean. */
const OPEN_COUNTS: { count: ClueCount; label: string; hint: string }[] = [
  { count: 0, label: '0', hint: 'none of these' },
  { count: null, label: '∞', hint: 'unlimited' },
];

const countClass = (on: boolean) =>
  'h-11 min-w-8 rounded-lg text-sm font-bold ring-1 transition disabled:cursor-not-allowed disabled:opacity-40 ' +
  (on
    ? 'bg-accent dark:bg-amber-500 text-accent-fg dark:text-stone-950 ring-accent dark:ring-amber-600'
    : 'bg-white ring-stone-300 hover:bg-stone-100 dark:bg-stone-800 dark:ring-stone-600');

interface Props {
  act: (a: CodenamesAction, options?: ActOptions) => Promise<boolean>;
  /** Agents the team still has to find: the engine rejects a higher number. */
  max: number;
}

export function ClueForm({ act, max }: Props) {
  const [word, setWord] = useState('');
  // No number is preselected (undefined), so a Spymaster never sends "· 1" by accident.
  const [count, setCount] = useState<ClueCount | undefined>(undefined);
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
    if (count === undefined || spaced) return;
    setBusy(true);
    if (await act({ type: 'give-clue', word: clue, count }, { anchor: CLUE_ANCHOR })) {
      setWord('');
      setCount(undefined);
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
                className={countClass(count === c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {OPEN_COUNTS.map((o) => (
              <button
                key={o.label}
                type="button"
                aria-pressed={count === o.count}
                title="Your team may keep guessing as long as they find your agents"
                onClick={() => setCount(o.count)}
                className={countClass(count === o.count) + ' px-2'}
              >
                {o.label} <span className="font-normal">· {o.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <Button
          type="submit"
          size="lg"
          disabled={!clue || spaced || count === undefined || busy || (count ?? 0) > max}
        >
          {count === undefined && clue && !spaced ? 'Pick a number' : 'Give clue'}
        </Button>
      </form>
      <RefusalSlot anchor={CLUE_ANCHOR} />
    </>
  );
}
