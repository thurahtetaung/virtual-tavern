import { cn } from '@vt/ui';
import type { InquestView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { nameOf } from './status.ts';

/**
 * The final accusations, one line per accuser in turn order: their accusation and its verdict as
 * soon as it's made, a skipped turn, who is accusing now and who is still to come. All public.
 */
export function FinalList({
  view,
  content,
  big = false,
}: {
  view: InquestView;
  content: Content;
  big?: boolean;
}) {
  const g = view.game!;
  const f = g.final;
  if (!f) return null;
  return (
    <ol className={cn('space-y-0.5', big ? 'text-base' : 'text-sm')} aria-label="Final accusations">
      {f.order.map((id, i) => {
        const a = g.attempts.find((x) => x.final && x.by === id);
        const now = g.stage === 'final' && i === f.index;
        const name = id === view.me?.id ? 'You' : nameOf(view, id);
        return (
          <li key={id} className={cn(now && 'font-semibold text-amber-700 dark:text-amber-400')}>
            {a ? (
              <>
                {a.correct ? '✅' : '❌'} <b>{name}</b> accused {nameOf(view, a.target)}’s{' '}
                {content.cardName('clue', a.clue)} + {content.cardName('means', a.means)}
              </>
            ) : f.skipped.includes(id) ? (
              <span className="text-stone-500">
                ⏭ <b>{name}</b>: turn skipped
              </span>
            ) : now ? (
              <>
                ⚖️ <b>{name}</b> {id === view.me?.id ? 'are' : 'is'} accusing…
              </>
            ) : (
              <span className="text-stone-500">
                ⏳ <b>{name}</b>
                {g.stage === 'final' ? '' : ': no turn'}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
