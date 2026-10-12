/**
 * Séance's cards, by number only. Art and set names live in the private `seance/manifest.json` in
 * asset storage (`vision/<n>.webp`, `suspect/<n>.webp`, `place/<n>.webp`, `object/<n>.webp`, each
 * with a `thumb/` copy), so the rules need no I/O and the repository never holds a card name.
 *
 * The ghost's cards are the psychics' cards (the same art), so one id serves both sides.
 */

/** The three things each psychic must find, in the order they look for them. */
export const PILLARS = ['suspect', 'place', 'object'] as const;
export type Pillar = (typeof PILLARS)[number];

/** Every card kind with art: the visions the ghost sends, and the three pillars. */
export type Kind = 'vision' | Pillar;

/**
 * Card sets: each a lobby toggle that adds its visions and its pillar cards. Ids are neutral; the
 * private manifest names them. Later waves add more sets (story cards, extra vision pools) here.
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
 * asset script): 173 visions, 31 suspects, 31 places and 32 objects in all.
 */
export const CARD_SETS: Readonly<Record<SetId, Readonly<Record<Kind, readonly number[]>>>> = {
  base: {
    vision: range(1, 84),
    suspect: range(1, 18),
    place: range(1, 18),
    object: range(1, 18),
  },
  exp1: {
    vision: range(85, 126),
    suspect: range(19, 24),
    place: range(19, 24),
    object: range(19, 24),
  },
  exp2: {
    vision: range(127, 168),
    suspect: range(25, 30),
    place: range(25, 30),
    object: range(25, 30),
  },
  promo: {
    vision: range(169, 173),
    suspect: [31],
    place: [31],
    object: [31, 32],
  },
};

export const CARD_COUNTS: Record<Kind, number> = {
  vision: 173,
  suspect: 31,
  place: 31,
  object: 32,
};

/** Every card of one kind in the chosen sets. */
export const poolOf = (sets: readonly SetId[], kind: Kind): number[] =>
  SET_IDS.filter((s) => sets.includes(s)).flatMap((s) => [...CARD_SETS[s][kind]]);

/** Card ids as the night recap and the stats name them: `suspect-12`, `vision-40`. */
export const cardKey = (kind: Kind, n: number) => `${kind}-${n}`;
