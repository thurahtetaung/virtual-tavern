/**
 * The role registry: one record per role id. Ids are plain English words; display names, card
 * text and portraits come from the private manifest at runtime, never from the repository.
 *
 * Everything that differs between roles is data here (set, team, box count, how a copy behaves,
 * which predicates it satisfies). The night steps live in `plan.ts`, their actions in `night.ts`,
 * and the vote in `resolve.ts`. Later sets add records, steps and hooks; nothing here assumes
 * the first wave's roles are the only ones.
 */

/** Every set the engine is built for, in release order. Only `ENABLED_SETS` are offered. */
export const SET_IDS = [
  'base',
  'daybreak',
  'bonus1',
  'bonus2',
  'vampire',
  'alien',
  'bonus3',
  'supervillains',
  'bonus4',
] as const;
export type SetId = (typeof SET_IDS)[number];

/** The sets whose roles can be picked today. */
export const ENABLED_SETS: readonly SetId[] = [
  'base',
  'daybreak',
  'bonus1',
  'bonus2',
  'vampire',
  'alien',
  'bonus3',
];

/** Neutral fallback names for the sets, used when the manifest has none. */
export const SET_LABELS: Record<SetId, string> = {
  base: 'Base set',
  daybreak: 'Daybreak',
  bonus1: 'Bonus pack 1',
  bonus2: 'Bonus pack 2',
  vampire: 'Vampire',
  alien: 'Alien',
  bonus3: 'Bonus pack 3',
  supervillains: 'Super villains',
  bonus4: 'Bonus pack 4',
};

export const ROLE_IDS = [
  // Base
  'doppelganger',
  'werewolf',
  'minion',
  'mason',
  'seer',
  'robber',
  'troublemaker',
  'drunk',
  'insomniac',
  'villager',
  'tanner',
  'hunter',
  // Daybreak
  'sentinel',
  'alpha-wolf',
  'mystic-wolf',
  'apprentice-seer',
  'paranormal-investigator',
  'witch',
  'village-idiot',
  'revealer',
  'curator',
  'bodyguard',
  'dream-wolf',
  // Bonus pack 1
  'aura-seer',
  'cursed',
  'prince',
  // Bonus pack 2
  'apprentice-tanner',
  'beholder',
  'squire',
  'thing',
  // Vampire
  'copycat',
  'vampire',
  'the-master',
  'the-count',
  'renfield',
  'diseased',
  'cupid',
  'instigator',
  'priest',
  'assassin',
  'apprentice-assassin',
  'marksman',
  'pickpocket',
  'gremlin',
  // Alien
  'oracle',
  'alien',
  'synthetic-alien',
  'cow',
  'groob',
  'zerb',
  'leader',
  'psychic',
  'rascal',
  'exposer',
  'blob',
  'mortician',
  // Bonus pack 3
  'body-snatcher',
  'empath',
  'nostradamus',
] as const;
export type RoleId = (typeof ROLE_IDS)[number];

/**
 * The team printed on a card. Own-team roles (the Tanner and his apprentice, the Assassin and
 * hers, the Synthetic Alien, the Blob and the Mortician) win on their own conditions. Later sets
 * add villains and more own teams.
 */
export type Team =
  | 'village'
  | 'werewolf'
  | 'tanner'
  | 'vampire'
  | 'assassin'
  | 'apprentice-assassin'
  | 'alien'
  | 'synthetic'
  | 'blob'
  | 'mortician';

/** The hostile groups a death can count against; later sets add villains. */
export const HOSTILE_GROUPS = ['werewolf', 'vampire', 'alien'] as const;
export type HostileGroup = (typeof HOSTILE_GROUPS)[number];

/**
 * How the Doppelgänger uses a role she copies:
 * - `immediate`: she does the action straight away, in her own step, and never wakes for it again;
 * - `later`: she wakes again in her own step right after the original's;
 * - `with-group`: she wakes with the group (werewolves, masons) when it is called;
 * - `minion`: she learns the werewolves at the end of her own step;
 * - `copycat`: she becomes whatever the Copycat copied, without learning it, and never wakes again;
 * - `none`: the role has no night action.
 */
export type DoppelMode = 'immediate' | 'later' | 'with-group' | 'minion' | 'copycat' | 'none';

