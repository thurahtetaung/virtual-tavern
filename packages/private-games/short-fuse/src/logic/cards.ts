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
  // Expansion 2
  'shelter',
  'superskip',
  'peek5',
  'alter5',
  'swap',
  'recycle',
  'stack',
  'mark',
  'blind',
  // Expansion 3
  'twin',
  'vault',
  'mine',
  'bury',
  'self3',
  'potluck',
  'share3',
  'alter3now',
] as const;
export type CardType = (typeof CARD_TYPES)[number];

/** The sets a card can come from: the core decks and the expansions. */
export type SetId = 'core' | 'x1' | 'x2' | 'x3';

export interface CardInfo {
  set: SetId;
  /** A Bomb-like card: never played, can't be Noped, revealed when drawn. */
  bombLike?: boolean;
  /** Played on its own, it needs another player as its target. */
  targeted?: boolean;
  /** Can be played on its own as an action on your turn. */
  playable: boolean;
  /** A NOW card: anyone may play it between actions, even off their turn. */
  now?: boolean;
  /** Its target must have cards to take (Favor, Mark…), not just be in the game. */
  needsCards?: boolean;
}

export const CARDS: Record<CardType, CardInfo> = {
  bomb: { set: 'core', bombLike: true, playable: false },
  defuse: { set: 'core', playable: false },
  attack: { set: 'core', playable: true },
  skip: { set: 'core', playable: true },
  favor: { set: 'core', targeted: true, needsCards: true, playable: true },
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
  shelter: { set: 'x2', playable: false },
  superskip: { set: 'x2', playable: true },
  peek5: { set: 'x2', playable: true },
  alter5: { set: 'x2', playable: true },
  swap: { set: 'x2', playable: true },
  recycle: { set: 'x2', playable: true },
  stack: { set: 'x2', playable: true },
  mark: { set: 'x2', targeted: true, needsCards: true, playable: true },
  blind: { set: 'x2', targeted: true, playable: true },
  twin: { set: 'x3', bombLike: true, playable: true },
  vault: { set: 'x3', playable: true },
  mine: { set: 'x3', targeted: true, playable: true },
  bury: { set: 'x3', playable: true },
  self3: { set: 'x3', playable: true },
  potluck: { set: 'x3', playable: true },
  share3: { set: 'x3', playable: true },
  alter3now: { set: 'x3', playable: true, now: true },
};

export const isBombCard = (t: CardType) => CARDS[t].bombLike === true;
/** Cards that explode whoever ends up with them by surprise (not the Twin Bombs). */
export const isExplosive = (t: CardType) => t === 'bomb' || t === 'void';
export const isCat = (t: CardType): t is CatType => (CAT_TYPES as readonly string[]).includes(t);

/** Card types that can be asked for with Three of a Kind (anything a hand can hold). */
export const NAMEABLE: readonly CardType[] = CARD_TYPES.filter(
  (t) => t !== 'bomb' && t !== 'void' && t !== 'vault',
);

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

/** Expansion 2's cards besides its extra Bomb. */
export const X2_POOL: Partial<Record<CardType, number>> = {
  shelter: 1,
  superskip: 1,
  peek5: 1,
  alter5: 1,
  swap: 3,
  recycle: 1,
  stack: 1,
  mark: 3,
  blind: 2,
};

/** Expansion 3's cards besides the Vault card (which goes in after the Stash is dealt). */
export const X3_POOL: Partial<Record<CardType, number>> = {
  twin: 2,
  mine: 4,
  bury: 2,
  self3: 4,
  potluck: 2,
  share3: 2,
  alter3now: 2,
  superskip: 1,
};
/** Cards dealt face down into the Vault's Stash. */
export const STASH_SIZE = 6;

/** How many cards a peek or a rearrange shows. */
export const PEEK_SIZE: Partial<Record<CardType, number>> = {
  peek3: 3,
  alter3: 3,
  peek5: 5,
  alter5: 5,
  share3: 3,
  alter3now: 3,
};
