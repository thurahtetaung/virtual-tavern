import { useEffect, useState } from 'react';
import { type Kind, type Pillar, SET_LABELS, type SetId } from '../logic/cards.ts';
import type { PsychicColor } from '../logic/types.ts';

export const GAME_ID = 'seance';

/**
 * The private manifest in asset storage (`seance/manifest.json`):
 * `{ back, sets: { base: { name, description } … }, psychics: { blue: { name, art, color } … } }`. Card art lives at `<kind>/<n>.webp` with a smaller
 * `<kind>/thumb/<n>.webp`. Everything is optional: without it, cards are numbered placeholders.
 */
export interface Manifest {
  back?: string;
  sets?: Partial<Record<SetId, { name?: string; description?: string }>>;
  psychics?: Partial<Record<PsychicColor, { name?: string; art?: string; color?: string }>>;
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
        if (!res.ok) {
          setManifest('unavailable');
          return;
        }
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

/** The sleeve colours, used when the manifest has none. */
export const SWATCHES: Record<PsychicColor, string> = {
  blue: '#2f8fdf',
  white: '#d6d0c4',
  red: '#d8342c',
  yellow: '#e9b80f',
  purple: '#9b3fb5',
  brown: '#7a5434',
};

const PILLAR_LABELS: Record<Pillar, string> = {
  suspect: 'Suspect',
  place: 'Place',
  object: 'Object',
};

export const PILLAR_ICONS: Record<Pillar, string> = { suspect: '🧑', place: '🏚️', object: '🗝️' };

/** Names and art for everything on the table, with placeholders where the manifest is silent. */
export interface Content {
  /** Whether real art is expected (the manifest loaded). */
  art: boolean;
  cardArt: (kind: Kind, n: number, thumb?: boolean) => string | null;
  /** "Suspect 12", "Vision 40": what screen readers and placeholders say. */
  cardLabel: (kind: Kind, n: number) => string;
  pillarName: (p: Pillar) => string;
  setName: (id: SetId) => string;
  setDescription: (id: SetId) => string | null;
  psychicName: (c: PsychicColor) => string;
  psychicArt: (c: PsychicColor) => string | null;
  swatch: (c: PsychicColor) => string;
  back: string | null;
}

const m = (s: ManifestState): Manifest | null => (s && s !== 'unavailable' ? s : null);
const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const capital = (s: string) => s[0]!.toUpperCase() + s.slice(1);

export function contentFor(state: ManifestState): Content {
  const man = m(state);
  const pillarName = (p: Pillar) => PILLAR_LABELS[p];
  return {
    art: !!man,
    cardArt: (kind, n, thumb) =>
      man ? assetUrl(`${kind}/${thumb ? 'thumb/' : ''}${n}.webp`) : null,
    cardLabel: (kind, n) => `${kind === 'vision' ? 'Vision' : pillarName(kind)} ${n}`,
    pillarName,
    setName: (id) => clean(man?.sets?.[id]?.name) ?? SET_LABELS[id],
    setDescription: (id) => clean(man?.sets?.[id]?.description) ?? null,
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
