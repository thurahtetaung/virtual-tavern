import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn as join } from './cn.ts';

/**
 * `primary` is the one main action on a screen. `soft` is for actions that repeat down a list (one
 * per card): a quiet accent tint in light mode so the page isn't a wall of filled buttons, and the
 * primary look in dark mode.
 */
type Variant = 'primary' | 'soft' | 'secondary' | 'ghost' | 'danger' | 'red' | 'blue';
/** `icon` is a square 44 px tap target for icon-only buttons (close, theme switch…). */
type Size = 'sm' | 'md' | 'lg' | 'icon';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm shadow-amber-900/15 dark:bg-amber-500 dark:text-stone-950 dark:shadow-amber-900/20 dark:hover:bg-amber-400',
  soft: 'bg-accent-soft text-accent-text ring-1 ring-accent-line hover:bg-accent-soft dark:bg-amber-500 dark:text-stone-950 dark:ring-0 dark:shadow-sm dark:shadow-amber-900/20 dark:hover:bg-amber-400',
  secondary:
    'bg-card text-stone-800 ring-1 ring-line-strong hover:bg-panel dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-600 dark:hover:bg-stone-700',
  ghost: 'text-stone-700 hover:bg-line/60 dark:text-stone-300 dark:hover:bg-stone-800',
  danger: 'bg-danger text-white hover:bg-danger dark:bg-rose-600 dark:hover:bg-rose-500',
  red: 'bg-team-a text-white hover:bg-danger dark:bg-red-600 dark:hover:bg-red-500',
  blue: 'bg-team-b text-white hover:bg-info dark:bg-blue-600 dark:hover:bg-blue-500',
};
const SIZES: Record<Size, string> = {
  // On touch screens an invisible 6 px band above and below makes the 32 px button a 44 px target
  // without making dense rows any taller.
  sm: "relative h-8 px-3 text-sm pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5 pointer-coarse:after:content-['']",
  md: 'h-10 px-4',
  lg: 'h-12 px-6 text-lg',
  icon: 'size-11 shrink-0 text-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      className={join(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={join(
        'rounded-2xl bg-card/85 p-4 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800',
        className,
      )}
      {...props}
    />
  );
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={join(
        'inline-flex items-center gap-1 rounded-full bg-stone-200 px-2 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-800 dark:text-stone-300',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Highlighted "what should I do now?" message for newcomers. */
export function Hint({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'action';
}) {
  return (
    <p
      role="status"
      className={join(
        'rounded-xl px-4 py-3 text-center text-sm sm:text-base',
        tone === 'action'
          ? 'bg-warn-soft font-semibold text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40'
          : 'bg-panel text-stone-700 ring-1 ring-line dark:bg-stone-800/70 dark:text-stone-300 dark:ring-0',
      )}
    >
      {children}
    </p>
  );
}