export interface RoleDef {
  id: RoleId;
  set: SetId;
  /** Cards of this role in its box: the most a setup may use. */
  count: number;
  team: Team;
  /**
   * Whether the card reads as village to roles that check a card's team (the Revealer and the
   * P.I.). Copier and P.I. cards count as village because their face doesn't show what they became.
   */
  villageCard: boolean;
  /** A Werewolf for every win and vote rule (the Minion and Squire are on the team but aren't). */
  werewolf?: boolean;
  /** Wakes in the werewolves' step. */
  wakesWithWerewolves?: boolean;
  /** Shows a werewolf thumb to the Minion and Squire (every Werewolf, the Dream Wolf included). */
  werewolfThumb?: boolean;
  /** A Vampire for every win and vote rule (Renfield is on the team but isn't). */
  vampire?: boolean;
  /** Wakes in the vampires' step. */
  wakesWithVampires?: boolean;
  /** An Alien for every win and vote rule (the Synthetic Alien too; the Cow and Leader aren't). */
  alien?: boolean;
  /** Wakes in the aliens' step (and shows the Leader an alien thumb). */
  wakesWithAliens?: boolean;
  doppel: DoppelMode;
  /** Takes longer at night: its steps last twice as long, as in the narrator. */
  complex?: boolean;
  /** A neutral one-line description of what the role does, for placeholders and the guide. */
  summary: string;
  /** How the role wins, in neutral words. */
  win: string;
}

/** The village's win, in general; `winFor` words it for one setup. */
const VILLAGE_WIN =
  'Wins with the village: at least one Werewolf or Vampire dies (one of each in an epic battle), or nobody dies if no player is either.';
const WOLF_WIN = 'Wins with the werewolves: no Werewolf dies.';
const VAMPIRE_WIN = 'Wins with the vampires: no Vampire dies.';
const ALIEN_WIN =
  'Wins with the aliens: no Alien dies (and the Synthetic Alien doesn’t die either).';

const role = (def: RoleDef): RoleDef => def;

