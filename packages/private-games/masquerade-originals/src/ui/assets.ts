import type { LocationDisplay } from '@vt/game-masquerade/ui';
import { useEffect, useState } from 'react';
import { placeholderName } from '../logic/pack.ts';

export const GAME_ID = 'masquerade-originals';

/**
 * The private manifest in asset storage (`masquerade-originals/manifest.json`). Paths are
 * relative to the game's folder; anything left out falls back to a numbered placeholder.
 * Location art is landscape (600×360, 5:3), shown with object-cover.
 */
export interface Manifest {
  /** The card back (landscape, about 20:13), shown on the spy's card. */
  back?: string;
  editions?: Partial<Record<'e1' | 'e2', { name?: string }>>;
  locations: Record<
    string,
    { name?: string; art?: string; emoji?: string; tip?: string; questions?: string[] }
  >;
}

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/** Loads the manifest; `'unavailable'` without asset storage, so placeholders show. */
export function useManifest(): ManifestState {
  const [manifest, setManifest] = useState<ManifestState>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/backroom/manifest/${GAME_ID}`)
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) return setManifest('unavailable');
        const body = (await res.json()) as Manifest | null;
        setManifest(
          body && typeof body === 'object' && body.locations && typeof body.locations === 'object'
            ? body
            : 'unavailable',
        );
      })
      .catch(() => live && setManifest('unavailable'));
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];

/** Names, art and coaching from the manifest, with numbered placeholders for anything missing. */
export function displayFor(manifest: ManifestState): LocationDisplay {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  const entry = (id: string) => m?.locations[id];
  return {
    name: (id) => entry(id)?.name?.trim() || placeholderName(id),
    emoji: (id) => entry(id)?.emoji ?? (entry(id)?.name ? '📍' : '🗺️'),
    art: (id) => {
      const art = entry(id)?.art;
      return art ? assetUrl(art) : null;
    },
    back: m?.back ? assetUrl(m.back) : null,
    tip: (id) => entry(id)?.tip?.trim() || null,
    questions: (id) => strings(entry(id)?.questions),
    editionLabel: (id, fallback) => m?.editions?.[id as 'e1' | 'e2']?.name?.trim() || fallback,
  };
}
