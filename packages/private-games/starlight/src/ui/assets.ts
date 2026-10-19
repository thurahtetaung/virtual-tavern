import type { PlayerColor } from '@vt/game-sdk';
import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';

export const GAME_ID = 'starlight';

/** The box's six lantern colours. */
export const LANTERN_COLORS = ['blue', 'purple', 'black', 'pink', 'orange', 'green'] as const;
export type LanternColor = (typeof LANTERN_COLORS)[number];

/**
 * What the private `starlight/manifest.json` describes: the table's tokens. The picture cards
 * are Reverie's (its manifest names the sets). Every field is optional; without one the screen
 * shows its emoji.
 */
export interface Manifest {
  components?: {
    lantern?: Partial<Record<LanternColor, { light?: string; dark?: string }>>;
    firstScout?: string;
  };
}

const loaded = (manifest: ManifestState) => (manifest === 'unavailable' ? null : manifest);

export const assetUrl = (path: string) => `/api/backroom/assets/${GAME_ID}/${path}`;

/** `null` while loading; `'unavailable'` when there is none (tests, dev). */
export type ManifestState = Manifest | null | 'unavailable';

/** Loads the manifest. */
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

/** The lantern nearest a player's colour. */
const LANTERN_OF: Record<PlayerColor, LanternColor> = {
  red: 'pink',
  blue: 'blue',
  green: 'green',
  yellow: 'orange',
  purple: 'purple',
  orange: 'orange',
  pink: 'pink',
  teal: 'blue',
  lime: 'green',
  sky: 'blue',
  brown: 'orange',
  grey: 'black',
  black: 'black',
  white: 'black',
  magenta: 'purple',
  mint: 'green',
};

/** The lantern picture for a player's colour and side, if the manifest has it. */
export function lanternArt(
  manifest: ManifestState,
  color: PlayerColor,
  side: 'light' | 'dark',
): string | null {
  const path = loaded(manifest)?.components?.lantern?.[LANTERN_OF[color]]?.[side];
  return path ? assetUrl(path) : null;
}

export function firstScoutArt(manifest: ManifestState): string | null {
  const path = loaded(manifest)?.components?.firstScout;
  return path ? assetUrl(path) : null;
}
