import type { PlayerColor } from './colors.ts';
import type { ZodType } from 'zod';
import type { AwardModule } from './awards.ts';
import type { BotCtx, BotInfo } from './bots.ts';
import type { GameGuide } from './guide.ts';
import type { Rng } from './rng.ts';

export type PlayerId = string;

export interface PlayerInfo {
  id: PlayerId;
  name: string;
  /**
   * The player's colour in the room, which they can change at any time; a change arrives as
   * another `playerJoined`. Missing in tests.
   */
  color?: PlayerColor;
}

export interface WordListSummary {
  id: string;
  name: string;
  /** Short blurb shown to players when choosing lists. */
  description?: string;
  wordCount: number;
  /** Ids of the games that offer this list (set by the server; fakes in tests may omit it). */
  games?: string[];
}

/** A deck of trivia questions (admin-managed, private to the server's database). */
export interface QuestionDeckSummary {
  id: string;
  name: string;
  /** Short blurb shown to players when choosing decks. */
  description?: string;
  questionCount: number;
  /** Whether the deck holds adult-only questions. */
  adult?: boolean;
}

/** One trivia question. `prompt` contains exactly one `___` where the answer goes. */
export interface Question {
  /** Stable within its deck, e.g. `<deckId>:<index>`; used to avoid repeats. */
  id: string;
  deckId: string;
  prompt: string;
  answer: string;
  /** Other accepted forms of the answer. */
  alternates: string[];
  /** Built-in fake answers the game may use as house lies. Never shown as such to players. */
  decoys?: string[];
}

/**
 * One open question (Stampede): no right answer, just a prompt everyone answers. Games with
 * `questionKind: 'open'` read these through `ContentProvider.openQuestions`.
 */
export interface OpenQuestion {
  /** Stable within its deck, e.g. `<deckId>:<index>`; used to avoid repeats. */
  id: string;
  deckId: string;
  prompt: string;
}

/** Server-provided content that games may read synchronously. */
export interface ContentProvider {
  wordLists(): WordListSummary[];
  /** Words from the given lists, combined. May contain duplicates across lists. */
  words(listIds: readonly string[]): string[];
  /** Enabled question decks offered to this game. Absent on servers without question decks. */
  questionDecks?(): QuestionDeckSummary[];
  /** Questions from the given decks (ignores unknown, disabled or untagged ids). */
  questions?(deckIds: readonly string[]): Question[];
  /** Open questions from the given decks, for games with `questionKind: 'open'`. */
  openQuestions?(deckIds: readonly string[]): OpenQuestion[];
  /**
   * The enabled private content packs of one kind for this game (`content_packs`), each with its
   * data as the game's schema accepted it. Absent on servers without content packs; only games
   * that declare `contentPacks` get it.
   */
  contentPacks?(kind: string): ContentPack[];
  /**
   * How long each narration line of a private game's manifest lasts, in ms (`narrationLengths`),
   * or null while unknown. Absent on servers without asset storage and for public games.
   */
  narrationLengths?(): Readonly<Record<string, number>> | null;
}

