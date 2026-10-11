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

/** The host's name, for guests' "Waiting for Hana to…" lines. */
export const hostNameOf = (room: Pick<GameRoomInfo, 'hostId' | 'players'>): string =>
  room.players.find((p) => p.id === room.hostId)?.name ?? 'the host';

export interface GameUiProps<View, Action> {
  view: View;
  room: GameRoomInfo;
  /** Sends an action; resolves false if it was rejected (the shell already showed the error). */
  act: (action: Action) => Promise<boolean>;
  /** Opens the game's rules guide. */
  showGuide: () => void;
  /** Tells the shell whether the viewer is expected to act now, so it can mark the tab. */
  setYourMove?: (yes: boolean) => void;
}
