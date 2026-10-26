import { type Drawing, type PlayerColor, type PlayerId, drawingSchema } from '@vt/game-sdk';
import { z } from 'zod';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

/**
 * The room's colours: the seven paddle colours the auctioneer says out loud ("You're screwed,
 * yellow!"), so every player is one of them (`GameDefinition.colors`).
 */
export const GAME_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'grey',
] as const satisfies readonly PlayerColor[];

/** Title groups a game draws from. */
export const GROUPS_PER_GAME = 2;
export const STARTING_CASH = 3000;
/** A player's two drawings are worth this much together. */
export const PAIR_TOTAL = 4500;
/** The high one of a pair: $3,000–$4,000 in steps of $100 (the low one is the rest). */
export const HIGH_MIN = 3000;
export const HIGH_MAX = 4000;
/** A house drawing: $500–$4,500 in steps of $100. */
export const HOUSE_MIN = 500;
export const HOUSE_MAX = 4500;
/** Worth this much or more: an "expensive" drawing. */
export const EXPENSIVE = 3000;

export const OPENING_BID = 400;
export const BID_STEP = 100;
/** The bid buttons: the next three steps. */
export const BID_BUTTONS = 3;
/** One bid per player this often at most. */
export const BID_GAP_MS = 300;
/** The artist's share of the price. */
export const COMMISSION = 0.5;

/** Each lot opens with its number and the hints for this long, before the picture goes up. */
export const LOT_INTRO_MS = 2000;

export const SCREW_PICK_MS = 15_000;
/**
 * Without the voice, how long a screw's outcome holds the bidding (its banner on every phone, the
 * screw landing or tumbling off on the table screen); voiced, the outcome's own line does.
 */
export const SCREW_OUTCOME_MS = 2500;
/** A screw still unaimed this long after the press gets a nudge on screen. */
export const SCREW_NUDGE_MS = 10_000;
/** The bank's first visit, and the visits someone called for (both end once everyone has answered). */
export const BANK_FIRST_MS = 30_000;
export const BANK_LATER_MS = 10_000;
/** At or below this much cash, the bank's first visit comes by itself. */
export const BANK_TRIGGER = 1000;
export const LOAN_CASH = 1000;
export const LOAN_DEBT = 1500;
export const MAX_LOANS = 3;
export const MAX_BANK_CALLS = 3;

/** A late drawing may still land this long after the drawing clock reads 0:00. */
export const DRAW_GRACE_MS = 2500;
export const DRAW_SECONDS = [60, 90, 120] as const;
export type DrawSeconds = (typeof DRAW_SECONDS)[number];

export const PACES = ['relaxed', 'normal', 'fast'] as const;
export type Pace = (typeof PACES)[number];

/** The auction's soft close and the breaks between lots, in ms, at each pace. */
export interface Timing {
  /** Before the first bid. */
  open: number;
  /** After a bid, before "going once". */
  quiet: number;
  once: number;
  twice: number;
  /** The Sold card. */
  sold: number;
  /** The half-time card that unlocks the screws. */
  halftime: number;
}

export const TIMINGS: Record<Pace, Timing> = {
  relaxed: {
    open: 12_000,
    quiet: 12_000,
    once: 2000,
    twice: 2000,
    sold: 7000,
    halftime: 9000,
  },
  normal: {
    open: 8000,
    quiet: 4000,
    once: 2000,
    twice: 2000,
    sold: 5000,
    halftime: 7000,
  },
  fast: {
    open: 6000,
    quiet: 3000,
    once: 1500,
    twice: 1500,
    sold: 3500,
    halftime: 5000,
  },
};

/** Messages kept per player (older ones drop off). */
export const MAX_MESSAGES = 40;
/** Public notices kept. */
export const MAX_LOG = 60;
/** Title groups remembered as used in this room (oldest forgotten first). */
export const MAX_USED_GROUPS = 400;

