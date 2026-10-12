import { useEffect, useState } from 'react';
import { type EventKind, EVENT_TILES, CAUSE_TILE, LOCATION_TILES } from '../logic/content.ts';
import { EVENT_NAMES, ROLE_NAMES } from '../logic/names.ts';
import type { RoleId } from '../logic/types.ts';

export const GAME_ID = 'inquest';

/**
 * The private manifest in asset storage (`inquest/manifest.json`):
 * `{ roleBack, roles: { murderer: { name, art, text } }, clue: { "17": "<name>" },
 *    means: { "4": "<name>" }, tiles: { "6": { title, items: [6], art } , "27": { title, text, art } } }`.
 * Card art lives at `clue/<n>.webp` and `means/<n>.webp`. Everything is optional: without it,
 * cards and tiles show as numbered placeholders.
 */
export interface Manifest {
  roleBack?: string;
  roles?: Partial<Record<RoleId, { name?: string; art?: string; text?: string }>>;
  clue?: Record<string, string>;
  means?: Record<string, string>;
  tiles?: Record<string, { title?: string; items?: string[]; text?: string; art?: string }>;
}

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

export function useManifest(): ManifestState {
  const [manifest, setManifest] = useState<ManifestState>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/backroom/manifest/${GAME_ID}`)
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) return setManifest('unavailable');
        const body = (await res.json()) as Manifest | null;
        setManifest(body && typeof body === 'object' ? body : 'unavailable');
      })
      .catch(() => {
        if (live) setManifest('unavailable');
      });
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}

export type Deck = 'clue' | 'means';

/** Names and art for everything on the table, with placeholders where the manifest is silent. */
export interface Content {
  /** Whether real art is expected (the manifest loaded). */
  art: boolean;
  cardName: (deck: Deck, n: number) => string;
  cardArt: (deck: Deck, n: number) => string | null;
  tileTitle: (tile: number) => string;
  tileItem: (tile: number, item: number) => string;
  tileArt: (tile: number) => string | null;
  roleName: (role: RoleId) => string;
  roleArt: (role: RoleId) => string | null;
  roleBack: string | null;
  eventName: (kind: EventKind) => string;
}

const m = (s: ManifestState): Manifest | null => (s && s !== 'unavailable' ? s : null);
const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export const placeholderTileTitle = (tile: number) =>
  tile === CAUSE_TILE
    ? 'Cause of Death'
    : LOCATION_TILES.includes(tile)
      ? 'Location'
      : `Tile ${tile}`;

export function contentFor(state: ManifestState): Content {
  const man = m(state);
  return {
    art: !!man,
    cardName: (deck, n) =>
      clean(man?.[deck]?.[String(n)]) ?? `${deck === 'clue' ? 'Clue' : 'Means'} ${n}`,
    cardArt: (deck, n) => (man ? assetUrl(`${deck}/${n}.webp`) : null),
    tileTitle: (tile) => clean(man?.tiles?.[String(tile)]?.title) ?? placeholderTileTitle(tile),
    tileItem: (tile, item) =>
      clean(man?.tiles?.[String(tile)]?.items?.[item]) ?? `Tile ${tile} · item ${item + 1}`,
    tileArt: (tile) => {
      const art = clean(man?.tiles?.[String(tile)]?.art);
      return art ? assetUrl(art) : null;
    },
    roleName: (role) => clean(man?.roles?.[role]?.name) ?? ROLE_NAMES[role],
    roleArt: (role) => {
      const art = clean(man?.roles?.[role]?.art);
      return art ? assetUrl(art) : null;
    },
    roleBack: clean(man?.roleBack) ? assetUrl(man!.roleBack!) : null,
    eventName: (kind) => clean(man?.tiles?.[String(EVENT_TILES[kind])]?.title) ?? EVENT_NAMES[kind],
  };
}
