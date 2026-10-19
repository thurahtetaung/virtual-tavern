import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import { type Manifest, namesOf } from '../logic/manifest.ts';
import type { Names } from '../logic/names.ts';

export const GAME_ID = 'thorns';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest (names and art). `null` while loading; `'unavailable'` when the
 * server has no asset storage, in which case discs are drawn as emoji on the player's colour.
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

/** One seat's art: its discs' faces and back, and its mat (plain and scored side). */
export interface SetArt {
  name: string | null;
  rose: string | null;
  thorn: string | null;
  back: string | null;
  mat: string | null;
  matScored: string | null;
  /** Small copies (falling back to the full ones). */
  thumbs: { rose: string | null; thorn: string | null; back: string | null };
}

export interface Art {
  names: Names;
  /** The art of the set at a seat (sets go round the table in seat order). */
  set: (seat: number) => SetArt;
  chance: { face: string | null; faceThumb: string | null; back: string | null };
  lobby: string | null;
}

const path = (p: unknown) => (typeof p === 'string' && p.trim() ? assetUrl(p.trim()) : null);

export function artFor(manifest: ManifestState): Art {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  const sets = Array.isArray(m?.sets) ? m.sets : [];
  return {
    names: namesOf(m),
    set: (seat) => {
      const s = sets.length ? sets[((seat % sets.length) + sets.length) % sets.length] : undefined;
      return {
        name: typeof s?.name === 'string' && s.name.trim() ? s.name.trim() : null,
        rose: path(s?.rose),
        thorn: path(s?.thorn),
        back: path(s?.back),
        mat: path(s?.mat),
        matScored: path(s?.matScored),
        thumbs: {
          rose: path(s?.thumbs?.rose) ?? path(s?.rose),
          thorn: path(s?.thumbs?.thorn) ?? path(s?.thorn),
          back: path(s?.thumbs?.back) ?? path(s?.back),
        },
      };
    },
    chance: {
      face: path(m?.chance?.face),
      faceThumb: path(m?.chance?.faceThumb) ?? path(m?.chance?.face),
      back: path(m?.chance?.back),
    },
    lobby: path(m?.lobby),
  };
}
