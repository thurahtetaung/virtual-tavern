import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import { type Manifest, clean, specialOf, specialThumbKey, tileOf } from '../logic/manifest.ts';
import type { Special, Tile } from '../logic/types.ts';

export const GAME_ID = 'mosaic';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest (tile faces, the marker, the factory disc). `null` while loading;
 * `'unavailable'` when the server has no asset storage, in which case tiles are plain colours
 * with their symbol.
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
  /** A tile's face (the small copy when `small`), or null to draw it as a plain colour. */
  tile: (c: Tile, small?: boolean) => string | null;
  first: (small?: boolean) => string | null;
  /** A special factory's gold face, or null for the drawn placeholder. */
  special: (sp: Special, small?: boolean) => string | null;
  factory: (small?: boolean) => string | null;
  box: string | null;
}

const path = (p: unknown) => {
  const c = clean(p);
  return c ? assetUrl(c) : null;
};

export function artFor(manifest: ManifestState): Art {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  const thumbs = m?.thumbs && typeof m.thumbs === 'object' ? m.thumbs : {};
  return {
    tile: (c, small) =>
      (small ? path(tileOf(thumbs, c)) : null) ??
      path(tileOf(m?.tiles, c)) ??
      (c === 'joker' ? path(m?.jokers) : null),
    special: (sp, small) =>
      (small ? path(thumbs[specialThumbKey(sp)]) : null) ?? path(specialOf(m, sp)),
    first: (small) => (small ? path(thumbs.first) : null) ?? path(m?.first),
    factory: (small) => (small ? path(thumbs.factory) : null) ?? path(m?.factory),
    box: path(thumbs.box) ?? path(m?.box),
  };
}
