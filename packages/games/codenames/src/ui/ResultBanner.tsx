import { cn } from '@vt/ui';
import type { GuessResult, ResultTone } from './result.ts';

const TONE: Record<ResultTone, string> = {
  correct: 'bg-success dark:bg-emerald-600 text-white ring-success dark:ring-emerald-700',
  wrong: 'bg-team-a dark:bg-rose-600 text-white ring-team-a dark:ring-rose-700',
  assassin: 'bg-stone-950 text-stone-100 ring-black dark:ring-stone-600',
  skipped:
    'bg-accent dark:bg-amber-500 text-accent-fg dark:text-stone-950 ring-accent dark:ring-amber-600',
};

/** Big, unmissable outcome of the latest guess or skipped turn, announced to screen readers too. */
export function ResultBanner({ result }: { result: GuessResult }) {
  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn('rounded-2xl px-4 py-3 text-center shadow-md ring-2', TONE[result.tone])}
    >
      {result.who && <p className="text-sm font-medium opacity-90">{result.who}</p>}
      <p className="text-xl font-extrabold sm:text-2xl">{result.headline}</p>
      <p className="mt-0.5 font-semibold">{result.next}</p>
    </div>
  );
}