/**
 * The hint kinds, in priority order: before each lot every player gets one message, the first
 * kind whose condition holds. Their wording comes from the private `lines` pack, with our own
 * plain lines as the fallback (`lines.ts`).
 */
export const HINT_KINDS = [
  'intro',
  'firstLoan',
  'thirdLoan',
  'prankCall',
  'topStillOut',
  'bankReminder',
  'goodBuy',
  'revenge',
  'brokeEven',
  'badBuy',
  'secondLot',
  'yourArt',
  'someoneKnows',
  'leader',
  'poorPlayer',
  'wantArt',
  'notBidding',
  'notBuying',
  'rivalry',
  'dog',
  'cameoA',
  'cameoB',
  'filler',
] as const;
export type HintKind = (typeof HINT_KINDS)[number];

/** Who a message seems to come from. */
export type Sender = 'buyer1' | 'buyer2' | 'buyer3' | 'bank' | 'dog' | 'caller';
/** The three art buyers: each player hears from one of them all game ("your contact"). */
export const BUYERS = ['buyer1', 'buyer2', 'buyer3'] as const;
export type Buyer = (typeof BUYERS)[number];

/**
 * Who makes sound: nobody, only the host's device, every device, or the table screen (phones then
 * play only their own rings).
 */
export const SOUND_MODES = ['off', 'host', 'all', 'stage'] as const;
export type SoundMode = (typeof SOUND_MODES)[number];

/** The practice lot: a house picture for play money, before lot 1 of a room's first game. */
export const PRACTICE_STEPS = ['hint', 'bid', 'sold', 'own', 'screw'] as const;
export type PracticeStep = (typeof PRACTICE_STEPS)[number];
/** How long each practice step lasts (the bidding runs on the auction's own close instead). */
export const PRACTICE_MS: Record<Exclude<PracticeStep, 'bid'>, number> = {
  hint: 6000,
  sold: 7000,
  own: 7000,
  screw: 9000,
};
export const PRACTICE_VALUE = 2000;
export const PRACTICE_CASH = 3000;
/** The practice lot's scripted rival, who bids once: never a real player id (those are hashes). */
export const HOUSE_BIDDER = '~house';

export interface Settings {
  drawSeconds: DrawSeconds;
  pace: Pace;
  /** The host picked the pace; until then it follows the table (Fast at 3 players, else Normal). */
  paceChosen?: boolean;
  /** Sound (rooms saved before it load with the defaults, `settingsOf`). */
  sound?: SoundMode;
  /** The host picked the sound; until then a paired table screen takes it (`soundModeIn`). */
  soundChosen?: boolean;
  music?: boolean;
  effects?: boolean;
  /** The auctioneer's voice, off unless the host turns it on. */
  voice?: boolean;
  /** The practice lot in the room's first game. */
  practice?: boolean;
}

export const DEFAULT_SETTINGS: Required<Omit<Settings, 'paceChosen' | 'soundChosen'>> = {
  drawSeconds: 90,
  pace: 'normal',
  sound: 'all',
  music: true,
  effects: true,
  voice: false,
  practice: true,
};

/** The settings with every default filled in. */
export const settingsOf = (s: Settings) => ({ ...DEFAULT_SETTINGS, ...s });

export interface Seat {
  name: string;
  /** Their room colour (the auctioneer's voice names players by it). */
  color?: PlayerColor;
  playing: boolean;
  /** Watching only for want of a seat: sat down at the next game if there's room. */
  waiting?: boolean;
}

/** One drawing in the game: a player's (or, unsent or extra, the house's) take on a title. */
export interface Item {
  /** Random, says nothing about who drew it. */
  id: string;
  /** 0: auctioned first, 1: second. */
  group: 0 | 1;
  title: string;
  value: number;
  /** Who was asked to draw it; null for the house's extra drawing. */
  drawer: PlayerId | null;
  /** Who earns the commission: the drawer once they've sent it, else nobody. */
  artist: PlayerId | null;
  drawing: Drawing | null;
  /** The house picture for this title (manifest key), used when nobody drew it. */
  house: string;
  hidden: boolean;
  /** Set once it has been auctioned. */
  sale: Sale | null;
}