export const ROLES: Record<RoleId, RoleDef> = {
  doppelganger: role({
    id: 'doppelganger',
    set: 'base',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'none',
    complex: true,
    summary:
      'Wakes first and looks at another player’s card, then becomes that role and plays it for the rest of the night.',
    win: 'Wins as the role she copied.',
  }),
  werewolf: role({
    id: 'werewolf',
    set: 'base',
    count: 2,
    team: 'werewolf',
    villageCard: false,
    werewolf: true,
    wakesWithWerewolves: true,
    werewolfThumb: true,
    doppel: 'with-group',
    summary:
      'Wakes with the other werewolves to see who they are. A lone werewolf may look at one centre card.',
    win: WOLF_WIN,
  }),
  minion: role({
    id: 'minion',
    set: 'base',
    count: 1,
    team: 'werewolf',
    villageCard: false,
    doppel: 'minion',
    summary: 'Wakes to see who the werewolves are; they don’t learn who the Minion is.',
    win: 'Wins with the werewolves, even if the Minion dies. With no Werewolf among the players, wins if anyone else dies.',
  }),
  mason: role({
    id: 'mason',
    set: 'base',
    count: 2,
    team: 'village',
    villageCard: true,
    doppel: 'with-group',
    summary: 'Wakes with the other Mason to see who they are.',
    win: VILLAGE_WIN,
  }),
  seer: role({
    id: 'seer',
    set: 'base',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    summary: 'May look at another player’s card, or at two centre cards.',
    win: VILLAGE_WIN,
  }),
  robber: role({
    id: 'robber',
    set: 'base',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    summary:
      'May swap cards with another player, then looks at the new card (without doing its action).',
    win: 'Wins as whatever card ends up in front of them.',
  }),
  troublemaker: role({
    id: 'troublemaker',
    set: 'base',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    summary: 'May swap the cards of two other players without looking at them.',
    win: VILLAGE_WIN,
  }),
  drunk: role({
    id: 'drunk',
    set: 'base',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    summary: 'Must swap their card with a centre card, without looking at the new one.',
    win: 'Wins as whatever card ends up in front of them.',
  }),
  insomniac: role({
    id: 'insomniac',
    set: 'base',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    summary: 'Wakes near the end of the night and looks at their own card.',
    win: VILLAGE_WIN,
  }),
  villager: role({
    id: 'villager',
    set: 'base',
    count: 3,
    team: 'village',
    villageCard: true,
    doppel: 'none',
    summary: 'Has no night action.',
    win: VILLAGE_WIN,
  }),
  tanner: role({
    id: 'tanner',
    set: 'base',
    count: 1,
    team: 'tanner',
    villageCard: false,
    doppel: 'none',
    summary: 'Hates the job. Has no night action and wants to be voted out.',
    win: 'Wins only if the Tanner dies. If the Tanner dies, no evil team can win.',
  }),
  hunter: role({
    id: 'hunter',
    set: 'base',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'none',
    summary: 'If the Hunter dies, the player the Hunter voted for dies too.',
    win: VILLAGE_WIN,
  }),
  sentinel: role({
    id: 'sentinel',
    set: 'daybreak',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    summary:
      'May put a shield on another player’s card. A shielded card can’t be looked at or moved.',
    win: VILLAGE_WIN,
  }),
  'alpha-wolf': role({
    id: 'alpha-wolf',
    set: 'daybreak',
    count: 1,
    team: 'werewolf',
    villageCard: false,
    werewolf: true,
    wakesWithWerewolves: true,
    werewolfThumb: true,
    doppel: 'immediate',
    summary:
      'Wakes with the werewolves, then must swap the centre werewolf card with a non-werewolf player’s card.',
    win: WOLF_WIN,
  }),
  'mystic-wolf': role({
    id: 'mystic-wolf',
    set: 'daybreak',
    count: 1,
    team: 'werewolf',
    villageCard: false,
    werewolf: true,
    wakesWithWerewolves: true,
    werewolfThumb: true,
    doppel: 'immediate',
    summary: 'Wakes with the werewolves, then may look at another player’s card.',
    win: WOLF_WIN,
  }),
  'apprentice-seer': role({
    id: 'apprentice-seer',
    set: 'daybreak',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    summary: 'May look at one centre card.',
    win: VILLAGE_WIN,
  }),
  'paranormal-investigator': role({
    id: 'paranormal-investigator',
    set: 'daybreak',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    complex: true,
    summary:
      'May look at up to two other players’ cards, one at a time. On seeing a card that isn’t village, stops and becomes that role (without waking for it).',
    win: 'Wins with the village, or as the role the investigator became.',
  }),
  witch: role({
    id: 'witch',
    set: 'daybreak',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    summary:
      'May look at a centre card. If she does, she must swap it with any player’s card, her own included.',
    win: VILLAGE_WIN,
  }),
  'village-idiot': role({
    id: 'village-idiot',
    set: 'daybreak',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    complex: true,
    summary:
      'May move every other player’s card one seat to the left or to the right. Shielded cards stay put.',
    win: VILLAGE_WIN,
  }),
  revealer: role({
    id: 'revealer',
    set: 'daybreak',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    summary:
      'May turn another player’s card face up. If it isn’t a village card, it goes back face down.',
    win: VILLAGE_WIN,
  }),
  curator: role({
    id: 'curator',
    set: 'daybreak',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    summary:
      'May place a random artifact face down on any player’s card. Its holder sees it at daybreak.',
    win: VILLAGE_WIN,
  }),
  bodyguard: role({
    id: 'bodyguard',
    set: 'daybreak',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'none',
    summary: 'The player the Bodyguard points at in the vote can’t be killed.',
    win: VILLAGE_WIN,
  }),
  'dream-wolf': role({
    id: 'dream-wolf',
    set: 'daybreak',
    count: 1,
    team: 'werewolf',
    villageCard: false,
    werewolf: true,
    werewolfThumb: true,
    doppel: 'none',
    summary: 'A Werewolf who doesn’t wake: shows a thumb so the other werewolves know who it is.',
    win: WOLF_WIN,
  }),
  'aura-seer': role({
    id: 'aura-seer',
    set: 'bonus1',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    summary: 'Learns which players have looked at or moved a card so far tonight.',
    win: VILLAGE_WIN,
  }),
  cursed: role({
    id: 'cursed',
    set: 'bonus1',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'none',
    summary:
      'If any Werewolf votes for the Cursed, the Cursed becomes a Werewolf. With vampires in the game, a Vampire’s vote turns him too: he joins the side that cast more of those votes (a tie makes him a Werewolf).',
    win: 'Wins with the village, or, once turned, with the side that turned him.',
  }),
  prince: role({
    id: 'prince',
    set: 'bonus1',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'none',
    summary: 'Votes for the Prince don’t count, so the Prince can’t be voted out.',
    win: VILLAGE_WIN,
  }),
  'apprentice-tanner': role({
    id: 'apprentice-tanner',
    set: 'bonus2',
    count: 1,
    team: 'tanner',
    villageCard: false,
    doppel: 'later',
    summary: 'Wakes (when the Tanner is in the game) to see who the Tanner is.',
    win: 'Wins if a Tanner dies. With no Tanner among the players, wins only by dying.',
  }),
  beholder: role({
    id: 'beholder',
    set: 'bonus2',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    complex: true,
    summary: 'Learns who the seers are and may look at their cards.',
    win: VILLAGE_WIN,
  }),
  squire: role({
    id: 'squire',
    set: 'bonus2',
    count: 1,
    team: 'werewolf',
    villageCard: false,
    doppel: 'later',
    complex: true,
    summary: 'Learns who the werewolves are and may look at their cards.',
    win: 'Wins with the werewolves, even if the Squire dies. With no Werewolf among the players, wins if anyone else dies.',
  }),
  thing: role({
    id: 'thing',
    set: 'bonus2',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    summary:
      'May tap the neighbour on the left or the right; that player learns which side the tap came from.',
    win: VILLAGE_WIN,
  }),
  copycat: role({
    id: 'copycat',
    set: 'vampire',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'copycat',
    summary:
      'Wakes first and must look at a centre card, then becomes that role: wakes when it is called and plays it.',
    win: 'Wins as the role copied. A Copycat card that never woke is a plain Villager.',
  }),
  vampire: role({
    id: 'vampire',
    set: 'vampire',
    count: 1,
    team: 'vampire',
    villageCard: false,
    vampire: true,
    wakesWithVampires: true,
    doppel: 'with-group',
    summary:
      'Wakes with the other vampires; together they must give the Mark of the Vampire to a player who isn’t one.',
    win: VAMPIRE_WIN,
  }),
  'the-master': role({
    id: 'the-master',
    set: 'vampire',
    count: 1,
    team: 'vampire',
    villageCard: false,
    vampire: true,
    wakesWithVampires: true,
    doppel: 'with-group',
    summary:
      'Wakes with the vampires. If another Vampire votes for The Master, The Master can’t be killed by the vote.',
    win: VAMPIRE_WIN,
  }),
  'the-count': role({
    id: 'the-count',
    set: 'vampire',
    count: 1,
    team: 'vampire',
    villageCard: false,
    vampire: true,
    wakesWithVampires: true,
    doppel: 'later',
    summary:
      'Wakes with the vampires, then again to give the Mark of Fear to a player who isn’t a vampire.',
    win: VAMPIRE_WIN,
  }),
  renfield: role({
    id: 'renfield',
    set: 'vampire',
    count: 1,
    team: 'vampire',
    villageCard: false,
    doppel: 'later',
    summary:
      'Sees the vampires and the player they marked, then takes the Mark of the Bat. On their team, but not a Vampire.',
    win: 'Wins with the vampires, even if Renfield dies. With no Vampire among the players, wins with the village.',
  }),
  diseased: role({
    id: 'diseased',
    set: 'vampire',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    summary:
      'Must give the Mark of Disease to the neighbour on the left or right. Anyone who votes for that player, or for the Diseased, can’t win.',
    win: VILLAGE_WIN,
  }),
  cupid: role({
    id: 'cupid',
    set: 'vampire',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    complex: true,
    summary:
      'May give the Mark of Love to two players (Cupid included). If one lover dies, the other dies too.',
    win: VILLAGE_WIN,
  }),
  instigator: role({
    id: 'instigator',
    set: 'vampire',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'immediate',
    summary:
      'May give the Mark of the Traitor to any player: they win only if someone else on their team dies.',
    win: VILLAGE_WIN,
  }),
  priest: role({
    id: 'priest',
    set: 'vampire',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    complex: true,
    summary:
      'Must take a Mark of Clarity, and may give one to another player, wiping out the Mark they had.',
    win: VILLAGE_WIN,
  }),
  assassin: role({
    id: 'assassin',
    set: 'vampire',
    count: 1,
    team: 'assassin',
    villageCard: false,
    doppel: 'later',
    summary: 'Must give the Mark of the Assassin to any player (the Assassin included).',
    win: 'Wins if a player with the Mark of the Assassin dies, alive or not, alongside any team. With no such Mark in play, a plain Villager.',
  }),
  'apprentice-assassin': role({
    id: 'apprentice-assassin',
    set: 'vampire',
    count: 1,
    team: 'apprentice-assassin',
    villageCard: false,
    doppel: 'later',
    summary:
      'Wakes with the Assassin to see who it is. With no Assassin awake, must give the Mark of the Assassin herself.',
    win: 'Wins if an Assassin dies. If she placed the Mark of the Assassin herself (no Assassin woke), wins when its holder dies, wherever her card ends up.',
  }),
  marksman: role({
    id: 'marksman',
    set: 'vampire',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    complex: true,
    summary: 'May look at one player’s Mark and a different player’s card.',
    win: VILLAGE_WIN,
  }),
  pickpocket: role({
    id: 'pickpocket',
    set: 'vampire',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    summary: 'May swap Marks with another player, then looks at the new Mark.',
    win: VILLAGE_WIN,
  }),
  gremlin: role({
    id: 'gremlin',
    set: 'vampire',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    summary:
      'May swap the Marks, or the cards, of any two players (the Gremlin included), without looking.',
    win: VILLAGE_WIN,
  }),
  oracle: role({
    id: 'oracle',
    set: 'alien',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'none',
    complex: true,
    summary:
      'Wakes first and answers one question from the narrator: join a team, look at centre cards, swap with the centre, guess a number… Her answer can change her team or the night.',
    win: 'Wins with the village, or with the team she joined (without becoming that role). If she fails the number question, she wins only by surviving, and everyone else wins only if she dies.',
  }),
  alien: role({
    id: 'alien',
    set: 'alien',
    count: 2,
    team: 'alien',
    villageCard: false,
    alien: true,
    wakesWithAliens: true,
    doppel: 'with-group',
    summary:
      'Wakes with the other aliens, then does whatever the narrator says tonight: look at a card, show cards, pass cards, recruit a new alien…',
    win: ALIEN_WIN,
  }),
  'synthetic-alien': role({
    id: 'synthetic-alien',
    set: 'alien',
    count: 1,
    team: 'synthetic',
    villageCard: false,
    alien: true,
    wakesWithAliens: true,
    doppel: 'with-group',
    summary:
      'Wakes with the aliens and counts as one for every instruction, but plays for himself.',
    win: 'Wins only if he dies. If the Synthetic Alien dies, the aliens and the village both lose.',
  }),
  cow: role({
    id: 'cow',
    set: 'alien',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'with-group',
    summary:
      'Puts out a fist while the aliens are awake. If an alien sits right next to the Cow, one of them must tap it: the Cow learns whether it was tapped.',
    win: VILLAGE_WIN,
  }),
  groob: role({
    id: 'groob',
    set: 'alien',
    count: 1,
    team: 'alien',
    villageCard: false,
    alien: true,
    wakesWithAliens: true,
    doppel: 'with-group',
    summary:
      'Wakes with the aliens, then again with Zerb to see whether Zerb is at the table. With both at the table, they are rivals.',
    win: 'With Zerb also among the players: wins only if Zerb dies and Groob lives (the village wins too, and the other aliens lose). Otherwise wins with the aliens.',
  }),
  zerb: role({
    id: 'zerb',
    set: 'alien',
    count: 1,
    team: 'alien',
    villageCard: false,
    alien: true,
    wakesWithAliens: true,
    doppel: 'with-group',
    summary:
      'Wakes with the aliens, then again with Groob to see whether Groob is at the table. With both at the table, they are rivals.',
    win: 'With Groob also among the players: wins only if Groob dies and Zerb lives (the village wins too, and the other aliens lose). Otherwise wins with the aliens.',
  }),
  leader: role({
    id: 'leader',
    set: 'alien',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    summary:
      'Sees the aliens’ thumbs, and whether Groob and Zerb found each other. If every player on the alien side votes for the Leader, the aliens win.',
    win: 'Wins with the village. With Groob and Zerb both among the players, wins only if both of them live (the Leader’s own life doesn’t matter).',
  }),
  psychic: role({
    id: 'psychic',
    set: 'alien',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    summary: 'May look at one (or two) cards of the players the narrator names: even or odd.',
    win: VILLAGE_WIN,
  }),
  rascal: role({
    id: 'rascal',
    set: 'alien',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    summary:
      'Moves cards the way the narrator says tonight: like the Troublemaker, the Witch, the Robber, the Drunk or the Village Idiot, among the players it names.',
    win: VILLAGE_WIN,
  }),
  exposer: role({
    id: 'exposer',
    set: 'alien',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    summary:
      'May turn exactly as many centre cards face up as the narrator says (one, two or three), or none. They stay face up for everyone to see.',
    win: VILLAGE_WIN,
  }),
  blob: role({
    id: 'blob',
    set: 'alien',
    count: 1,
    team: 'blob',
    villageCard: false,
    doppel: 'none',
    summary:
      'Doesn’t wake. The narrator announces which neighbours are part of the Blob, counted from wherever the Blob card ends up.',
    win: 'Wins if nobody in the Blob dies, the Blob included, alongside any other team.',
  }),
  mortician: role({
    id: 'mortician',
    set: 'alien',
    count: 1,
    team: 'mortician',
    villageCard: false,
    doppel: 'later',
    summary:
      'May look at the neighbours’ cards (or the Mortician’s own) as the narrator says, or only pretends to.',
    win: 'Wins if at least one neighbour of the Mortician card dies, alive or not, alongside any other team.',
  }),
  'body-snatcher': role({
    id: 'body-snatcher',
    set: 'bonus3',
    count: 1,
    team: 'alien',
    villageCard: false,
    alien: true,
    wakesWithAliens: true,
    doppel: 'later',
    summary:
      'Wakes with the aliens, then again: must take a non-alien’s card (or a centre card) as the narrator says and look at it. That card is now an Alien card, wherever it goes.',
    win: ALIEN_WIN,
  }),
  empath: role({
    id: 'empath',
    set: 'bonus3',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    summary:
      'Watches while the players the narrator names point, eyes closed, at whoever fits its question (“the most suspicious player”…).',
    win: VILLAGE_WIN,
  }),
  nostradamus: role({
    id: 'nostradamus',
    set: 'bonus3',
    count: 1,
    team: 'village',
    villageCard: true,
    doppel: 'later',
    complex: true,
    summary:
      'May look at up to three other players’ cards, one at a time, stopping at one that isn’t village. The last card seen decides his team, which the narrator announces to everyone.',
    win: 'Wins only if he lives and the team he was announced on wins (with an own-team card, if its holder wins). He isn’t a member of that team: his death doesn’t make it lose.',
  }),
};

