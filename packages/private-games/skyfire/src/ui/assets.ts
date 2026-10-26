import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import type { Suit } from '../logic/cards.ts';
import {
  type ArtRef,
  type Manifest,
  artOf,
  cardKey,
  clean,
  thumbOf,
  zoomOf,
} from '../logic/manifest.ts';

export const GAME_ID = 'skyfire';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest (card faces, back, tokens). `null` while loading; `'unavailable'`
 * when the server has no asset storage, in which case cards are drawn from their colour, symbol
 * and number, and tokens are emoji.
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
  /** A card's face (its small copy when `small`), or null to draw it. */
  card: (suit: Suit, rank: number, small?: boolean) => string | null;
  /** A card's largest face, for its sheet: the sharper zoom copy where there is one. */
  big: (suit: Suit, rank: number) => string | null;
  back: (small?: boolean) => string | null;
  clue: string | null;
  /** Fuse tile `i` (0–2), burned or not. */
  fuse: (i: number, burned: boolean) => string | null;
  /** A firework's picture (its empty stack's backdrop). */
  suit: (suit: Suit) => string | null;
  box: string | null;
  lobby: string | null;
}

const path = (p: unknown) => {
  const c = clean(p);
  return c ? assetUrl(c) : null;
};

/** A picture entry's file: the small copy when asked for and there is one. */
const pic = (ref: ArtRef | undefined, small = false) =>
  (small ? path(thumbOf(ref)) : null) ?? path(artOf(ref));

export function artFor(manifest: ManifestState): Art {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  const cards = m?.cards && typeof m.cards === 'object' ? m.cards : {};
  const tokens = m?.tokens && typeof m.tokens === 'object' ? m.tokens : {};
  const fuses = tokens.fuse;
  return {
    card: (suit, rank, small) => pic(cards[cardKey(suit, rank)], small),
    big: (suit, rank) => {
      const ref = cards[cardKey(suit, rank)];
      return path(zoomOf(ref)) ?? path(artOf(ref));
    },
    back: (small) => (small ? (path(m?.backThumb) ?? pic(m?.back, true)) : pic(m?.back)),
    clue: pic(tokens.clue, true),
    fuse: (i, burned) => {
      if (Array.isArray(fuses)) {
        const tile = fuses[i] ?? fuses[0];
        return pic(burned ? tile?.used : tile?.unused, true);
      }
      return burned ? (pic(tokens.fuseUsed, true) ?? null) : pic(fuses, true);
    },
    suit: (suit) => pic(m?.suits?.[suit], true),
    box: pic(m?.box, true),
    lobby: pic(m?.lobby) ?? pic(m?.box, true),
  };
}
