import type { GameSummary, ListVersions, WordListSummary } from '@vt/protocol';
import { noteManifestVersions } from '@vt/ui';
import { useEffect, useState } from 'react';
import { api } from './api.ts';

/**
 * The server's game list, word lists and back-room manifests (`loadManifest` in `@vt/ui`). Responses every page load fetches anyway (the back-room
 * status, the room lookup, the admin session) carry the lists' current versions; a versioned URL
 * is kept by the browser for a day, and any change (an admin edit, an unlock or lock, a deploy)
 * is a new version. Before a version is known the plain URL is used, which revalidates.
 */
let gamesVersion: string | null = null;

/** Called with the versions from each response that carries them. */
export function noteVersions(versions: ListVersions | undefined): void {
  if (!versions) return;
  gamesVersion = versions.games;
  noteManifestVersions(versions.manifests);
}

export function fetchGames(): Promise<GameSummary[]> {
  return api<GameSummary[]>(
    gamesVersion ? `/api/games?v=${encodeURIComponent(gamesVersion)}` : '/api/games',
  );
}

/** A game's word lists; `version` from its room lookup, or none to revalidate. */
export function fetchWordLists(gameId: string, version?: string): Promise<WordListSummary[]> {
  const game = `game=${encodeURIComponent(gameId)}`;
  return api<WordListSummary[]>(
    `/api/word-lists?${game}${version ? `&v=${encodeURIComponent(version)}` : ''}`,
  );
}

/** For tests: a fresh page. */
export function resetVersions(): void {
  gamesVersion = null;
}

/** The games the admin switched off (an empty set until the list arrives). */
export function useOffGames(): ReadonlySet<string> {
  const [off, setOff] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    void fetchGames()
      .then((games) => setOff(new Set(games.filter((g) => g.off).map((g) => g.id))))
      .catch(() => {});
  }, []);
  return off;
}
