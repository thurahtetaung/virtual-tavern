import {
  type Drawing,
  type PlayerId,
  type TableVolumes,
  drawingSchema,
  tableVolumeAction,
} from '@vt/game-sdk';
import { z } from 'zod';
import type { PackSummary, Prompt } from './content.ts';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const ROOM_CAPACITY = 20;
/** Lies are short: a title, not a sentence. */
export const MAX_LIE_LENGTH = 45;
/** Points for picking the real title. */
export const TRUTH_POINTS = 1000;
/** Points to the artist for each player who picks the real title. */
export const ARTIST_POINTS = 1000;
/** Points for each player your lie fools (shared between the authors of a merged lie). */
export const FOOL_POINTS = 500;
/** Extra points per drawing in a row on which you found the truth, after the first. */
export const STREAK_POINTS = 100;
/** The board is padded with house titles up to this many options, or the player count if more. */
export const MIN_OPTIONS = 4;
/** Shared credit is rounded down to a multiple of this. */
export const POINT_STEP = 50;
/** How long each answer stays in the spotlight during the reveal, one after another. */
export const REVEAL_STEP_MS = 3000;
/** When, within its step, an answer flips to show whose it was (or that it's the truth). */
export const REVEAL_FLIP_MS = 1400;
/** How long a drawing takes to draw itself on every screen when it comes up. */
export const REPLAY_MS = 1500;
/** Prompt ids remembered per room, so rematches avoid repeats while the packs allow. */
export const MAX_USED_PROMPTS = 2000;
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 600;
/** Default clocks: drawing, writing a lie, picking the truth. */
export const DEFAULT_DRAW_SECONDS = 130;
export const DEFAULT_WRITE_SECONDS = 40;
export const DEFAULT_VOTE_SECONDS = 30;

/** How many drawings each player makes, by player count: two each, one at a full table. */
export const roundsFor = (players: number) => (players >= 8 ? 1 : 2);

export type TimerMode = 'soft' | 'strict';

/**
 * Where the room's sound plays: nowhere, the host's device, every device, or the table screen
 * (with one paired: music and voice there, phones keep their own cues).
 */
export type SoundMode = 'off' | 'host' | 'all' | 'stage';
export const SOUND_MODES: readonly SoundMode[] = ['off', 'host', 'all', 'stage'];

/** The sound settings, with their defaults for rooms saved before they existed. */
export interface SoundSettings {
  sound: SoundMode;
  /** The host picked the sound: until then a paired table screen takes it. */
  soundChosen: boolean;
  music: boolean;
  effects: boolean;
  /** The narrator's voice (and the jokes about some prompts): off unless the host turns it on. */
  voice: boolean;
}
export const DEFAULT_SOUND: SoundSettings = {
  sound: 'host',
  soundChosen: false,
  music: true,
  effects: true,
  voice: false,
};

export interface Settings {
  packIds: string[];
  /** Adult-only prompts (and house titles) are dealt too. */
  adult: boolean;
  drawSeconds: number | null;
  writeSeconds: number | null;
  voteSeconds: number | null;
  timerMode: TimerMode;
  /** Missing in rooms saved before the sound settings: `DEFAULT_SOUND` then. */
  sound?: SoundMode;
  soundChosen?: boolean;
  music?: boolean;
  effects?: boolean;
  voice?: boolean;
  /** The table screen's volumes, from the host's sliders (the table has no input). */
  tableVolumes?: TableVolumes;
}

export interface Seat {
  name: string;
  /** false = just watching. */
  playing: boolean;
}

export type Stage = 'draw' | 'write' | 'vote' | 'reveal';

/** One choice on the board: the real title, or a lie (merged if several players wrote it). */
export interface Option {
  text: string;
  truth: boolean;
  /** Who wrote this lie (empty for the truth and house titles). */
  authors: PlayerId[];
  /** A house title that pads a small board: nobody's lie, scores for nobody. */
  house: boolean;
}

/** A player's drawing for the round. */
export interface Sketch {
  /** The prompt, with any `{player}` filled in and lowercased: the real title on the board. */
  prompt: Prompt;
  drawing: Drawing | null;
}

