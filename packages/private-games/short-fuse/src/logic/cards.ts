/**
 * The card table. Card types are neutral ids; their real names, rules text and art come from the
 * private manifest (`src/ui/assets.ts`), with the placeholder names in `names.ts` as the fallback.
 * Later releases add their expansions' types here and in `deck.ts`.
 */

export const CAT_TYPES = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5'] as const;
export type CatType = (typeof CAT_TYPES)[number];

export const CARD_TYPES = [
  'bomb',
  'defuse',
  'attack',
  'skip',
  'favor',
  'shuffle',
  'peek3',
  'nope',
  ...CAT_TYPES,
  // Expansion 1
  'void',
  'wild',
  'aim',
  'reverse',
  'bottom',
  'alter3',
] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** The sets a card can come from: the core decks and the expansions. */
export type SetId = 'core' | 'x1';

export interface CardInfo {
  set: SetId;
  /** A Bomb-like card: never played, can't be Noped, revealed when drawn. */
  bombLike?: boolean;
  /** Played on its own, it needs another player as its target. */
  targeted?: boolean;
  /** Can be played on its own as an action on your turn. */
  playable: boolean;
}

export const CARDS: Record<CardType, CardInfo> = {
  bomb: { set: 'core', bombLike: true, playable: false },
  defuse: { set: 'core', playable: false },
  attack: { set: 'core', playable: true },
  skip: { set: 'core', playable: true },
  favor: { set: 'core', targeted: true, playable: true },
  shuffle: { set: 'core', playable: true },
  peek3: { set: 'core', playable: true },
  nope: { set: 'core', playable: false },
  cat1: { set: 'core', playable: false },
  cat2: { set: 'core', playable: false },
  cat3: { set: 'core', playable: false },
  cat4: { set: 'core', playable: false },
  cat5: { set: 'core', playable: false },
  void: { set: 'x1', bombLike: true, playable: false },
  wild: { set: 'x1', playable: false },
  aim: { set: 'x1', targeted: true, playable: true },
  reverse: { set: 'x1', playable: true },
  bottom: { set: 'x1', playable: true },
  alter3: { set: 'x1', playable: true },
};

export const isBombCard = (t: CardType) => CARDS[t].bombLike === true;
export const isCat = (t: CardType): t is CatType => (CAT_TYPES as readonly string[]).includes(t);

/** Card types that can be asked for with Three of a Kind (anything a hand can hold). */
export const NAMEABLE: readonly CardType[] = CARD_TYPES.filter((t) => !isBombCard(t));

/** Classic and Adult core decks (same counts, different art): the cards besides Bombs and Defuses. */
export const CORE_POOL: Partial<Record<CardType, number>> = {
  attack: 4,
  skip: 4,
  favor: 4,
  shuffle: 4,
  peek3: 5,
  nope: 5,
  cat1: 4,
  cat2: 4,
  cat3: 4,
  cat4: 4,
  cat5: 4,
};

/** The party deck, by corner mark: `paw` cards for 2–3 players, the rest for 4–7, all for 8–10. */
export const PARTY_POOL: {
  paw: Partial<Record<CardType, number>>;
  plain: Partial<Record<CardType, number>>;
} = {
  paw: {
    attack: 2,
    aim: 2,
    skip: 4,
    peek3: 3,
    alter3: 2,
    shuffle: 2,
    bottom: 3,
    favor: 2,
    nope: 4,
    wild: 2,
    cat1: 3,
    cat2: 3,
    cat3: 3,
    cat4: 3,
    cat5: 3,
  },
  plain: {
    attack: 3,
    aim: 3,
    skip: 6,
    peek3: 3,
    alter3: 4,
    shuffle: 4,
    bottom: 4,
    favor: 4,
    nope: 5,
    wild: 4,
    cat1: 4,
    cat2: 4,
    cat3: 4,
    cat4: 4,
    cat5: 4,
  },
};
export const PARTY_DEFUSES = { paw: 3, plain: 7 } as const;

/** Expansion 1's cards besides its Black Hole. */
export const X1_POOL: Partial<Record<CardType, number>> = {
  wild: 4,
  aim: 3,
  reverse: 4,
  bottom: 4,
  alter3: 4,
};

/** How many cards a peek or a rearrange shows. */
export const PEEK_SIZE: Partial<Record<CardType, number>> = { peek3: 3, alter3: 3 };

/** Cards that end one of your turns when they resolve (instead of drawing). */
export const ENDS_TURN: readonly CardType[] = ['attack', 'aim', 'skip', 'reverse', 'bottom'];
