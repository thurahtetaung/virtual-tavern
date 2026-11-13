import type { Drawing } from '@vt/game-sdk';
import { DrawingView, PAPER, ProtectedImage, cn } from '@vt/ui';
import type { ReactNode } from 'react';
import type { Art } from './assets.ts';

/**
 * A lot's picture: the player's strokes, or the house picture (from the manifest, or a plain
 * placeholder card).
 */
export function Picture({
  drawing,
  house,
  compact = false,
  tv = false,
  art,
  label,
  className,
  children,
}: {
  drawing: Drawing | null;
  house: string | null;
  /** A thumbnail: icons only, no captions. */
  compact?: boolean;
  /** On the table screen: the placeholder's words at the TV caption size. */
  tv?: boolean;
  art: Art;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  if (drawing)
    return (
      <DrawingView drawing={drawing} label={label} className={className}>
        {children}
      </DrawingView>
    );
  const src = house ? art.house(house) : null;
  return (
    <div
      className={cn('relative aspect-[4/5] overflow-hidden rounded-lg', className)}
      style={{ background: PAPER }}
    >
      {src ? (
        <ProtectedImage src={src} alt={label} className="size-full object-contain" />
      ) : (
        <div
          className={cn(
            'flex size-full flex-col items-center justify-center gap-1 text-center text-stone-600',
            !compact && 'p-3',
          )}
          role="img"
          aria-label={`${label}: house picture`}
        >
          <span aria-hidden className={compact ? 'text-base' : tv ? 'text-7xl' : 'text-4xl'}>
            🏛️
          </span>
          {!compact && (
            <span className={cn('font-semibold', tv ? 'text-[28px]' : 'text-sm')}>
              House picture
            </span>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
