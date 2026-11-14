import { useSyncExternalStore } from 'react';

/** A phone's width: the lobbies and first-time tips fold or compact below it to fit one screen. */
export const PHONE = '(max-width: 639px)';

/**
 * Also checked on every resize, which comes before the frame is painted: the media query's own
 * change event can come a frame later, and that frame showed the CSS of one width with the layout
 * React chose for the other.
 */
function subscribe(change: () => void) {
  const q = window.matchMedia(PHONE);
  q.addEventListener('change', change);
  window.addEventListener('resize', change);
  return () => {
    q.removeEventListener('change', change);
    window.removeEventListener('resize', change);
  };
}

/** Whether the screen is a phone's width, kept up to date (false where it can't be measured). */
export const usePhone = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
