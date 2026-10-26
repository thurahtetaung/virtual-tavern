import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import { TYPES, type TypeId } from '../logic/cards.ts';
import {
  type Manifest,
  type Names,
  PLAIN_NAMES,
  artOf,
  namesOf,
  thumbOf,
} from '../logic/manifest.ts';

export const GAME_ID = 'conveyor';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest (card faces, menu tiles, names). `null` while loading;
 * `'unavailable'` when the server has no asset storage, in which case cards are drawn from their
 * dish and points.
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
  /** A card face: the small copy (hands, trays) or the full one (zoomed in). Null: drawn. */
  card: (variant: string, full?: boolean) => string | null;
  /** A dish's menu tile (its rules card). */
  tile: (type: TypeId, full?: boolean) => string | null;
  back: (full?: boolean) => string | null;
  box: (full?: boolean) => string | null;
  names: Names;
}

const url = (p: string | undefined) => (p ? assetUrl(p) : null);

export function artFor(manifest: ManifestState): Art {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  const cards = m?.cards && typeof m.cards === 'object' ? m.cards : {};
  const tiles = m?.tiles && typeof m.tiles === 'object' ? m.tiles : {};
  // Phones get the small copies everywhere but the zoomed card: full faces only on request.
  const pick = (ref: Parameters<typeof artOf>[0], full?: boolean) =>
    full ? url(artOf(ref) ?? thumbOf(ref)) : url(thumbOf(ref) ?? artOf(ref));
  return {
    card: (variant, full) => pick(cards[variant], full),
    tile: (type, full) => pick(tiles[type], full),
    back: (full) => pick(m?.back, full),
    box: (full) => pick(m?.box, full),
    names: m ? namesOf(m) : PLAIN_NAMES,
  };
}

const CACHE = 'vt-conveyor-art';
const warmed = new Set<string>();

/**
 * Fetches the small faces of this round's dishes ahead of time, into Cache Storage (and so the
 * browser's own cache), so a passed hand shows its art at once. Full faces are left alone.
 */
export function preloadThumbs(art: Art, types: readonly TypeId[]) {
  const urls = types
    .flatMap((t) => TYPES[t].variants.map((x) => art.card(x.id)))
    .filter((u): u is string => !!u && !warmed.has(u));
  if (!urls.length) return;
  for (const u of urls) warmed.add(u);
  const open =
    typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(CACHE).catch(() => null);
  void open.then(async (cache) => {
    for (const u of urls) {
      try {
        if (cache) {
          if (!(await cache.match(u))) await cache.add(u);
        }
        const img = new Image();
        img.decoding = 'async';
        img.src = u;
      } catch {
        // A failed warm-up just means the card loads when it is shown.
      }
    }
  });
}
