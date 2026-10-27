import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './cn.ts';
import { PHONE } from './phone.ts';
import { HostOnlyNote } from './switch.tsx';
import { fitSummary, summaryText, type SummaryPart } from './summary-fit.ts';

const CLAMP = 'line-clamp-2 min-w-0 flex-1 text-ink-muted';

/** Wider screens show the whole lobby; phones (and screens we can't measure) fold. */
const startsOpen = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  !window.matchMedia(PHONE).matches;

/**
 * A lobby's settings panel: a summary of at most two lines ("⚙️ Settings: 2 min turns · strict ·
 * narration on") that opens to the full settings, so a lobby fits a phone. Everyone else sees them
 * read-only; the host changes them, and sees them open from the start on wider screens.
 * `className` styles the settings' own box (`space-y-4`), in both forms.
 */
export function LobbySettings({
  editable,
  summary,
  title = 'Settings',
  children,
  className,
}: {
  /** The host: the settings can be changed (and start open on wider screens). */
  editable: boolean;
  /**
   * The summary as its parts, the choices that matter most first. Parts that don't fit two
   * lines on this screen are counted from the end ("+2 more", the full list one tap away), so the
   * summary never ends in an ellipsis.
   */
  summary: readonly SummaryPart[];
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(() => editable && startsOpen());
  return (
    <details
      open={open}
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
      }}
      data-testid={editable ? 'host-settings' : undefined}
      className="group rounded-2xl bg-card/85 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800"
    >
      <summary className="relative flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 font-semibold">
          <span aria-hidden>⚙️ </span>
          {title}
        </span>
        <Summary parts={summary.filter((p): p is string => !!p)} />
        <span
          aria-hidden
          className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className={cn('px-4 pb-4', className)}>
        {!editable && <HostOnlyNote />}
        {children}
      </div>
    </details>
  );
}

/** The summary text, cut at a part boundary to fit its two lines (measured on an invisible copy). */
function Summary({ parts }: { parts: string[] }) {
  const line = useRef<HTMLSpanElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(parts.length);
  const key = parts.join('\n');

  const fit = useCallback(() => {
    const el = line.current;
    const copy = probe.current;
    if (!el || !copy) return;
    copy.style.width = `${el.clientWidth}px`;
    const fits = fitSummary(parts, (text) => {
      copy.textContent = text;
      return copy.scrollHeight <= copy.clientHeight + 1;
    });
    copy.textContent = '';
    setShown(fits);
    // `key` stands for `parts`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useLayoutEffect(() => {
    fit();
    const el = line.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const watch = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    watch.observe(el);
    return () => {
      watch.disconnect();
    };
  }, [fit]);

  return (
    <>
      <span ref={line} data-testid="settings-summary" className={CLAMP}>
        {summaryText(parts, Math.min(shown, parts.length))}
      </span>
      <span
        ref={probe}
        aria-hidden
        className={cn(CLAMP, 'pointer-events-none invisible absolute top-0 left-0 flex-none')}
      />
    </>
  );
}