export interface Sale {
  /** Null: nobody bid. */
  buyer: PlayerId | null;
  price: number;
  commission: number;
  /** The winning bid was a screw's forced bid, and who screwed. */
  screwedBy: PlayerId | null;
}

export interface WishEntry {
  item: string;
  title: string;
  value: number;
}

export interface Message {
  id: number;
  lot: number;
  kind: HintKind;
  from: Sender;
  text: string;
  /** The player it names, if any (for the "why this hint?" line). */
  about?: PlayerId;
  value?: number;
}

export interface PlayerState {
  cash: number;
  debt: number;
  loans: number;
  bankCalls: number;
  screw: boolean;
  bids: number;
  wish: WishEntry[];
  messages: Message[];
  /** Hint kinds already sent that come once a game. */
  sent: HintKind[];
  /** Flags for the next message: a first or third loan, a call to the bank without a loan. */
  pending: ('firstLoan' | 'thirdLoan' | 'prankCall')[];
  /** When their last bid landed (for the bid rate limit). */
  lastBidAt: number;
}

/** `intro`: the lot number and the hints, before the picture goes up and bidding opens. */
export type CloseStage = 'intro' | 'open' | 'quiet' | 'once' | 'twice';

export interface Auction {
  /** Index into `Game.lots`. */
  lot: number;
  /** Bumps on every change of price, so a bid pressed for an old price is refused. */
  seq: number;
  bid: { by: PlayerId; amount: number } | null;
  close: CloseStage;
  /** When the current close stage ends. */
  closeAt: number;
  /** When the current close stage began (or a screw was pressed or resolved): for the sound. */
  since?: number;
  /**
   * A screw being aimed: the bidding clock waits (bids are refused) until it lands, fails or is
   * lost, then starts a fresh stretch (`afterScrew`). `left` only survives in rooms saved before.
   */
  screw: { by: PlayerId; until: number; left?: number } | null;
  /**
   * A screw's outcome still playing out (the forced bid's or the failure's line and banner): no
   * bids and no close until then, and the clock shows Paused.
   */
  pausedUntil?: number;
  /** Set while a screw's forced bid leads: nobody may screw until a free bid. */
  screwed: { target: PlayerId; by: PlayerId } | null;
  /** Players who called the bank during this lot. */
  bankCalled: PlayerId[];
  /** Players who bid on this lot. */
  bidders: PlayerId[];
  /** The last few bids on this lot, newest last (a screw's forced bid marked). */
  recent?: RecentBid[];
}

export interface RecentBid {
  by: PlayerId;
  amount: number;
  forced: boolean;
}

/** Bids kept in `Auction.recent`. */
export const RECENT_BIDS = 4;

/** `intro`: the auctioneer's spoken welcome and tutorial (voiced games only, the host can skip). */
export type Stage =
  'intro' | 'draw' | 'practice' | 'auction' | 'sold' | 'halftime' | 'bank' | 'done';

/** The practice lot in play (none of it counts). */
export interface Practice {
  step: PracticeStep;
  /** When a timed step ends. */
  until: number;
  /** When this step (or the bidding's current close stage) began. */
  since: number;
  /** A title and house picture from the spare groups, which no lot uses. */
  title: string;
  house: string;
  /** The coach's hint, the same for everyone (it is about the practice lot only). */
  hint: string;
  seq: number;
  bid: { by: PlayerId; amount: number } | null;
  close: CloseStage;
  closeAt: number;
  recent: RecentBid[];
  /** The house bidder has made its one bid. */
  houseBid: boolean;
  lastBidAt: Record<PlayerId, number>;
}

