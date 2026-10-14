import { type ReactNode, useCallback, useRef, useState } from 'react';
import { Button } from './components.tsx';
import { Modal } from './modal.tsx';

export interface ConfirmOptions {
  /** The question, as the dialog's title: "Leave this room?" */
  title: string;
  /** What happens, in a sentence or two (optional). */
  body?: ReactNode;
  /** The action, named: "Leave", "Remove Ana". */
  confirmLabel: string;
  /** Default "Cancel". */
  cancelLabel?: string;
  /** Something that can't be undone or hurts someone else: a red confirm button. */
  danger?: boolean;
}

/**
 * A yes/no question in the site's own dialog, in place of `window.confirm`. Cancel has the focus
 * on keyboards, and Esc, the backdrop and ✕ all count as Cancel.
 */
export function ConfirmDialog({
  open,
  options,
  onAnswer,
}: {
  open: boolean;
  options: ConfirmOptions;
  onAnswer: (yes: boolean) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={() => onAnswer(false)}
      title={options.title}
      size="sm"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="secondary"
            className="min-h-11"
            data-autofocus
            onClick={() => onAnswer(false)}
          >
            {options.cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={options.danger ? 'danger' : 'primary'}
            className="min-h-11"
            onClick={() => onAnswer(true)}
          >
            {options.confirmLabel}
          </Button>
        </div>
      }
    >
      {options.body && <div className="text-sm text-ink-muted">{options.body}</div>}
    </Modal>
  );
}

/**
 * `const [confirm, dialog] = useConfirm()`: render `dialog` once, then
 * `if (!(await confirm({ title: 'Leave this room?', confirmLabel: 'Leave' }))) return;`.
 * Asking again while a question is open answers the old one with "no".
 */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [asked, setAsked] = useState<ConfirmOptions | null>(null);
  const [last, setLast] = useState<ConfirmOptions | null>(null);
  const answer = useRef<((yes: boolean) => void) | null>(null);
  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        answer.current?.(false);
        answer.current = resolve;
        setAsked(options);
        setLast(options);
      }),
    [],
  );
  const onAnswer = useCallback((yes: boolean) => {
    answer.current?.(yes);
    answer.current = null;
    setAsked(null);
  }, []);
  // The last question stays rendered while the dialog closes, so its text never blanks out.
  const shown = asked ?? last;
  const dialog = shown && (
    <ConfirmDialog open={asked !== null} options={shown} onAnswer={onAnswer} />
  );
  return [confirm, dialog];
}
