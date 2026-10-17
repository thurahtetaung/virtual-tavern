import { useCallback, useEffect, useRef, useState } from 'react';

/** A move still waiting this long shows that it is on its way. */
export const PENDING_AFTER_MS = 150;
/** ...and this long, says so in words. */
export const STILL_SENDING_AFTER_MS = 3_000;
/** A press this recent is the one that sent the move. */
const PRESS_FRESH_MS = 1_000;

const PRESSABLE = 'button, [role="button"], a, input, select, label, summary, [tabindex]';

/**
 * Feedback for moves on their way to the server, for every game at once: the control that sent
 * one (the last one pressed) is marked busy (and pulses, from `index.css`) after a moment,
 * a thin bar runs along the top, and after a few seconds "Still sending…" says so. Nothing is
 * blocked: other moves can go out meanwhile.
 */
export function usePending() {
  const pressed = useRef<{ el: Element; at: number } | null>(null);
  useEffect(() => {
    const note = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target instanceof Element ? e.target.closest(PRESSABLE) : null;
      if (el) pressed.current = { el, at: Date.now() };
    };
    document.addEventListener('pointerdown', note, true);
    document.addEventListener('keydown', note, true);
    return () => {
      document.removeEventListener('pointerdown', note, true);
      document.removeEventListener('keydown', note, true);
    };
  }, []);

  /** Moves on their way, and how many of them are past each threshold. */
  const [shown, setShown] = useState(0);
  const [slow, setSlow] = useState(0);

  const track = useCallback(async <T,>(work: Promise<T>): Promise<T> => {
    const press = pressed.current;
    const el = press && Date.now() - press.at < PRESS_FRESH_MS ? press.el : null;
    let showing = false;
    let marked = false;
    let slowing = false;
    const show = window.setTimeout(() => {
      showing = true;
      setShown((n) => n + 1);
      el?.setAttribute('data-vt-sending', '');
      if (el && !el.hasAttribute('aria-busy')) {
        el.setAttribute('aria-busy', 'true');
        marked = true;
      }
    }, PENDING_AFTER_MS);
    const still = window.setTimeout(() => {
      slowing = true;
      setSlow((n) => n + 1);
    }, STILL_SENDING_AFTER_MS);
    try {
      return await work;
    } finally {
      window.clearTimeout(show);
      window.clearTimeout(still);
      if (showing) setShown((n) => n - 1);
      if (slowing) setSlow((n) => n - 1);
      el?.removeAttribute('data-vt-sending');
      if (marked) el?.removeAttribute('aria-busy');
    }
  }, []);

  return { track, sending: shown > 0, stillSending: slow > 0 };
}

/** The room's shared "on its way" signs: a thin bar along the top, then a few words. */
export function PendingIndicator({
  sending,
  stillSending,
}: {
  sending: boolean;
  stillSending: boolean;
}) {
  return (
    <>
      {sending && (
        <div
          aria-hidden
          className="vt-sending pointer-events-none fixed inset-x-0 top-0 z-50 h-1 overflow-hidden"
        />
      )}
      {stillSending && (
        <p
          role="status"
          // In the gap under the site's title bar (56 px), above the room's own title row.
          className="pointer-events-none fixed inset-x-0 top-[57px] z-50 mx-auto w-fit rounded-full bg-panel px-3 py-0.5 text-xs font-semibold text-ink shadow-md ring-1 ring-line dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-700"
        >
          Still sending…
        </p>
      )}
    </>
  );
}
