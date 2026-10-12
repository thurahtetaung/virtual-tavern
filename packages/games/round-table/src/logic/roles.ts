import type { Known, Loyalty, QuestCard, RoleId } from './types.ts';

/** Game options a role's knowledge or cards can depend on. */
export interface RoleOptions {
  /** The FAQ reading: Merlin doesn't see Oberon. */
  oberonHidden: boolean;
}

/** What a role may play on a quest, given the quest and the game so far (later waves use more). */
export interface CardContext {
  /** Quests played before this one (0–4): "the first three quests" are counted this way. */
  played: number;
  slot: number;
}

/**
 * One character. Knowledge is data: `sees` says how the holder sees another player at the start
 * (or not at all), from the two roles alone, so later waves add records rather than rewrites.
 */
export interface RoleDef {
  id: RoleId;
  name: string;
  loyalty: Loyalty;
  /** One line under the name. */
  blurb: string;
  /** What the card means for its holder, for the role card and the guide. */
  detail: string;
  /** Which release brings the role (wave 1 is the base game and its four classic characters). */
  wave: 1 | 2 | 3;
  /** At most one in a deck. The plain cards (Servant, Minion) can repeat. */
  unique: boolean;
  /** A plain card of its side, used to fill a deck. */
  plain?: boolean;
  /** Evil: wakes with the other Evil players and sees them (Oberon doesn't). */
  seesEvil?: boolean;
  /** Evil: the other Evil players see them (Oberon isn't). */
  seenByEvil?: boolean;
  /** Evil: Merlin sees them (Mordred isn't; Oberon is, unless the FAQ reading is on). */
  seenByMerlin?: (o: RoleOptions) => boolean;
  /** Names Merlin at the end. */
  assassin?: boolean;
  /** Never designated to act as the Assassin (they don't know their team). */
  neverDesignated?: boolean;
  /** Which side adding the role helps, per the rulebook's balance notes. */
  favours?: Loyalty;
  /** How this holder sees `other` at the start, or null. Defaults by loyalty (see `seesOf`). */
  sees?: (other: RoleDef, o: RoleOptions) => Known['as'] | null;
  /** Legal quest cards. Defaults: Good plays Success, Evil plays Success or Fail. */
  cards?: (c: CardContext) => QuestCard[];
}

const evilSeenByMerlin = () => true;

export const ROLES: Record<RoleId, RoleDef> = {
  merlin: {
    id: 'merlin',
    name: 'Merlin',
    loyalty: 'good',
    blurb: 'Knows Evil, must stay hidden',
    detail:
      'You know who is Evil (all but Mordred). Steer the table without being obvious: if Good wins the quests, the Assassin gets one guess at who you are.',
    wave: 1,
    unique: true,
    sees: (other, o) =>
      other.loyalty === 'evil' && (other.seenByMerlin ?? evilSeenByMerlin)(o) ? 'evil' : null,
  },
  percival: {
    id: 'percival',
    name: 'Percival',
    loyalty: 'good',
    blurb: 'Knows Merlin (and Morgana)',
    detail:
      'You see Merlin, but Morgana looks the same to you: when both are in play you see two players and don’t know which is which. Protect the real Merlin.',
    wave: 1,
    unique: true,
    favours: 'good',
    sees: (other) => (other.id === 'merlin' || other.id === 'morgana' ? 'magic' : null),
  },
  servant: {
    id: 'servant',
    name: 'Loyal Servant',
    loyalty: 'good',
    blurb: 'Loyal to the Round Table',
    detail:
      'You know nothing at the start. Watch the votes and the quests, and work out who to trust.',
    wave: 1,
    unique: false,
    plain: true,
  },
  assassin: {
    id: 'assassin',
    name: 'Assassin',
    loyalty: 'evil',
    blurb: 'Hunts Merlin',
    detail:
      'You know your fellow Evil players. If Good wins three quests, you name one player as Merlin: get it right and Evil wins.',
    wave: 1,
    unique: true,
    seesEvil: true,
    seenByEvil: true,
    assassin: true,
  },
  morgana: {
    id: 'morgana',
    name: 'Morgana',
    loyalty: 'evil',
    blurb: 'Appears as Merlin',
    detail:
      'You know your fellow Evil players. Percival sees you just like Merlin: act the part and win his trust.',
    wave: 1,
    unique: true,
    seesEvil: true,
    seenByEvil: true,
    favours: 'evil',
  },
  mordred: {
    id: 'mordred',
    name: 'Mordred',
    loyalty: 'evil',
    blurb: 'Unknown to Merlin',
    detail:
      'You know your fellow Evil players, and Merlin can’t see you. The Lady of the Lake still shows you as Evil.',
    wave: 1,
    unique: true,
    seesEvil: true,
    seenByEvil: true,
    seenByMerlin: () => false,
    favours: 'evil',
  },
  oberon: {
    id: 'oberon',
    name: 'Oberon',
    loyalty: 'evil',
    blurb: 'Unknown to Evil',
    detail:
      'You are Evil, but you don’t know the other Evil players and they don’t know you. Merlin can see you, unless the host chose the FAQ reading (then Merlin can’t, and the Lady of the Lake sees you as Good).',
    wave: 1,
    unique: true,
    seenByMerlin: (o) => !o.oberonHidden,
    neverDesignated: true,
    favours: 'good',
    sees: () => null,
  },
  minion: {
    id: 'minion',
    name: 'Minion of Mordred',
    loyalty: 'evil',
    blurb: 'Serves Mordred',
    detail:
      'You know your fellow Evil players (all but Oberon). Fail quests, but don’t get caught doing it.',
    wave: 1,
    unique: false,
    plain: true,
    seesEvil: true,
    seenByEvil: true,
  },
};

/** The roles on offer, Good first, in the order the lobby lists them. */
export const ROLE_ORDER: RoleId[] = [
  'merlin',
  'percival',
  'servant',
  'assassin',
  'morgana',
  'mordred',
  'oberon',
  'minion',
];

export const role = (id: RoleId): RoleDef => ROLES[id];
export const loyaltyOf = (id: RoleId): Loyalty => ROLES[id].loyalty;

/** How `viewer` sees `other` at the start, or null: the role's own rule, else its side's. */
export function seesOf(viewer: RoleDef, other: RoleDef, o: RoleOptions): Known['as'] | null {
  if (viewer.sees) return viewer.sees(other, o);
  if (viewer.loyalty === 'evil' && viewer.seesEvil)
    return other.loyalty === 'evil' && other.seenByEvil ? 'evil' : null;
  return null;
}

/** The quest cards `role` may play. */
export function cardsFor(id: RoleId, c: CardContext): QuestCard[] {
  const def = ROLES[id];
  if (def.cards) return def.cards(c);
  return def.loyalty === 'good' ? ['success'] : ['success', 'fail'];
}

/**
 * What a loyalty check (the Lady of the Lake) shows: the card's own loyalty, except that the FAQ
 * reading shows Oberon as Good. Later waves add the roles that may or must lie, and Lancelot's
 * current side.
 */
export const shownLoyalty = (id: RoleId, o: RoleOptions): Loyalty =>
  id === 'oberon' && o.oberonHidden ? 'good' : ROLES[id].loyalty;

/** Sorts a deck into lobby order. */
export const sortDeck = (roles: readonly RoleId[]): RoleId[] =>
  [...roles].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
