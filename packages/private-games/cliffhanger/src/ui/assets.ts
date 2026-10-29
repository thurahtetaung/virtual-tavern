import { loadManifest } from '@vt/ui';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { DeckKind } from '../logic/genres.ts';
import {
  type Box,
  type Manifest,
  type Names,
  type Picture,
  type TapeArt,
  namesOf,
} from '../logic/manifest.ts';

export const GAME_ID = 'cliffhanger';

/** A file in the game's private asset folder. */
export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

const path = (p: unknown) => (typeof p === 'string' && p.trim() ? assetUrl(p.trim()) : null);

/** A picture's full copy (or its only one). */
export const artOf = (p: Picture | undefined): string | null =>
  typeof p === 'string' ? path(p) : path(p?.art);

/** A picture's small copy, else the full one. */
export const thumbOf = (p: Picture | undefined, thumb?: string): string | null =>
  path(thumb) ?? (typeof p === 'object' ? path(p.thumb) : null) ?? artOf(p);

/** A box from the manifest, if it is four fractions. */
export const boxOf = (b: unknown): Box | null =>
  Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && n >= 0 && n <= 1)
    ? (b as Box)
    : null;

export type ManifestState = Manifest | null | 'unavailable';

/** The manifest: `null` while loading, `'unavailable'` when there is none. */
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

export const manifestOf = (m: ManifestState): Manifest | null =>
  m && m !== 'unavailable' ? m : null;

/** Everything the screens read from the manifest, with the plain words where it has none. */
export interface Art {
  manifest: Manifest | null;
  names: Names;
  /** A genre's tape (the deck's own table, TV falling back to the film tape of the same id). */
  tape: (genre: string, deck: DeckKind) => TapeArt | null;
  app: (key: string) => string | null;
  faceoff: { card: string | null; thumb: string | null; textBox: Box | null };
  board: string | null;
  sign: string | null;
}

export function artFrom(m: Manifest | null): Art {
  return {
    manifest: m,
    names: namesOf(m),
    tape: (genre, deck) =>
      (deck === 'tv' ? m?.tvGenres?.[genre] : undefined) ?? m?.genres?.[genre] ?? null,
    app: (key) => artOf(m?.app?.[key]),
    faceoff: {
      card: artOf(m?.faceoff?.card),
      thumb: thumbOf(m?.faceoff?.card, m?.faceoff?.thumb),
      textBox: boxOf(m?.faceoff?.textBox),
    },
    board: artOf(m?.board),
    sign: artOf(m?.sign),
  };
}

/** The room's art: loaded once at the game's root, read anywhere below it. */
export const ArtContext = createContext<Art>(artFrom(null));

/** Loads the manifest for the root to provide (plain words until it loads, and without one). */
export function useLoadedArt(): Art {
  const manifest = manifestOf(useManifest());
  return useMemo(() => artFrom(manifest), [manifest]);
}

export const useArt = () => useContext(ArtContext);
