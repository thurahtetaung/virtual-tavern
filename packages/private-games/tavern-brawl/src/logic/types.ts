import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

/**
 * Hero ids. These neutral words are the ids in code and the fallback names on screen; the
 * heroes' real names, portraits and card art come from the private manifest in asset storage.
 */
export const HERO_IDS = [
  'brute',
  'mage',
  'knight',
  'thief',
  'ranger',
  'druid',
  'dragon',
  'owl',
  'psychic',
  'slime',
  'eye',
  'mimic',
] as const;
export type HeroId = (typeof HERO_IDS)[number];

export const SET_IDS = ['core', 'x1', 'x2'] as const;
export type SetId = (typeof SET_IDS)[number];

/** A card in a hero's deck: `<hero>.<nn>`, e.g. `brute.03`. */
export type CardId = string;
/** One physical copy of a card in this game: a random token that says nothing about the card. */
export type Inst = string;

export type Sym = 'atk' | 'heal' | 'play' | 'draw';

/**
 * One step of a card, resolved in printed order. `paw` is the Form bonus (heal in the bear Form,
 * one more attack in the wolf Form); `power` is the card's power.
 */
export type Step = { k: Sym; n: number } | { k: 'paw' } | { k: 'power' };

export const EFFECTS = [
  'healPerOppThenHitEach',
  'allDiscardDraw3',
  'destroyOneShield',
  'damageAll3',
  'stealShield',
  'swapHpWithOpp',
  'takeFromDiscard',
  'destroyAllShields',
  'disguise',
  'playOpponentTop',
  'rotateHpRight',
  'drawFromEachOpp',
  'attackBonus',
  'formBear',
  'formWolf',
  'freeFormPlay',
  'howlThenHitEach',
  'everyoneChooses',
  'discardHandHit',
  'threeTargets',
  'destroyThenHitPerShield',
  'danceDraw',
  'hitAllOpps',
  'swapHands',
  'takeTopDiscards',
  'hitPerHandCard',
  'destroyThenHealPerShield',
  'ignoreShields',
  'bonesOnDestroy',
  'praiseOrHit',
  'controlAttacks',
  'hitUnshieldedThenWipe',
  'copyShield',
  'borrowNeighbourPower',
  'copyHp',
] as const;
export type Effect = (typeof EFFECTS)[number];

export type FormKind = 'bear' | 'wolf';

export interface CardDef {
  id: CardId;
  hero: HeroId;
  /** Copies in the hero's 28-card deck. */
  count: number;
  steps: Step[];
  /** Shield points when the card stays in play. */
  shield: number;
  /** Has printed attack symbols (or is a Form-bonus attack card): counts for the attack bonus. */
  attack: boolean;
  effect: Effect | null;
  form: FormKind | null;
}

export const HP_START = 10;
export const HP_MAX = 10;
export const HAND_START = 3;
export const DECK_SIZE = 28;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
/** From this many players at the start, attacks only reach neighbours and the out haunt. */
export const ZONE_PLAYERS = 5;
/** Public log entries kept. */
export const MAX_LOG = 80;
/** Social prompts and every other out-of-turn question get this long, whatever the timer. */
export const SOCIAL_SECONDS = 20;
/** The pause before the table plays for someone who has left. */
export const LEFT_BEAT_MS = 3000;
/** A player can be nudged again after this long. */
export const NUDGE_MS = 15_000;
export const TIMER_SECONDS = [30, 60, 90, 120, 180, 300] as const;
export const DEFAULT_SECONDS = 60;

export type TimerMode = 'soft' | 'strict';

export interface Settings {
  /** Seconds per decision; null turns the clock off. */
  seconds: number | null;
  /** Soft: a reminder only. Strict: a random legal move is made at zero. */
  timerMode: TimerMode;
  /** Which sets the random hero picks draw from (missing: all). */
  sets?: SetId[];
}

export interface Seat {
  name: string;
  playing: boolean;
  hero: HeroId | null;
  /** Watching only because there was no seat: sat down automatically when one frees up. */
  waiting?: boolean;
}

export interface ShieldInPlay {
  id: Inst;
  /** Damage marks; the shield breaks when they reach its shield points. */
  damage: number;
  /** A mirror card copying this shield card (its points and its trigger). */
  copyOf?: CardId;
}