export const isRoleId = (id: string): id is RoleId => id in ROLES;

/**
 * The team Nostradamus is announced on, from the last card he saw: its printed team, or for the
 * cards whose face doesn't tell (copiers, the Oracle, the P.I.) the narrator's own team words.
 */
export const NOSTRA_TEAMS = [
  'village',
  'werewolf',
  'vampire',
  'alien',
  'tanner',
  'synthetic',
  'blob',
  'mortician',
  'assassin',
  'apprentice-assassin',
  'doppelganger',
  'copycat',
  'oracle',
  'paranormal-investigator',
] as const;
export type NostraTeam = (typeof NOSTRA_TEAMS)[number];

export function nostraTeamOf(role: RoleId): NostraTeam {
  if (
    role === 'doppelganger' ||
    role === 'copycat' ||
    role === 'oracle' ||
    role === 'paranormal-investigator'
  )
    return role;
  return ROLES[role].team;
}

/** Roles that can be picked today, grouped by set in registry order. */
export function rolesBySet(
  sets: readonly SetId[] = ENABLED_SETS,
): { set: SetId; roles: RoleId[] }[] {
  return sets.map((set) => ({ set, roles: ROLE_IDS.filter((r) => ROLES[r].set === set) }));
}

const SMALL_WORDS = new Set(['of', 'the', 'a', 'an', 'and']);