/** One drawing on the table: lies, the vote and the reveal. */
export interface Turn {
  artist: PlayerId;
  /** Who writes and votes: the round's players but the artist, pruned as they leave. */
  writers: PlayerId[];
  lies: Record<PlayerId, string>;
  /** This drawing's share of the house titles, in their hidden order: the padding comes from it. */
  decoys: string[];
  options: Option[];
  /** Who votes: the writers when voting started (leavers who hadn't voted are dropped). */
  voters: PlayerId[];
  votes: Record<PlayerId, number>;
  /** Board indexes each player liked (any number, never their own lie). */
  likes: Record<PlayerId, number[]>;
  /** The strict vote timer ended the vote before everyone had voted. */
  voteTimedOut: boolean;
  /** Points scored on this drawing, filled at the reveal. */
  points: Record<PlayerId, number>;
  /** Of those, the streak bonus. */
  streakBonus: Record<PlayerId, number>;
  /** Epoch ms when the reveal began: every phone turns the answers over one by one from then. */
  revealedAt: number | null;
  /** The host skipped the one-by-one reveal: everything shows at once. */
  revealSkipped: boolean;
}

/** A drawing that has been played, for the end of the game. */
export interface PastTurn {
  artist: PlayerId;
  prompt: string;
  /** Players who found the real title, of how many voted. */
  found: number;
  voters: number;
  /** Likes the lies on its board got, by author. */
  likes: Record<PlayerId, number>;
}

export interface Game {
  /** 1-based. */
  round: number;
  rounds: number;
  stage: Stage;
  /** Who plays this round: seated when it began, pruned as players leave. */
  players: PlayerId[];
  /** Prompts still to deal (rerolls and later rounds), next first. Never sent to clients. */
  pool: Prompt[];
  /** House titles, in a hidden order: each drawing takes its share in turn. Never sent. */
  decoys: string[];
  /** Where the next drawing's house titles start in `decoys`. */
  decoyAt: number;
  sketches: Record<PlayerId, Sketch>;
  /** Players who have used their one prompt reroll this game. */
  rerolled: PlayerId[];
  /** Artists of this round's drawings, in the (hidden) order they come up. */
  order: PlayerId[];
  /** Index into `order`. */
  at: number;
  turn: Turn | null;
  /** Drawings the host has hidden: they still play, shown as hidden. */
  hidden: PlayerId[];
  /** In a row, drawings on which each player found the truth. */
  streaks: Record<PlayerId, number>;
  history: PastTurn[];
  /** Epoch ms when the current stage times out, or null if untimed. */
  deadline: number | null;
  /** Epoch ms when the current stage began (missing in rooms saved before it was kept). */
  since?: number;
}

export interface Score {
  name: string;
  score: number;
  /** Players fooled by this player's lies, over the game. */
  fooled: number;
  /** Times this player found the truth. */
  truths: number;
  /** Likes this player's lies got. */
  likes: number;
  /** Players who found the truth in this player's drawings. */
  hits: number;
}

export interface SketchyState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  seats: Record<PlayerId, Seat>;
  /** The prompt packs this game is offered, as last seen through `ctx.content`. */
  packs: PackSummary[];
  game: Game | null;
  /** Everyone who has played this game, leavers included. */
  scores: Record<PlayerId, Score>;
  /** Prompts dealt in this room's earlier games, oldest first (capped). */
  usedPromptIds: string[];
  /** Hidden seed for the order of drawings and the board. Never sent to clients. */
  seed: number;
  gamesPlayed: number;
  /** `abandoned`: the host ended a game early, back to the lobby (kept until the next start). */
  endReason: 'finished' | 'too-few' | 'abandoned' | null;
}

const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    packIds: z.array(z.string().min(1)).max(50).optional(),
    adult: z.boolean().optional(),
    drawSeconds: timerSeconds.optional(),
    writeSeconds: timerSeconds.optional(),
    voteSeconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
    sound: z.enum(['off', 'host', 'all', 'stage']).optional(),
    music: z.boolean().optional(),
    effects: z.boolean().optional(),
    voice: z.boolean().optional(),
  }),
  tableVolumeAction,
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('back-to-lobby') }),
  z.object({ type: z.literal('draw'), drawing: drawingSchema }),
  z.object({ type: z.literal('reroll') }),
  // Length and content are checked in `reduce`, so the player gets a friendly message.
  z.object({ type: z.literal('lie'), text: z.string().max(200) }),
  z.object({ type: z.literal('vote'), option: z.number().int().min(0).max(20) }),
  z.object({ type: z.literal('like'), option: z.number().int().min(0).max(20), on: z.boolean() }),
  /** Host: moves on after a reveal. */
  z.object({ type: z.literal('next') }),
  /** Host: show the whole reveal at once instead of one answer at a time. */
  z.object({ type: z.literal('skip-reveal') }),
  /** Host: stop waiting for the players still missing; the stage ends as a strict timeout would. */
  z.object({ type: z.literal('continue-without') }),
  /** Host: hide (or show again) the drawing on the table for everyone; it still plays. */
  z.object({ type: z.literal('hide'), hidden: z.boolean() }),
]);

