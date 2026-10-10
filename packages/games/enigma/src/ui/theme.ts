import type { Team } from '../logic/types.ts';

export const TEAM_LABEL: Record<Team, string> = { red: 'Red', blue: 'Blue' };
export const TEAM_TEXT: Record<Team, string> = {
  red: 'text-red-600 dark:text-red-400',
  blue: 'text-blue-600 dark:text-blue-400',
};
export const TEAM_PANEL: Record<Team, string> = {
  red: 'bg-red-50 ring-red-200 dark:bg-red-950/40 dark:ring-red-900',
  blue: 'bg-blue-50 ring-blue-200 dark:bg-blue-950/40 dark:ring-blue-900',
};

export const formatCode = (code: readonly number[] | null) =>
  code ? code.map((d) => (d ? String(d) : '·')).join('-') : '?-?-?';
