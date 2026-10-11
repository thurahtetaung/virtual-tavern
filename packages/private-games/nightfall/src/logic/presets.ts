import type { RoleId } from './roles.ts';
import { MAX_PLAYERS, MIN_PLAYERS } from './types.ts';

/**
 * Ready-made setups. Scenarios list the roles they need and are topped up with Villagers to
 * players + 3 cards; the per-count setups are a sensible table for each player count. Names here
 * are our own; the manifest may give scenarios their printed names (`presets.<id>.name`).
 */
export interface Preset {
  id: string;
  name: string;
  /** Fewest players the scenario suits. */
  minPlayers: number;
  roles: RoleId[];
}

export const SCENARIOS: Preset[] = [
  {
    id: 'shapeshifters',
    name: 'Shapeshifters',
    minPlayers: 3,
    roles: ['doppelganger', 'alpha-wolf', 'mystic-wolf', 'minion', 'robber', 'witch', 'werewolf'],
  },
  {
    id: 'no-trust',
    name: 'Trust nobody',
    minPlayers: 3,
    roles: ['doppelganger', 'alpha-wolf', 'dream-wolf', 'robber', 'witch', 'tanner', 'werewolf'],
  },
  {
    id: 'careful-village',
    name: 'A careful village',
    minPlayers: 4,
    roles: [
      'werewolf',
      'mystic-wolf',
      'seer',
      'apprentice-seer',
      'revealer',
      'hunter',
      'bodyguard',
    ],
  },
  {
    id: 'information',
    name: 'Everybody knows something',
    minPlayers: 5,
    roles: [
      'werewolf',
      'mystic-wolf',
      'seer',
      'apprentice-seer',
      'paranormal-investigator',
      'witch',
      'insomniac',
      'revealer',
    ],
  },
  {
    id: 'chaos',
    name: 'Total mayhem',
    minPlayers: 5,
    roles: [
      'doppelganger',
      'alpha-wolf',
      'werewolf',
      'robber',
      'witch',
      'troublemaker',
      'village-idiot',
      'curator',
      'mystic-wolf',
    ],
  },
];

/** A balanced table for each player count (the first game, growing with the table). */
const BY_COUNT: Record<number, RoleId[]> = {
  3: ['werewolf', 'werewolf', 'seer', 'robber', 'troublemaker', 'villager'],
  4: ['werewolf', 'werewolf', 'seer', 'robber', 'troublemaker', 'villager', 'villager'],
  5: ['werewolf', 'werewolf', 'seer', 'robber', 'troublemaker', 'villager', 'villager', 'villager'],
  6: [
    'werewolf',
    'werewolf',
    'minion',
    'seer',
    'robber',
    'troublemaker',
    'drunk',
    'insomniac',
    'villager',
  ],
  7: [
    'werewolf',
    'werewolf',
    'minion',
    'seer',
    'robber',
    'troublemaker',
    'drunk',
    'insomniac',
    'mason',
    'mason',
  ],
  8: [
    'werewolf',
    'werewolf',
    'minion',
    'seer',
    'robber',
    'troublemaker',
    'drunk',
    'insomniac',
    'mason',
    'mason',
    'hunter',
  ],
  9: [
    'werewolf',
    'werewolf',
    'minion',
    'seer',
    'robber',
    'troublemaker',
    'drunk',
    'insomniac',
    'mason',
    'mason',
    'hunter',
    'tanner',
  ],
  10: [
    'doppelganger',
    'werewolf',
    'werewolf',
    'minion',
    'seer',
    'robber',
    'troublemaker',
    'drunk',
    'insomniac',
    'mason',
    'mason',
    'hunter',
    'tanner',
  ],
};

/** The recommended setup for a table of `players`. */
export const recommended = (players: number): RoleId[] => [
  ...BY_COUNT[Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, players))]!,
];

/** Cards needed: one each, three in the centre, and the centre werewolf with the Alpha Wolf. */
export const cardsNeeded = (players: number, roles: readonly RoleId[]) =>
  players + 3 + (roles.includes('alpha-wolf') ? 1 : 0);

/** A scenario for a table of `players`: its roles, topped up with Villagers (null if too few). */
export function scenarioRoles(preset: Preset, players: number): RoleId[] | null {
  if (players < preset.minPlayers) return null;
  const roles = [...preset.roles];
  const need = cardsNeeded(players, roles);
  if (roles.length > need) return null;
  let villagers = 0;
  while (roles.length < need && villagers < 3) {
    roles.push('villager');
    villagers++;
  }
  // Past three Villagers, add the plain village roles that fit any table.
  for (const extra of ['mason', 'mason', 'hunter', 'insomniac', 'seer'] as RoleId[]) {
    if (roles.length >= need) break;
    if (
      !roles.includes(extra) ||
      (extra === 'mason' && roles.filter((r) => r === 'mason').length < 2)
    )
      roles.push(extra);
  }
  return roles.length === need ? roles : null;
}
