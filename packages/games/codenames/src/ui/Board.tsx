import { cn } from '@vt/ui';
import type { CodenamesView } from '../logic/types.ts';
import { KEY_TINT, KIND_LABEL, REVEALED } from './theme.ts';

interface Props {
  view: CodenamesView;
  /** Card the viewer has picked to reveal next. */
  selected: number | null;
  /** Null when the viewer cannot interact with the board right now. */
  onPick: ((index: number) => void) | null;
}

const initials = (name: string) => name.trim().slice(0, 2).toUpperCase();

export function Board({ view, selected, onPick }: Props) {
  const names = new Map(view.seats.map((s) => [s.id, s.name]));
  const showKey =
    view.me?.role === 'spymaster' && view.me.team !== null && view.phase === 'playing';

  return (
    <div className="grid grid-cols-5 gap-1.5 sm:gap-2" role="grid" aria-label="Word cards">
      {view.board.map((card, i) => {
        const interactive = onPick !== null && !card.revealed;
        const face = card.revealed
          ? REVEALED[card.kind!]
          : card.kind && (showKey || view.phase === 'over')
            ? KEY_TINT[card.kind]
            : 'bg-amber-50 text-stone-900 ring-1 ring-amber-200/80 dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-700';
        const label = `${card.word}${card.kind ? `, ${KIND_LABEL[card.kind]}` : ''}${card.revealed ? ', revealed' : ''}`;
        return (
          <button
            key={i}
            type="button"
            role="gridcell"
            aria-label={label}
            aria-pressed={selected === i}
            disabled={!interactive}
            onClick={() => onPick?.(i)}
            className={cn(
              'relative flex aspect-[4/3] min-w-0 items-center justify-center rounded-lg p-1 shadow-sm transition sm:aspect-[3/2] sm:rounded-xl',
              face,
              interactive && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md',
              selected === i && 'ring-4 ring-amber-500 dark:ring-amber-400',
              card.revealed && 'opacity-90',
              view.phase === 'over' && !card.revealed && 'opacity-70',
            )}
          >
            <span
              className={cn(
                'line-clamp-2 w-full text-center leading-tight font-bold uppercase [overflow-wrap:anywhere]',
                // Never truncate a word players need to read; shrink long ones instead.
                card.word.length > 9
                  ? 'text-[0.5rem] sm:text-xs md:text-sm'
                  : 'text-[0.6rem] tracking-wide sm:text-sm md:text-base',
                card.revealed && card.kind !== 'bystander' && 'line-through decoration-2',
              )}
            >
              {card.word}
            </span>
            {card.kind === 'assassin' && (showKey || card.revealed || view.phase === 'over') && (
              <span aria-hidden className="absolute top-0.5 left-1 text-xs sm:text-sm">
                ☠
              </span>
            )}
            {card.suggestedBy.length > 0 && (
              <span className="absolute -top-1.5 -right-1 flex gap-0.5">
                {card.suggestedBy.slice(0, 3).map((id) => (
                  <span
                    key={id}
                    title={names.get(id)}
                    className="rounded-full bg-amber-500 px-1 text-[0.55rem] font-bold text-stone-950 shadow sm:text-[0.65rem]"
                  >
                    {initials(names.get(id) ?? '?')}
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
