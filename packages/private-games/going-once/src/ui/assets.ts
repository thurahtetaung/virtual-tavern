import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import { type Manifest, namesOf } from '../logic/manifest.ts';
import type { Names } from '../logic/names.ts';

export const GAME_ID = 'going-once';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest (the bank's name and the house pictures). `null` while loading;
 * `'unavailable'` when there is none, in which case house pictures show as a placeholder.
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
  names: Names;
  /** The house picture for a title's house key, or null (shown as a placeholder). */
  house: (key: string) => string | null;
  /** A UI picture (`buyer-0`, `bank`, `gallery`, `easel`, `lot`, `handle`…), or null. */
  ui: (key: string) => string | null;
  /** The paddle silhouette for a shape index (wrapping round the manifest's list), or null. */
  paddle: (shape: number) => string | null;
  /** What a voice clip says (its key and number in the manifest's `audio.voice`); '' for none. */
  voiceWords: (key: string, i: number) => string;
}

export function artFor(manifest: ManifestState): Art {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  const house = m?.house && typeof m.house === 'object' ? m.house : {};
  const ui = m?.ui && typeof m.ui === 'object' ? m.ui : {};
  const paddles = Array.isArray(ui.paddles) ? ui.paddles.filter((p) => typeof p === 'string') : [];
  const path = (p: unknown) => (typeof p === 'string' && p.trim() ? assetUrl(p.trim()) : null);
  return {
    ui: (key) => path(ui[key]),
    paddle: (shape) => (paddles.length ? path(paddles[shape % paddles.length]) : null),
    names: namesOf(m),
    voiceWords: (key, i) => {
      const list = m?.audio?.voice?.[key];
      const path = list?.length ? list[i % list.length] : undefined;
      const words = path ? m?.audio?.text?.[path] : undefined;
      return typeof words === 'string' ? words.trim() : '';
    },
    house: (key) => {
      const p = house[key];
      return typeof p === 'string' && p.trim() ? assetUrl(p.trim()) : null;
    },
  };
}
