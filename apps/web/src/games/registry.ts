import type { GameGuide, GameUiProps } from '@vt/game-sdk';
// Guides come from their own entry point, so the landing page doesn't ship the game engines.
import { guide as codenamesGuide } from '@vt/game-codenames/guide';
import { guide as enigmaGuide } from '@vt/game-enigma/guide';
import { type ComponentType, lazy } from 'react';

export interface ClientGame {
  id: string;
  name: string;
  guide: GameGuide;
  /** Emoji shown on cards and headers. */
  icon: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<GameUiProps<any, any>>;
}

/** Every playable game's UI. Add new games here (and in the server registry). */
export const clientGames: ClientGame[] = [
  {
    id: 'codenames',
    name: 'Codenames',
    guide: codenamesGuide,
    icon: '🕵️',
    Component: lazy(() =>
      import('@vt/game-codenames/ui').then((m) => ({ default: m.CodenamesGame })),
    ),
  },
  {
    id: 'enigma',
    name: 'Enigma',
    guide: enigmaGuide,
    icon: '🔐',
    Component: lazy(() => import('@vt/game-enigma/ui').then((m) => ({ default: m.EnigmaGame }))),
  },
];

export const findGame = (id: string | undefined) => clientGames.find((g) => g.id === id);

/** Loads the back-room registry (only fetchable once unlocked); empty if it can't be loaded. */
export async function loadPrivateGames(): Promise<ClientGame[]> {
  try {
    return (await import('./private.ts')).privateGames;
  } catch {
    return [];
  }
}

/**
 * The private games to show: only those the server says it offers. The web app may know about
 * games the server has switched off, and offering those would
 * only end in "Unknown game".
 */
export function offeredPrivateGames(
  offered: readonly { id: string; private?: boolean }[],
  known: readonly ClientGame[],
): ClientGame[] {
  const ids = new Set(offered.filter((g) => g.private).map((g) => g.id));
  return known.filter((g) => ids.has(g.id));
}

/** Finds a public game, or a private one when the back room is unlocked. */
export async function loadGame(id: string): Promise<ClientGame | undefined> {
  return findGame(id) ?? (await loadPrivateGames()).find((g) => g.id === id);
}
