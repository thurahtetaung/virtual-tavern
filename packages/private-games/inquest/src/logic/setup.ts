import type { PlayerId } from '@vt/game-sdk';
import {
  EXTRA_ROLES_MIN,
  type InquestState,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type RoleId,
} from './types.ts';

/** Why a game can't start yet, or null. Shared with the lobby UI. */
export function startProblem(
  settings: InquestState['settings'],
  seats: readonly { id: PlayerId; playing: boolean; volunteer: boolean }[],
): string | null {
  const playing = seats.filter((s) => s.playing);
  if (playing.length < MIN_PLAYERS)
    return `${MIN_PLAYERS} players are needed (${playing.length} so far).`;
  if (playing.length > MAX_PLAYERS) return `At most ${MAX_PLAYERS} can play.`;
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

/** The roles in play for a table of this size and these settings. */
export function rolesFor(
  count: number,
  s: Pick<InquestState['settings'], 'accomplice' | 'witness'>,
) {
  const roles: RoleId[] = ['forensic', 'murderer'];
  if (count >= EXTRA_ROLES_MIN && s.accomplice) roles.push('accomplice');
  if (count >= EXTRA_ROLES_MIN && s.accomplice && s.witness) roles.push('witness');
  while (roles.length < count) roles.push('investigator');
  return roles;
}
