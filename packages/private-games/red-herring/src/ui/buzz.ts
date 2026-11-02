import { useEffect, useRef } from 'react';

/** A short buzz on phones that can, when the viewer's turn comes. Red Herring has no sound. */
export function useTurnBuzz(yourMove: boolean) {
  const was = useRef(yourMove);
  useEffect(() => {
    if (yourMove && !was.current) {
      try {
        navigator.vibrate?.(200);
      } catch {
        // Not allowed before a tap: nothing to do.
      }
    }
    was.current = yourMove;
  }, [yourMove]);
}
