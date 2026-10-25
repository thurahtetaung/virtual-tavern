import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import { type Manifest, namesOf } from '../logic/manifest.ts';
import type { Names } from '../logic/names.ts';

export const GAME_ID = 'going-once';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest (the bank's name and the house pictures). `null` while loading;
 * `'unavailable'` when there is none, in which case house pictures show as a placeholder.
 */
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

export interface Art {
  names: Names;
  /** The house picture for a title's house key, or null (shown as a placeholder). */
  house: (key: string) => string | null;
}

export function artFor(manifest: ManifestState): Art {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  const house = m?.house && typeof m.house === 'object' ? m.house : {};
  return {
    names: namesOf(m),
    house: (key) => {
      const p = house[key];
      return typeof p === 'string' && p.trim() ? assetUrl(p.trim()) : null;
    },
  };
}