/**
 * The plain role id as a title-cased label, matching how the cards read: "alpha-wolf" → "Alpha
 * Wolf", "claw-of-the-werewolf" → "Claw of the Werewolf". The manifest supplies real names.
 */
export const roleLabel = (id: string) =>
  id
    .split('-')
    .map((w, i) =>
      w === 'doppelganger'
        ? 'Doppelgänger'
        : i > 0 && SMALL_WORDS.has(w)
          ? w
          : w[0]!.toUpperCase() + w.slice(1),
    )
    .join(' ');

// ---- Marks (the Vampire set) ----

/** Mark ids, as in the private manifest. */
export const MARK_IDS = [
  'clarity',
  'vampire',
  'fear',
  'bat',
  'disease',
  'love',
  'traitor',
  'assassin',
] as const;
export type MarkId = (typeof MARK_IDS)[number];

/** A neutral description of each Mark, for placeholders and the guide. */
export const MARKS: Record<MarkId, string> = {
  clarity: 'No effect: your card says who you are.',
  vampire: 'You are a Vampire, on the vampire team, and keep your own night action and vote power.',
  fear: 'You may not do any part of your night action, not even open your eyes.',
  bat: 'No effect.',
  disease: 'Anyone who votes for you can’t win (you still can).',
  love: 'If another player with a Mark of Love dies, you die too, even if protected.',
  traitor: 'You win only if someone else on your team dies.',
  assassin: 'If you die, the Assassin wins.',
};

