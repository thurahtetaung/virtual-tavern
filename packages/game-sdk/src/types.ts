import type { ZodType } from 'zod';
import type { GameGuide } from './guide.ts';
import type { Rng } from './rng.ts';

export type PlayerId = string;

export interface PlayerInfo {
  id: PlayerId;
  name: string;
}

export interface WordListSummary {
  id: string;
  name: string;
  /** Short blurb shown to players when choosing lists. */
  description?: string;
  wordCount: number;
}

/** Server-provided content that games may read synchronously. */
export interface ContentProvider {
  wordLists(): WordListSummary[];
  /** Words from the given lists, combined. May contain duplicates across lists. */
  words(listIds: readonly string[]): string[];
}

export interface CreateCtx {
  now: number;
  rng: Rng;
  content: ContentProvider;
}

export interface ActionCtx extends CreateCtx {
  by: PlayerId;
  /** Whether `by` is the room host. Room-level concept, supplied by the room host. */
  isHost: boolean;
}

/** A rejected action. Returned (not thrown) from `reduce`. */
export class GameError {
  readonly code: string;
  readonly message: string;
  constructor(code: string, message: string) {
    this.code = code;
    this.message = message;
  }
}

export const isGameError = (value: unknown): value is GameError => value instanceof GameError;

/**
 * A game plugin. All functions must be pure: no I/O, no Date.now(), no Math.random().
 * State must be JSON-serialisable so the room host can persist it.
 */
export interface GameDefinition<State, Action, View> {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /**
   * `private` games are only listed, created, joined and played by players who have unlocked
   * the back room. Their assets live in private storage, never in the repo. Default: public.
   */
  access?: 'public' | 'private';
  /** Beginner-friendly rules; required so every game is learnable in-app. */
  guide: GameGuide;
  actionSchema: ZodType<Action>;
  /** Initial state for a freshly opened game (typically a pre-game lobby phase). */
  create(ctx: CreateCtx, players: readonly PlayerInfo[]): State;
  reduce(state: State, action: Action, ctx: ActionCtx): State | GameError;
  /** Player joined the room, or rejoined/renamed (upsert by id). */
  playerJoined(state: State, player: PlayerInfo): State;
  /** Player left the room for good (left or was kicked). Disconnects are not reported. */
  playerLeft(state: State, playerId: PlayerId, now: number): State;
  /** What `viewer` may see. `null` is an observer with no seat. Must strip all hidden information. */
  view(state: State, viewer: PlayerId | null): View;
  /** Epoch ms at which `onDeadline` should run, or null if no timer is active. */
  nextDeadline?(state: State): number | null;
  onDeadline?(state: State, now: number): State;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameDefinition = GameDefinition<any, any, any>;