export type LogEntry =
  | {
      id: number;
      lot: number;
      kind: 'screw';
      by: PlayerId;
      target: PlayerId | null;
      outcome: 'forced' | 'failed' | 'wasted';
      amount?: number;
    }
  | { id: number; lot: number; kind: 'hidden'; item: string; hidden: boolean }
  | { id: number; lot: number; kind: 'left'; player: PlayerId }
  | { id: number; lot: number; kind: 'back'; player: PlayerId };

export interface Game {
  order: PlayerId[];
  names: Record<PlayerId, string>;
  players: Record<PlayerId, PlayerState>;
  items: Record<string, Item>;
  /** Item ids in auction order. */
  lots: string[];
  /** Each player's two titles to draw, in order. */
  prompts: Record<PlayerId, string[]>;
  stage: Stage;
  /** When the current timed stage ends (draw, sold, halftime, bank). */
  until: number;
  /** When the drawing started (stats). */
  drawStart: number;
  auction: Auction | null;
  /** The bank has visited at least once (the Call button shows from then on). */
  bankOpened: boolean;
  /** This visit: who has taken a loan or said no. */
  bankDone: PlayerId[];
  /** Who called the bank for this visit. */
  bankCallers: PlayerId[];
  /** Who took a loan at this visit. */
  bankTook: PlayerId[];
  /**
   * The hint lines for this game (from the private lines packs; kinds left out use our own), plus
   * each buyer's own chatter and the practice tip (`LineKey` in `content.ts`).
   */
  lines: Partial<Record<HintKind | Buyer | 'practice', string[]>>;
  /** Players who left the room for good: they keep their seat, cash and art. */
  left: PlayerId[];
  winners: PlayerId[];
  /** Host lines for this game, by moment (from the private host packs; none without them). */
  hostLines: Record<string, string[]>;
  /** What the host says now (public: lines name only players everyone sees). */
  host: HostLine | null;
  /** Two more title groups, dealt if nobody draws anything (one redraw a game). */
  spares: [TitleGroupRef, TitleGroupRef] | null;
  /** Drawing rounds redone because nobody drew anything (at most one). */
  redraws: number;
  /** Set when the game ended with nothing drawn twice. */
  ended: 'no-drawings' | null;
  /** Drawing-stage nudges already given (half time, ten seconds left). */
  nudges: number;
  /** Lots in a row nobody bid on. */
  unsoldRun: number;
  /** Each player's paddle shape (an index into the manifest's paddles). */
  paddles: Record<PlayerId, number>;
  /** When each player last bid (lot index), for the host's call-outs. */
  lastBidLot: Record<PlayerId, number>;
  /** Players the host has called out (quiet ones every 3 lots at most, the art-less once). */
  calledOut: { quiet: Record<PlayerId, number>; empty: PlayerId[] };
  /** When the current stage began (games saved before it have none). */
  since?: number;
  /** Each player's art buyer, who sends them every tip (games saved before it pick at random). */
  contacts?: Record<PlayerId, Buyer>;
  /** The practice lot, while it runs. */
  practice?: Practice | null;
  /** The auctioneer's voice is on (the host's switch with sound on, at the start): it sets the pace. */
  voiced?: boolean;
  /** The voice has explained buying your own drawing once this game. */
  ownArtTold?: boolean;
  /** The host skipped the spoken introduction. */
  introSkipped?: boolean;
}

/** A title group kept for a redraw. */
export interface TitleGroupRef {
  key: string;
  titles: string[];
  house: string[];
}

/** One voice clip the auctioneer says: a key and clip number into the manifest's `audio.voice`. */
export interface HostClip {
  key: string;
  i: number;
  ms: number;
  /** The player a colour-named clip ("You're screwed, yellow!") is said to. */
  player?: PlayerId;
}

export interface HostLine {
  id: number;
  /** One to three short lines, in order (text games; voiced games say `clips`). */
  lines: string[];
  /** Voiced games: the clips said from `at`, one after the other, `ms` in all. */
  clips?: HostClip[];
  ms?: number;
  /** The moment each line was said for (the voice plays the matching clip), and when. */
  moments?: string[];
  /** Lines that name a player: the voice never says those. */
  named?: boolean[];
  at?: number;
}

