import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import {
  EXTRAS_LABEL,
  type Kind,
  POOL_LABELS,
  type Pillar,
  type PoolId,
  SET_LABELS,
  type SetId,
  type Third,
  kindOf,
  pictureCardOf,
} from '../logic/cards.ts';
import type { PsychicColor } from '../logic/types.ts';

export const GAME_ID = 'seance';

/**
 * The private manifest in asset storage (`seance/manifest.json`):
 * `{ back, sets: { base: { name, description } … }, pools: { 'pool-a': { name, description, art? } … },
 * extras: { name, description }, psychics: { blue: { name, art, color } … } }`. Card art lives at `<kind>/<n>.webp` with a smaller
 * `<kind>/thumb/<n>.webp`. A pool's `art` points at another back-room game's files instead (for
 * `pool-r`, Reverie's: `reverie/cards/{nnn}.jpg`, `{n}` being Reverie's card number, `{nnn}` it
 * padded to 3), with no separate thumbnail. Everything is optional: without it, cards are
 * numbered placeholders.
 */
export interface Manifest {
  back?: string;
  sets?: Partial<Record<SetId, { name?: string; description?: string }>>;
  pools?: Partial<Record<PoolId, { name?: string; description?: string; art?: string }>>;
  /** The extra suspects and places (their art is stored with the others). */
  extras?: { name?: string; description?: string };
  psychics?: Partial<Record<PsychicColor, { name?: string; art?: string; color?: string }>>;
}

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

export function useManifest(): ManifestState {
  const [manifest, setManifest] = useState<ManifestState>(null);
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

/** The sleeve colours, used when the manifest has none. */
export const SWATCHES: Record<PsychicColor, string> = {
  blue: '#2f8fdf',
  white: '#d6d0c4',
  red: '#d8342c',
  yellow: '#e9b80f',
  purple: '#9b3fb5',
  brown: '#7a5434',
};

const KIND_LABELS: Record<Kind, string> = {
  vision: 'Vision',
  suspect: 'Suspect',
  place: 'Place',
  object: 'Object',
  story: 'Story',
};

export const KIND_ICONS: Record<Kind, string> = {
  vision: '👁️',
  suspect: '🧑',
  place: '🏚️',
  object: '🗝️',
  story: '📜',
};

/** A pool's art template, kept to a plain path under the back-room assets. */
const ART_TEMPLATE = /^[\w-]+\/(?:[\w.-]+\/)*[\w.{}-]+$/;

/** Where a pool's card art lives, from the manifest's template, or null. */
export function poolArt(template: string | undefined, n: number): string | null {
  if (!template || !ART_TEMPLATE.test(template) || template.includes('..')) return null;
  const path = template
    .replaceAll('{nnn}', String(n).padStart(3, '0'))
    .replaceAll('{n}', String(n));
  return `/api/backroom/assets/${path}`;
}

/** Names and art for everything on the table, with placeholders where the manifest is silent. */
export interface Content {
  /** Whether real art is expected (the manifest loaded). */
  art: boolean;
  cardArt: (kind: Kind, n: number, thumb?: boolean) => string | null;
  /** "Suspect 12", "Vision 40": what screen readers and placeholders say. */
  cardLabel: (kind: Kind, n: number) => string;
  /** What this game's third pillar is played with. */
  third: Third;
  /** The card kind of a pillar in this game (stories for the third, when chosen). */
  kindOf: (p: Pillar) => Kind;
  pillarName: (p: Pillar) => string;
  /** "Suspects", "Stories". */
  pillarPlural: (p: Pillar) => string;
  pillarIcon: (p: Pillar) => string;
  setName: (id: SetId) => string;
  setDescription: (id: SetId) => string | null;
  poolName: (id: PoolId) => string;
  poolDescription: (id: PoolId) => string | null;
  extrasName: string;
  extrasDescription: string | null;
  psychicName: (c: PsychicColor) => string;
  psychicArt: (c: PsychicColor) => string | null;
  swatch: (c: PsychicColor) => string;
  back: string | null;
}

const m = (s: ManifestState): Manifest | null => (s && s !== 'unavailable' ? s : null);
const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function contentFor(state: ManifestState, third: Third = 'object'): Content {
  const man = m(state);
  const kind = (p: Pillar) => kindOf(p, third);
  return {
    art: !!man,
    cardArt: (kind, n, thumb) => {
      if (!man) return null;
      const picture = kind === 'vision' ? pictureCardOf(n) : null;
      if (picture !== null) return poolArt(clean(man.pools?.['pool-r']?.art), picture);
      return assetUrl(`${kind}/${thumb ? 'thumb/' : ''}${n}.webp`);
    },
    cardLabel: (kind, n) => `${KIND_LABELS[kind]} ${n}`,
    third,
    kindOf: kind,
    pillarName: (p) => KIND_LABELS[kind(p)],
    pillarPlural: (p) => (kind(p) === 'story' ? 'Stories' : `${KIND_LABELS[kind(p)]}s`),
    pillarIcon: (p) => KIND_ICONS[kind(p)],
    setName: (id) => clean(man?.sets?.[id]?.name) ?? SET_LABELS[id],
    setDescription: (id) => clean(man?.sets?.[id]?.description) ?? null,
    poolName: (id) => clean(man?.pools?.[id]?.name) ?? POOL_LABELS[id],
    poolDescription: (id) => clean(man?.pools?.[id]?.description) ?? null,
    extrasName: clean(man?.extras?.name) ?? EXTRAS_LABEL,
    extrasDescription: clean(man?.extras?.description) ?? null,
    psychicName: (c) => clean(man?.psychics?.[c]?.name) ?? `The ${c} psychic`,
    psychicArt: (c) => {
      const art = clean(man?.psychics?.[c]?.art);
      return art ? assetUrl(art) : null;
    },
    swatch: (c) => {
      const v = clean(man?.psychics?.[c]?.color);
      return v && /^#[0-9a-f]{3,8}$/i.test(v) ? v : SWATCHES[c];
    },
    back: clean(man?.back) ? assetUrl(man!.back!) : null,
  };
}

export const colorLabel = (c: PsychicColor) => capital(c);
