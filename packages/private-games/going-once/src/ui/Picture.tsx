import type { Drawing } from '@vt/game-sdk';
import { DrawingView, PAPER, ProtectedImage, cn } from '@vt/ui';
import type { ReactNode } from 'react';
import type { Art } from './assets.ts';

/**
 * A lot's picture: the player's strokes, the house picture (from the manifest, or a plain
 * placeholder card), or a veil when the host or the viewer hid it.
 */
export function Picture({
  drawing,
  house,
  hidden,
  hiddenByMe = false,
  art,
  label,
  className,
  children,
}: {
  drawing: Drawing | null;
  house: string | null;
  hidden: boolean;
  hiddenByMe?: boolean;
  art: Art;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  if (hidden || hiddenByMe)
    return (
      <div
        className={cn(
          'relative flex aspect-[4/5] flex-col items-center justify-center gap-1 rounded-lg bg-stone-200 text-center text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-300',
          className,
        )}
        role="img"
        aria-label={`${label}: hidden`}
      >
        <span aria-hidden className="text-3xl">
          🙈
        </span>
        <span>{hidden ? 'Hidden by the host' : 'Hidden on your screen'}</span>
        {children}
      </div>
    );
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
          className="flex size-full flex-col items-center justify-center gap-1 p-3 text-center text-stone-500"
          role="img"
          aria-label={`${label}: house picture`}
        >
          <span aria-hidden className="text-4xl">
            🏛️
          </span>
          <span className="text-sm font-semibold">House picture</span>
        </div>
      )}
      {children}
    </div>
  );
}
