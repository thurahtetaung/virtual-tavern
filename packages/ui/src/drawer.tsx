import { type ReactNode, useEffect, useId, useRef } from 'react';
import { cn } from './cn.ts';
import { Button } from './components.tsx';
import { Icon } from './icon.tsx';

/** Side sheet built on <dialog> (focus trap, Esc to close, backdrop for free). */
export function Drawer({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Classes for the sheet (a narrower `max-w-*`). */
  className?: string;
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
      // A dialog opened inside this one (a card sheet) closes too, and React bubbles its event.
      onClose={(e) => e.target === e.currentTarget && onClose()}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'm-0 ml-auto h-dvh max-h-dvh w-full max-w-xl border-l border-line bg-page p-0 text-ink shadow-vt-3 backdrop:bg-black/40',
        className,
      )}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-page px-4 py-2">
        <h2 id={titleId} className="text-heading font-semibold">
          {title}
        </h2>
        <Button variant="quiet" size="icon" className="-mr-2" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </Button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
