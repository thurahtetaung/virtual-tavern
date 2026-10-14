import { Button, cn } from '@vt/ui';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from 'react';

const KEYS = new Set([' ', 'Enter']);

/**
 * Hidden information behind one gesture: hold the cover to look (a finger, the mouse or Space/Enter),
 * or tap Show to keep it up until Hide. The content is only rendered while it shows, never hidden
 * with CSS, so it can't be read from the page while covered, and the cover is the same for every
 * role. A local stand-in for the shared `Peek` from `@vt/ui` (same props), to swap in once it lands.
 */
export function Peek({
  what,
  children,
  cover,
  className,
}: {
  /** What is hidden, lower case, for the controls: "your card" → "Hold to see your card". */
  what: string;
  children: ReactNode;
  /** What shows while hidden. Default: a plain panel saying how to look. */
  cover?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const contentId = useId();
  // Leaving the page (another app, a locked screen) lets go, so nothing stays up unattended.
  useEffect(() => {
    const letGo = () => setHeld(false);
    window.addEventListener('blur', letGo);
    document.addEventListener('visibilitychange', letGo);
    return () => {
      window.removeEventListener('blur', letGo);
      document.removeEventListener('visibilitychange', letGo);
    };
  }, []);
  const shown = open || held;
  const release = () => setHeld(false);
  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative w-full">
        {!open && (
          <button
            type="button"
            aria-label={`Hold to see ${what}`}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setHeld(true);
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onKeyDown={(e: KeyboardEvent) => {
              if (!KEYS.has(e.key)) return;
              e.preventDefault();
              if (!e.repeat) setHeld(true);
            }}
            onKeyUp={(e: KeyboardEvent) => KEYS.has(e.key) && release()}
            onBlur={release}
            onContextMenu={(e) => e.preventDefault()}
            className={cn(
              'block w-full cursor-grab touch-none rounded-2xl text-left select-none [-webkit-touch-callout:none]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500',
              // While held, the button lies over the content (so the release still reaches it).
              shown && 'absolute inset-0 z-10 opacity-0',
            )}
          >
            {!shown &&
              (cover ?? (
                <span className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-2xl bg-gradient-to-b from-stone-700 to-stone-900 p-4 text-center text-stone-100">
                  <span aria-hidden className="text-3xl">
                    🙈
                  </span>
                  <span className="font-semibold">Hold to see {what}</span>
                  <span className="text-xs text-stone-300">Keep it hidden from the others</span>
                </span>
              ))}
          </button>
        )}
        <div id={contentId} aria-live="polite">
          {shown && children}
        </div>
      </div>
      <Button
        variant="secondary"
        size="sm"
        className="min-h-11"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => {
          setHeld(false);
          setOpen(!open);
        }}
      >
        {open ? `🙈 Hide ${what}` : `👁️ Show ${what}`}
      </Button>
    </div>
  );
}
