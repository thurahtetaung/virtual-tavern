import type { PlayerId } from '@vt/game-sdk';
import { LOCATION_TILES, UNKNOWN_LOCATION_TILE } from './content.ts';
import {
  EXTRA_ROLES_MIN,
  type InquestState,
  MIN_PLAYERS,
  type RoleId,
  type Settings,
  alliesOf,
  maxPlayersOf,
} from './types.ts';

type RoleSettings = Pick<
  Settings,
  'accomplice' | 'witness' | 'allies' | 'labTech' | 'insideMan' | 'protective' | 'unknownLocation'
>;

/** Why a game can't start yet, or null. Shared with the lobby UI. */
export function startProblem(
  settings: InquestState['settings'],
  seats: readonly { id: PlayerId; playing: boolean; volunteer: boolean }[],
): string | null {
  const playing = seats.filter((s) => s.playing);
  if (playing.length < MIN_PLAYERS)
    return `${MIN_PLAYERS} players are needed (${playing.length} so far).`;
  const max = maxPlayersOf(settings);
  if (playing.length > max)
    return `At most ${max} can play${alliesOf(settings).on ? '' : ' without the Allies expansion'}.`;
  // The handover needs a plain Investigator, and the game needs someone to fool.
  if (!rolesFor(playing.length, settings).includes('investigator'))
    return `Too many roles for ${playing.length} players: switch one off.`;
  const volunteers = playing.filter((s) => s.volunteer);
  switch (settings.fsMode) {
    case 'host':
      if (!playing.some((s) => s.id === settings.fsPick))
        return 'The host picks who is the Forensic Scientist.';
      return null;
    case 'random':
      return null;
    case 'volunteers':
      return volunteers.length ? null : 'Nobody has volunteered to be the Forensic Scientist yet.';
    case 'host-volunteers':
      if (!volunteers.length) return 'Nobody has volunteered to be the Forensic Scientist yet.';
      if (!volunteers.some((s) => s.id === settings.fsPick))
        return 'The host picks the Forensic Scientist from the volunteers.';
      return null;
  }
}

/**
 * The roles in play for a table of this size and these settings. The extra roles (the base game's
 * and the Allies expansion's) join from 6 players; any seat left over is an Investigator.
 */
export function rolesFor(count: number, s: RoleSettings) {
  const roles: RoleId[] = ['forensic', 'murderer'];
  const extras = count >= EXTRA_ROLES_MIN;
  const a = alliesOf(s);
  if (extras && s.accomplice) roles.push('accomplice');
  if (extras && s.accomplice && s.witness) roles.push('witness');
  if (extras && a.labTech) roles.push('lab-technician');
  if (extras && a.insideMan) roles.push('inside-man');
  if (extras && a.protective) roles.push('protective-detail');
  while (roles.length < count) roles.push('investigator');
  return roles;
}

/**
 * The rulebook's suggested Allies role sets: 6 players have the Accomplice and the Witness, 7 add
 * the Lab Technician, 8 or more the Inside Man too. The Protective Detail is left as it is.
 */
export function suggestedRoles(
  count: number,
): Pick<Settings, 'accomplice' | 'witness' | 'labTech' | 'insideMan'> {
  return {
    accomplice: true,
    witness: true,
    labTech: count >= 7,
    insideMan: count >= 8,
  };
}

/** The Location tiles the Forensic Scientist picks from: the Unknown Location variant has one. */
export const locationTiles = (s: RoleSettings): readonly number[] =>
  alliesOf(s).unknownLocation ? [UNKNOWN_LOCATION_TILE] : LOCATION_TILES;