export type SketchyAction = z.infer<typeof actionSchema>;

// ---- What each player is allowed to see ----

/** `waiting`: seated, but joined after this round began. */
export type Role = 'player' | 'waiting' | 'spectator';

export interface OptionView {
  index: number;
  text: string;
  /** The viewer wrote this lie (so can't pick or like it). */
  mine: boolean;
  /** The rest is revealed only at the reveal. */
  truth: boolean | null;
  authors: PlayerId[] | null;
  voters: PlayerId[] | null;
  house: boolean | null;
  likes: number | null;
}

export interface TurnView {
  /** 1-based, of `of` drawings this round. */
  number: number;
  of: number;
  /** The viewer drew this one. */
  mine: boolean;
  /** Who drew it: null until the reveal. */
  artist: PlayerId | null;
  /** The real title: to its artist all along, to everyone at the reveal. */
  prompt: string | null;
  /** Null when the host has hidden it. */
  drawing: Drawing | null;
  hidden: boolean;
  /** How many write a lie and vote (who they are stays hidden until the reveal). */
  writerCount: number;
  /** The viewer writes and votes on this drawing. */
  writing: boolean;
  /**
   * Who is still to write (or vote), named only once someone else is in, so the missing never
   * point at the artist by elimination. Null otherwise.
   */
  missing: PlayerId[] | null;
  /** Lies in (or votes cast). */
  done: number;
  /**
   * Titles in so far (while writing, then for the rest of the drawing): the table screen's last
   * pencil still breaks after the last title has moved the table on to picking.
   */
  titles: number;
  myLie: string | null;
  myLieShared: boolean;
  /** The board: empty while lies are being written. */
  options: OptionView[];
  myVote: number | null;
  myLikes: number[];
  /** The viewer may like answers now. */
  canLike: boolean;
  voteTimedOut: boolean;
  /** Points scored on this drawing: null until the reveal. */
  points: Record<PlayerId, number> | null;
  streakBonus: Record<PlayerId, number> | null;
  /** When the one-by-one reveal began (server clock), or null when everything shows at once. */
  revealAt: number | null;
}

export interface GameView {
  round: number;
  rounds: number;
  stage: Stage;
  players: PlayerId[];
  /**
   * Who has sent their drawing this round (from the drawing stage to the round's end, so the last
   * one in still finishes its pencil on the table screen once the table has moved on).
   */
  drawn: PlayerId[];
  /** Drawing stage: the viewer's own prompt, or null. */
  myPrompt: string | null;
  /** Drawing stage: the viewer's sent drawing. */
  myDrawing: Drawing | null;
  /**
   * The viewer's drawing for this round is in (in every stage of the round): their own "sent" cue
   * plays even when theirs was the last one and the table moved straight on to writing.
   */
  sentDrawing: boolean;
  canReroll: boolean;
  rerolled: boolean;
  turn: TurnView | null;
  streaks: Record<PlayerId, number>;
  history: PastTurn[];
  deadline: number | null;
  /** When the current stage began, on the server clock (0 when unknown). */
  since: number;
}

export interface ScoreView extends Score {
  id: PlayerId;
  /** No longer in the room. */
  left: boolean;
}

export interface SketchyView {
  phase: SketchyState['phase'];
  /** The settings, the sound ones always filled in. */
  settings: Settings & SoundSettings;
  seats: Array<Seat & { id: PlayerId }>;
  me: (Seat & { id: PlayerId }) | null;
  role: Role;
  packs: PackSummary[];
  game: GameView | null;
  /** Highest score first. */
  scores: ScoreView[];
  endReason: SketchyState['endReason'];
}
