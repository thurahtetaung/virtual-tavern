import { ProtectedImage, cn } from '@vt/ui';
import { Fragment, type ReactNode } from 'react';
import { type CardId, type Suit, suitOf, valueOf } from '../logic/cards.ts';
import { useArt } from './assets.tsx';

/**
 * Each suit has its own shape as well as its own colour (a colour-blind-safe set), so a card
 * never relies on colour alone.
 */
export const SUIT_LOOK: Record<Suit, { symbol: string; color: string; name: string }> = {
  p: { symbol: '◆', color: '#c4558f', name: 'pink' },
  b: { symbol: '●', color: '#1f6fb2', name: 'blue' },
  g: { symbol: '▲', color: '#0f8a68', name: 'green' },
  y: { symbol: '★', color: '#c47f00', name: 'yellow' },
  t: { symbol: '⬢', color: '#4a4a55', name: 'trump' },
};

/** "pink 3", "trump 4" (with the theme's word for trumps). */
export function cardName(c: CardId, trump: string): string {
  const s = suitOf(c);
  return `${s === 't' ? trump : SUIT_LOOK[s].name} ${valueOf(c)}`;
}

/** A card in running text: its symbol and value in the suit's colour. */
export function CardChip({ card, className }: { card: CardId; className?: string }) {
  const { names } = useArt();
  const look = SUIT_LOOK[suitOf(card)];
  return (
    <span
      role="img"
      aria-label={cardName(card, names.trump)}
      className={cn(
        'inline-flex items-baseline gap-0.5 rounded-md bg-card px-1 font-bold tabular-nums ring-1 ring-line dark:bg-stone-100',
        className,
      )}
      style={{ color: look.color }}
    >
      <span aria-hidden>{look.symbol}</span>
      <span aria-hidden>{valueOf(card)}</span>
    </span>
  );
}

export type CardState = 'normal' | 'legal' | 'dim' | 'selected' | 'queued' | 'signalled';

const SIZE = {
  xs: 'h-11 w-8 text-sm',
  sm: 'h-16 w-11 text-base',
  md: 'h-20 w-14 text-xl',
  lg: 'h-28 w-20 text-2xl',
  /** The hand: phone size, bigger on wide screens. */
  hand: 'h-20 w-14 text-xl lg:h-28 lg:w-20 lg:text-2xl',
} as const;

/** A playing card's face: art from the manifest when there is some, else its symbol and value. */
export function CardFace({
  card,
  size = 'md',
  state = 'normal',
  onClick,
  label,
  badge,
  testId,
}: {
  card: CardId;
  size?: keyof typeof SIZE;
  state?: CardState;
  onClick?: () => void;
  label?: string;
  badge?: ReactNode;
  testId?: string;
}) {
  const art = useArt();
  const look = SUIT_LOOK[suitOf(card)];
  const src = size === 'xs' || size === 'sm' ? art.cardThumb(card) : art.card(card);
  const name = cardName(card, art.names.trump);
  const body = (
    <>
      {src ? (
        <ProtectedImage src={src} alt="" className="absolute inset-0 size-full object-cover" />
      ) : null}
      {/* The symbol and value always show, over the art too, for colour-blind players. */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0.5 top-0.5 flex flex-col items-center rounded px-0.5 leading-none font-black',
          src && 'bg-white/85',
        )}
        style={{ color: look.color }}
      >
        <span>{valueOf(card)}</span>
        <span className="text-[0.7em]">{look.symbol}</span>
      </span>
      {!src && (
        <span aria-hidden className="text-[1.6em] leading-none" style={{ color: look.color }}>
          {look.symbol}
        </span>
      )}
      {badge && <span className="absolute -right-1 -top-1">{badge}</span>}
    </>
  );
  const classes = cn(
    'relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-line transition dark:ring-stone-600',
    SIZE[size],
    state === 'dim' && 'opacity-35',
    state === 'legal' && 'ring-2 ring-accent -translate-y-1 dark:ring-amber-400',
    state === 'selected' && 'ring-4 ring-accent -translate-y-2 dark:ring-amber-400',
    state === 'queued' && 'ring-4 ring-info -translate-y-1 dark:ring-sky-400',
    state === 'signalled' && 'ring-2 ring-special dark:ring-violet-400',
  );
  if (!onClick)
    return (
      <span
        role="img"
        aria-label={label ?? name}
        className={classes}
        data-testid={testId}
        data-card={card}
      >
        {body}
      </span>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label ?? name}
      aria-pressed={state === 'selected' || state === 'queued'}
      className={cn(classes, 'focus-visible:outline-2 focus-visible:outline-accent')}
      data-testid={testId}
      data-card={card}
    >
      {body}
    </button>
  );
}

/** A face-down card (the dummy's lower row). */
export function CardBack({ size = 'sm' }: { size?: keyof typeof SIZE }) {
  const art = useArt();
  return (
    <span
      role="img"
      aria-label="face-down card"
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-panel ring-1 ring-line dark:bg-stone-700 dark:ring-stone-600',
        SIZE[size],
      )}
    >
      {art.back ? (
        <ProtectedImage src={art.back} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span aria-hidden className="text-ink-muted">
          🌊
        </span>
      )}
    </span>
  );
}

/**
 * Text with placeholders: `{p:<id>}` a player's name, `{c:<card>}` a card chip, and the theme's
 * name tokens.
 */
export function Rich({ text, name }: { text: string; name: (id: string) => string }) {
  const art = useArt();
  const parts = art.say(text).split(/(\{[pc]:[^}]+\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{([pc]):([^}]+)\}$/.exec(part);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        if (m[1] === 'p') return <strong key={i}>{name(m[2]!)}</strong>;
        return <CardChip key={i} card={m[2]!} />;
      })}
    </>
  );
}

/** Plain text with placeholders filled (for aria labels and status lines). */
export function plainText(text: string, name: (id: string) => string, trump: string): string {
  return text
    .replace(/\{p:([^}]+)\}/g, (_, id: string) => name(id))
    .replace(/\{c:([^}]+)\}/g, (_, c: string) => cardName(c, trump));
}
