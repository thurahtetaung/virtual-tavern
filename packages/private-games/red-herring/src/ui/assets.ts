import type { PlayerColor } from '@vt/game-sdk';
import { cardUrl as reverieCardUrl } from '@vt/private-reverie/card';
import { loadManifest } from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import {
  GAME_ID,
  type Manifest,
  type MarkerColor,
  asManifest,
  assetUrl,
  clean,
  deckNames,
} from '../logic/manifest.ts';
import { oursCard } from '../logic/types.ts';

export { GAME_ID, assetUrl };

/** `null` while loading; `'unavailable'` when there is none (tests, dev). */
export type ManifestState = Manifest | null | 'unavailable';

/** Loads the private manifest once per page. */
export function useManifest(): ManifestState {
  const [manifest, setManifest] = useState<ManifestState>(null);
  useEffect(() => {
    let live = true;
    void loadManifest(GAME_ID).then((body) => {
      if (live) setManifest(asManifest(body) ?? 'unavailable');
    });
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}

/** The board nearest a player's colour (the box has eight). */
const MARKER_OF: Record<PlayerColor, MarkerColor> = {
  red: 'red',
  blue: 'blue',
  green: 'green',
  yellow: 'yellow',
  purple: 'purple',
  orange: 'orange',
  pink: 'red',
  teal: 'blue',
  lime: 'green',
  sky: 'blue',
  brown: 'brown',
  grey: 'white',
  black: 'brown',
  white: 'white',
  magenta: 'purple',
  mint: 'green',
};

/** Everything the screens draw from the manifest; nulls where there is no art. */
export interface Art {
  /** Whether the manifest is still loading (cards wait rather than flash a number). */
  loading: boolean;
  /** Whether there is no asset storage at all (numbered placeholders). */
  none: boolean;
  back: string | null;
  lobby: string | null;
  notebookCover: string | null;
  notebookPage: string | null;
  pencil: string | null;
  vp: Partial<Record<'3' | '4' | '5' | 'back', string>>;
  marker: (color: PlayerColor | undefined) => string | null;
  decks: ReturnType<typeof deckNames>;
  sound: { newWord: string | null; winner: string | null };
}

const url = (p: unknown) => {
  const c = clean(p);
  return c ? assetUrl(c) : null;
};

export function artFor(state: ManifestState): Art {
  const m = state && state !== 'unavailable' ? state : null;
  const c = m?.components;
  const vp: Art['vp'] = {};
  for (const k of ['3', '4', '5', 'back'] as const) {
    const u = url(c?.vp?.[k]);
    if (u) vp[k] = u;
  }
  return {
    loading: state === null,
    none: state === 'unavailable',
    back: url(m?.back),
    lobby: url(c?.lobbyArt),
    notebookCover: url(c?.notebookCover),
    notebookPage: url(c?.notebookPage),
    pencil: url(c?.pencil),
    vp,
    marker: (color) => (color ? url(c?.markers?.[MARKER_OF[color]]) : null),
    decks: deckNames(m),
    sound: { newWord: clean(m?.sound?.newWord) ?? null, winner: clean(m?.sound?.winner) ?? null },
  };
}

export function useArt(): Art {
  const manifest = useManifest();
  return useMemo(() => artFor(manifest), [manifest]);
}

/** A card's face: the game's own, or one of our picture cards from Reverie's storage. */
export function cardUrl(card: number): string {
  const ours = oursCard(card);
  return ours !== null
    ? reverieCardUrl(ours)
    : assetUrl(`cards/${String(card).padStart(3, '0')}.jpg`);
}

/** What a card is called for screen readers and the viewer. */
export const cardLabel = (card: number) => {
  const ours = oursCard(card);
  return ours !== null ? `Picture ${ours}` : `Card ${card}`;
};
