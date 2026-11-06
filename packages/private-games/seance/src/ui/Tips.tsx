import { storageKey } from '@vt/game-sdk';
import { Fold, Notice, usePhone } from '@vt/ui';
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

/**
 * A dismissable first-time tip: a closed fold on phones (the play screen must fit), an info notice
 * on wider screens. Got it remembers it either way.
 */
export function Tip({ id, children }: { id: string; children: ReactNode }) {
  const [open, dismiss] = useTip(id);
  const phone = usePhone();
  if (!open) return null;
  const gotIt = (
    <button
      type="button"
      className="-my-3 inline-flex min-h-11 items-center px-2 text-xs font-bold"
      onClick={dismiss}
    >
      Got it
    </button>
  );
  if (phone) {
    return (
      <Fold summary="💡 Tip" bodyClassName="flex items-start gap-2 text-sm">
        <span className="flex-1">{children}</span>
        {gotIt}
      </Fold>
    );
  }
  return (
    <Notice tone="info" dense className="text-sm">
      <span className="flex items-start gap-2">
        <span className="flex-1">💡 {children}</span>
        {gotIt}
      </span>
    </Notice>
  );
}
