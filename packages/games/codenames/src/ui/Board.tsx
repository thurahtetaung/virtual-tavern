import { cn } from '@vt/ui';
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import type { CodenamesView } from '../logic/types.ts';
import { type Measure, canvasMeasure, estimate, fitSize, fitsAlone, softBreaks } from './fit.ts';
import { KEY_TINT, KIND_CAPTION, KIND_LABEL, REVEALED } from './theme.ts';

interface Props {
  view: CodenamesView;
  /** Card the viewer has picked to guess next. */
  selected: number | null;
  /** Card from the most recent guess, highlighted so everyone sees what was just guessed. */
  lastGuessed: number | null;
  /** Null when the viewer cannot interact with the board right now. */
  onPick: ((index: number) => void) | null;
}

const initials = (name: string) => name.trim().slice(0, 2).toUpperCase();

export function Board({ view, selected, lastGuessed, onPick }: Props) {
  const names = new Map(view.seats.map((s) => [s.id, s.name]));
  const showKey =
    view.me?.role === 'spymaster' && view.me.team !== null && view.phase === 'playing';
  // Word widths in the board's own font, so each word can be sized to fit its card.
  const section = useRef<HTMLElement>(null);
  const [measure, setMeasure] = useState<Measure>(() => estimate);
  useLayoutEffect(() => {
    if (section.current)
      setMeasure(() => canvasMeasure(getComputedStyle(section.current!).fontFamily));
  }, []);
  // The board's width, so each card re-checks which words fit a line once the cards resize.
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = section.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry!.contentRect.width);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <section ref={section} className="grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="Word cards">
      {view.board.map((card, i) => {
        const interactive = onPick !== null && !card.revealed;
        // The kind is printed, not just tinted, whenever the viewer may know it.
        const captioned = card.kind !== null && (card.revealed || showKey || view.phase === 'over');
        const face = card.revealed
          ? REVEALED[card.kind!]
          : card.kind && (showKey || view.phase === 'over')
            ? KEY_TINT[card.kind]
            : 'bg-accent-soft text-stone-900 ring-1 ring-accent-line/80 dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-700';
        const label = `${card.word}${card.kind ? `, ${KIND_LABEL[card.kind]}` : ''}${card.revealed ? ', revealed' : ''}`;
        return (
          <button
            key={i}
            type="button"
            aria-label={label}
            aria-pressed={selected === i}
            disabled={!interactive}
            onClick={() => onPick?.(i)}
            className={cn(
              // Wide cells from lg up, so five rows plus the header fit a 900px desktop window.
              '@container relative flex aspect-[5/4] min-w-0 items-center justify-center rounded-lg px-0.5 py-1 shadow-sm transition sm:aspect-[3/2] sm:rounded-xl sm:p-1 lg:aspect-[2/1] motion-reduce:transition-none',
              face,
              interactive &&
                'cursor-pointer hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-none',
              selected === i && 'ring-4 ring-accent dark:ring-amber-400',
              lastGuessed === i &&
                'z-10 scale-105 ring-4 ring-accent dark:ring-amber-400 ring-offset-2 ring-offset-stone-100 dark:ring-offset-stone-950',
              card.revealed && lastGuessed !== i && 'opacity-90',
              view.phase === 'over' && !card.revealed && 'opacity-70',
            )}
          >
            <CardWord word={card.word} measure={measure} boardWidth={width} captioned={captioned} />
            {captioned && (
              // Capped by the card's width too, so larger browser text can't make it run into the word.
              <span className="absolute inset-x-0 bottom-0.5 text-center text-[length:min(0.55rem,15cqw)] leading-none font-semibold uppercase opacity-90 sm:bottom-1 sm:tracking-wide sm:text-[length:min(0.65rem,9cqw)] lg:text-[length:min(0.65rem,7cqw)]">
                {KIND_CAPTION[card.kind!]}
              </span>
            )}
            {card.revealed && card.kind !== 'assassin' && (
              // Every revealed card gets the same mark, so a guessed bystander never differs from
              // an unguessed one by shade alone.
              <span
                aria-hidden
                className="absolute top-0.5 left-1 text-[length:min(0.75rem,20cqw)] leading-none sm:text-[length:min(0.875rem,13cqw)] lg:text-[length:min(0.875rem,9.5cqw)]"
              >
                ✓
              </span>
            )}
            {card.kind === 'assassin' && captioned && (
              <span
                aria-hidden
                className="absolute top-0.5 left-1 text-[length:min(0.75rem,20cqw)] sm:text-[length:min(0.875rem,13cqw)] lg:text-[length:min(0.875rem,9.5cqw)]"
              >
                ☠
              </span>
            )}
            {card.suggestedBy.length > 0 && (
              <span className="absolute -top-1.5 -right-1 flex gap-0.5">
                {card.suggestedBy.slice(0, 3).map((id) => (
                  <span
                    key={id}
                    title={names.get(id)}
                    className="rounded-full bg-accent dark:bg-amber-500 px-1 text-[0.625rem] font-bold text-accent-fg dark:text-stone-950 shadow sm:text-[0.65rem]"
                  >
                    {initials(names.get(id) ?? '?')}
                  </span>
                ))}
              </span>
            )}
          </button>
        );
      })}
    </section>
  );
}