/** Roles whose game hands every player a Mark (of Clarity) and runs Marks. */
export const MARK_ROLES: ReadonlySet<RoleId> = new Set<RoleId>([
  'vampire',
  'the-master',
  'the-count',
  'renfield',
  'diseased',
  'cupid',
  'instigator',
  'priest',
  'assassin',
  'apprentice-assassin',
  'marksman',
  'pickpocket',
  'gremlin',
]);

export const marksInUse = (roles: readonly RoleId[]) => roles.some((r) => MARK_ROLES.has(r));

/** The Mark each role gives or takes (the vampires' step gives the Mark of the Vampire). */
const MARK_OF_ROLE: Partial<Record<RoleId, MarkId>> = {
  vampire: 'vampire',
  'the-master': 'vampire',
  'the-count': 'fear',
  renfield: 'bat',
  diseased: 'disease',
  cupid: 'love',
  instigator: 'traitor',
  assassin: 'assassin',
  'apprentice-assassin': 'assassin',
};

/** The Marks that can turn up with these cards, Clarity first (everyone starts with one). */
export function marksInPlay(roles: readonly RoleId[]): MarkId[] {
  if (!marksInUse(roles)) return [];
  const given = new Set(roles.flatMap((r) => (MARK_OF_ROLE[r] ? [MARK_OF_ROLE[r]] : [])));
  if (roles.some((r) => ROLES[r].wakesWithVampires)) given.add('vampire');
  return MARK_IDS.filter((m) => m === 'clarity' || given.has(m));
}

