import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';
import type { CardId, Position } from './cards.ts';
import type { Check, Play, Trick } from './checks.ts';
import type { AttemptComms, Comms, MissionDef, OrderToken, Selection } from './content.ts';

export const MIN_PLAYERS = 2;
export const MAX_SEATED = 5;
export const ROOM_CAPACITY = 20;
/** The dummy crew member's seat id in a two-player game. */
export const DUMMY = 'dummy';
/** How long the mission briefing waits before the deal, unless everyone is ready sooner. */
export const BRIEFING_SECONDS = 60;
/** Task cards remembered as drawn, so new draws prefer fresh ones until the deck runs low. */
export const MAX_USED_TASKS = 300;
/** How long a request to wait for a signal holds the leader back. */
export const HOLD_SECONDS = 20;
/** Emotes kept (only after a trick). */
export const MAX_EMOTES = 8;
export const EMOTES = ['😬', '👍', '🙏', '🤞', '🎉', '😅'] as const;
/** The endless epilogue's mission number in the logbook. */
export const EPILOGUE = 0;

export interface Settings {
  /** The voyage (campaign) this room plays. */
  voyageKey: string | null;
  /** Everyone can look back at every trick played, not just the last (host option). */
  playedCards: boolean;
  /** Real-time missions run their clock; off, they play their printed alternative. */
  realTime: boolean;
  /** House rule: the table talks freely (only the banners change). */
  openTable: boolean;
  /** Two players: the dummy sits after the first (0) or the second (1) player. */
  dummyAfter: 0 | 1;
  /** One-card task campaigns at exactly three players: no green cards and no trump 1. */
  challenge: boolean;
}

export interface Seat {
  name: string;
  playing: boolean;
}

// ---- Campaign ----

export interface MissionLog {
  /** Counted attempts (a distress signal adds one, once per mission). */
  attempts: number;
  distress: boolean;
  /** Epoch ms of the first success, or null. */
  done: number | null;
  /** The crew's names on the first success. */
  crew: string[];
  /** Attempts played out of order. */
  practice: number;
  practised: boolean;
}

export interface Campaign {
  key: string;
  started: number;
  finished: number | null;
  /** Everyone who has dived in this campaign, by id. */
  members: Record<PlayerId, string>;
  log: Record<string, MissionLog>;
  /** The endless epilogue: the next difficulty and how it went. */
  epilogue: { level: number; successes: number; attempts: number; distress: number };
}

export interface MissionSummary {
  n: number;
  title: string | null;
  difficulty: number | null;
  comms: Comms;
  selection: Selection;
  timed: boolean;
  /** Missions without drawn tasks (crew conditions or fixed tasks). */
  fixed: boolean;
  /** One-card campaigns: tasks to draw and their order tokens. */
  cards: number | null;
  tokens: OrderToken[];
}

export interface VoyageSummary {
  key: string;
  /** `cards`: one-card tasks; `pack`: task cards from the tasks pack. */
  taskSet: 'pack' | 'cards';
  packId: string;
  name: string;
  missions: MissionSummary[];
  epilogue: { difficulty: number; title: string | null } | null;
}

// ---- One attempt ----

/** The mission as this attempt plays it. */
export interface MissionPlay {
  /** The mission number; `EPILOGUE` (0) for the endless epilogue. */
  n: number;
  title: string | null;
  rule: string | null;
  story: string | null;
  fresh: string | null;
  /** The difficulty drawn to (null without drawn tasks). */
  difficulty: number | null;
  comms: Comms;
  commsFrom: number | null;
  selection: Selection;
  wanted: number;
  /** Seconds on the clock for a real-time mission played with its timer. */
  seconds: number | null;
  /** Played out of campaign order. */
  practice: boolean;
  /** One-card tasks ("win this card") instead of task cards from the pack. */
  cardTasks: boolean;
  /** The one-card campaigns' mission rules (absent fields: not on this mission). */
  rules: MissionRules;
}

export type MissionRules = Pick<
  MissionDef,
  | 'cards'
  | 'tokens'
  | 'passing'
  | 'tokenEdit'
  | 'pick'
  | 'handOver'
  | 'drawAfterFirst'
  | 'omegaLast'
  | 'holderLeft'
  | 'captainTask'
  | 'roleNames'
>;

export type TaskState = 'open' | 'done' | 'failed';