/** Paddle shapes to deal from (the manifest's `ui.paddles` may hold fewer; the UI wraps). */
export const PADDLE_SHAPES = 29;

/** A test-only setup (browser tests): fixed deal and a quicker clock. Refused unless the server allows it. */
export interface Rig {
  /** Every duration is multiplied by this (0.1–1)… */
  scale: number;
  /** …except the auction's close, which uses this when set (a full-length close leaves time to bid). */
  closeScale?: number;
  /** Starting cash, to reach the bank quickly. */
  cash?: number;
  /**
   * No shuffles: the groups in pack order, titles in seat order (the house gets the next), each
   * player's first-group drawing worth $3,500 and the other $1,000, the house's $2,000, and lots in
   * seat order with the house last.
   */
  fixed: boolean;
}

export interface GoingOnceState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  log: LogEntry[];
  seq: number;
  /** Title groups used in this room, so the next game deals fresh ones (`<pack id>:<group id>`). */
  usedGroups: string[];
  /** Title groups on offer when the lobby last looked (a count, for the host). */
  groupsAvailable: number;
  gamesPlayed: number;
  rig: Rig | null;
  /** Hidden randomness for timer-driven steps (hints at a new lot). */
  seed: number;
}

// ---- Actions ----

const id = z.string().min(1).max(80);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    drawSeconds: z.union([z.literal(60), z.literal(90), z.literal(120)]).optional(),
    pace: z.enum(PACES).optional(),
    sound: z.enum(SOUND_MODES).optional(),
    music: z.boolean().optional(),
    effects: z.boolean().optional(),
    voice: z.boolean().optional(),
    practice: z.boolean().optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('refresh') }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('draw'), item: id, drawing: drawingSchema }),
  z.object({
    type: z.literal('bid'),
    amount: z.number().int().min(OPENING_BID).max(1_000_000),
    seq: z.number().int().min(0),
  }),
  z.object({
    type: z.literal('practice-bid'),
    amount: z.number().int().min(OPENING_BID).max(PRACTICE_CASH),
    seq: z.number().int().min(0),
  }),
  z.object({ type: z.literal('skip-practice') }),
  z.object({ type: z.literal('skip-intro') }),
  z.object({ type: z.literal('screw') }),
  z.object({ type: z.literal('screw-pick'), target: id }),
  z.object({ type: z.literal('call-bank') }),
  z.object({ type: z.literal('loan'), take: z.boolean() }),
  z.object({ type: z.literal('hide'), item: id, hidden: z.boolean() }),
  z.object({ type: z.literal('skip') }),
  z.object({
    type: z.literal('rig'),
    scale: z.number().min(0.1).max(1),
    closeScale: z.number().min(0.1).max(1).optional(),
    cash: z.number().int().min(0).max(100_000).optional(),
    fixed: z.boolean(),
  }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type GoingOnceAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
  waiting?: boolean;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  /** Still holds their screw. */
  screw: boolean;
  /** Has sent both drawings (draw stage). */
  drawn: boolean;
  left: boolean;
}

/** A lot as everyone sees it during its auction: the picture, never its title, value or artist. */
export interface LotPicture {
  item: string;
  /** Strokes; null for a house picture or while hidden. */
  drawing: Drawing | null;
  /** The house picture's key when nobody drew it (null otherwise or while hidden). */
  house: string | null;
  hidden: boolean;
}

/** A lot after its hammer falls. */
export interface LotResult extends LotPicture {
  index: number;
  title: string;
  value: number;
  /** Null: a house drawing (or one its drawer never sent); hidden while unsold until the end. */
  artist: PlayerId | null;
  /** The artist of an unsold lot stays secret until the end. */
  artistKnown: boolean;
  buyer: PlayerId | null;
  price: number;
  commission: number;
  screwedBy: PlayerId | null;
}

