import type { CardKind, Team } from '../logic/types.ts';

export const TEAM_LABEL: Record<Team, string> = { red: 'Red', blue: 'Blue' };

export const TEAM_TEXT: Record<Team, string> = {
  red: 'text-team-a-ink',
  blue: 'text-team-b-ink',
};

/** A team's soft surface and its line (panels, the role tag). */
export const TEAM_PANEL: Record<Team, string> = {
  red: 'bg-team-a-soft ring-team-a-line',
  blue: 'bg-team-b-soft ring-team-b-line',
};

/** A team's 2 px line along a panel's top edge. */
export const TEAM_LINE: Record<Team, string> = { red: 'border-team-a', blue: 'border-team-b' };

/** A team's own button. */
export const TEAM_BUTTON = { red: 'team-a', blue: 'team-b' } as const satisfies Record<
  Team,
  string
>;

/**
 * The assassin is near-black with cream text in both themes (a card colour that never changes),
 * framed by the strong line so it doesn't sink into a dark page.
 */
// vt-palette: the assassin card
const ASSASSIN = 'bg-[#1C1816] text-[#F3ECE2] ring-1 ring-line-strong';

/** Revealed card faces. */
export const REVEALED: Record<CardKind, string> = {
  red: 'bg-team-a text-on-fill ring-1 ring-team-a',
  blue: 'bg-team-b text-on-fill ring-1 ring-team-b',
  bystander: 'bg-sunk text-ink-2 ring-1 ring-line-strong',
  assassin: ASSASSIN,
};

/** Spymaster's key overlay on face-down cards. */
export const KEY_TINT: Record<CardKind, string> = {
  red: 'bg-team-a-soft text-team-a-ink ring-2 ring-team-a',
  blue: 'bg-team-b-soft text-team-b-ink ring-2 ring-team-b',
  bystander: 'bg-sunk text-ink ring-1 ring-line-strong',
  assassin: ASSASSIN,
};

/** A face-down card nobody's key colours. */
export const FACE_DOWN = 'bg-card text-ink ring-1 ring-line shadow-vt-1';

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