export interface TaskInPlay {
  /** `<pack id>:<task id>`, or `fixed:<i>`/`crew:<i>` for a mission's own. */
  key: string;
  check: Check;
  text: string;
  difficulty: number;
  /** The holder; null for a crew condition (it belongs to everyone). */
  owner: string | null;
  crew: boolean;
  /** Prediction tasks: the number named before the first trick. */
  prediction: number | null;
  state: TaskState;
  progress: string | null;
  why: string | null;
  /** The trick (1-based) that settled it. */
  at: number | null;
  /** Teammates whose cards in the deciding trick fed it. */
  fedBy: string[];
  /** An order token on a one-card task. */
  token: OrderToken | null;
}

export interface DraftState {
  /** Seats who pick, in order (normal selection), or who are asked (crew wanted, captain offers). */
  order: string[];
  /** Index into `order`. */
  at: number;
  /** Normal selection: picks made so far this round, for the passing rule. */
  round: number;
  passed: string[];
  /** Yes/no answers so far (crew wanted, captain offers). */
  answers: Record<string, boolean>;
  /** Who takes the tasks (crew wanted: the yes-sayers; after a captain's offer). */
  chosen: string[];
  /** Free selection, all to one, the split: who has pressed Ready. */
  ready: string[];
  /** The captain gave the tasks away: every signal must be made before the first trick. */
  given: boolean;
  /** Commander's distribution: the task on offer now (an index), or null. */
  offer: number | null;
  /** Roles: each seat's claimed role (0, 1 or 2). */
  roles: Record<string, number>;
}

/** Steps before the draft and after it (one-card campaigns). */
export interface Extras {
  /** The captain's pick: who answered what, and whom the captain chose. */
  pick: { answers: Record<string, string>; order: string[]; at: number; chosen: string | null };
  /** A proposed token swap or move, and who agreed; `ready`: who wants none. */
  tokenEdit: {
    proposal: { by: string; a: number; b: number } | null;
    accepted: string[];
    ready: string[];
  };
  /** The five-player hand-over: one task may change hands once. */
  handOver: {
    proposal: { by: string; task: number; to: string } | null;
    accepted: string[];
    ready: string[];
  };
  /** The crew member who may not signal this mission. */
  mute: string | null;
  /** After the first trick: who drew which card (each seat sees only its own). */
  drawn: Record<string, CardId>;
  /** Public notes for the table ("Ana holds the pink 9"). */
  notes: string[];
}

export interface Signal {
  by: string;
  card: CardId;
  /** Null under currents: the position isn't shown. */
  pos: Position | null;
  played: boolean;
  /** Before which trick (1-based). */
  before: number;
}

export interface Distress {
  proposal: { by: string; dir: 'left' | 'right' } | null;
  accepted: string[];
  /** Pressed "Dive" (no distress). */
  dive: string[];
  used: boolean;
  dir: 'left' | 'right' | null;
  /** The pass: each seat's chosen card (the dummy's is chosen by the captain). */
  passes: Record<string, CardId>;
  /** What each seat received, for its owner only. */
  received: Record<string, CardId>;
}

export type Stage =
  | 'briefing'
  | 'pick'
  | 'tokens'
  | 'draft'
  | 'handover'
  | 'distress'
  | 'pass'
  | 'predict'
  | 'play'
  | 'done';

export interface Result {
  success: boolean;
  why: string | null;
  /** The failing task's index in `tasks`. */
  task: number | null;
  timedOut: boolean;
  /** Tricks played when it ended. */
  tricks: number;
}

export interface Attempt {
  mission: MissionPlay;
  /** This attempt's number at this mission (1-based). */
  number: number;
  stage: Stage;
  /** Everyone at the table in seat order, the dummy included. */
  crew: string[];
  captain: string;
  /** Unplayed cards by seat. Never sent except a viewer's own (and the dummy's face-up ones). */
  hands: Record<string, CardId[]>;
  /** The dealt hands (after any distress pass), for the replay at the end. */
  dealt: Record<string, CardId[]>;
  /** The dummy's two rows: `up[i]` lies on `down[i]`. */
  dummy: { up: (CardId | null)[]; down: (CardId | null)[] } | null;
  total: number;
  tasks: TaskInPlay[];
  draft: DraftState;
  /** Unfamiliar terrain: the card drawn and what it made the signals. */
  terrain: CardId | null;
  comms: AttemptComms;
  /** Seats whose own sonar token is still unused. */
  tokens: string[];
  /** Rapture of the deep: shared tokens left. */
  pool: number;
  signals: Signal[];
  /** Players asking the leader to wait while they signal. */
  holds: string[];
  /** When the first of them asked (holds lapse after `HOLD_SECONDS`). */
  holdSince: number | null;
  distress: Distress;
  tricks: Trick[];
  current: Play[];
  turn: string;
  ready: string[];
  /** Epoch ms: the briefing's end, or a real-time mission's clock. */
  deadline: number | null;
  startedAt: number;
  playStartedAt: number | null;
  result: Result | null;
  /** Cards dealt again because of a task's printed re-deal rule. */
  redeals: number;
  /** Tasks put back and replaced because they couldn't be met together. */
  redraws: number;
  extras: Extras;
}

