import { Button, cn } from '@vt/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Kind } from '../logic/cards.ts';
import type { Content } from './assets.ts';
import { Card } from './Card.tsx';

export interface CardRow {
  kind: Kind;
  /** Per-card kinds, for a row that mixes them (a line-up group). */
  kinds?: readonly Kind[];
  cards: readonly number[];
  /** A caption per card ("from hour II", "Ana’s guess"). */
  captions?: Readonly<Record<number, string>>;
}

/**
 * The split compare view, full screen: cards to read pinned at the top (swipe between them), and
 * the cards to choose from in a swipeable strip below, with the action at the bottom. Psychics
 * pin their vision over the candidates; the ghost pins a psychic's target over their hand. With
 * no strip it is simply a big card viewer.
 */
export function Compare({
  title,
  pinned,
  pinnedLabel,
  strip,
  stripLabel,
  selected = [],
  onToggle,
  footer,
  content,
  onClose,
  start = 0,
}: {
  title: string;
  pinned: CardRow;
  pinnedLabel?: string;
  strip?: CardRow | null;
  stripLabel?: string;
  selected?: readonly number[];
  onToggle?: (card: number) => void;
  footer?: ReactNode;
  content: Content;
  onClose: () => void;
  /** The pinned card to open on. */
  start?: number;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(start);
  const count = pinned.cards.length;

  useEffect(() => {
    const el = pane.current;
    if (el) el.scrollLeft = start * el.clientWidth;
  }, [start]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const go = (i: number) => {
    const el = pane.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex h-dvh flex-col bg-stone-950 text-stone-100"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/10 px-2">
        <h2 className="min-w-0 flex-1 truncate pl-2 font-semibold">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          className="text-stone-100 hover:bg-white/10"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </Button>
      </div>
      <section aria-label={pinnedLabel ?? 'Pinned cards'} className="relative min-h-0 flex-1">
        <div
          ref={pane}
          onScroll={(e) => {
            const el = e.currentTarget;
            setAt(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
          }}
          className="flex size-full snap-x snap-mandatory overflow-x-auto overscroll-contain [scrollbar-width:none]"
        >
          {pinned.cards.map((n, i) => (
            <div
              key={`${n}-${i}`}
              className="flex h-full w-full shrink-0 snap-center flex-col items-center gap-1 p-2"
            >
              <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                <div
                  className={cn(
                    'max-h-full max-w-full',
                    (pinned.kinds?.[i] ?? pinned.kind) === 'vision'
                      ? 'aspect-[700/1024] h-full'
                      : 'aspect-[1024/700] w-full max-w-3xl',
                  )}
                >
                  <Card
                    kind={pinned.kinds?.[i] ?? pinned.kind}
                    n={n}
                    content={content}
                    size="big"
                    fill
                  />
                </div>
              </div>
              {pinned.captions?.[n] && (
                <p className="text-xs text-stone-400">{pinned.captions[n]}</p>
              )}
            </div>
          ))}
        </div>
        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous pinned card"
              disabled={at <= 0}
              onClick={() => go(at - 1)}
              className="absolute top-1/2 left-1 hidden size-10 -translate-y-1/2 rounded-full bg-black/50 text-xl disabled:opacity-20 sm:block"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next pinned card"
              disabled={at >= count - 1}
              onClick={() => go(at + 1)}
              className="absolute top-1/2 right-1 hidden size-10 -translate-y-1/2 rounded-full bg-black/50 text-xl disabled:opacity-20 sm:block"
            >
              ›
            </button>
            <p className="absolute top-2 right-3 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold">
              {Math.min(at, count - 1) + 1} / {count}
            </p>
          </>
        )}
      </section>
      {strip && (
        <section
          aria-label={stripLabel ?? 'Choose'}
          className="flex h-[36%] shrink-0 flex-col border-t border-white/10 bg-stone-900"
        >
          {stripLabel && (
            <p className="px-3 pt-1.5 text-xs font-semibold tracking-wide text-stone-400 uppercase">
              {stripLabel}
            </p>
          )}
          <ul className="flex min-h-0 flex-1 snap-x gap-2 overflow-x-auto overscroll-contain px-3 py-2">
            {strip.cards.map((n) => (
              <li
                key={n}
                className={cn(
                  'flex h-full shrink-0 snap-center flex-col gap-0.5',
                  strip.kind === 'vision' ? 'aspect-[700/1100]' : 'aspect-[1024/800]',
                )}
              >
                <Card
                  kind={strip.kind}
                  n={n}
                  content={content}
                  selected={selected.includes(n)}
                  onTap={onToggle ? () => onToggle(n) : undefined}
                  fill
                  className="min-h-0 flex-1"
                >
                  {selected.includes(n) && (
                    <span className="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full bg-accent-line dark:bg-amber-400 font-black text-stone-950 shadow">
                      ✓
                    </span>
                  )}
                </Card>
                {strip.captions?.[n] && (
                  <p className="truncate text-center text-[11px] text-stone-400">
                    {strip.captions[n]}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {footer && (
        <div className="shrink-0 border-t border-white/10 bg-stone-950 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {footer}
        </div>
      )}
    </div>
  );
}
