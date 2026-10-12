import { cn } from '@vt/ui';
import type { ReactNode } from 'react';
import { ROLES } from '../logic/roles.ts';
import type { Loyalty, RoleId } from '../logic/types.ts';

// Our own emblems: one simple drawing per role on a disc, blue for Good and red for Evil. Drawn
// in a 64-unit box with the current text colour, so they work in both themes.

const GLYPH: Record<RoleId, ReactNode> = {
  // A wizard's hat with a star.
  merlin: (
    <>
      <path d="M32 8 L46 44 H18 Z" fill="currentColor" opacity="0.9" />
      <path d="M12 46 Q32 54 52 46 L52 49 Q32 57 12 49 Z" fill="currentColor" />
      <path
        d="M31 22 l2 4.5 4.8 .5 -3.6 3.2 1 4.8 -4.2 -2.4 -4.2 2.4 1 -4.8 -3.6 -3.2 4.8 -.5 Z"
        fill="var(--emblem-bg)"
      />
    </>
  ),
  // A shield with a cross.
  percival: (
    <>
      <path d="M32 9 L50 15 V30 C50 43 42 51 32 56 C22 51 14 43 14 30 V15 Z" fill="currentColor" />
      <path d="M29 18 h6 v9 h9 v6 h-9 v15 h-6 v-15 h-9 v-6 h9 Z" fill="var(--emblem-bg)" />
    </>
  ),
  // A goblet.
  servant: (
    <>
      <path d="M18 12 H46 C46 28 40 36 32 36 C24 36 18 28 18 12 Z" fill="currentColor" />
      <rect x="30" y="35" width="4" height="12" fill="currentColor" />
      <path d="M21 52 Q32 44 43 52 Z" fill="currentColor" />
    </>
  ),
  // A dagger.
  assassin: (
    <>
      <path d="M32 6 L37 36 H27 Z" fill="currentColor" />
      <rect x="20" y="36" width="24" height="5" rx="2" fill="currentColor" />
      <rect x="29.5" y="41" width="5" height="12" rx="1.5" fill="currentColor" />
      <circle cx="32" cy="56" r="3.5" fill="currentColor" />
    </>
  ),
  // A crescent moon and a star.
  morgana: (
    <>
      <path d="M38 10 A22 22 0 1 0 54 42 A17 17 0 1 1 38 10 Z" fill="currentColor" />
      <circle cx="44" cy="22" r="3" fill="currentColor" />
    </>
  ),
  // A dark crown.
  mordred: (
    <>
      <path d="M10 22 L20 32 L32 14 L44 32 L54 22 L50 48 H14 Z" fill="currentColor" />
      <rect x="14" y="50" width="36" height="5" rx="2" fill="currentColor" />
      <circle cx="32" cy="38" r="4" fill="var(--emblem-bg)" />
    </>
  ),
  // A lone eye, closed to the others.
  oberon: (
    <>
      <path d="M8 32 Q32 10 56 32 Q32 54 8 32 Z" fill="currentColor" />
      <circle cx="32" cy="32" r="8" fill="var(--emblem-bg)" />
      <circle cx="32" cy="32" r="4" fill="currentColor" />
      <path d="M12 52 L52 12" stroke="var(--emblem-bg)" strokeWidth="5" strokeLinecap="round" />
      <path d="M12 52 L52 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  // A helmet.
  minion: (
    <>
      <path d="M14 34 C14 18 22 10 32 10 C42 10 50 18 50 34 V50 H14 Z" fill="currentColor" />
      <rect x="20" y="30" width="24" height="5" rx="2" fill="var(--emblem-bg)" />
      <rect x="30" y="35" width="4" height="12" fill="var(--emblem-bg)" />
    </>
  ),
};

const DISC: Record<Loyalty, string> = {
  good: 'bg-blue-100 text-blue-700 ring-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-700 [--emblem-bg:var(--color-blue-100)] dark:[--emblem-bg:var(--color-blue-950)]',
  evil: 'bg-red-100 text-red-700 ring-red-300 dark:bg-red-950 dark:text-red-300 dark:ring-red-700 [--emblem-bg:var(--color-red-100)] dark:[--emblem-bg:var(--color-red-950)]',
};

export function Emblem({ role, className }: { role: RoleId; className?: string }) {
  const def = ROLES[role];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full ring-2',
        DISC[def.loyalty],
        className ?? 'size-12',
      )}
    >
      <svg viewBox="0 0 64 64" className="size-[72%]" role="img" aria-label={def.name}>
        {GLYPH[role]}
      </svg>
    </span>
  );
}

/** The Lady of the Lake: a wave in a ring. */
export function LadyMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-5', className)} aria-hidden>
      <circle cx="32" cy="32" r="28" fill="none" stroke="currentColor" strokeWidth="5" />
      <path
        d="M14 36 Q20 28 26 36 T38 36 T50 36"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const SIDE_TEXT: Record<Loyalty, string> = {
  good: 'text-blue-700 dark:text-blue-300',
  evil: 'text-red-700 dark:text-red-300',
};

export const SIDE_LABEL: Record<Loyalty, string> = { good: 'Good', evil: 'Evil' };
