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
  /** One line on what the setup plays like. */
  description: string;
  /** How hard it is on a new player: shown as a tag. */
  level: 'beginner' | 'advanced' | 'chaos';
  /** Fewest players the scenario suits. */
  minPlayers: number;
  roles: RoleId[];
}

/** The tag shown for each level. */
export const LEVEL_LABEL: Record<Preset['level'], string> = {
  beginner: 'Beginner',
  advanced: 'Advanced',
  chaos: 'Chaos',
};

/** The recommended table, described like a scenario. */
export const RECOMMENDED = {
  description: 'The best first game: the classic roles, sized for your table.',
  level: 'beginner',
} as const satisfies Pick<Preset, 'description' | 'level'>;

export const SCENARIOS: Preset[] = [
  {
    id: 'shapeshifters',
    name: 'Shapeshifters',
    description: 'Cards change hands all night: copies, the Alpha Wolf and the Witch.',
    level: 'chaos',
    minPlayers: 3,
    roles: ['doppelganger', 'alpha-wolf', 'mystic-wolf', 'minion', 'robber', 'witch', 'werewolf'],
  },
  {
    id: 'no-trust',
    name: 'Trust nobody',
    description: 'Nobody can be sure of their own card, and the Tanner wants to die.',
    level: 'chaos',
    minPlayers: 3,
    roles: ['doppelganger', 'alpha-wolf', 'dream-wolf', 'robber', 'witch', 'tanner', 'werewolf'],
  },
  {
    id: 'careful-village',
    name: 'A careful village',
    description: 'Plenty of village information and a Bodyguard: gentle on new players.',
    level: 'beginner',
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
    description: 'Everyone learns something; the trick is who to believe.',
    level: 'advanced',
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
    description: 'Copies, swaps, moves and artifacts: for players who know the base roles.',
    level: 'chaos',
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
  // The Vampire set: two vampires each, as its rules recommend.
  {
    id: 'lovers-night',
    name: 'Lovers’ night',
    description: 'A small vampire game with Marks, love and disease.',
    level: 'advanced',
    minPlayers: 3,
    roles: ['vampire', 'the-master', 'cupid', 'priest', 'diseased', 'pickpocket'],
  },
  {
    id: 'first-bite',
    name: 'First bite',
    description: 'Vampires with Marks flying everywhere: assassins, traitors and thieves.',
    level: 'chaos',
    minPlayers: 5,
    roles: [
      'vampire',
      'the-master',
      'diseased',
      'instigator',
      'assassin',
      'marksman',
      'pickpocket',
      'gremlin',
    ],
  },
  {
    id: 'counts-court',
    name: 'The Count’s court',
    description: 'The Count, Renfield and a Copycat: vampires for a confident table.',
    level: 'advanced',
    minPlayers: 5,
    roles: [
      'vampire',
      'the-count',
      'renfield',
      'copycat',
      'cupid',
      'priest',
      'marksman',
      'gremlin',
    ],
  },
  {
    id: 'fangs-and-claws',
    name: 'Fangs and claws (epic battle)',
    description: 'Werewolves against vampires: the two most voted players die.',
    level: 'chaos',
    minPlayers: 5,
    roles: [
      'werewolf',
      'werewolf',
      'vampire',
      'the-count',
      'seer',
      'cupid',
      'priest',
      'pickpocket',
    ],
  },
  // The Alien set: the setups its makers suggest, under names of our own.
  {
    id: 'first-contact',
    name: 'First contact',
    description: 'A gentle alien game: the Oracle, the Cow, the Blob and a Synthetic Alien.',
    level: 'advanced',
    minPlayers: 5,
    roles: ['oracle', 'alien', 'synthetic-alien', 'cow', 'rascal', 'exposer', 'empath', 'blob'],
  },
  {
    id: 'invasion',
    name: 'Invasion',
    description: 'Two aliens and a Cow among werewolves: who is tipping whom?',
    level: 'advanced',
    minPlayers: 5,
    roles: ['alien', 'alien', 'werewolf', 'cow', 'psychic', 'rascal', 'exposer', 'seer'],
  },
  {
    id: 'rivals',
    name: 'Rival worlds',
    description: 'Groob and Zerb, their Leader and a daybreak crew: for a full table.',
    level: 'chaos',
    minPlayers: 10,
    roles: [
      'sentinel',
      'synthetic-alien',
      'groob',
      'zerb',
      'leader',
      'psychic',
      'witch',
      'rascal',
      'exposer',
      'curator',
      'blob',
      'mortician',
      'bodyguard',
    ],
  },
  {
    id: 'five-sets',
    name: 'A bit of everything',
    description: 'Copies, wolves, an alien and a Gremlin: five boxes at one table.',
    level: 'chaos',
    minPlayers: 10,
    roles: [
      'oracle',
      'copycat',
      'alien',
      'synthetic-alien',
      'werewolf',
      'mystic-wolf',
      'thing',
      'seer',
      'witch',
      'troublemaker',
      'gremlin',
      'insomniac',
      'curator',
    ],
  },
  {
    id: 'three-way',
    name: 'Three-way war (epic battle)',
    description: 'Werewolves, vampires and aliens all at once: the two most voted die.',
    level: 'chaos',
    minPlayers: 6,
    roles: [
      'werewolf',
      'werewolf',
      'vampire',
      'the-count',
      'alien',
      'alien',
      'seer',
      'body-snatcher',
      'nostradamus',
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
