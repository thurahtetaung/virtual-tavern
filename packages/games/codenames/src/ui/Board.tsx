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
              // The caption's and the corner mark's sizes are shared with the word (`CardWord`),
              // which keeps clear of them.
              '[--cap-at:0.125rem] [--cap-size:min(0.55rem,15cqw)] [--mark-size:min(0.75rem,20cqw)] sm:[--cap-at:0.25rem] sm:[--cap-size:min(0.65rem,9cqw)] sm:[--mark-size:min(0.875rem,13cqw)] lg:[--cap-size:min(0.65rem,7cqw)] lg:[--mark-size:min(0.875rem,9.5cqw)]',
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
            <CardWord
              word={card.word}
              measure={measure}
              captioned={captioned}
              marked={card.revealed || (card.kind === 'assassin' && captioned)}
            />
            {captioned && (
              // Capped by the card's width too, so larger browser text can't make it run into the word.
              <span className="absolute inset-x-0 bottom-[var(--cap-at)] text-center text-[length:var(--cap-size)] leading-none font-semibold uppercase opacity-90 sm:tracking-wide">
                {KIND_CAPTION[card.kind!]}
              </span>
            )}
            {card.revealed && card.kind !== 'assassin' && (
              // Every revealed card gets the same mark, so a guessed bystander never differs from
              // an unguessed one by shade alone.
              <span
                aria-hidden
                data-card-mark
                className="absolute top-0.5 left-1 text-[length:var(--mark-size)] leading-none"
              >
                ✓
              </span>
            )}
            {card.kind === 'assassin' && captioned && (
              <span
                aria-hidden
                data-card-mark
                className="absolute top-0.5 left-1 text-[length:var(--mark-size)] leading-none"
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

/** The smallest size a word is shown at whole; below it, long words may take their soft hyphen. */
const WHOLE_FLOOR = 6;
/** The smallest size any word is shown at, in px so larger browser text can't push it past the card. */
const FLOOR = 5;

/**
 * Whether every word of `el` sits inside `box` and clear of the card's corner `mark`, read from
 * the rendered glyph boxes (per word, so a space hanging at a line's end never counts).
 */
function clear(el: HTMLElement, box: HTMLElement, mark: Element | null): boolean {
  const text = el.firstChild;
  if (!(text instanceof Text)) return true;
  const b = box.getBoundingClientRect();
  const range = document.createRange();
  // The mark's glyph, which can stand taller than its line.
  let m: DOMRect | undefined;
  if (mark) {
    range.selectNodeContents(mark);
    m = range.getBoundingClientRect();
  }
  for (const run of text.data.matchAll(/\S+/g)) {
    range.setStart(text, run.index);
    range.setEnd(text, run.index + run[0].length);
    for (const r of range.getClientRects()) {
      if (r.width === 0) continue;
      const out =
        r.left < b.left - 0.5 ||
        r.right > b.right + 0.5 ||
        r.top < b.top - 0.5 ||
        r.bottom > b.bottom + 0.5;
      const onMark =
        m && r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top;
      if (out || onMark) return false;
    }
  }
  return true;
}

const markBottom = (mark: Element) => {
  const range = document.createRange();
  range.selectNodeContents(mark);
  return Math.max(range.getBoundingClientRect().bottom, mark.getBoundingClientRect().bottom);
};

/**
 * A card's word, sized to fit its card. CSS gives a first size that fits the card's width on two
 * lines (`fitSize`); the word is then measured where it is shown and shrunk until every line sits
 * inside the card, above its caption and clear of its corner mark, however many lines a phrase
 * takes. A phrase breaks between its words: a long word only takes its soft hyphen when it can't
 * fit a line by itself even at `WHOLE_FLOOR`.
 */
function CardWord({
  word,
  measure,
  captioned,
  marked,
}: {
  word: string;
  measure: Measure;
  /** A caption sits under the word, so the word's box stops above it. */
  captioned: boolean;
  /** A corner mark (✓ or ☠) is shown, which the word keeps clear of. */
  marked: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLSpanElement>(null);
  const [fitted, setFitted] = useState<{ word: string; text: string; size: number | null }>();
  // The box's size, so the word is fitted again whenever the card or the caption resizes.
  const [boxSize, setBoxSize] = useState('');
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setBoxSize(`${entry!.contentRect.width}x${entry!.contentRect.height}`);
    });
    observer.observe(box);
    return () => {
      observer.disconnect();
    };
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    const box = boxRef.current;
    if (!el || !box) return;
    el.style.fontSize = '';
    el.style.lineHeight = '';
    box.style.top = '';
    if (box.clientWidth === 0 || box.clientHeight === 0) {
      // Not laid out (tests): CSS sizing alone.
      el.textContent = softBreaks(word);
      setFitted({ word, text: el.textContent, size: null });
      return;
    }
    const mark = box.parentElement?.querySelector('[data-card-mark]') ?? null;
    const start = parseFloat(getComputedStyle(el).fontSize);
    const sizes: number[] = [];
    for (let size = start; size > FLOOR; size *= 0.93) sizes.push(size);
    sizes.push(FLOOR);
    // In order of preference: whole words (down to `WHOLE_FLOOR`), then long words may take their
    // hyphen, then the lines close up.
    const ways = [
      { hyphens: false, tight: false, floor: WHOLE_FLOOR },
      { hyphens: true, tight: false, floor: FLOOR },
      { hyphens: true, tight: true, floor: FLOOR },
    ];
    const tryAt = (size: number, way: (typeof ways)[number]) => {
      el.style.fontSize = `${size}px`;
      el.style.lineHeight = way.tight ? '1.05' : '';
      el.textContent = way.hyphens
        ? softBreaks(
            word,
            fitsAlone(
              measure,
              size,
              el.clientWidth,
              parseFloat(getComputedStyle(el).letterSpacing) || 0,
            ),
          )
        : word;
      return clear(el, box, mark);
    };
    const fit = () => {
      for (const [rank, way] of ways.entries()) {
        const size = sizes.find((size) => size >= way.floor && tryAt(size, way));
        if (size !== undefined) return { rank, size, top: box.style.top };
      }
      return { rank: ways.length, size: FLOOR, top: box.style.top };
    };
    let best = fit();
    if (mark) {
      // The word may also start below the mark, which suits a long phrase better.
      const card = box.parentElement!.getBoundingClientRect();
      box.style.top = `${Math.ceil(markBottom(mark) - card.top) + 1}px`;
      const lower = fit();
      if (lower.rank < best.rank || (lower.rank === best.rank && lower.size > best.size))
        best = lower;
      // Nothing fits: below the mark at least nothing covers it.
      if (lower.rank === ways.length) best = lower;
    }
    box.style.top = best.top;
    tryAt(best.size, ways[Math.min(best.rank, ways.length - 1)]!);
    const size = best.size === start ? null : best.size;
    if (size === null) el.style.fontSize = '';
    setFitted({ word, text: el.textContent ?? word, size });
  }, [word, measure, captioned, marked, boxSize]);
  const shown = fitted?.word === word ? fitted : undefined;

  return (
    // The word's box: the card's content area, above the caption when there is one.
    <span
      ref={boxRef}
      className={cn(
        'absolute inset-x-0.5 top-1 flex items-center justify-center sm:inset-x-1',
        captioned ? 'bottom-[calc(var(--cap-at)_+_var(--cap-size)_+_2px)]' : 'bottom-1',
      )}
    >
      <span
        ref={ref}
        style={
          {
            '--fit': fitSize(word, measure),
            ...(shown?.size ? { fontSize: `${shown.size}px` } : {}),
          } as CSSProperties
        }
        className={cn(
          'w-full text-center leading-tight font-bold break-normal hyphens-manual uppercase',
          // Each size tier is capped at the size that fits the card's width (`--fit`), so long
          // words shrink instead of breaking; the measured fit above shrinks further when needed.
          word.length >= 9
            ? 'text-[length:min(0.6rem,var(--fit))] tracking-tight sm:text-[length:min(0.75rem,var(--fit))] sm:tracking-normal md:text-[length:min(0.875rem,var(--fit))]'
            : word.length >= 8
              ? 'text-[length:min(0.625rem,var(--fit))] sm:text-[length:min(0.75rem,var(--fit))] md:text-[length:min(0.875rem,var(--fit))]'
              : 'text-[length:min(0.7rem,var(--fit))] sm:text-[length:min(0.875rem,var(--fit))] sm:tracking-wide md:text-[length:min(1rem,var(--fit))]',
        )}
      >
        {shown?.text ?? softBreaks(word)}
      </span>
    </span>
  );
}
