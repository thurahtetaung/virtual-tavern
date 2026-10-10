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
}

export interface GameUiProps<View, Action> {
  view: View;
  room: GameRoomInfo;
  /** Sends an action; resolves false if it was rejected (the shell already showed the error). */
  act: (action: Action) => Promise<boolean>;
  /** Opens the game's rules guide. */
  showGuide: () => void;
}