/** The hostile group a role's card counts towards, if any. */
export function groupOfRole(role: RoleId): HostileGroup | null {
  const def = ROLES[role];
  if (def.vampire) return 'vampire';
  if (def.werewolf) return 'werewolf';
  if (def.alien) return 'alien';
  return null;
}

/** Hostile groups these roles can put in play (for the "epic battle" warning). */
export function hostileGroupsIn(roles: readonly RoleId[]): HostileGroup[] {
  const groups = new Set(roles.map(groupOfRole));
  return HOSTILE_GROUPS.filter((g) => groups.has(g));
}

/**
 * Hostile groups a setup can put among the players: by card, or by an artifact the Curator may
 * draw (the Claw makes a Werewolf, the Mist a Vampire, the Alien Artifact an Alien).
 */
export function sidesIn(
  roles: readonly RoleId[],
  artifacts: readonly ArtifactId[] = [],
): HostileGroup[] {
  const drawn = roles.includes('curator')
    ? artifacts.filter((a) => defaultArtifacts(roles).includes(a))
    : [];
  const extra = drawn.flatMap((a) => {
    const becomes = ARTIFACTS[a].becomes;
    return becomes ? [becomes] : [];
  });
  return hostileGroupsIn([...roles, ...extra]);
}

const PLURAL: Record<HostileGroup, string> = {
  werewolf: 'werewolves',
  vampire: 'vampires',
  alien: 'aliens',
};

const GROUP_WORD: Record<HostileGroup, string> = {
  werewolf: 'Werewolf',
  vampire: 'Vampire',
  alien: 'Alien',
};

/** "Werewolf", "Werewolf or Vampire", "Werewolf, Vampire or Alien". */
const either = (groups: readonly HostileGroup[]) => {
  const words = groups.map((g) => GROUP_WORD[g]);
  return words.length <= 1
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
};

/** The village's win for a setup with these hostile groups. */
export function villageWin(groups: readonly HostileGroup[]): string {
  if (groups.length >= 2) {
    const sides = groups.map((g) => PLURAL[g]).join(', ');
    const need =
      groups.length === 2
        ? 'at least one of each must die'
        : 'players from at least two different evil sides must die';
    return `Wins with the village: at least one ${either(groups)} dies. In an epic battle (${sides} and villagers all among the players), ${need}.`;
  }
  if (groups.length === 1)
    return `Wins with the village: at least one ${GROUP_WORD[groups[0]!]} dies (or, if no player is a ${GROUP_WORD[groups[0]!]}, nobody dies).`;
  return 'Wins with the village: nobody dies (no player can be a Werewolf, Vampire or Alien).';
}

