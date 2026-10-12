import { storageKey } from '@vt/game-sdk';
import { useCallback, useState } from 'react';

/** Per seat in a playtest, so each seat tab learns the tips once. */
const prefix = () => `${storageKey('vt.inquest.tip')}.`;

function seen(id: string): boolean {
  try {
    return localStorage.getItem(prefix() + id) === '1';
  } catch {
    return false;
  }
}

/**
 * A first-time tip: shown until dismissed, then remembered in this browser. Without storage the
 * tip still closes for this page view.
 */
export function useTip(id: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => !seen(id));
  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(prefix() + id, '1');
    } catch {
      // Storage blocked: it'll show again next time.
    }
  }, [id]);
  return [open, dismiss];
}
