import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Button } from './components.tsx';

/**
 * Centered dialog with a fixed header and footer and a scrollable body.
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
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
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto max-h-[85dvh] w-[min(44rem,calc(100vw-2rem))] flex-col rounded-2xl bg-stone-50 p-0 text-stone-900 shadow-2xl backdrop:bg-black/50 open:flex dark:bg-stone-900 dark:text-stone-100"
    >
      <div className="flex items-center justify-between gap-2 border-b border-stone-200 px-4 py-2 dark:border-stone-800">
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        <Button variant="ghost" size="icon" className="-mr-2" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      {footer && (
        <div className="border-t border-stone-200 px-4 py-3 dark:border-stone-800">{footer}</div>
      )}
    </dialog>
  );
}

/** Moves focus from the close button (where `showModal()` puts it) to the `data-autofocus` element. */
export function focusPreferred(dialog: HTMLDialogElement) {
  if (window.matchMedia('(pointer: coarse)').matches) return;
  dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
}
