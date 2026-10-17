import { loadManifest as loadSharedManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import type { CardType } from '../logic/cards.ts';
import { type Manifest, faceOf, namesOf, thumbOf } from '../logic/manifest.ts';
import { GLYPHS, type Names, RULES, fillNames } from '../logic/names.ts';
import type { Art, Card } from '../logic/types.ts';

export const GAME_ID = 'short-fuse';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/** The private manifest, fetched once per page; null without asset storage (tests, dev). */
export const loadManifest = (): Promise<Manifest | null> => loadSharedManifest(GAME_ID);

export function useManifest(): ManifestState {
  const [manifest, setManifest] = useState<ManifestState>(null);
  useEffect(() => {
    let live = true;
    void loadManifest().then((m) => {
      if (live) setManifest(m ?? 'unavailable');
    });
    return () => {
      live = false;
    };
  }, []);
  return manifest;
}

/** Everything the UI needs from the manifest: names, art and card text, with fallbacks. */
export interface Content {
  names: Names;
  /** Fills name tokens (`{c:attack}`, `{bomb}`…) in a line. */
  t: (text: string) => string;
  name: (t: CardType) => string;
  glyph: (t: CardType) => string;
  /** The card's art (full size), or null for a placeholder. */
  face: (card: Card, art: Art) => string | null;
  thumb: (card: Card, art: Art) => string | null;
  back: string | null;
  /** Every small face of a card type (to load ahead of time, so a play shows its art at once). */
  thumbs: (t: CardType, art: Art) => string[];
  /** The Vault's crown, when the manifest has one. */
  crown: string | null;
  rules: (t: CardType, card?: Card, art?: Art) => string;
  flavour: (card: Card, art: Art) => string | null;
  /** True once the manifest has loaded (or is known to be missing). */
  ready: boolean;
}

export function contentFor(m: ManifestState, art: Art = 'classic'): Content {
  const man = m && m !== 'unavailable' ? m : null;
  const names = namesOf(man, art);
  const t = (text: string) => fillNames(text, names);
  const face = (card: Card, art: Art) => {
    const f = faceOf(man, card.t, card.face, art);
    return f ? assetUrl(f) : null;
  };
  return {
    names,
    t,
    name: (type) => names.cards[type],
    glyph: (type) => GLYPHS[type],
    face,
    thumb: (card, art) => {
      const f = faceOf(man, card.t, card.face, art);
      return f ? assetUrl(thumbOf(man, f)) : null;
    },
    back: man?.back ? assetUrl(man.back) : null,
    thumbs: (type, art) => {
      const list = man?.faces?.[type];
      const files = (list?.[art]?.length ? list[art] : (list?.classic ?? list?.adult)) ?? [];
      return files
        .filter((f): f is string => typeof f === 'string' && f.length > 0)
        .map((f) => assetUrl(thumbOf(man, f)));
    },
    crown:
      typeof man?.extras?.crownIcon === 'string' && man.extras.crownIcon
        ? assetUrl(man.extras.crownIcon)
        : null,
    rules: (type) => t(RULES[type]),
    flavour: (card, art) => {
      const f = faceOf(man, card.t, card.face, art);
      const text = f ? man?.text?.[f]?.flavour : undefined;
      return typeof text === 'string' && text.trim() ? text.trim() : null;
    },
    ready: m !== null,
  };
}
