import { type ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from './cn.ts';
import { Button } from './components.tsx';
import { Icon } from './icon.tsx';

/**
 * A dialog with a fixed header and footer and a scrollable body: a centred card on wider screens,
 * and on phones a sheet that slides up from the bottom edge, with a grab handle.
 * Built on <dialog>, so focus trapping, Esc to close and the backdrop come for free.
 * Give one element `data-autofocus` to focus it on open instead of the close button (skipped on
 * touch screens, where it would only throw up the keyboard).
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** `sm` for a short question (a confirmation). */
  size?: 'sm' | 'md';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      focusPreferred(d);
    }
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // Only this dialog's own close: React bubbles a nested dialog's too.
      onClose={(e) => e.target === e.currentTarget && onClose()}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        'vt-sheet m-auto max-h-[85dvh] w-[min(44rem,calc(100vw-2rem))] flex-col rounded-xl border border-line bg-card p-0 text-ink shadow-vt-3 backdrop:bg-black/50 open:flex',
        size === 'sm' && 'w-[min(26rem,calc(100vw-2rem))]',
        // Phones: a bottom sheet the width of the screen, its top corners rounded.
        'max-sm:mx-0 max-sm:mb-0 max-sm:w-full max-sm:max-w-none max-sm:rounded-t-2xl max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <div
        aria-hidden
        className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden"
      />
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 max-sm:pt-0">
        <h2 id={titleId} className="text-sub font-semibold">
          {title}
        </h2>
        <Button variant="quiet" size="icon" className="-mr-2" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </Button>
      </div>
      {/* Focusable, so a keyboard can scroll a long body (arrow keys) even with no control in it. */}
      {children && (
        <div
          tabIndex={0}
          role="group"
          aria-labelledby={titleId}
          className="min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          {children}
        </div>
      )}
      {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}
    </dialog>
  );
}

/** Moves focus from the close button (where `showModal()` puts it) to the `data-autofocus` element. */
export function focusPreferred(dialog: HTMLDialogElement) {
  if (window.matchMedia('(pointer: coarse)').matches) return;
  dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
}
