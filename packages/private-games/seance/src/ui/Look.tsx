import { CardViewer, type ViewerItem, cn } from '@vt/ui';
import { type ReactNode, useCallback, useState } from 'react';
import type { Kind } from '../logic/cards.ts';
import type { Content } from './assets.ts';
import { Card, CardPlaceholder } from './Card.tsx';

/** One card to look at, with an optional caption ("from hour II", "Ana’s guess"). */
export interface LookCard {
  kind: Kind;
  n: number;
  caption?: string;
}

export const lookItem = (content: Content, c: LookCard): ViewerItem => ({
  key: `${c.kind}-${c.n}`,
  label: content.cardLabel(c.kind, c.n),
  caption: c.caption,
  aspect: c.kind === 'vision' ? 700 / 1024 : 1024 / 700,
  src: content.cardArt(c.kind, c.n, false),
  fallback: <CardPlaceholder kind={c.kind} n={c.n} big />,
});

/** Same kind for every card of a row. */
export const cardsOf = (kind: Kind, cards: readonly number[], captions?: Record<number, string>) =>
  cards.map((n): LookCard => ({ kind, n, caption: captions?.[n] }));

/**
 * The full-screen viewer for one group of cards. `look(cards, start)` opens it; render `viewer`
 * somewhere in the component. `actions` (a Pick toggle) is drawn under the card shown, from the
 * current render, so it always reflects the latest state.
 */
export function useLook(content: Content, actions?: (card: LookCard) => ReactNode) {
  const [open, setOpen] = useState<{
    cards: readonly LookCard[];
    start: number;
    title: string;
  } | null>(null);
  const look = useCallback(
    (cards: readonly LookCard[], start = 0, title = 'Cards') => setOpen({ cards, start, title }),
    [],
  );
  const close = useCallback(() => setOpen(null), []);
  const viewer = open && (
    <CardViewer
      items={open.cards.map((c) => lookItem(content, c))}
      start={open.start}
      title={open.title}
      onClose={close}
      actions={actions ? (i) => open.cards[i] && actions(open.cards[i]) : undefined}
    />
  );
  return { look, viewer };
}

/**
 * The pick control beside a card: picking is always this button, never a tap on the card (which
 * opens it full screen). `data-pick` names the card for tests.
 */
export function PickButton({
  kind,
  n,
  on,
  onToggle,
  label,
  onLabel,
  disabled,
  className,
  big,
}: {
  kind: Kind;
  n: number;
  on: boolean;
  onToggle: () => void;
  /** "Pick", "Guess", "Throw away". */
  label: string;
  /** Shown while picked: "✓ Picked". */
  onLabel: string;
  disabled?: boolean;
  className?: string;
  /** A full-size button (in the viewer) rather than a pill on the card. */
  big?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={`${on ? onLabel : label}: ${kind === 'vision' ? 'vision' : kind} ${n}`}
      data-pick={`${kind}-${n}`}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'rounded-full font-bold shadow-lg ring-1 touch-manipulation disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500',
        big ? 'min-h-12 px-6 text-base' : 'min-h-10 px-3 text-sm',
        on
          ? 'bg-accent-line text-stone-950 ring-black/20 dark:bg-amber-400'
          : 'bg-black/70 text-white ring-white/30',
        className,
      )}
    >
      {on ? onLabel : label}
    </button>
  );
}

/** A card you tap to look at, with its Pick pill in the corner (a sibling, not inside the card). */
export function PickableCard({
  kind,
  n,
  content,
  onLook,
  pick,
  note,
  fill,
  className,
  children,
}: {
  kind: Kind;
  n: number;
  content: Content;
  onLook: () => void;
  pick?: {
    on: boolean;
    onToggle: () => void;
    label: string;
    onLabel: string;
    disabled?: boolean;
    dimmed?: boolean;
  };
  note?: string;
  fill?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={cn('relative', fill && 'size-full', className)}>
      <Card
        kind={kind}
        n={n}
        content={content}
        selected={pick?.on}
        dimmed={pick?.dimmed}
        note={note}
        onTap={onLook}
        look
        fill={fill}
      >
        {children}
      </Card>
      {pick && (
        <PickButton
          kind={kind}
          n={n}
          on={pick.on}
          onToggle={pick.onToggle}
          label={pick.label}
          onLabel={pick.onLabel}
          disabled={pick.disabled}
          className="absolute right-1.5 bottom-1.5"
        />
      )}
    </div>
  );
}
