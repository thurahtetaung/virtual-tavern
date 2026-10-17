import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import { CARDS, HEROES } from '../logic/cards.ts';
import { DEFAULT_FOCUS, placeholderCardName } from '../logic/guide.ts';
import type { CardId, HeroId, SetId } from '../logic/types.ts';

export const GAME_ID = 'tavern-brawl';

/**
 * What the private manifest in asset storage describes: the real names, the card faces and the
 * heroes' cards. Paths are relative to the game's folder. Without it, everything shows as neutral
 * placeholders (the hero words and symbol-built card names).
 */
export interface Manifest {
  title?: string;
  sets?: Record<string, { name?: string; box?: string } | undefined>;
  heroes?: Partial<
    Record<
      string,
      {
        name?: string;
        class?: string;
        tagline?: string;
        portrait?: string;
        portraitThumb?: string;
        /** Where the face is on the portrait, as fractions of its width and height. */
        portraitFocus?: [number, number];
        hp?: string;
        ref?: string;
        back?: string;
      }
    >
  >;
  cards?: Record<CardId, { name?: string; face?: string; thumb?: string; text?: string }>;
  credit?: { title?: string; paragraphs?: string[]; links?: { label: string; href: string }[] };
}

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest. `null` while loading; `'unavailable'` when the server has no asset
 * storage, in which case everything renders as placeholders.
 */
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

/** Names and art, falling back to the neutral placeholders. */
export interface Art {
  hero(id: HeroId): string;
  heroClass(id: HeroId): string | null;
  portrait(id: HeroId, size?: 'thumb' | 'full'): string | null;
  /** The face's spot on the portrait (fractions), for the round crop. */
  focus(id: HeroId): [number, number];
  heroCard(id: HeroId, which: 'hp' | 'ref' | 'back'): string | null;
  card(id: CardId): string;
  face(id: CardId, size?: 'thumb' | 'full'): string | null;
  /** The printed power text, with {atk}-style symbol tokens. */
  text(id: CardId): string | null;
  set(id: SetId): string | null;
  box(id: SetId): string | null;
  /** Whether real art is loaded. */
  real: boolean;
}

const clean = (s: string | undefined) => (s && s.trim() ? s.trim() : null);

export function artFor(manifest: ManifestState): Art {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  return {
    real: !!m?.cards,
    hero: (id) => clean(m?.heroes?.[id]?.name) ?? HEROES[id]?.label ?? id,
    heroClass: (id) => clean(m?.heroes?.[id]?.class),
    portrait: (id, size = 'thumb') => {
      const h = m?.heroes?.[id];
      const path = size === 'thumb' ? (h?.portraitThumb ?? h?.portrait) : h?.portrait;
      return path ? assetUrl(path) : null;
    },
    focus: (id) => {
      const f = m?.heroes?.[id]?.portraitFocus;
      const ok = (n: unknown) => typeof n === 'number' && n >= 0 && n <= 1;
      return Array.isArray(f) && ok(f[0]) && ok(f[1]) ? [f[0], f[1]] : DEFAULT_FOCUS;
    },
    heroCard: (id, which) => {
      const path = m?.heroes?.[id]?.[which];
      return path ? assetUrl(path) : null;
    },
    card: (id) => clean(m?.cards?.[id]?.name) ?? (CARDS[id] ? placeholderCardName(CARDS[id]) : id),
    face: (id, size = 'thumb') => {
      const c = m?.cards?.[id];
      const path = size === 'thumb' ? (c?.thumb ?? c?.face) : c?.face;
      return path ? assetUrl(path) : null;
    },
    text: (id) => clean(m?.cards?.[id]?.text),
    set: (id) => clean(m?.sets?.[id]?.name),
    box: (id) => (m?.sets?.[id]?.box ? assetUrl(m.sets[id].box) : null),
  };
}

/**
 * Hero colours (deck colours), light and dark: seat chips, placeholder cards and borrowed-card
 * rims. Data, not theme: each pair keeps white text readable.
 */
export const HERO_COLOURS: Record<HeroId, { light: string; dark: string }> = {
  brute: { light: '#0f766e', dark: '#14b8a6' },
  mage: { light: '#a16207', dark: '#eab308' },
  knight: { light: '#b91c1c', dark: '#ef4444' },
  thief: { light: '#7e22ce', dark: '#a855f7' },
  ranger: { light: '#be185d', dark: '#ec4899' },
  druid: { light: '#4d7c0f', dark: '#84cc16' },
  dragon: { light: '#475569', dark: '#94a3b8' },
  owl: { light: '#c2410c', dark: '#fb923c' },
  psychic: { light: '#7c4a2d', dark: '#c08457' },
  slime: { light: '#0e7490', dark: '#22d3ee' },
  eye: { light: '#1d4ed8', dark: '#60a5fa' },
  mimic: { light: '#15803d', dark: '#4ade80' },
};

/** CSS variables for a hero's colour, read by `bg-[var(--hero)] dark:bg-[var(--hero-dark)]`. */
export const heroVars = (hero: HeroId | null | undefined) =>
  ({
    '--hero': hero ? HERO_COLOURS[hero].light : '#78716c',
    '--hero-dark': hero ? HERO_COLOURS[hero].dark : '#a8a29e',
  }) as React.CSSProperties;