/** How a role wins, worded for the cards in this game (`roles`) and the Curator's artifacts. */
export function winFor(
  role: RoleId,
  roles: readonly RoleId[],
  artifacts: readonly ArtifactId[] = [],
): string {
  const def = ROLES[role];
  const groups = sidesIn(roles, artifacts);
  if (def.win === VILLAGE_WIN) return villageWin(groups);
  if (groups.length < 2) return def.win;
  const others = (g: HostileGroup) => either(groups.filter((x) => x !== g));
  if (def.win === WOLF_WIN)
    return `Wins with the werewolves: no Werewolf dies. In an epic battle, a ${others('werewolf')} must die too.`;
  if (def.win === VAMPIRE_WIN)
    return `Wins with the vampires: no Vampire dies. In an epic battle, a ${others('vampire')} must die too.`;
  if (def.win === ALIEN_WIN)
    return `${ALIEN_WIN} In an epic battle, a ${others('alien')} must die too.`;
  return def.win;
}

// ---- Artifacts (placed by the Curator) ----

/** Artifact ids, as in the private manifest. */
export const ARTIFACT_IDS = [
  'claw-of-the-werewolf',
  'brand-of-the-villager',
  'cudgel-of-the-tanner',
  'void-of-nothingness',
  'mask-of-muting',
  'shroud-of-shame',
  'bow-of-the-hunter',
  'cloak-of-the-prince',
  'sword-of-the-bodyguard',
  'mist-of-the-vampire',
  'dagger-of-the-traitor',
  'alien-artifact',
] as const;
export type ArtifactId = (typeof ARTIFACT_IDS)[number];

export interface ArtifactDef {
  id: ArtifactId;
  set: SetId;
  /** A role-changing artifact replaces the holder's role, team and abilities. */
  becomes?: RoleId;
  /** The holder wins only if another member of their own team dies. */
  traitor?: boolean;
  /** Only offered when roles from this set are in the game. */
  needsSet?: SetId;
  /** Only offered when one of the game's cards is an Alien. */
  needsAliens?: boolean;
  summary: string;
}

export const ARTIFACTS: Record<ArtifactId, ArtifactDef> = {
  'claw-of-the-werewolf': {
    id: 'claw-of-the-werewolf',
    set: 'daybreak',
    becomes: 'werewolf',
    summary: 'You are now a Werewolf.',
  },
  'brand-of-the-villager': {
    id: 'brand-of-the-villager',
    set: 'daybreak',
    becomes: 'villager',
    summary: 'You are now a Villager, with no special abilities.',
  },
  'cudgel-of-the-tanner': {
    id: 'cudgel-of-the-tanner',
    set: 'daybreak',
    becomes: 'tanner',
    summary: 'You are now a Tanner.',
  },
  'void-of-nothingness': { id: 'void-of-nothingness', set: 'daybreak', summary: 'No effect.' },
  'mask-of-muting': {
    id: 'mask-of-muting',
    set: 'daybreak',
    summary: 'You may not speak until after the vote (gestures are fine).',
  },
  'shroud-of-shame': {
    id: 'shroud-of-shame',
    set: 'daybreak',
    summary: 'Face away from the table until the vote; you may still talk.',
  },
  'bow-of-the-hunter': {
    id: 'bow-of-the-hunter',
    set: 'bonus1',
    becomes: 'hunter',
    summary: 'You are now a Hunter.',
  },
  'cloak-of-the-prince': {
    id: 'cloak-of-the-prince',
    set: 'bonus1',
    becomes: 'prince',
    summary: 'You are now a Prince.',
  },
  'sword-of-the-bodyguard': {
    id: 'sword-of-the-bodyguard',
    set: 'bonus1',
    becomes: 'bodyguard',
    summary: 'You are now a Bodyguard.',
  },
  'mist-of-the-vampire': {
    id: 'mist-of-the-vampire',
    set: 'bonus2',
    becomes: 'vampire',
    needsSet: 'vampire',
    summary: 'You are now a Vampire (only with vampire roles).',
  },
  'dagger-of-the-traitor': {
    id: 'dagger-of-the-traitor',
    set: 'bonus2',
    traitor: true,
    summary: 'You are a traitor: you win only if someone else on your team dies.',
  },
  'alien-artifact': {
    id: 'alien-artifact',
    set: 'bonus3',
    becomes: 'alien',
    needsAliens: true,
    summary: 'You are now an Alien, and win or lose with the aliens (only with alien roles).',
  },
};

/** Artifacts the Curator may draw by default for these roles. */
export function defaultArtifacts(roles: readonly RoleId[]): ArtifactId[] {
  const sets = new Set(roles.map((r) => ROLES[r].set));
  const aliens = roles.some((r) => ROLES[r].alien);
  return ARTIFACT_IDS.filter((a) => {
    const def = ARTIFACTS[a];
    return (!def.needsSet || sets.has(def.needsSet)) && (!def.needsAliens || aliens);
  });
}