export interface Emote {
  by: PlayerId;
  emoji: string;
  at: number;
  /** After which trick. */
  trick: number;
}

export interface MissionControlState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  seats: Record<PlayerId, Seat>;
  voyages: VoyageSummary[];
  campaigns: Record<string, Campaign>;
  /** The mission the lobby has chosen (null: the campaign's next). */
  chosen: number | null;
  attempt: Attempt | null;
  usedTasks: string[];
  /** Hidden seed for deals and draws. Never sent. */
  seed: number;
  emotes: Emote[];
  /** Why the last attempt stopped without counting (a player left). */
  notice: string | null;
  attemptsPlayed: number;
}

const seat = z.string().min(1).max(80);
const cardId = z.string().regex(/^[pbgyt][1-9]$/);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    voyageKey: z.string().max(40).optional(),
    playedCards: z.boolean().optional(),
    realTime: z.boolean().optional(),
    openTable: z.boolean().optional(),
    dummyAfter: z.union([z.literal(0), z.literal(1)]).optional(),
    challenge: z.boolean().optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  /** Host: the mission to play next (null: the campaign's next); others are practice. */
  z.object({ type: z.literal('choose'), mission: z.number().int().min(0).max(99).nullable() }),
  z.object({ type: z.literal('start') }),
  /** Host: back to the lobby (an attempt in play stops without counting). */
  z.object({ type: z.literal('lobby') }),
  z.object({ type: z.literal('ready') }),
  // The draft. `task` is an index into the attempt's tasks; `for` lets the captain act for the dummy.
  z.object({ type: z.literal('take'), task: z.number().int().min(0).max(40) }),
  z.object({ type: z.literal('pass') }),
  z.object({
    type: z.literal('claim'),
    task: z.number().int().min(0).max(40),
    on: z.boolean(),
    for: seat.optional(),
  }),
  z.object({ type: z.literal('take-all'), for: seat.optional() }),
  z.object({ type: z.literal('answer'), yes: z.boolean() }),
  z.object({ type: z.literal('give'), to: seat }),
  z.object({
    type: z.literal('predict'),
    task: z.number().int().min(0).max(40),
    n: z.number().int().min(0).max(14),
  }),
  z.object({ type: z.literal('distress'), dir: z.enum(['left', 'right']) }),
  z.object({ type: z.literal('distress-answer'), yes: z.boolean() }),
  z.object({ type: z.literal('dive') }),
  z.object({ type: z.literal('pass-card'), card: cardId, for: seat.optional() }),
  z.object({ type: z.literal('play'), card: cardId }),
  z.object({
    type: z.literal('signal'),
    card: cardId,
    pos: z.enum(['top', 'only', 'bottom']).nullable(),
  }),
  z.object({ type: z.literal('hold'), on: z.boolean() }),
  z.object({ type: z.literal('emote'), emoji: z.enum(EMOTES) }),
  /** After a failure: deal again with the same tasks or new ones. */
  z.object({ type: z.literal('retry'), same: z.boolean() }),
  /** After a success: on to the next mission (or the next epilogue dive). */
  z.object({ type: z.literal('next') }),
  /** The captain's pick: an answer to the question (in turn), then the captain chooses. */
  z.object({ type: z.literal('reply'), reply: z.string().max(60) }),
  z.object({ type: z.literal('choose-member'), seat }),
  /** Token swap (or move onto an unmarked task, `b`), proposed and agreed. */
  z.object({
    type: z.literal('token-edit'),
    a: z.number().int().min(0).max(40),
    b: z.number().int().min(0).max(40),
  }),
  z.object({ type: z.literal('token-answer'), yes: z.boolean() }),
  /** The five-player hand-over. */
  z.object({ type: z.literal('hand-over'), task: z.number().int().min(0).max(40), to: seat }),
  z.object({ type: z.literal('hand-over-answer'), yes: z.boolean() }),
  /** Roles: claim a role (0, 1 or 2) for yourself or the dummy. */
  z.object({ type: z.literal('role'), role: z.number().int().min(0).max(2), for: seat.optional() }),
]);