export interface PlayerState {
  hero: HeroId;
  hp: number;
  /** Top first. Never sent to players. */
  deck: Inst[];
  hand: Inst[];
  /** Oldest first (the top is the last). Public. */
  discard: Inst[];
  /** Shields in front of this player, theirs or taken (each card still belongs to its owner). */
  shields: ShieldInPlay[];
  form: { kind: FormKind; id: Inst } | null;
  out: boolean;
  /** Knocked out in a five-or-more game: haunts the table, never wins. */
  ghost?: boolean;
}

/** `control`: you pick the target of every other player's attack cards; `allOpps`: your attacks hit every opponent. */
export type LastingKind = 'disguise' | 'control' | 'allOpps';

/** An effect that lasts until `player`'s next turn starts. */
export interface Lasting {
  kind: LastingKind;
  player: PlayerId;
  card: Inst;
}

export interface Turn {
  player: PlayerId;
  /** Counts every turn of the game, from 1. */
  number: number;
  /** Cards still to play this turn (each turn starts owing one; ⚡ adds one each). */
  debt: number;
  /** Cards played this turn that aren't in play: they go to their owners' discards at the end. */
  played: Inst[];
  /** Attack bonus from the ranger's power, for attack cards played after it this turn. */
  bonus: number;
  /** Cards that reached a discard pile this turn (out of reach for the knight's power). */
  fresh: Inst[];
  /** Cards played from hand this turn (for the clock and the chain counter). */
  plays: number;
  /** This turn your attack cards ignore shields. */
  ignoreShields?: boolean;
}

/** Pending damage to one player (an attack aimed at a shield starts at `first`). */
export interface Hit {
  target: PlayerId;
  amount: number;
  /** Power damage (not an attack card's swords). */
  power: boolean;
  first?: Inst;
  /** Damage dealt so far by this hit (a choice can split it). */
  dealt?: number;
  /** Who deals it, when not the card's player (everyone attacks on one card). */
  by?: PlayerId;
  /** Straight to hit points. */
  ignore?: boolean;
  /** A ghost's attack: never takes anyone below 1. */
  nonLethal?: boolean;
}

/** A card being resolved: steps run in order, `queue` holds damage still to deal. */
export interface Frame {
  id: Inst;
  /** The player resolving it ("you" on the card), who may not own it. */
  by: PlayerId;
  step: number;
  /** Taken from another player (the thief's power): shown face up to everyone. */
  stolen: boolean;
  queue: Hit[];
  /** Effect progress between choices. */
  data: Record<string, string | number | boolean | string[] | null>;
  /** Not a card from a hand: a ghost's attack, or a broken shield's trigger. */
  virtual?: 'ghost' | 'bones';
  /** The card a virtual frame shows (the broken shield). */
  card?: CardId;
  /** A mirror resolving as a copy of this card. */
  copy?: CardId;
}

export const CHOICE_KINDS = [
  'target',
  'shield',
  'destroy',
  'charm',
  'swap',
  'pickpocket',
  'recover',
  'form',
  'social',
  'mna',
  'opponent',
  'second',
  'side',
  'copyA',
  'copyB',
  'mirror',
  'redirect',
] as const;
export type ChoiceKind = (typeof CHOICE_KINDS)[number];

/**
 * One open question. Options are player ids, card instance ids, `skip` or `done`, depending on
 * the kind. `target` accepts a player or one of their shields.
 */
export interface Choice {
  id: number;
  kind: ChoiceKind;
  chooser: PlayerId;
  options: string[];
  /** The card asking ('' for a ghost's attack or a broken shield striking back). */
  source: Inst;
  /** The card a virtual frame asks for. */
  card?: CardId;
  /** Damage it carries (target and shield choices). */
  amount?: number;
  /** For `shield`: whose shields. */
  target?: PlayerId;
  /** Fixed deadline (social prompts, out-of-turn questions), whatever the room timer. */
  deadline?: number;
  /** Where the answer is kept on the frame (several questions of one kind). */
  tag?: string;
  /** What the timer, the host or the table answers. */
  fallback?: string;
  /** Social prompts: what is asked. */
  flavour?: Flavour;
  /** Redirects: whose attack it is. */
  attacker?: PlayerId;
}

export type Flavour = 'howl' | 'dance' | 'praise';

export interface Clock {
  /** Which decision it times; a new decision restarts it. */
  key: string;
  who: PlayerId;
  since: number;
  /** The soft reminder has gone off. */
  reminded: boolean;
}

export interface Knockout {
  player: PlayerId;
  turn: number;
  /** Whose card did it (themselves for their own card). */
  by: PlayerId;
  card: CardId | null;
  /** Removed by the host after leaving. */
  removed?: boolean;
}

