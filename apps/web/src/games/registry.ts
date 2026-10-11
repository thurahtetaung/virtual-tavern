import type { GameGuide, GameUiProps } from '@vt/game-sdk';
// Guides come from their own entry point, so the landing page doesn't ship the game engines.
import { guide as codenamesGuide } from '@vt/game-codenames/guide';
import { guide as echoGuide } from '@vt/game-echo/guide';
import { guide as enigmaGuide } from '@vt/game-enigma/guide';
import { guide as masqueradeGuide } from '@vt/game-masquerade/guide';
import { type ComponentType, lazy } from 'react';
import { isChunkLoadError, reloadOnce } from '../lib/chunk-reload.ts';
import type { Labeler } from '../recap/resolve.ts';

export interface ClientGame {
  id: string;
  name: string;
  guide: GameGuide;
  /** Emoji shown on cards and headers. */
  icon: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<GameUiProps<any, any>>;
  /**
   * Names the night recap's private placeholders (`{role:…}`, `{loc:…}`, `{card:…}`) from the
   * game's manifest. Back-room games only; public games report readable words already.
   */
  labels?: () => Promise<Labeler>;
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
  {
    id: 'echo',
    name: 'Echo',
    guide: echoGuide,
    icon: '🔔',
    Component: lazy(() => import('@vt/game-echo/ui').then((m) => ({ default: m.EchoGame }))),
  },
  {
    id: 'masquerade',
    name: 'Masquerade',
    guide: masqueradeGuide,
    icon: '🎭',
    Component: lazy(() =>
      import('@vt/game-masquerade/ui').then((m) => ({ default: m.MasqueradeGame })),
    ),
  },
];

export const findGame = (id: string | undefined) => clientGames.find((g) => g.id === id);

/**
 * Loads the back-room registry (only fetchable once unlocked); empty if it can't be loaded.
 * `known` says the browser is unlocked, so a failure means a deploy replaced the chunk: the page
 * reloads once instead of calling the game missing.
 */
export async function loadPrivateGames({ known = false } = {}): Promise<ClientGame[]> {
  try {
    return (await import('./private.ts')).privateGames;
  } catch (err) {
    if (known && isChunkLoadError(err)) reloadOnce();
    return [];
  }
}

/**
 * The private games to show: only those the server says it offers. The web app may know about
 * games the server has switched off, and offering those would
 * only end in "Unknown game".
 */
export function offeredPrivateGames(
  offered: readonly { id: string; private?: boolean; title?: string }[],
  known: readonly ClientGame[],
): ClientGame[] {
  const titles = new Map(offered.filter((g) => g.private).map((g) => [g.id, g.title]));
  return known.filter((g) => titles.has(g.id)).map((g) => withTitle(g, titles.get(g.id)));
}

/** A private game shown under the title the admin set (unlocked browsers only get one). */
export const withTitle = (game: ClientGame, title: string | undefined): ClientGame =>
  title ? { ...game, name: title } : game;

/** Finds a public game, or a private one when the back room is unlocked. */
export async function loadGame(id: string): Promise<ClientGame | undefined> {
  // Only called once the server has let this browser into the room, so the back room is open.
  return findGame(id) ?? (await loadPrivateGames({ known: true })).find((g) => g.id === id);
}
