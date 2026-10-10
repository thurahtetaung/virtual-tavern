import { Button } from '@vt/ui';
import { type ReactNode, useEffect, useId, useRef } from 'react';

/** Side sheet built on <dialog> (focus trap, Esc to close, backdrop for free). */
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl bg-stone-50 p-0 text-stone-900 backdrop:bg-black/40 dark:bg-stone-900 dark:text-stone-100"
    >
      <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-stone-200 bg-stone-50/95 px-4 py-2 dark:border-stone-800 dark:bg-stone-900/95">
        <h2 id={titleId} className="text-xl font-bold">
          {title}
        </h2>
        <Button variant="ghost" size="icon" className="-mr-2" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
