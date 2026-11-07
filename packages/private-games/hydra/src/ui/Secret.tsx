import { Button, Peek, cn } from '@vt/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { Policy } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { FlipCard, PolicyBack, PolicyFace } from './Cards.tsx';
import { playSfx, prefersReducedMotion, useLyingFlat } from './fx.ts';

/**
 * A secret action: full screen on a phone, a centred card on a desktop. Closing it never loses
 * anything: the action dock opens it again, and a reload lands back on it.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
  tone = 'neutral',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  tone?: 'neutral' | 'red' | 'blue';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'hy-rise flex w-full flex-col overflow-hidden bg-panel text-ink shadow-2xl outline-none sm:max-w-lg sm:rounded-3xl',
          tone === 'red' && 'sm:ring-2 sm:ring-red-500/50',
          tone === 'blue' && 'sm:ring-2 sm:ring-sky-500/50',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex min-h-full flex-col justify-center">{children}</div>
        </div>
        {footer && (
          <div className="border-t border-line px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Cards behind the shared peek: face down until you hold them (or switch them on), and hidden
 * again whenever the phone lies flat on the table.
 */
export function SecretHand({
  cards,
  c,
  selected,
  onSelect,
  verb,
  shuffleKey,
  testId,
}: {
  cards: readonly Policy[];
  c: Content;
  selected?: number | null;
  onSelect?: (i: number) => void;
  /** "Discard", "Enact": the card buttons' labels. */
  verb?: string;
  /** Plays the shuffle once for each new key (the Chancellor's two cards). */
  shuffleKey?: string;
  testId?: string;
}) {
  const flat = useLyingFlat(true);
  const [shuffling, setShuffling] = useState<string | null>(null);
  const played = useRef<string | null>(null);
  useEffect(() => {
    if (!shuffleKey || played.current === shuffleKey) return;
    played.current = shuffleKey;
    setShuffling(shuffleKey);
    playSfx('card');
    const t = window.setTimeout(() => setShuffling(null), prefersReducedMotion() ? 250 : 650);
    return () => {
      window.clearTimeout(t);
    };
  }, [shuffleKey]);
  const row = cn(
    'mx-auto flex justify-center gap-3 pt-4',
    cards.length === 3 ? 'max-w-sm' : 'max-w-[16rem]',
  );
  const animOf = (i: number) =>
    shuffling !== null && cards.length === 2 ? (i === 0 ? 'hy-swap-a' : 'hy-swap-b') : '';
  return (
    <div className="space-y-3" data-testid={testId}>
      {shuffleKey && (
        <p className="text-center text-xs font-semibold text-ink-muted">
          {c.copy('hand.shuffled')}
        </p>
      )}
      <Peek
        what="cards"
        blocked={flat && 'Hidden while your phone lies flat: pick it up to look.'}
        onReveal={() => playSfx('flip')}
        cover={
          <span className={row}>
            {cards.map((_, i) => (
              <span key={i} className={cn('relative block min-w-0 flex-1 rounded-xl', animOf(i))}>
                <PolicyBack c={c} />
              </span>
            ))}
          </span>
        }
      >
        <div className={row}>
          {cards.map((card, i) => {
            const isSel = selected === i;
            const up = shuffling === null;
            return (
              <button
                key={i}
                type="button"
                disabled={!onSelect}
                onClick={() => onSelect?.(i)}
                aria-pressed={onSelect ? isSel : undefined}
                aria-label={
                  up
                    ? `${verb ? `${verb}: ` : ''}${c.t(`${c.policyName(card)} {policy}`)} (card ${i + 1})`
                    : `Card ${i + 1} (face down)`
                }
                className={cn(
                  'relative min-w-0 flex-1 rounded-xl transition-transform focus-visible:outline-2 focus-visible:outline-accent',
                  isSel && '-translate-y-2 ring-4 ring-accent',
                  onSelect && 'cursor-pointer',
                  animOf(i),
                )}
              >
                <FlipCard
                  up={up}
                  front={<PolicyFace policy={card} c={c} />}
                  back={<PolicyBack c={c} />}
                />
                {isSel && (
                  <span className="hy-pop absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-line px-2 text-xs font-black text-ink uppercase shadow">
                    {verb ?? 'Picked'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Peek>
    </div>
  );
}
