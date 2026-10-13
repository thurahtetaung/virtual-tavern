import { storageKey } from '@vt/game-sdk';
import { type ReactNode, useCallback, useState } from 'react';

/** Per seat in a playtest, so each seat tab learns the tips once. */
const prefix = () => `${storageKey('vt.seance.tip')}.`;

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

/** A dismissable first-time tip. */
export function Tip({ id, children }: { id: string; children: ReactNode }) {
  const [open, dismiss] = useTip(id);
  if (!open) return null;
  return (
    <p className="flex items-start gap-2 rounded-xl bg-info-soft px-3 py-1.5 text-sm text-sky-950 ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
      <span className="flex-1">💡 {children}</span>
      <button type="button" className="text-xs font-bold" onClick={dismiss}>
        Got it
      </button>
    </p>
  );
}
