import { cn } from '@vt/ui';
import type { GameView, PsychicView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Card } from './Card.tsx';
import { type LookCard, useLook } from './Look.tsx';
import { pastGuesses, roman } from './status.ts';

/**
 * A psychic's judged guesses in order (✗ wrong, ✓ the one that was right, with the hour), each
 * card opening full screen. `compact` is the one-line strip for a psychic's row.
 */
export function PastGuesses({
  g,
  p,
  content,
  compact,
}: {
  g: GameView;
  p: PsychicView;
  content: Content;
  compact?: boolean;
}) {
  const { look, viewer } = useLook(content);
  const list = pastGuesses(g, p.color);
  if (!list.length)
    return compact ? null : <p className="text-sm text-ink-muted">No guesses judged yet.</p>;
  const cards = list.flatMap((x): LookCard[] =>
    x.card === null
      ? []
      : [
          {
            kind: x.pillar,
            n: x.card,
            caption: `${p.name}, hour ${roman(x.hour)}: ${x.correct ? 'right' : 'wrong'}`,
          },
        ],
  );
  const at = list.map((x, i) =>
    x.card === null ? -1 : list.slice(0, i).filter((y) => y.card !== null).length,
  );
  return (
    <div className="space-y-0.5">
      {viewer}
      <p className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
        Past guesses
      </p>
      <ul
        tabIndex={0}
        aria-label={`${p.name}’s past guesses`}
        className="flex items-end gap-1 overflow-x-auto pb-0.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500"
      >
        {list.map((x, i) => {
          const label = `hour ${roman(x.hour)}, ${x.correct ? 'right' : 'wrong'}`;
          return (
            <li
              key={`${x.hour}-${i}`}
              className={cn(
                'shrink-0 space-y-0.5 text-center',
                compact ? 'w-14 sm:w-16' : 'w-24 sm:w-28',
                i > 0 && list[i - 1]!.pillar !== x.pillar && 'ml-2',
              )}
            >
              {x.card === null ? (
                <div
                  role="img"
                  aria-label={`No ${content.pillarName(x.pillar).toLowerCase()} guess, ${label}`}
                  className="flex aspect-[1024/700] items-center justify-center rounded-lg border border-dashed border-stone-300 text-xs text-ink-muted dark:border-stone-700"
                >
                  {content.pillarIcon(x.pillar)} —
                </div>
              ) : (
                <Card
                  kind={x.pillar}
                  n={x.card}
                  content={content}
                  note={label}
                  dimmed={!x.correct}
                  onTap={() => look(cards, at[i], `${p.name}’s past guesses`)}
                  className={
                    x.correct
                      ? 'ring-2 ring-success dark:ring-emerald-500'
                      : 'ring-1 ring-danger dark:ring-rose-500'
                  }
                >
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-0.5 right-0.5 rounded px-0.5 text-[10px] leading-tight font-black text-white',
                      x.correct ? 'bg-success dark:bg-emerald-700' : 'bg-danger dark:bg-rose-700',
                    )}
                  >
                    {x.correct ? '✓' : '✗'}
                  </span>
                </Card>
              )}
              <p className="text-[10px] leading-none text-ink-muted">{roman(x.hour)}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
