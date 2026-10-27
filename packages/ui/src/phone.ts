import { useSyncExternalStore } from 'react';

/** A phone's width: the lobbies and first-time tips fold or compact below it to fit one screen. */
export const PHONE = '(max-width: 639px)';

function subscribe(change: () => void) {
  const q = window.matchMedia(PHONE);
  q.addEventListener('change', change);
  return () => {
    q.removeEventListener('change', change);
  };
}

/** Whether the screen is a phone's width, kept up to date (false where it can't be measured). */
export const usePhone = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE).matches,
    () => false,
  );
