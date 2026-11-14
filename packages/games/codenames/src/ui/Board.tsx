import { Icon, cn, useFreeHeight } from '@vt/ui';
import { type CSSProperties, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CodenamesView } from '../logic/types.ts';
import { type Measure, canvasMeasure, estimate, fitSize, fitsAlone, softBreaks } from './fit.ts';
import { FACE_DOWN, KEY_TINT, KIND_CAPTION, KIND_LABEL, REVEALED } from './theme.ts';

interface Props {
  view: CodenamesView;
  /** Card the viewer has picked to guess next. */
  selected: number | null;
  /** Card from the most recent guess, highlighted so everyone sees what was just guessed. */
  lastGuessed: number | null;
  /** Null when the viewer cannot interact with the board right now. */
  onPick: ((index: number) => void) | null;
  /**
   * Phones: `fill` grows the cells into the height a waiting screen leaves free (no clue form or
   * guess bar under the board); `short` keeps the whole key above the end's tab bar (a rem height, so larger text still fits).
   */
  size?: 'fill' | 'short';
}

const initials = (name: string) => name.trim().slice(0, 2).toUpperCase();

/** Tailwind's `lg`: from here up the board's rows are sized to the window. */
const WIDE = '(min-width: 1024px)';
const useWide = () =>
  useSyncExternalStore(
    (on) => {
      const q = window.matchMedia(WIDE);
      q.addEventListener('change', on);
      return () => q.removeEventListener('change', on);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );

/** Wide screens: five rows and their 8 px gaps share the height left down to the bars. */
export function rowHeight(free: number, tallest: number) {
  return Math.round(Math.min(tallest, Math.max(40, (free - 4 * 8) / 5)));
}

/**
 * How much of the column follows the board, in px: down to the foot of its last part in the
 * column's flow. A fixed part (the phone's bar at the foot of the window) sits outside it.
 */
export function belowBoard(parts: { bottom: number; fixed: boolean }[], boardBottom: number) {
  const last = parts.filter((part) => !part.fixed).at(-1);
  return last ? Math.max(0, Math.ceil(last.bottom - boardBottom)) : 0;
}

export function Board({ view, selected, lastGuessed, onPick, size }: Props) {
  const names = new Map(view.seats.map((s) => [s.id, s.name]));
  const showKey =
    view.me?.role === 'spymaster' && view.me.team !== null && view.phase === 'playing';
  // Word widths in the board's own font, so each word can be sized to fit its card.
  const section = useRef<HTMLElement>(null);
  // From lg up the five rows take exactly the height left between what sits above the board (a
  // result line, the playtest bar) and what follows it in its column (the clue form) or the bar at
  // the foot, so the whole board, the Spymaster's key included, is in view with no scroll: down to
  // 40 px rows on a short laptop window (at the default text size; larger text keeps a rem floor).
  const root = useRef<HTMLDivElement>(null);
  const wide = useWide();
  const free = useFreeHeight(root, wide);
  const [after, setAfter] = useState(0);
  useLayoutEffect(() => {
    const el = root.current;
    const column = el?.parentElement;
    if (!wide || !el || !column) return;
    // What follows the board in its own column (never the side rail beside it).
    const measure = () => {
      const parts = [...column.children]
        .filter((child) => child !== el)
        .map((child) => ({
          bottom: child.getBoundingClientRect().bottom,
          fixed: getComputedStyle(child).position === 'fixed',
        }));
      const next = belowBoard(parts, el.getBoundingClientRect().bottom);
      setAfter((a) => (a === next ? a : next));
    };
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    const watch = () => {
      sizes?.disconnect();
      for (const child of column.children) if (child !== el) sizes?.observe(child);
      measure();
    };
    watch();
    // The column's parts can change without the board rendering again: on a window turning wide,
    // the bar at the foot moves from the phone's fixed bar into the column a moment later, and
    // measured before that the board kept the fixed bar's room and squashed its rows.
    const parts = new MutationObserver(watch);
    parts.observe(column, { childList: true });
    return () => {
      sizes?.disconnect();
      parts.disconnect();
    };
  });
  const rows = free === null ? null : rowHeight(free - after, size === 'fill' ? 144 : 120);
  const [measure, setMeasure] = useState<Measure>(() => estimate);
  useLayoutEffect(() => {
    if (section.current)
      setMeasure(() => canvasMeasure(getComputedStyle(section.current!).fontFamily));
  }, []);
  const legend = view.board.some(
    (card) => card.kind !== null && (card.revealed || showKey || view.phase === 'over'),
  );
  return (
    <div ref={root}>
      <section
        ref={section}
        className="grid grid-cols-5 gap-1.5 sm:gap-2"
        aria-label="Word cards"
        style={rows === null ? undefined : ({ '--row-h': `${rows}px` } as CSSProperties)}
      >
        {view.board.map((card, i) => {
          const interactive = onPick !== null && !card.revealed;
          // The kind is printed, not just tinted, whenever the viewer may know it.
          const captioned =
            card.kind !== null && (card.revealed || showKey || view.phase === 'over');
          const face = card.revealed
            ? REVEALED[card.kind!]
            : card.kind && (showKey || view.phase === 'over')
              ? KEY_TINT[card.kind]
              : FACE_DOWN;
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
                // From lg up the cells take the window's height left for five rows (the clue form and
                // its refusal still fit a 900 px desktop window), up to 7.5rem on tall screens.
                // The caption's and the corner mark's sizes are shared with the word (`CardWord`),
                // which keeps clear of them.
                // Phones show no caption (the legend under the board says what each colour is). The
                // caption and the mark are capped by the card's width, so larger browser text can't
                // push them into the word, and are never under 12 px.
                '[--cap-at:0px] [--cap-size:0px] [--mark-size:max(12px,min(0.75rem,20cqw))] sm:[--cap-at:0.25rem] sm:[--cap-size:max(12px,min(0.75rem,9cqw))] sm:[--mark-size:max(12px,min(0.875rem,13cqw))] lg:[--cap-size:clamp(12px,9cqw,16px)] lg:[--mark-size:max(12px,min(0.875rem,9.5cqw))]',
                '@container relative flex aspect-[5/4] min-w-0 items-center justify-center rounded-lg px-0.5 py-1 shadow-vt-1 transition sm:aspect-[3/2] sm:p-1 lg:aspect-auto lg:h-[clamp(4.5rem,calc((100dvh-30rem)/5-0.5rem),7.5rem)] motion-reduce:transition-none',
                // Nothing to type or press under the board: the cells take that room too, on
                // phones and on wide screens (about a quarter taller at 1440×900).
                size === 'fill' &&
                  'max-sm:aspect-auto max-sm:h-[clamp(3.3rem,calc((100dvh-22rem)/5-0.4rem),5.5rem)] lg:h-[clamp(4.5rem,calc((100dvh-23rem)/5-0.5rem),9rem)]',
                // A face-down card has a printed frame inside its edge, like the cards on a table.
                face === FACE_DOWN &&
                  'sm:before:pointer-events-none sm:before:absolute sm:before:inset-1 sm:before:rounded-md sm:before:border sm:before:border-line',
                // In rem, so a larger text size grows the cards with their words.
                size === 'short' && 'max-sm:aspect-auto max-sm:h-[2.8rem]',
                face,
                interactive &&
                  'cursor-pointer hover:-translate-y-0.5 hover:shadow-vt-2 motion-reduce:hover:translate-none',
                // The selection rule: a 3 px accent ring, 2 px out.
                selected === i && 'z-10 ring-[3px] ring-accent ring-offset-2 ring-offset-page',
                lastGuessed === i &&
                  'z-10 scale-105 ring-[3px] ring-accent ring-offset-2 ring-offset-page',
                card.revealed && lastGuessed !== i && 'opacity-90',
                // The fitted rows, but never under the 4.5rem floor once the browser's text is larger
                // than its default (the min() is 0 at 16 px and the floor above it), so long phrases
                // still fit their cards at 150% text; at the default size the rows fit the window.
                rows !== null && 'lg:h-[max(var(--row-h),min(4.5rem,calc((1rem_-_16px)*1000)))]!',
                // At the end the cards nobody guessed keep their words at full strength: their soft
                // key tint and the missing check mark already tell them from the guessed ones.
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
                <span className="absolute inset-x-0 bottom-[var(--cap-at)] text-center text-[length:var(--cap-size)] leading-none font-semibold uppercase max-sm:hidden sm:tracking-wide">
                  {KIND_CAPTION[card.kind!]}
                </span>
              )}
              {card.revealed && card.kind !== 'assassin' && (
                // Every revealed card gets the same mark, so a guessed bystander never differs from
                // an unguessed one by shade alone.
                <span
                  aria-hidden
                  data-card-mark
                  className="absolute top-0.5 left-0.5 leading-none sm:left-1"
                >
                  <Icon name="check" className="size-[var(--mark-size)]" />
                </span>
              )}
              {card.kind === 'assassin' && captioned && (
                <span
                  aria-hidden
                  data-card-mark
                  className="absolute top-0.5 left-0.5 leading-none sm:left-1"
                >
                  <Icon name="skull" className="size-[calc(var(--mark-size)*1.4)]" />
                </span>
              )}
              {card.suggestedBy.length > 0 && (
                <span className="absolute -top-1.5 -right-1 flex gap-0.5">
                  {card.suggestedBy.slice(0, 3).map((id) => (
                    <span
                      key={id}
                      title={names.get(id)}
                      className="rounded-full bg-accent px-1 text-caption leading-tight font-bold text-accent-fg shadow-vt-1"
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
      {legend && <Legend />}
    </div>
  );
}

/** Phones: what each card colour means, in place of the captions the cells have no room for. */
function Legend() {
  const swatch = (face: string, label: string) => (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className={cn('size-3 rounded-sm', face)} />
      {label}
    </span>
  );
  return (
    <p
      data-testid="board-legend"
      className="mt-1.5 flex flex-wrap justify-center gap-x-3 text-caption text-ink-muted sm:hidden"
    >
      {swatch(REVEALED.red, KIND_LABEL.red)}
      {swatch(REVEALED.blue, KIND_LABEL.blue)}
      {swatch(REVEALED.bystander, KIND_LABEL.bystander)}
      {swatch(REVEALED.assassin, KIND_LABEL.assassin)}
    </p>
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
      const text = way.hyphens
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
      // New text costs a layout of its own many times a font size's (a game's end refits all 25
      // words at once, and setting the same text on every try took seconds), so only when it
      // changes.
      if (el.textContent !== text) el.textContent = text;
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
            ? 'text-[length:min(0.75rem,var(--fit))] tracking-tight sm:tracking-normal md:text-[length:min(0.875rem,var(--fit))] lg:text-[length:min(1.125rem,var(--fit))]'
            : word.length >= 8
              ? 'text-[length:min(0.75rem,var(--fit))] md:text-[length:min(0.875rem,var(--fit))] lg:text-[length:min(1.125rem,var(--fit))]'
              : 'text-[length:min(0.75rem,var(--fit))] sm:text-[length:min(0.875rem,var(--fit))] sm:tracking-wide md:text-[length:min(1rem,var(--fit))] lg:text-[length:min(1.25rem,var(--fit))]',
        )}
      >
        {shown?.text ?? softBreaks(word)}
      </span>
    </span>
  );
}
