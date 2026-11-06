import type { Team } from '../logic/types.ts';

export const TEAM_LABEL: Record<Team, string> = { red: 'Red', blue: 'Blue' };
export const TEAM_TEXT: Record<Team, string> = {
  red: 'text-team-a-ink',
  blue: 'text-team-b-ink',
};
/** A team's soft surface and its line. */
export const TEAM_PANEL: Record<Team, string> = {
  red: 'bg-team-a-soft ring-team-a-line',
  blue: 'bg-team-b-soft ring-team-b-line',
};
/** A team's 2 px line along a panel's top edge (with `border-t-2`). */
export const TEAM_LINE: Record<Team, string> = { red: 'border-team-a', blue: 'border-team-b' };
/** A team's own button. */
export const TEAM_BUTTON = { red: 'team-a', blue: 'team-b' } as const satisfies Record<
  Team,
  string
>;

export const formatCode = (code: readonly number[] | null) =>
  code ? code.map((d) => (d ? String(d) : '·')).join('-') : '?-?-?';
