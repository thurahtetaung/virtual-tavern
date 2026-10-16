import type { PlayerColor } from './colors.ts';
import type { WordListSummary } from './types.ts';

/** Room context handed to a game's UI component. Framework-agnostic so the SDK stays React-free. */
export interface GameRoomInfo {
  you: string;
  hostId: string;
  isHost: boolean;
  /** `color` is missing in tests. */
  players: { id: string; name: string; color?: PlayerColor; connected: boolean }[];
  /** Add to Date.now() to approximate the server clock (for deadlines). */
  clockOffset: number;
  wordLists: WordListSummary[];
  /**
   * The game's name as the room header shows it (a back-room game's title from the admin or its
   * manifest). Show this, not a name of your own, wherever the game names itself.
   */
  gameName?: string;
  /**
   * The finished game's superlatives (2–3 lines), already worded and named by the shell. Only
   * set on the end screen while night recaps are on; show them with `Superlatives` from `@vt/ui`.
   */
  superlatives?: Superlative[];
}

/** One line of a game's end-screen strip: "💀 Assassin Magnet: Ben shook hands with the assassin". */
export interface Superlative {
  emoji: string;
  title: string;
  text: string;
}

export interface ActOptions {
  /**
   * Where a refusal belongs: the id of a `RefusalSlot` (from `@vt/ui`) next to the control that
   * sent the action. The shell shows the server's message there, or as a toast when no such slot
   * is on screen.
   */
  anchor?: string;
}

/**
 * Tells the shell the viewer is only watching, so it can show "You're watching" at the top of
 * the room with a button that leads to the game's own seat control.
 */
export interface SpectatorPrompt {
  /** What to do, e.g. "Join a team below." Default: "Take a seat to play." */
  text?: string;
  /** The button's label. Default: "Take a seat". */
  actionLabel?: string;
  /** Takes the seat, or scrolls to the game's seat control. No action: no button. */
  action?: () => void;
}

/** The host's "Abandon game" in the room's Players drawer: what ends the game under way. */
export interface AbandonGame {
  /** Sends the game's own back-to-lobby action (the shell has already asked the host). */
  run: () => void;
}

export interface GameUiProps<View, Action> {
  view: View;
  room: GameRoomInfo;
  /** Sends an action; resolves false if it was rejected (the shell already showed the error). */
  act: (action: Action, options?: ActOptions) => Promise<boolean>;
  /**
   * Opens the game's rules guide; with a topic (a tile id or role anchor, as a string), at that
   * card. Anything else is ignored, so it can still be an `onClick` handler.
   */
  showGuide: (topic?: unknown) => void;
  /** Tells the shell whether the viewer is expected to act now, so it can mark the tab. */
  setYourMove?: (yes: boolean) => void;
  /** Tells the shell the viewer is watching (with how to join), or null once they play. */
  setSpectator?: (prompt: SpectatorPrompt | null) => void;
  /**
   * Offers the host "Abandon game" in the Players drawer while a game is under way, or null when
   * there is nothing to abandon. Use `useAbandonGame` from `@vt/ui`.
   */
  setAbandon?: (abandon: AbandonGame | null) => void;
  /**
   * Opens the room's colour picker for the viewer (Reverie's own seat does this). Only given while
   * colours may change (no game in play, or between rounds).
   */
  pickColor?: () => void;
}
