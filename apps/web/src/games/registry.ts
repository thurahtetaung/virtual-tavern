import type { GameGuide } from '@vt/game-sdk';
// Guides come from their own entry point, so the landing page doesn't ship the game engines.
import { guide as codenamesGuide } from '@vt/game-codenames/guide';
import { guide as echoGuide } from '@vt/game-echo/guide';
import { guide as enigmaGuide } from '@vt/game-enigma/guide';
import { guide as masqueradeGuide } from '@vt/game-masquerade/guide';
import { guide as roundTableGuide } from '@vt/game-round-table/guide';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import type { BackroomStatus } from '../lib/backroom.ts';
import { isChunkLoadError, reloadOnce } from '../lib/chunk-reload.ts';
import { retryOnce } from '../lib/retry.ts';
import type { Labeler } from '../recap/resolve.ts';
import { type GameUi, lazyUi } from './lazy-ui.ts';

export interface ClientGame {
  id: string;
  name: string;
  guide: GameGuide;
  /** Emoji shown on cards and headers. */
  icon: string;
  Component: GameUi;
  /**
   * Names the night recap's private placeholders (`{role:…}`, `{loc:…}`, `{card:…}`) from the
   * game's manifest. Back-room games only; public games report readable words already.
   */
  labels?: () => Promise<Labeler>;
  /** The guide with the game's real names and credits from its manifest (back-room games only). */
  namedGuide?: () => Promise<GameGuide>;
  /** The title in the game's manifest, if it has one (back-room games only). */
  manifestTitle?: () => Promise<string | undefined>;
}

/** Every playable game's UI. Add new games here (and in the server registry). */
export const clientGames: ClientGame[] = [
  {
    id: 'codenames',
    name: 'Codenames',
    guide: codenamesGuide,
    icon: '🕵️',
    Component: lazyUi(() =>
      import('@vt/game-codenames/ui').then((m) => ({ default: m.CodenamesGame })),
    ),
  },
  {
    id: 'enigma',
    name: 'Enigma',
    guide: enigmaGuide,
    icon: '🔐',
    Component: lazyUi(() => import('@vt/game-enigma/ui').then((m) => ({ default: m.EnigmaGame }))),
  },
  {
    id: 'echo',
    name: 'Echo',
    guide: echoGuide,
    icon: '🔔',
    Component: lazyUi(() => import('@vt/game-echo/ui').then((m) => ({ default: m.EchoGame }))),
  },
  {
    id: 'masquerade',
    name: 'Masquerade',
    guide: masqueradeGuide,
    icon: '🎭',
    Component: lazyUi(() =>
      import('@vt/game-masquerade/ui').then((m) => ({ default: m.MasqueradeGame })),
    ),
  },
  {
    id: 'round-table',
    name: 'Round Table',
    guide: roundTableGuide,
    icon: '⚔️',
    Component: lazyUi(() =>
      import('@vt/game-round-table/ui').then((m) => ({ default: m.RoundTableGame })),
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
    // A phone on a flaky network often gets it at the second try.
    return (await retryOnce(() => import('./private.ts'))).privateGames;
  } catch (err) {
    if (known && isChunkLoadError(err)) reloadOnce();
    return [];
  }
}

/**
 * The back room's games (for their emoji), once `wanted` and only in a browser that has the back
 * room; empty until then, and for everyone else.
 */
export function usePrivateGames(wanted: boolean): readonly ClientGame[] {
  const [games, setGames] = useState<readonly ClientGame[]>([]);
  const asked = useRef(false);
  useEffect(() => {
    if (!wanted || asked.current) return;
    asked.current = true;
    void api<BackroomStatus>('/api/backroom/status')
      .then((s) => (s.unlocked ? loadPrivateGames({ known: true }) : []))
      .then((loaded) => {
        if (loaded.length) setGames(loaded);
      })
      .catch(() => {});
  }, [wanted]);
  return games;
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

/**
 * A private game shown under the title the admin set (unlocked browsers only get one). A room
 * falls back to the manifest's title (`roomTitle`), as the game's own lobby does.
 */
export const withTitle = (game: ClientGame, title: string | undefined): ClientGame =>
  title ? { ...game, name: title } : game;

/**
 * The game as a room names it: the admin's title, else its manifest's title, else its own name, so
 * the header, the guide and the game's lobby never show two different names.
 */
export async function roomGame(game: ClientGame, title: string | undefined): Promise<ClientGame> {
  return withTitle(game, title ?? (await game.manifestTitle?.()));
}

/** Finds a public game, or a private one when the back room is unlocked. */
export async function loadGame(id: string): Promise<ClientGame | undefined> {
  // Only called once the server has let this browser into the room, so the back room is open.
  return findGame(id) ?? (await loadPrivateGames({ known: true })).find((g) => g.id === id);
}