export type MissionControlAction = z.infer<typeof actionSchema>;

// ---- What each player sees ----

export type Role = 'player' | 'waiting' | 'spectator';

export interface TaskView {
  index: number;
  token: OrderToken | null;
  key: string;
  /** The condition (public, like the task card). */
  check: Check;
  text: string;
  difficulty: number;
  owner: string | null;
  crew: boolean;
  /** A prediction task's number: hidden (null) from others while it is secret. */
  prediction: number | null;
  predictionSecret: boolean;
  /** The viewer may not take it (the captain and a captain comparison). */
  captainCannot: boolean;
  state: TaskState;
  progress: string | null;
  why: string | null;
  at: number | null;
  fedBy: string[];
}

export interface CrewView {
  id: string;
  dummy: boolean;
  captain: boolean;
  /** Cards left in hand. */
  cards: number;
  tricks: number;
  /** Their own sonar token: unused, used, or none (dummy; shared tokens). */
  token: 'unused' | 'used' | null;
}

export interface DraftView {
  /** Whose turn it is to pick or answer (null when anyone may act). */
  turn: string | null;
  canPass: boolean;
  order: string[];
  answers: Record<string, boolean>;
  chosen: string[];
  ready: string[];
  given: boolean;
  offer: number | null;
  roles: Record<string, number>;
  /** Commander's decision: the tasks are still face down. */
  hidden: boolean;
}

export interface AttemptView {
  mission: MissionPlay;
  number: number;
  stage: Stage;
  crew: CrewView[];
  captain: string;
  /** Seats the viewer plays for (their own, and the dummy for the captain). */
  controls: string[];
  /** The viewer's own hand, sorted (null for watchers, and during the briefing). */
  hand: CardId[] | null;
  dummy: { up: (CardId | null)[]; down: number } | null;
  /** Cards the viewer may play now (for the seat whose turn it is, if the viewer controls it). */
  legal: CardId[];
  tasks: TaskView[];
  draft: DraftView;
  terrain: CardId | null;
  comms: AttemptComms;
  commsFrom: number | null;
  /** Why the viewer can't signal now, or null if they can. */
  signalBlock: string | null;
  /** The viewer's colour cards that can be signalled now, with their positions. */
  signalable: Record<CardId, Position[]>;
  pool: number;
  signals: Signal[];
  holds: string[];
  /** When the holds lapse (server clock), or null. */
  holdUntil: number | null;
  distress: {
    proposal: Distress['proposal'];
    accepted: string[];
    dive: string[];
    used: boolean;
    dir: Distress['dir'];
    /** Seats whose pass is in (not which card). */
    passed: string[];
    /** The viewer's own pass and what they got. */
    myPass: Record<string, CardId>;
    received: Record<string, CardId>;
  };
  /** Completed tricks: all of them with the played-cards option, else only the last. */
  tricks: (Trick & { no: number })[];
  trickCount: number;
  /** Tricks in the attempt. */
  total: number;
  current: Play[];
  turn: string;
  ready: string[];
  deadline: number | null;
  result: Result | null;
  redeals: number;
  redraws: number;
  /** At the end: every dealt hand and every trick, for the replay. */
  replay: { hands: Record<string, CardId[]>; tricks: Trick[] } | null;
  /** One-card campaigns' steps; `drawn` holds only the viewer's own card. */
  extras: Extras;
}

export interface CampaignView extends Campaign {
  /** The next mission in order (`EPILOGUE` once every mission is done). */
  next: number;
}

export interface MissionControlView {
  phase: MissionControlState['phase'];
  settings: Settings;
  seats: Array<Seat & { id: PlayerId }>;
  me: (Seat & { id: PlayerId }) | null;
  role: Role;
  voyages: VoyageSummary[];
  voyage: VoyageSummary | null;
  campaign: CampaignView | null;
  chosen: number | null;
  attempt: AttemptView | null;
  emotes: Emote[];
  notice: string | null;
}
