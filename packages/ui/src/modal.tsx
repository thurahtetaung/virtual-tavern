import { type ReactNode, useEffect, useRef } from 'react';
import { Button } from './components.tsx';

/**
 * Centered dialog with a fixed header and footer and a scrollable body.
 * Built on <dialog>, so focus trapping, Esc to close and the backdrop come for free.
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
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto max-h-[85dvh] w-[min(44rem,calc(100vw-2rem))] flex-col rounded-2xl bg-stone-50 p-0 text-stone-900 shadow-2xl backdrop:bg-black/50 open:flex dark:bg-stone-900 dark:text-stone-100"
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <h2 className="text-lg font-bold">{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
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
