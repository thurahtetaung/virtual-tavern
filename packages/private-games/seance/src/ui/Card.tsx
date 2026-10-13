import { ProtectedImage, cn } from '@vt/ui';
import { type ReactNode, useState } from 'react';
import type { Kind } from '../logic/cards.ts';
import type { PsychicColor } from '../logic/types.ts';
import { type Content, PILLAR_ICONS } from './assets.ts';

const PLACEHOLDER: Record<Kind, string> = {
  vision: 'from-indigo-800 via-violet-900 to-stone-950',
  suspect: 'from-rose-900 to-stone-900',
  place: 'from-emerald-900 to-stone-900',
  object: 'from-amber-800 to-stone-900',
};

interface Props {
  kind: Kind;
  n: number;
  content: Content;
  /** `thumb` uses the small file; `big` the full one with a larger placeholder. */
  size?: 'thumb' | 'big';
  selected?: boolean;
  dimmed?: boolean;
  onTap?: () => void;
  disabled?: boolean;
  /** Extra label for screen readers and tests ("your guess"). */
  note?: string;
  /** Fill the parent instead of sizing by width and aspect ratio. */
  fill?: boolean;
  className?: string;
  /** Overlays: tokens, guesses, stamps. */
  children?: ReactNode;
}

/**
 * One card, art first. Visions are portrait, suspects, places and objects landscape. When the art
 * can't load (no asset storage in tests or dev, or a missing file) it shows a numbered placeholder.
 */
export function Card({
  kind,
  n,
  content,
  size = 'thumb',
  selected,
  dimmed,
  onTap,
  disabled,
  note,
  fill,
  className,
  children,
}: Props) {
  const [failed, setFailed] = useState(false);
  const art = content.cardArt(kind, n, size === 'thumb');
  const label = `${content.cardLabel(kind, n)}${note ? ` (${note})` : ''}`;
  const body = (
    <>
      {art && !failed ? (
        <ProtectedImage
          src={art}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn(
            'absolute inset-0 size-full',
            size === 'big' ? 'object-contain' : 'object-cover',
          )}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br font-serif font-bold text-white/90',
            PLACEHOLDER[kind],
            size === 'big' ? 'text-5xl' : 'text-lg',
          )}
        >
          <span className={size === 'big' ? 'text-6xl' : 'text-xl'}>
            {kind === 'vision' ? '👁️' : PILLAR_ICONS[kind]}
          </span>
          {n}
        </span>
      )}
      {children}
    </>
  );
  const classes = cn(
    'relative block overflow-hidden rounded-lg bg-stone-900 shadow ring-1 ring-black/20 select-none [-webkit-touch-callout:none]',
    fill
      ? 'size-full'
      : kind === 'vision'
        ? 'aspect-[700/1024] w-full'
        : 'aspect-[1024/700] w-full',
    selected && 'ring-4 ring-accent dark:ring-amber-400',
    dimmed && 'opacity-45 grayscale',
    className,
  );
  if (!onTap)
    return (
      <div role="img" aria-label={label} data-card={`${kind}-${n}`} className={classes}>
        {body}
      </div>
    );
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      data-card={`${kind}-${n}`}
      onClick={onTap}
      className={cn(classes, 'cursor-pointer touch-manipulation disabled:cursor-not-allowed')}
    >
      {body}
    </button>
  );
}

/** A face-down vision (the shared vision before it turns over). */
export function CardBack({ content, className }: { content: Content; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      role="img"
      aria-label="Face-down vision"
      className={cn(
        'relative aspect-[700/1024] w-full overflow-hidden rounded-lg bg-gradient-to-br from-sky-900 to-indigo-950 shadow ring-1 ring-black/20',
        className,
      )}
    >
      {content.back && !failed ? (
        <ProtectedImage
          src={content.back}
          alt=""
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center text-3xl">
          🌀
        </span>
      )}
    </div>
  );
}

/** A psychic's portrait in their sleeve colour (initial on a coloured disc without art). */
export function Avatar({
  color,
  content,
  name,
  size = 'md',
  className,
}: {
  color: PsychicColor;
  content: Content;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const art = content.psychicArt(color);
  const swatch = content.swatch(color);
  const dim = size === 'sm' ? 'size-7' : size === 'lg' ? 'size-16' : 'size-10';
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ring-2',
        dim,
        className,
      )}
      style={{ backgroundColor: swatch, ['--tw-ring-color' as string]: swatch }}
      aria-hidden
    >
      {art && !failed ? (
        <ProtectedImage
          src={art}
          alt=""
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span className={cn(color === 'white' && 'text-stone-800', size === 'lg' && 'text-2xl')}>
          {(name ?? color)[0]!.toUpperCase()}
        </span>
      )}
    </span>
  );
}
