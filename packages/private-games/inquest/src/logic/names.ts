import type { EventKind } from './content.ts';
import { type RoleId, type Settings, finalOf, presentationsOf } from './types.ts';

/** Plain role names. The private manifest may carry art for each. */
export const ROLE_NAMES: Readonly<Record<RoleId, string>> = {
  forensic: 'Forensic Scientist',
  murderer: 'Murderer',
  accomplice: 'Accomplice',
  witness: 'Witness',
  investigator: 'Investigator',
};

export const roleName = (role: RoleId) => ROLE_NAMES[role];

/**
 * Our own names for the six events. The UI prefers the event tile's title from the private
 * manifest when there is one.
 */
export const EVENT_NAMES: Readonly<Record<EventKind, string>> = {
  'useful-clue': 'Fresh Lead',
  'good-twist': 'Second Chance',
  'ruled-out': 'Cleared Evidence',
  erroneous: 'Shifted Bullet',
  countdown: 'Last Call',
  testimony: 'Secret Tip',
};

export const eventName = (kind: EventKind) => EVENT_NAMES[kind];

/** What each event does, in plain words (the event card and the guide). */
export const EVENT_TEXT: Readonly<Record<EventKind, string>> = {
  'useful-clue':
    'The Forensic Scientist draws 5 scene tiles, swaps one of them in for a scene tile on the table and gives it a bullet.',
  'good-twist':
    'Whoever solved the last case at this table gets one extra attempt. If nobody did, another tile is drawn.',
  'ruled-out':
    'One by one, going the other way round from the Forensic Scientist, everyone flips one of their own Clue cards. A flipped card can’t be the answer.',
  erroneous: 'The Forensic Scientist moves one bullet to a different item on the same scene tile.',
  countdown:
    'Two scene tiles are swapped for new ones, and this is the last round: the game ends after it, or the final accusations follow when they’re on.',
  testimony:
    'The Witness secretly points at a scene tile, and a new tile replaces it. Nobody learns who pointed.',
};

/** What ends the last round, in the room's mode: its discussion or its presentations. */
export function lastRoundText(s: Settings): string {
  const after = presentationsOf(s) ? 'its presentations' : 'its discussion';
  return `after ${after}, ${finalOf(s) ? 'the final accusations follow' : 'the game ends'}`;
}

/** An event's text for the room's mode (Last Call names what comes after the last round). */
export function eventText(kind: EventKind, s: Settings): string {
  return kind === 'countdown'
    ? `Two scene tiles are swapped for new ones, and this is the last round: ${lastRoundText(s)}.`
    : EVENT_TEXT[kind];
}
