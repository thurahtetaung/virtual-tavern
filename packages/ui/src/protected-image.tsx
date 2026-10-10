import type { ImgHTMLAttributes } from 'react';
import { cn } from './cn.ts';

/**
 * An image from the private asset store. Light copy deterrents: it can't be dragged out, the
 * context menu ("Save image as…") is blocked, and long-press saving is disabled on iOS. Anyone can
 * still screenshot, so this deters casual copying rather than preventing it.
 */
export function ProtectedImage({
  className,
  alt,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { alt: string }) {
  return (
    <img
      {...props}
      alt={alt}
      draggable={false}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      className={cn('pointer-events-auto select-none [-webkit-touch-callout:none]', className)}
    />
  );
}
