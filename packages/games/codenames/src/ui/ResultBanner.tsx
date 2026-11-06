import { cn } from '@vt/ui';
import type { CardKind } from '../logic/types.ts';
import type { GuessResult } from './result.ts';

/** The banner's surface: by what the guessed card was, so a miss reads as whose card it hit. */
function tone(result: GuessResult, kind: CardKind | null): string {
  if (result.tone === 'skipped') return 'bg-accent-soft text-accent-text border-accent-line';
  if (result.tone === 'correct') return 'bg-success-soft text-success-ink border-success-line';
  switch (kind) {
    case 'red':
      return 'bg-team-a-soft text-team-a-ink border-team-a-line';
    case 'blue':
      return 'bg-team-b-soft text-team-b-ink border-team-b-line';
    case 'assassin':
      // vt-palette: the assassin card
      return 'bg-[#1C1816] text-[#F3ECE2] border-line-strong';
    default:
      return 'bg-sunk text-ink border-line-strong';
  }
}

/** Big, unmissable outcome of the latest guess or skipped turn, announced to screen readers too. */
export function ResultBanner({ result, kind }: { result: GuessResult; kind: CardKind | null }) {
  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn('rounded-xl border px-4 py-2.5 text-center shadow-vt-1', tone(result, kind))}
    >
      {result.who && <p className="text-small font-medium">{result.who}</p>}
      <p className="text-sub font-extrabold sm:text-heading">{result.headline}</p>
      <p className="mt-0.5 text-small font-semibold sm:text-body">{result.next}</p>
    </div>
  );
}
