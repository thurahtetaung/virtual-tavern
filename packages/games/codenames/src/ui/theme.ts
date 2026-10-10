import type { CardKind, Team } from '../logic/types.ts';

export const TEAM_LABEL: Record<Team, string> = { red: 'Red', blue: 'Blue' };

export const TEAM_TEXT: Record<Team, string> = {
  red: 'text-red-600 dark:text-red-400',
  blue: 'text-blue-600 dark:text-blue-400',
};

export const TEAM_PANEL: Record<Team, string> = {
  red: 'bg-red-50 ring-red-200 dark:bg-red-950/40 dark:ring-red-900',
  blue: 'bg-blue-50 ring-blue-200 dark:bg-blue-950/40 dark:ring-blue-900',
};

/** Revealed card faces. */
export const REVEALED: Record<CardKind, string> = {
  red: 'bg-red-600 text-white ring-red-700',
  blue: 'bg-blue-600 text-white ring-blue-700',
  bystander:
    'bg-stone-300 text-stone-600 ring-stone-400 dark:bg-stone-600 dark:text-stone-200 dark:ring-stone-500',
  assassin: 'bg-stone-950 text-stone-200 ring-black',
};

/** Spymaster's key overlay on face-down cards. */
export const KEY_TINT: Record<CardKind, string> = {
  red: 'bg-red-100 text-red-900 ring-2 ring-red-400 dark:bg-red-950 dark:text-red-100 dark:ring-red-700',
  blue: 'bg-blue-100 text-blue-900 ring-2 ring-blue-400 dark:bg-blue-950 dark:text-blue-100 dark:ring-blue-700',
  bystander:
    'bg-amber-50 text-stone-800 ring-1 ring-amber-200 dark:bg-stone-800 dark:text-stone-200 dark:ring-stone-700',
  assassin: 'bg-stone-800 text-white ring-2 ring-stone-950 dark:bg-black dark:ring-stone-500',
};

export const KIND_LABEL: Record<CardKind, string> = {
  red: 'Red agent',
  blue: 'Blue agent',
  bystander: 'Bystander',
  assassin: 'Assassin',
};

/** Short caption printed on guessed cards so their outcome is readable without relying on color. */
export const KIND_CAPTION: Record<CardKind, string> = {
  red: 'Red agent',
  blue: 'Blue agent',
  bystander: 'Bystander',
  assassin: 'Assassin',
};
