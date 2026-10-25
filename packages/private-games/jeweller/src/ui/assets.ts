import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import { type Manifest, artOf, backOf, nameOf, nobleNumber, thumbOf } from '../logic/manifest.ts';
import type { Level, Token } from '../logic/types.ts';

export const GAME_ID = 'jeweller';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest (art and noble names). `null` while loading; `'unavailable'` when
 * the server has no asset storage, in which case cards, gems and nobles are drawn from their
 * numbers and colours.
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
  /** A card's face, or null to draw it from its numbers. */
  card: (id: string) => string | null;
  /** A small copy of the face, for the market on phones (falls back to the face). */
  cardThumb: (id: string) => string | null;
  back: (level: Level) => string | null;
  backThumb: (level: Level) => string | null;
  noble: (id: string) => string | null;
  nobleThumb: (id: string) => string | null;
  nobleName: (id: string) => string;
  token: (t: Token) => string | null;
  tokenThumb: (t: Token) => string | null;
  box: string | null;
  logo: string | null;
}

const path = (p: unknown) => (typeof p === 'string' && p.trim() ? assetUrl(p.trim()) : null);

export function artFor(manifest: ManifestState): Art {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  const cards = m?.cards && typeof m.cards === 'object' ? m.cards : {};
  const nobles = m?.nobles && typeof m.nobles === 'object' ? m.nobles : {};
  return {
    card: (id) => path(artOf(cards[id])),
    cardThumb: (id) => path(thumbOf(cards[id])) ?? path(artOf(cards[id])),
    back: (level) => path(backOf(m?.backs, level)),
    backThumb: (level) => path(backOf(m?.backThumbs, level)) ?? path(backOf(m?.backs, level)),
    noble: (id) => path(artOf(nobles[id])),
    nobleThumb: (id) => path(thumbOf(nobles[id])) ?? path(artOf(nobles[id])),
    nobleName: (id) => nameOf(nobles[id]) ?? nobleNumber(id),
    token: (t) => path(m?.tokens?.[t]),
    tokenThumb: (t) => path(m?.tokenThumbs?.[t]) ?? path(m?.tokens?.[t]),
    box: path(m?.box),
    logo: path(m?.logo),
  };
}
