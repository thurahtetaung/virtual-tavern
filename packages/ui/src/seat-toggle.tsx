import type { ReactNode } from 'react';
import { Button } from './components.tsx';
import { type ConfirmOptions, useConfirm } from './confirm.tsx';

/**
 * The one seat control every lobby uses: "Watch instead" (a quiet button) while you play, "Take a
 * seat" (a tint button) while you watch. It sits at the right of the Players panel's heading, so it
 * is in the same place in every game. `full` turns "Take a seat" off with the reason on it, and
 * `confirmLeave` asks first (a game in progress). `id` lets the room's "You're watching" banner
 * scroll to it with `revealElement`.
 */
export function SeatToggle({
  playing,
  onChange,
  full = false,
  confirmLeave,
  id,
  className,
}: {
  playing: boolean;
  onChange: (playing: boolean) => void;
  full?: boolean;
  confirmLeave?: ConfirmOptions | null;
  id?: string;
  className?: string;
}) {
  const [confirm, dialog] = useConfirm();
  if (!playing) {
    return (
      <Button
        id={id}
        variant="tint"
        size="sm"
        className={className}
        disabled={full}
        onClick={() => onChange(true)}
      >
        {full ? 'Table full' : 'Take a seat'}
      </Button>
    );
  }
  return (
    <>
      <Button
        id={id}
        variant="quiet"
        size="sm"
        className={className}
        onClick={() =>
          void (async () => {
            if (!confirmLeave || (await confirm(confirmLeave))) onChange(false);
          })()
        }
      >
        Watch instead
      </Button>
      {dialog}
    </>
  );
}

/** A Players panel's heading row: the title on the left, the seat control (or nothing) on the right. */
export function SeatHeading({
  title,
  children,
  as: Tag = 'h3',
}: {
  title: ReactNode;
  children?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2">
      <Tag className="font-bold">{title}</Tag>
      {children}
    </div>
  );
}
