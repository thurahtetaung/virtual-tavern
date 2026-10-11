import type { WordListSummary } from './types.ts';

/** Room context handed to a game's UI component. Framework-agnostic so the SDK stays React-free. */
export interface GameRoomInfo {
  you: string;
  hostId: string;
  isHost: boolean;
  players: { id: string; name: string; connected: boolean }[];
  /** Add to Date.now() to approximate the server clock (for deadlines). */
  clockOffset: number;
  wordLists: WordListSummary[];
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

export interface GameUiProps<View, Action> {
  view: View;
  room: GameRoomInfo;
  /** Sends an action; resolves false if it was rejected (the shell already showed the error). */
  act: (action: Action, options?: ActOptions) => Promise<boolean>;
  /** Opens the game's rules guide. */
  showGuide: () => void;
  /** Tells the shell whether the viewer is expected to act now, so it can mark the tab. */
  setYourMove?: (yes: boolean) => void;
  /** Tells the shell the viewer is watching (with how to join), or null once they play. */
  setSpectator?: (prompt: SpectatorPrompt | null) => void;
}