/**
 * A card's word, sized to fit its card. In a phrase, a long word only gets its soft hyphen when it
 * can't fit on a line by itself at the size it is shown at, read from the rendered line.
 */
function CardWord({
  word,
  measure,
  boardWidth,
  captioned,
}: {
  word: string;
  measure: Measure;
  boardWidth: number;
  /** A caption sits under the word, so the word keeps clear of it (`--cap`). */
  captioned: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [text, setText] = useState(() => softBreaks(word));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const style = getComputedStyle(el);
    const fits = fitsAlone(
      measure,
      parseFloat(style.fontSize),
      el.clientWidth,
      parseFloat(style.letterSpacing) || 0,
    );
    setText(softBreaks(word, el.clientWidth > 0 ? fits : undefined));
  }, [word, measure, boardWidth, captioned]);

  return (
    <span
      ref={ref}
      style={
        {
          '--fit': captioned
            ? `min(${fitSize(word, measure)}, var(--cap))`
            : fitSize(word, measure),
        } as CSSProperties
      }
      className={cn(
        // Two lines centred in the card stay above its caption at each breakpoint's card shape,
        // even with larger browser text.
        captioned &&
          '[--cap:calc(20cqw_-_2.4px)] sm:[--cap:calc(19cqw_-_2.4px)] lg:[--cap:calc(14cqw_-_2.4px)]',
        'line-clamp-3 w-full text-center leading-tight font-bold break-normal hyphens-manual uppercase',
        // Never break or truncate a word players need to read: each size tier is capped at the
        // size that fits the card (`--fit`), so long words shrink instead, and a phrase wraps
        // between its words. Only a word of 11+ letters that is too long for a line of its own
        // even at the smallest size breaks, at its one soft hyphen (`softBreaks`); in a phrase that
        // takes a third line, which only happens at that smallest size, so it fits the card.
        word.length >= 9
          ? 'text-[length:min(0.6rem,var(--fit))] tracking-tight sm:text-[length:min(0.75rem,var(--fit))] sm:tracking-normal md:text-[length:min(0.875rem,var(--fit))]'
          : word.length >= 8
            ? 'text-[length:min(0.625rem,var(--fit))] sm:text-[length:min(0.75rem,var(--fit))] md:text-[length:min(0.875rem,var(--fit))]'
            : 'text-[length:min(0.7rem,var(--fit))] sm:text-[length:min(0.875rem,var(--fit))] sm:tracking-wide md:text-[length:min(1rem,var(--fit))]',
      )}
    >
      {word === text.replaceAll('\u00ad', '') ? text : softBreaks(word)}
    </span>
  );
}
