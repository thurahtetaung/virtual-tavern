import { useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes, SyntheticEvent } from 'react';
import { cn } from './cn.ts';

/** How long a failed image waits before its one retry. */
export const IMAGE_RETRY_MS = 500;

/**
 * The error handler for an image on its `tries`-th failed load: the first failure schedules one
 * retry of the same URL after {@link IMAGE_RETRY_MS} (a rare failed request shouldn't leave a
 * broken image until a reload); a second one is final and goes to the caller's `onError`.
 * Returns the pending timer, if any, so it can be cleared.
 */
export function imageError(
  tries: number,
  retry: () => void,
  onError?: (e: SyntheticEvent<HTMLImageElement>) => void,
) {
  return (e: SyntheticEvent<HTMLImageElement>): ReturnType<typeof setTimeout> | undefined => {
    if (tries < 1) return setTimeout(retry, IMAGE_RETRY_MS);
    onError?.(e);
    return undefined;
  };
}

/**
 * An image from the private asset store. Light copy deterrents: it can't be dragged out, the
 * context menu ("Save image as…") is blocked, and long-press saving is disabled on iOS. Anyone can
 * still screenshot, so this deters casual copying rather than preventing it. A failed load is
 * retried once with the same URL (the files are cached by URL, so no cache-busting).
 */
export function ProtectedImage({
  className,
  alt,
  src,
  onError,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { alt: string }) {
  const [tries, setTries] = useState({ src, n: 0 });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const n = tries.src === src ? tries.n : 0;
  if (tries.src !== src) setTries({ src, n: 0 });
  useEffect(() => {
    return () => {
      clearTimeout(timer.current);
    };
  }, [src]);
  const handle = imageError(n, () => setTries({ src, n: n + 1 }), onError);
  return (
    <img
      {...props}
      // A new key remounts the element, so the browser requests the same URL again.
      key={n}
      src={src}
      alt={alt}
      draggable={false}
      onError={(e) => {
        timer.current = handle(e);
      }}
      onContextMenu={(e) => e.preventDefault()}
      onDragStart={(e) => e.preventDefault()}
      className={cn('pointer-events-auto select-none [-webkit-touch-callout:none]', className)}
    />
  );
}