/** One private content pack (admin-imported, server-side only). */
export interface ContentPack {
  id: string;
  name: string;
  data: unknown;
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
  /**
   * Whether a player is connected right now (bots count as connected). Room-level, supplied by
   * the room host; absent in tests and harnesses, where games should treat everyone as connected.
   */
  connected?: (id: PlayerId) => boolean;
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

/** The most players who can play a game at once (`maxSeated`, else its room limit). */
export const seatLimit = (game: { maxPlayers: number; maxSeated?: number }) =>
  game.maxSeated ?? game.maxPlayers;

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
  /** The room limit: everyone in the room, watchers included. */
  maxPlayers: number;
  /**
   * The most players who can actually play (take a seat at the table); the rest of the room
   * watches. Where it depends on lobby settings, the largest over all of them. Default:
   * `maxPlayers`, for games where everyone in the room plays.
   */
  maxSeated?: number;
  /**
   * The only player colours this game's rooms use, when it needs fewer than all 16 (Going Once:
   * the seven its auctioneer says out loud). The room gives newcomers one of these, offers only
   * these in the colour picker, refuses the rest, and moves players who had another colour (a
   * room saved before) onto a free one; past the list's length they repeat, least used first.
   * Default: every `PLAYER_COLORS` colour.
   */
  colors?: readonly PlayerColor[];
  /**
   * `private` games are only listed, created, joined and played by players who have unlocked
   * the back room. Their assets live in private storage, never in the repo. Default: public.
   */
  access?: 'public' | 'private';
  /**
   * Whether the game draws words from admin word lists. Lists can be tagged only for such games,
   * and `ctx.content` only offers a game the lists tagged for it. Default: false.
   */
  usesWordLists?: boolean;
  /** Whether the game draws questions from admin question decks. Default: false. */
  usesQuestionDecks?: boolean;
  /**
   * Which decks a question-deck game reads: `trivia` (the default: every question has an answer)
   * or `open` (questions with no right answer, through `ContentProvider.openQuestions`). A deck is
   * tagged for games of one kind only.
   */
  questionKind?: 'trivia' | 'open';
  /**
   * Back-room games with private content packs: the kinds they read through
   * `ctx.content.contentPacks(kind)`, each with the schema a pack's data must pass to be imported.
   * Packs never reach a browser except the admin's.
   */
  contentPacks?: { kinds: Readonly<Record<string, ZodType>> };
  /**
   * Back-room games with background music from their manifest (`music`, `musicTracks`): the
   * phases it plays in, which the admin may give other tracks on the Games page.
   */
  music?: { phases: readonly { id: string; label: string }[] };
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
  /**
   * Optional: a member's device came (`connected`) or went. Called when their last connection
   * closes or their first one opens (several tabs count as one), and, as disconnected, for every
   * member when the room loads (after a restart nobody is connected yet), so it must be
   * idempotent. Never called for playtest bots. Return the same state when nothing changes.
   */
  playerPresence?(state: State, playerId: PlayerId, connected: boolean, now: number): State;
  /** What `viewer` may see. `null` is an observer with no seat. Must strip all hidden information. */
  view(state: State, viewer: PlayerId | null): View;
  /**
   * Epoch ms at which `onDeadline` should run, or null if no timer is active. The state
   * `onDeadline` returns must report a later deadline (or null): a deadline that stays in the
   * past is treated as a bug and the room host stops its timer until the next player action.
   */
  nextDeadline?(state: State): number | null;
  /** Called once the deadline has passed. Must always make progress (end the turn, time out…). */
  onDeadline?(state: State, now: number): State;
  /**
   * Stats only: what this accepted change meant, as game-agnostic events for the admin stats page
   * (clues given, guesses, outcomes…). Pure and side-effect free like everything else; called by
   * the room host after an action or deadline is committed. `by` is null for deadlines. Never
   * affects play, so it can be added to a game at any time.
   */
  insights?(
    before: State,
    after: State,
    action: Action | null,
    by: PlayerId | null,
  ): InsightEvent[];
  /**
   * Tavern night recap: award rules over this game's own `insights` events (see `awards.ts`).
   * Like `insights`, it never affects play.
   */
  awards?: AwardModule;
  /**
   * Admin playtests: the move a bot in seat `ctx.me` makes now, from that seat's own `view`
   * only (never the state), or null when it has nothing to do. Pure and idempotent: one legal
   * action at a time, null once it has done its part. In the lobby it may only seat itself;
   * starting and every host-only step belong to the human host. See `docs/adding-a-game.md` §1c.
   */
  bot?(view: View, ctx: BotCtx): Action | null;
  /** How the bots fit a playtest (roles they can't play, setup). */
  botInfo?: BotInfo;
}

/**
 * A game-specific fact for the stats page. `type` is game-scoped and stable (e.g. 'clue', 'guess',
 * 'card', 'outcome'); `words` are reported per kind so the stats store can count them; `players`
 * credits outcomes (winners, the guesser…); everything else goes in `props` (JSON-serialisable).
 */
export interface InsightEvent {
  type: string;
  /** The player the event is about, if any (the clue giver, the guesser…). */
  playerId?: PlayerId | null;
  /** Words to count: clue / guess / cancelled / assassin / story. */
  words?: { kind: 'clue' | 'guess' | 'cancelled' | 'assassin' | 'story'; word: string }[];
  /** Players credited with a win, for leaderboards. */
  winners?: PlayerId[];
  props?: Record<string, string | number | boolean | null | string[] | number[]>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameDefinition = GameDefinition<any, any, any>;
