import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import { cardOf } from '../logic/cards.ts';
import { type Manifest, artOf, clean, thumbOf } from '../logic/manifest.ts';
import type { HandCard } from '../logic/rules.ts';

export const GAME_ID = 'encore';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest (card faces, chip, marker). `null` while loading; `'unavailable'`
 * when the server has no asset storage, in which case cards are drawn from their numbers.
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
  /** A card's face as stored, or null to draw it from its numbers. */
  card: (id: string, small?: boolean) => string | null;
  /** Whether the face must turn 180° to show this card's up number at the top. */
  turned: (c: HandCard) => boolean;
  back: (small?: boolean) => string | null;
  chip: string | null;
  marker: string | null;
  markerUsed: string | null;
  hat: string | null;
  box: string | null;
  logo: string | null;
}

const path = (p: unknown) => {
  const c = clean(p);
  return c ? assetUrl(c) : null;
};

export function artFor(manifest: ManifestState): Art {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  const cards = m?.cards && typeof m.cards === 'object' ? m.cards : {};
  const highUp = m?.artUp === 'high';
  return {
    card: (id, small) => (small ? path(thumbOf(cards[id])) : null) ?? path(artOf(cards[id])),
    turned: (c) => {
      const d = cardOf(c.id);
      return highUp ? c.up === d.a : c.up === d.b;
    },
    back: (small) => (small ? path(m?.backThumb) : null) ?? path(m?.back),
    chip: path(m?.chip),
    marker: path(m?.marker),
    markerUsed: path(m?.markerUsed),
    hat: path(m?.startHat),
    box: path(m?.box),
    logo: path(m?.logo),
  };
}
