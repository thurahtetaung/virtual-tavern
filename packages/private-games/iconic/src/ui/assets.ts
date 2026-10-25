import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import { type Manifest, asManifest, clean, iconMeanings, iconName } from '../logic/manifest.ts';
import type { SetId } from '../logic/types.ts';

export const GAME_ID = 'iconic';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest (icon names, meanings and art). `null` while loading;
 * `'unavailable'` when the server has no asset storage, in which case icons are numbered tiles.
 */
export function useManifest(): ManifestState {
  const [manifest, setManifest] = useState<ManifestState>(null);
  useEffect(() => {
    let live = true;
    void loadManifest(GAME_ID).then((body) => {
      if (live) setManifest(asManifest(body) ?? 'unavailable');
    });
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}

export interface Art {
  name: (icon: number) => string;
  meanings: (icon: number) => string[];
  /** The icon's picture, or null for a numbered tile. */
  icon: (icon: number) => string | null;
  marker: (set: SetId) => string | null;
  box: string | null;
}

const path = (p: unknown) => (clean(p, 300) ? assetUrl(clean(p, 300)!) : null);

export function artFor(manifest: ManifestState): Art {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  return {
    name: (n) => iconName(m, n),
    meanings: (n) => iconMeanings(m, n),
    icon: (n) => path(m?.icons?.[String(n)]?.art),
    marker: (set) => path(m?.markers?.[set]),
    box: path(m?.box),
  };
}
