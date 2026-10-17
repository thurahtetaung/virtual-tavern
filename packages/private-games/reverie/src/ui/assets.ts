import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';

export const GAME_ID = 'reverie';

/** What the private manifest in asset storage describes. */
export interface Manifest {
  back: string;
  sets: { id: string; name: string; description?: string }[];
}

export const cardUrl = (card: number) =>
  `/api/backroom/assets/${GAME_ID}/cards/${String(card).padStart(3, '0')}.jpg`;

/**
 * Loads the private manifest (set names, card back). `null` while loading; `'unavailable'` when
 * the server has no asset storage, in which case cards render as numbered placeholders.
 */
export function useManifest(): Manifest | null | 'unavailable' {
  const [manifest, setManifest] = useState<Manifest | null | 'unavailable'>(null);
  useEffect(() => {
    let live = true;
    void loadManifest(GAME_ID).then((body) => {
      const m = body as Manifest | null;
      if (live) setManifest(m ? m : 'unavailable');
    });
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}
