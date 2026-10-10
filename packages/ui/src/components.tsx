import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn as join } from './cn.ts';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'red' | 'blue';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-amber-600 text-white hover:bg-amber-500 shadow-sm shadow-amber-900/20 dark:bg-amber-500 dark:text-stone-950 dark:hover:bg-amber-400',
  secondary:
    'bg-white text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-600 dark:hover:bg-stone-700',
  ghost: 'text-stone-700 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-500',
  red: 'bg-red-600 text-white hover:bg-red-500',
  blue: 'bg-blue-600 text-white hover:bg-blue-500',
};
const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4',
  lg: 'h-12 px-6 text-lg',
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
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500',
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
        'rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-800',
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
          ? 'bg-amber-100 font-semibold text-amber-950 ring-1 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40'
          : 'bg-stone-100 text-stone-700 dark:bg-stone-800/70 dark:text-stone-300',
      )}
    >
      {children}
    </p>
  );
}
