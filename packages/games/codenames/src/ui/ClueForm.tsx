import type { ActOptions } from '@vt/game-sdk';
import { Button, Input, StickyBar, cn } from '@vt/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { CodenamesAction } from '../logic/types.ts';

/** Where the server's refusal of a clue shows: with the form (in the sticky bar on phones). */
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

  // Phones keep the form in the sticky bar, with the board above it: the word and Give clue on one
  // row, the numbers under them, and the labels for screen readers only (the status line and the
  // placeholder say what to do).
  return (
    <StickyBar fixed refusal={CLUE_ANCHOR} className="max-sm:pt-2">
      <form
        onSubmit={(e) => void submit(e)}
        className="grid grid-cols-[minmax(0,1fr)_auto] gap-1 sm:flex sm:flex-row sm:items-end sm:gap-3"
      >
        <label className="min-w-0 sm:flex-1">
          <span className="text-small font-semibold max-sm:sr-only">Your clue (one word)</span>
          <Input
            ref={input}
            value={word}
            onChange={(e) => setWord(e.target.value)}
            invalid={spaced}
            aria-describedby={spaced ? 'clue-one-word' : undefined}
            maxLength={32}
            placeholder="e.g. Ocean"
            className="text-sub font-semibold uppercase placeholder:font-normal placeholder:normal-case sm:mt-1"
          />
          {spaced && (
            <span id="clue-one-word" role="alert" className="mt-1 block text-small text-danger-ink">
              One word only: try {clue.replace(/\s+/g, '-').toUpperCase()} or a single word.
            </span>
          )}
        </label>
        <fieldset className="col-span-2 row-start-2 min-w-0 lg:shrink-0">
          <legend className="text-small font-semibold max-sm:sr-only">
            How many of your agents does it point to?
          </legend>
          {/* Wide screens: nine full 44 px squares. */}
          <div className="grid grid-cols-5 gap-1 sm:mt-1 sm:grid-cols-9 lg:grid-cols-[repeat(9,2.75rem)]">
            {COUNTS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={count === c}
                disabled={c > max}
                title={c > max ? `Only ${max} left to find` : undefined}
                onClick={() => setCount(c)}
                className={cn(
                  'h-11 min-w-8 rounded-lg text-small font-bold ring-1 transition disabled:cursor-not-allowed disabled:bg-sunk disabled:text-ink-muted disabled:ring-line',
                  count === c
                    ? 'bg-accent text-accent-fg ring-accent'
                    : 'bg-card text-ink ring-line-strong hover:bg-panel',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </fieldset>
        <Button
          type="submit"
          size="lg"
          className="max-sm:h-12 max-sm:min-h-12 max-sm:px-4 max-sm:text-body"
          disabled={!clue || spaced || count === null || busy || count > max}
        >
          {count === null && clue && !spaced ? 'Pick a number' : 'Give clue'}
        </Button>
      </form>
    </StickyBar>
  );
}
