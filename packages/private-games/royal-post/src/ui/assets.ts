import { useEffect, useState } from 'react';
import type { Edition, Role } from '../logic/types.ts';

export const GAME_ID = 'royal-post';

/** What the private manifest in asset storage describes, per edition. */
export interface Manifest {
  editions: Partial<
    Record<
      Edition,
      {
        /** Path of the card back's art. */
        back?: string;
        cards?: Partial<Record<Role, { name?: string; art?: string }>>;
      }
    >
  >;
}

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest (card names and art). `null` while loading; `'unavailable'` when the
 * server has no asset storage, in which case cards render as styled placeholders.
 */
export function useManifest(): ManifestState {
  const [manifest, setManifest] = useState<ManifestState>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/backroom/manifest/${GAME_ID}`)
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) return setManifest('unavailable');
        const body = (await res.json()) as Manifest | null;
        setManifest(body && typeof body === 'object' && body.editions ? body : 'unavailable');
      })
      .catch(() => live && setManifest('unavailable'));
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}

const edition = (manifest: ManifestState, ed: Edition) =>
  manifest && manifest !== 'unavailable' ? manifest.editions[ed] : undefined;

/** The plain role word, capitalised: what shows when the manifest has no name. */
export const roleLabel = (role: Role) => role[0]!.toUpperCase() + role.slice(1);

/** Display names and art for one edition, falling back to the role words. */
export interface Deck {
  name: (role: Role) => string;
  art: (role: Role) => string | null;
  back: string | null;
}

export function deckFor(manifest: ManifestState, ed: Edition): Deck {
  const e = edition(manifest, ed);
  return {
    name: (role) => e?.cards?.[role]?.name?.trim() || roleLabel(role),
    art: (role) => (e?.cards?.[role]?.art ? assetUrl(e.cards[role].art) : null),
    back: e?.back ? assetUrl(e.back) : null,
  };
}
