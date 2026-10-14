import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useReducer,
} from 'react';
import { cn } from './cn.ts';
import { Button } from './components.tsx';

/** How far (px) a slide must go up to leave the content showing once released. */
export const SLIDE_TO_OPEN_PX = 50;

export interface PeekState {
  /** Shown by the toggle (or a slide) until hidden again. */
  open: boolean;
  /** Shown while the finger, mouse button or key is held down. */
  held: boolean;
  /** Where a slide started (clientY), while one is under way. */
  start: number | null;
  /** How far the slide has gone up, in px. */
  drag: number;
}

export type PeekEvent =
  | { type: 'press'; y?: number }
  | { type: 'move'; y: number }
  | { type: 'release'; slide: boolean }
  | { type: 'toggle' }
  | { type: 'set'; open: boolean };

export const PEEK_START: PeekState = { open: false, held: false, start: null, drag: 0 };

/** The peek's state machine, pure so it can be tested without a browser. */
export function peekReducer(s: PeekState, e: PeekEvent): PeekState {
  switch (e.type) {
    case 'press':
      return { ...s, held: true, start: e.y ?? null, drag: 0 };
    case 'move':
      return s.start === null ? s : { ...s, drag: Math.max(0, s.start - e.y) };
    case 'release':
      if (!s.held) return s;
      return {
        open: s.open || (e.slide && s.drag > SLIDE_TO_OPEN_PX),
        held: false,
        start: null,
        drag: 0,
      };
    case 'toggle':
      return { ...PEEK_START, open: !s.open };
    case 'set':
      return s.open === e.open ? s : { ...PEEK_START, open: e.open };
  }
}

const KEYS = new Set([' ', 'Enter']);

/**
 * Hidden information (a secret role, a hand, a private note) behind one gesture for every game:
 * hold the cover to look (a finger, the mouse or Space/Enter on the keyboard), or tap Show to keep
 * it up until Hide. With `slide`, sliding the cover up also keeps it showing.
 *
 * The content is only rendered while it is showing, never hidden with CSS, so it can't be read
 * from the page while covered. Screen readers use the Show/Hide button (holding is a pointer
 * gesture); the content is announced when it appears.
 */
export function Peek({
  what,
  children,
  cover,
  slide = false,
  open: controlled,
  onOpenChange,
  blocked,
  onReveal,
  className,
}: {
  /** What is hidden, lower case, for the controls: "your role" → "Hold to see your role". */
  what: string;
  /** The hidden content. */
  children: ReactNode;
  /** What shows while hidden (a card back). Default: a plain panel saying how to look. */
  cover?: ReactNode;
  /** Sliding the cover up keeps the content showing. */
  slide?: boolean;
  /** Controls the Show/Hide state from outside (with `onOpenChange`). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Keeps everything covered whatever the player does, saying why (a phone lying flat). */
  blocked?: string | false;
  /** Called each time the content is about to show (a sound, a flip). */
  onReveal?: () => void;
  className?: string;
}) {
  const [state, dispatch] = useReducer(peekReducer, {
    ...PEEK_START,
    open: controlled ?? false,
  });
  const contentId = useId();
  useEffect(() => {
    if (controlled !== undefined) dispatch({ type: 'set', open: controlled });
  }, [controlled]);
  // Leaving the page (another app, a locked screen) lets go, so nothing stays up unattended.
  useEffect(() => {
    const letGo = () => dispatch({ type: 'release', slide: false });
    window.addEventListener('blur', letGo);
    document.addEventListener('visibilitychange', letGo);
    return () => {
      window.removeEventListener('blur', letGo);
      document.removeEventListener('visibilitychange', letGo);
    };
  }, []);

  const open = state.open;
  const shown = (open || state.held) && !blocked;
  const setOpen = (next: boolean) => {
    if (next && !blocked) onReveal?.();
    if (controlled === undefined) dispatch({ type: 'toggle' });
    onOpenChange?.(next);
  };
  const press = (y?: number) => {
    if (!blocked) onReveal?.();
    dispatch({ type: 'press', y });
  };
  const release = () => {
    const opens = slide && state.drag > SLIDE_TO_OPEN_PX && !open;
    // Controlled: the owner decides through onOpenChange, so the slide only asks.
    dispatch({ type: 'release', slide: slide && controlled === undefined });
    if (opens) onOpenChange?.(true);
  };

  const holder = !open && (
    <button
      type="button"
      aria-label={`Hold to see ${what}`}
      aria-describedby={blocked ? `${contentId}-blocked` : undefined}
      onPointerDown={(e: PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        press(e.clientY);
      }}
      onPointerMove={(e) => slide && dispatch({ type: 'move', y: e.clientY })}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={(e: KeyboardEvent) => {
        if (!KEYS.has(e.key)) return;
        e.preventDefault();
        if (!e.repeat) press();
      }}
      onKeyUp={(e: KeyboardEvent) => KEYS.has(e.key) && release()}
      onBlur={release}
      onContextMenu={(e) => e.preventDefault()}
      style={state.drag ? { transform: `translateY(-${Math.min(state.drag, 60)}px)` } : undefined}
      className={cn(
        'block w-full cursor-grab touch-none rounded-2xl text-left select-none [-webkit-touch-callout:none]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500',
        // While held, the button lies over the content (so the release still reaches it).
        shown && 'absolute inset-0 z-10 opacity-0',
      )}
    >
      {!shown &&
        (cover ?? (
          <span className="flex min-h-32 flex-col items-center justify-center gap-1 rounded-2xl bg-gradient-to-b from-stone-700 to-stone-900 p-4 text-center text-stone-100">
            <span aria-hidden className="text-3xl">
              {slide ? '⬆️' : '🙈'}
            </span>
            <span className="font-semibold">
              {slide ? `Slide up, or hold, to see ${what}` : `Hold to see ${what}`}
            </span>
            <span className="text-xs text-stone-300">Keep it hidden from the others</span>
          </span>
        ))}
    </button>
  );

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative w-full">
        {holder}
        <div id={contentId} aria-live="polite">
          {shown && children}
        </div>
      </div>
      {blocked && (
        <p id={`${contentId}-blocked`} className="text-xs text-ink-muted">
          {blocked}
        </p>
      )}
      <Button
        variant="secondary"
        size="sm"
        className="min-h-11"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(!open)}
      >
        {open ? `🙈 Hide ${what}` : `👁️ Show ${what}`}
      </Button>
    </div>
  );
}