export type EndReason = 'last-standing' | 'tie' | 'stalled';

export interface Game {
  /** Seat order, which is also turn order ("left" is the next seat). */
  order: PlayerId[];
  /** Names at the deal, for players who have since left the room. */
  names: Record<PlayerId, string>;
  players: Record<PlayerId, PlayerState>;
  /** Every card instance: which card, and whose deck it belongs to. */
  cards: Record<Inst, { card: CardId; owner: PlayerId }>;
  first: PlayerId;
  turn: Turn;
  lasting: Lasting[];
  /** Cards being resolved, innermost last. */
  frames: Frame[];
  choice: Choice | null;
  clock: Clock | null;
  /** Players who left for good, with when: the table plays for them. */
  left: Record<PlayerId, number>;
  nudges: Record<PlayerId, number>;
  knockouts: Knockout[];
  winners: PlayerId[];
  endReason: EndReason | null;
  /** Turns in a row in which nobody could play (everything is in play). */
  passes: number;
  /** Per-player totals for the stats and the end screen. */
  tally: Record<PlayerId, Tally>;
  /** Five or more at the start: attacks reach only neighbours, and the out become ghosts. */
  zone?: boolean;
  /** Broken trigger shields waiting to strike once the card in play has resolved. */
  bones?: { holder: PlayerId; card: CardId }[];
}

export interface Tally {
  dealt: number;
  healed: number;
  absorbed: number;
  biggestHit: number;
  longestChain: number;
  stolen: number;
  howls: number;
  plays: number;
}

export type LogEntry = { id: number; turn: number } & (
  | { kind: 'turn'; player: PlayerId; drew: number }
  | {
      kind: 'play';
      by: PlayerId;
      card: CardId;
      inst: Inst;
      owner: PlayerId;
      stolen?: boolean;
      free?: boolean;
      auto?: 'timer' | 'host' | 'left';
    }
  | {
      kind: 'damage';
      by: PlayerId;
      target: PlayerId;
      /** Damage to HP. */
      hp: number;
      /** Damage taken by shields. */
      shield: number;
      power: boolean;
      /** A ghost's attack. */
      ghost?: boolean;
    }
  | { kind: 'shield-hit'; target: PlayerId; shield: Inst; card: CardId; amount: number }
  | {
      kind: 'destroy';
      by: PlayerId;
      holder: PlayerId;
      shield: Inst;
      card: CardId;
      owner: PlayerId;
    }
  | { kind: 'heal'; player: PlayerId; amount: number }
  | { kind: 'draw'; player: PlayerId; count: number; refill?: boolean }
  | { kind: 'reshuffle'; player: PlayerId }
  | { kind: 'debt'; player: PlayerId; amount: number }
  | { kind: 'shield-up'; player: PlayerId; shield: Inst; card: CardId }
  | { kind: 'charm'; by: PlayerId; from: PlayerId; shield: Inst; card: CardId }
  | { kind: 'swap'; a: PlayerId; b: PlayerId; hpA: number; hpB: number }
  | { kind: 'rotate'; players: PlayerId[]; before: number[]; after: number[] }
  | { kind: 'recover'; player: PlayerId; card: CardId; inst: Inst }
  | { kind: 'scout'; by: PlayerId; from: PlayerId[]; count: number }
  | { kind: 'pickpocket'; by: PlayerId; from: PlayerId; card: CardId | null }
  | { kind: 'roar'; players: PlayerId[] }
  | { kind: 'disguise'; player: PlayerId }
  | { kind: 'bonus'; player: PlayerId; bonus: number }
  | { kind: 'form'; player: PlayerId; form: FormKind }
  | {
      kind: 'social';
      player: PlayerId;
      done: boolean;
      auto?: boolean;
      /** Missing on older entries: the howl. */
      flavour?: Flavour;
    }
  | { kind: 'mna'; player: PlayerId; pick: 'attack' | 'heal' | 'draw'; repeat?: boolean }
  | { kind: 'hp-copy'; a: PlayerId; b: PlayerId; hp: number }
  | { kind: 'hands'; a: PlayerId; b: PlayerId }
  | { kind: 'mother'; by: PlayerId; cards: CardId[] }
  | { kind: 'mirror'; player: PlayerId; card: CardId }
  | { kind: 'lasting'; player: PlayerId; what: 'control' | 'allOpps' | 'ignoreShields' }
  | { kind: 'redirect'; by: PlayerId; attacker: PlayerId; target: PlayerId }
  | { kind: 'borrow'; player: PlayerId; from: PlayerId; effect: Effect }
  | { kind: 'liquidate'; player: PlayerId; count: number }
  | { kind: 'haunt'; player: PlayerId }
  | { kind: 'fizzle'; by: PlayerId; card: CardId; why: 'no-target' | 'no-shield' | 'no-card' }
  | { kind: 'ko'; player: PlayerId; by: PlayerId; card: CardId | null; removed?: boolean }
  | { kind: 'pass'; player: PlayerId }
  | { kind: 'auto'; player: PlayerId; by: 'timer' | 'host' | 'left'; what: string }
  | { kind: 'left'; player: PlayerId }
  | { kind: 'end'; winners: PlayerId[]; reason: EndReason }
);