export interface AuctionView {
  lot: number;
  /** Empty (no strokes, no house picture) during the lot's intro. */
  picture: LotPicture;
  seq: number;
  bid: { by: PlayerId; amount: number } | null;
  close: CloseStage;
  closeAt: number;
  since: number;
  /** The bids the buttons offer now. */
  steps: number[];
  screw: { by: PlayerId; until: number } | null;
  /** A screw's outcome playing out until then (0: none): the clock is paused. */
  pausedUntil: number;
  screwed: { target: PlayerId; by: PlayerId } | null;
  bankCalled: boolean;
  bidders: PlayerId[];
  recent: RecentBid[];
}

export interface MineView {
  cash: number;
  debt: number;
  loans: number;
  bankCalls: number;
  screw: boolean;
  prompts: { item: string; title: string; sent: boolean; drawing: Drawing | null }[];
  /** Titles and values only: which lot each one is stays the puzzle. */
  wish: { title: string; value: number }[];
  messages: Message[];
  /** Screw targets while aiming one. */
  targets: PlayerId[];
  /** May take a loan at this bank visit (and hasn't decided). */
  canLoan: boolean;
  /** Has decided at this bank visit. */
  bankDone: boolean;
  /** May call the bank now. */
  canCallBank: boolean;
  /** Why the Call the bank button is off ("Stop calling", "Bad credit"), when it shows. */
  bankRefusal: string | null;
  /** The art buyer who sends this player's tips. */
  contact: Buyer;
}

/** The practice lot as everyone sees it. */
export interface PracticeView {
  step: PracticeStep;
  until: number;
  since: number;
  /** The house picture's key. */
  house: string;
  hint: string;
  value: number;
  cash: number;
  /** Shown from the Sold step on. */
  title: string | null;
  seq: number;
  bid: { by: PlayerId; amount: number } | null;
  close: CloseStage;
  closeAt: number;
  steps: number[];
  recent: RecentBid[];
}

export interface FinalView {
  id: PlayerId;
  cash: number;
  art: number;
  debt: number;
  score: number;
  bought: string[];
}

export interface GameView {
  stage: Stage;
  until: number;
  /** When this stage began (for the sound). */
  since: number;
  practice: PracticeView | null;
  order: PlayerId[];
  players: PlayerView[];
  lotCount: number;
  /** Half-time: the lot after which screws unlock. */
  halfAt: number;
  screwsOn: boolean;
  auction: AuctionView | null;
  /** Lots already auctioned, oldest first; their drawings only at the end (the gallery). */
  results: LotResult[];
  bank: { open: boolean; done: PlayerId[]; waiting: PlayerId[] } | null;
  bankOpened: boolean;
  final: FinalView[] | null;
  winners: PlayerId[];
  host: HostLine | null;
  /** The game ended because nobody drew anything, twice. */
  ended: 'no-drawings' | null;
  /** The auctioneer's voice sets the pace this game. */
  voiced: boolean;
  /** The host skipped the spoken introduction (intro stage). */
  introSkipped: boolean;
  /** This drawing round is the redraw. */
  redraw: boolean;
  /** Each player's paddle shape. */
  paddles: Record<PlayerId, number>;
  /** The room's first game (the how-to shows; later games skip it). */
  firstGame: boolean;
  /** At the end: every player's wish list, and who had each lot on theirs (item id → players). */
  knew: {
    lists: Record<PlayerId, { title: string; value: number }[]>;
    by: Record<string, PlayerId[]>;
  } | null;
}

export interface GoingOnceView {
  phase: GoingOnceState['phase'];
  settings: ReturnType<typeof settingsOf> & Pick<Settings, 'paceChosen' | 'soundChosen'>;
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
  mine: MineView | null;
  log: LogEntry[];
  groupsAvailable: number;
  /** Games started in this room (the practice lot runs in the first). */
  gamesPlayed: number;
  rigAllowed: boolean;
  rig: Rig | null;
}
