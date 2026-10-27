import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import type { AudioManifest, JokeTable } from './audio.ts';

export const GAME_ID = 'sketchy';

/**
 * The private manifest, as the show and the sound read it: `show` (rigs, read by `useRig`),
 * `audio` (music, effects and the narrator by key) and `jokes` (prompt key → the joke's file).
 * Without it the game plays as before, silent and without the original's art.
 */
export interface SketchyManifest {
  audio?: AudioManifest;
  jokes?: JokeTable;
  show?: unknown;
}

export type ManifestState = SketchyManifest | null | 'unavailable';

/** Loads the manifest: `null` while loading, `'unavailable'` when there is none. */
export function useManifest(): ManifestState {
  const [manifest, setManifest] = useState<ManifestState>(null);
  useEffect(() => {
    let live = true;
    void loadManifest(GAME_ID).then((body) => {
      if (live) setManifest(body ?? 'unavailable');
    });
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}

export const manifestOf = (m: ManifestState): SketchyManifest | null =>
  m && m !== 'unavailable' ? m : null;
