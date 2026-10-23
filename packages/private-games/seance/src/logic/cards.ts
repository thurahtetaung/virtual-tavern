import { CARD_SETS as PICTURE_SETS, STELLAR_SET } from '@vt/private-reverie/cards';

/**
 * Séance's cards, by number only. Art and set names live in the private `seance/manifest.json` in
 * asset storage (`vision/<n>.webp`, `suspect/<n>.webp`, `place/<n>.webp`, `object/<n>.webp`,
 * `story/<n>.webp`, each with a `thumb/` copy), so the rules need no I/O and the repository never
 * holds a card name.
 *
 * The ghost's cards are the psychics' cards (the same art), so one id serves both sides.
 */

/** The three things each psychic must find, in the order they look for them. */
export const PILLARS = ['suspect', 'place', 'object'] as const;
export type Pillar = (typeof PILLARS)[number];

/**
 * What the third pillar is played with: objects, or story cards in their place (the host's
 * choice; the rules are the same).
 */
export const THIRDS = ['object', 'story'] as const;
export type Third = (typeof THIRDS)[number];

/** Every card kind with art: the visions the ghost sends, the pillar cards and the stories. */
export type Kind = 'vision' | Pillar | 'story';

/** The card kind a pillar is played with. */
export const kindOf = (pillar: Pillar, third: Third = 'object'): Kind =>
  pillar === 'object' ? third : pillar;

/**
 * Whether a card of this kind is a card of the pillar. Compare a card's kind with a pillar only
 * through this: the third pillar's cards are stories when the host picks them.
 */
export const isPillarCard = (kind: Kind, pillar: Pillar, third: Third = 'object') =>
  kind === kindOf(pillar, third);

/**
 * Card sets: each a lobby toggle that adds its visions and its pillar cards. Ids are neutral; the
 * private manifest names them. New sets go here; the extra vision pools are below.
 */
export const SET_IDS = ['base', 'exp1', 'exp2', 'promo'] as const;
export type SetId = (typeof SET_IDS)[number];

/** Placeholder names, used until the manifest loads (and in tests). */
export const SET_LABELS: Record<SetId, string> = {
  base: 'Core set',
  exp1: 'Expansion 1',
  exp2: 'Expansion 2',
  promo: 'Promos',
};

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

/**
 * Card numbers per set and kind, contiguous within each set (cut in this order by the private
 * asset scripts): 173 visions, 31 suspects, 31 places, 32 objects and 20 stories in all.
 */
export const CARD_SETS: Readonly<Record<SetId, Readonly<Record<Kind, readonly number[]>>>> = {
  base: {
    vision: range(1, 84),
    suspect: range(1, 18),
    place: range(1, 18),
    object: range(1, 18),
    story: [],
  },
  exp1: {
    vision: range(85, 126),
    suspect: range(19, 24),
    place: range(19, 24),
    object: range(19, 24),
    story: [],
  },
  exp2: {
    vision: range(127, 168),
    suspect: range(25, 30),
    place: range(25, 30),
    object: range(25, 30),
    story: range(1, 18),
  },
  promo: {
    vision: range(169, 173),
    suspect: [31],
    place: [31],
    object: [31, 32],
    story: [19, 20],
  },
};

/**
 * Extra vision pools from other picture-card games, each a lobby toggle (off by default). Their
 * visions are numbered on after the sets' 173. `pool-a` and `pool-b` are cut into Séance's own
 * storage; `pool-r` plays the picture cards Reverie already stores (its card sets but Starlight's
 * own), in their order, so its art comes from the manifest's pointer at Reverie's files.
 */
export const POOL_IDS = ['pool-a', 'pool-b', 'pool-r'] as const;
export type PoolId = (typeof POOL_IDS)[number];

/** Placeholder names, used until the manifest loads (and in tests). */
export const POOL_LABELS: Record<PoolId, string> = {
  'pool-a': 'Extra visions A',
  'pool-b': 'Extra visions B',
  'pool-r': 'Reverie’s pictures',
};

/** Reverie's card numbers that `pool-r` plays, in order: its vision `n` is the `n - first`th. */
export const POOL_R_CARDS: readonly number[] = PICTURE_SETS.filter(
  (s) => s.id !== STELLAR_SET,
).flatMap((s) => s.cards);

const POOL_R_FIRST = 426;

export const POOL_CARDS: Readonly<Record<PoolId, readonly number[]>> = {
  'pool-a': range(174, 341),
  'pool-b': range(342, 425),
  'pool-r': range(POOL_R_FIRST, POOL_R_FIRST + POOL_R_CARDS.length - 1),
};

/** Reverie's card number for a `pool-r` vision, or null for any other card. */
export const pictureCardOf = (vision: number): number | null =>
  POOL_R_CARDS[vision - POOL_R_FIRST] ?? null;

/** The pool a vision belongs to, or null for the sets' own visions. */
export const poolOfVision = (vision: number): PoolId | null =>
  POOL_IDS.find((p) => POOL_CARDS[p].includes(vision)) ?? null;

export const CARD_COUNTS: Record<Kind, number> = {
  vision: POOL_R_FIRST + POOL_R_CARDS.length - 1,
  suspect: 31,
  place: 31,
  object: 32,
  story: 20,
};

/** Every card of one kind in the chosen sets (and, for visions, the chosen extra pools). */
export const poolOf = (
  sets: readonly SetId[],
  kind: Kind,
  pools: readonly PoolId[] = [],
): number[] => [
  ...SET_IDS.filter((s) => sets.includes(s)).flatMap((s) => [...CARD_SETS[s][kind]]),
  ...(kind === 'vision'
    ? POOL_IDS.filter((p) => pools.includes(p)).flatMap((p) => [...POOL_CARDS[p]])
    : []),
];

/** Card ids as the night recap and the stats name them: `suspect-12`, `vision-40`. */
export const cardKey = (kind: Kind, n: number) => `${kind}-${n}`;