export type NewLog = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, 'id' | 'turn'>
    : never
  : never;

export interface TavernBrawlState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Hidden randomness for deadlines and leavers, which come without an rng. Never sent. */
  seed: number;
  /** Insertion-ordered by join time: the seating order. */
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  log: LogEntry[];
  /** The last log or choice id handed out; never reset. */
  seq: number;
  gamesPlayed: number;
}

const id = z.string().min(1).max(128);
const hero = z.enum(HERO_IDS);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    seconds: z.number().int().min(10).max(600).nullable().optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
    sets: z.array(z.enum(SET_IDS)).min(1).max(SET_IDS.length).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('pick-hero'), hero: z.union([hero, z.literal('random')]).nullable() }),
  z.object({ type: z.literal('random-heroes') }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('play'), card: id }),
  z.object({ type: z.literal('choose'), choice: z.number().int(), pick: id }),
  z.object({ type: z.literal('act-for'), player: id }),
  z.object({ type: z.literal('nudge'), player: id }),
  z.object({ type: z.literal('remove'), player: id }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type TavernBrawlAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

/** A card the viewer may see: the instance, which card it is and whose deck it came from. */
export interface CardRef {
  id: Inst;
  card: CardId;
  owner: PlayerId;
}

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
  hero: HeroId | null;
  waiting?: boolean;
}

export interface ShieldView extends CardRef {
  damage: number;
  /** Points left before it breaks. */
  left: number;
  /** A mirror card copying this card. */
  copyOf?: CardId;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  hero: HeroId;
  hp: number;
  out: boolean;
  left: boolean;
  handCount: number;
  deckCount: number;
  discard: CardRef[];
  shields: ShieldView[];
  form: { kind: FormKind; card: CardRef } | null;
  /** Opponents' cards can't touch them until their next turn. */
  disguised: boolean;
  /** A ghost (five or more players): attacks once a turn, never wins. */
  ghost: boolean;
  /** Picks the target of everyone else's attack cards until their next turn. */
  controls: boolean;
  /** Their attacks hit every opponent until their next turn. */
  allOpps: boolean;
}

export interface ChoiceView {
  id: number;
  kind: ChoiceKind;
  chooser: PlayerId;
  /** The card asking, when it's a real card (not a ghost's attack). */
  source: CardRef | null;
  /** Which card is asking (a broken shield striking back has no instance any more). */
  card: CardId | null;
  /** Only the chooser gets the options. */
  options: string[];
  amount?: number;
  target?: PlayerId;
  deadline?: number;
  flavour?: Flavour;
  /** Whose attack a redirect is about. */
  attacker?: PlayerId;
}

export interface GameView {
  order: PlayerId[];
  /** Five or more at the start: neighbours only, and ghosts. */
  zone: boolean;
  players: PlayerView[];
  first: PlayerId;
  turn: {
    player: PlayerId;
    number: number;
    debt: number;
    played: CardRef[];
    bonus: number;
    plays: number;
  };
  /** The card being resolved (outermost first). */
  resolving: CardRef[];
  choice: ChoiceView | null;
  /** Who the table is waiting on and when the clock for it runs out. */
  clock: { who: PlayerId; since: number; deadline: number | null; reminded: boolean } | null;
  nudges: Record<PlayerId, number>;
  knockouts: Knockout[];
  winners: PlayerId[];
  endReason: EndReason | null;
  tally: Record<PlayerId, Tally>;
  /** Every hand, face up once the game is over. */
  hands: Record<PlayerId, CardRef[]> | null;
}

export interface TavernBrawlView {
  phase: TavernBrawlState['phase'];
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
  /** Only the viewer's own cards. */
  hand: CardRef[];
  log: LogEntry[];
}
