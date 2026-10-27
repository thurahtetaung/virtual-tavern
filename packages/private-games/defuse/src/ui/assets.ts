import { loadManifest } from '@vt/ui';
import { useEffect, useState } from 'react';
import { type ArtRef, type Manifest, artOf, clean, namesOf, thumbOf } from '../logic/manifest.ts';
import type { Kind } from '../logic/types.ts';

export const GAME_ID = 'defuse';

export type ManifestState = Manifest | null | 'unavailable';

export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/**
 * Loads the private manifest (renders, sounds, names). `null` while loading; `'unavailable'`
 * without asset storage, when the bomb is plain styled panels and words and the game is silent.
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

const path = (p: unknown) => {
  const c = clean(p);
  return c ? assetUrl(c) : null;
};
const pic = (ref: ArtRef | undefined, small = false) =>
  (small ? path(thumbOf(ref)) : null) ?? path(artOf(ref));

const loaded = new Set<string>();

/** Adds one of the manifest's font files to the page (once) and names its family. */
function loadFont(
  family: string,
  src: string | null,
  fallback = 'ui-monospace, monospace',
): string | null {
  if (!src || typeof FontFace === 'undefined' || typeof document === 'undefined') return null;
  if (!loaded.has(family)) {
    loaded.add(family);
    const face = new FontFace(family, `url(${src})`);
    void face.load().then(
      (f) => document.fonts.add(f),
      () => {},
    );
  }
  return `${family}, ${fallback}`;
}

export type Box = [number, number, number, number];

export interface Layer {
  src: string;
  box?: Box;
}

/** A module's art, or the timer's (it is drawn like a module). */
export type ArtKind = Kind | 'timer';

/** Everything the screens read from the manifest, with nulls where it has nothing. */
export interface Art {
  names: Record<Kind, string>;
  /** A module's base render and its canvas size, or null to draw it plainly. */
  module: (kind: ArtKind) => { base: string; size: [number, number] } | null;
  /** One part of a module (`wire-2-red`, `status-pass`…). */
  part: (kind: ArtKind, part: string) => Layer | null;
  /** The part each layer shows before anything happens. */
  defaults: (kind: ArtKind) => Record<string, string>;
  /** Where the original draws a text node, as [x, y] fractions. */
  anchor: (kind: Kind, node: string) => [number, number] | null;
  glyphBox: (key: number) => Box | null;
  mazeGrid: () => { cell00: [number, number]; pitch: [number, number] } | null;
  dialCentre: () => [number, number] | null;
  casing: (face: 'front' | 'rear' | 'top' | 'bottom' | 'left' | 'right' | 'blank') => string | null;
  /** The casing's module slots per face, and its widget areas per edge, as boxes. */
  slots: (face: 'front' | 'rear') => Box[] | null;
  areas: (side: 'top' | 'bottom' | 'left' | 'right') => Box[] | null;
  widget: (name: string) => string | null;
  portBox: (port: string) => Box | null;
  glyph: (n: number) => string | null;
  page: (n: number) => string | null;
  pagesOf: (page: Kind | 'appendix') => number[];
  stamp: (which: 'defused' | 'exploded') => string | null;
  /** An effect's file (one at random when the manifest lists several). */
  effect: (name: string) => string | null;
  music: (name: string) => string[];
  digitsFont: string | null;
  /** The 3D bomb's folder URL (ending in `/`), or null without one. */
  scene: string | null;
  /** The room's folder URL (ending in `/`), or null without one. */
  room: string | null;
  /** A results page of the binder (`freeplay-exploded`, `freeplay-defused`). */
  results: (which: 'freeplay-exploded' | 'freeplay-defused') => string | null;
  /** The original's fonts, as CSS families once loaded (null without the manifest's files). */
  fonts: Record<'digits' | 'labels' | 'morse' | 'manual', string | null>;
}

const num2 = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number')
    ? [v[0] as number, v[1] as number]
    : null;
const box4 = (v: unknown): Box | null =>
  Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'number')
    ? [v[0] as number, v[1] as number, v[2] as number, v[3] as number]
    : null;

export function artFor(manifest: ManifestState): Art {
  const m = manifest && manifest !== 'unavailable' ? manifest : null;
  const modules = m?.modules && typeof m.modules === 'object' ? m.modules : {};
  const extras = (m as { extras?: Record<string, unknown> } | null)?.extras ?? {};
  const of = (kind: ArtKind) =>
    kind === 'timer'
      ? {
          base: m?.timer?.backing,
          size: m?.timer?.size,
          parts: m?.timer?.parts,
          defaults: m?.timer?.defaults,
        }
      : modules[kind];
  const boxes = (key: string, face: string): Box[] | null => {
    const list = (extras[key] as Record<string, unknown> | undefined)?.[face];
    if (!Array.isArray(list)) return null;
    const out = list.flatMap((b): Box[] => {
      const x = box4(b);
      return x ? [x] : [];
    });
    return out.length ? out : null;
  };
  return {
    names: namesOf(m),
    module: (kind) => {
      const a = of(kind);
      const base = pic(a?.base);
      if (!base) return null;
      const size = num2(a?.size) ?? [1024, 1024];
      return { base, size };
    },
    part: (kind, id) => {
      const p = of(kind)?.parts?.[id];
      const src = path(p?.art);
      if (!src) return null;
      const box = box4(p?.box);
      return { src, ...(box && { box }) };
    },
    defaults: (kind) => {
      const d = of(kind)?.defaults;
      return d && typeof d === 'object' ? { ...d } : {};
    },
    anchor: (kind, node) => num2(modules[kind]?.anchors?.[node]),
    glyphBox: (key) => box4(modules.keypad?.glyphBoxes?.[`glyph-${key}`]),
    mazeGrid: () => {
      const g = modules.maze?.grid;
      const cell00 = num2(g?.cell00);
      const pitch = num2(g?.pitch);
      return cell00 && pitch ? { cell00, pitch } : null;
    },
    dialCentre: () => num2(modules.knob?.dialCentre),
    casing: (face) => pic(m?.casing?.[face]),
    slots: (face) => boxes('casingSlots', face),
    areas: (side) => boxes('casingAreas', side),
    widget: (name) => pic(m?.widgets?.[name], true),
    portBox: (port) => box4((extras.portBoxes as Record<string, unknown> | undefined)?.[port]),
    glyph: (n) => pic(m?.glyphs?.[String(n)], true),
    page: (n) => pic(m?.manual?.pages?.[String(n)]),
    pagesOf: (page) => {
      const list = m?.manual?.modulePages?.[page];
      return Array.isArray(list) ? list.filter((n) => Number.isInteger(n)).slice(0, 4) : [];
    },
    stamp: (which) => pic(m?.stamps?.[which]),
    effect: (name) => {
      const v = m?.audio?.effects?.[name];
      const list = (Array.isArray(v) ? v : v ? [v] : []).flatMap((p) => path(p) ?? []);
      return list.length ? list[Math.floor(Math.random() * list.length)]! : null;
    },
    music: (name) => {
      const v = m?.audio?.music?.[name];
      return (Array.isArray(v) ? v : v ? [v] : []).flatMap((p) => path(p) ?? []);
    },
    digitsFont: path(m?.fonts?.digits),
    scene: (() => {
      const p = path(m?.scene);
      return p ? p.replace(/\/*$/, '/') : null;
    })(),
    room: (() => {
      const p = path(m?.room);
      return p ? p.replace(/\/*$/, '/') : null;
    })(),
    results: (which) => {
      const r = extras.results as Record<string, unknown> | undefined;
      const v = r?.[which];
      return typeof v === 'string' ? pic(v) : null;
    },
    fonts: {
      digits: loadFont('DefuseDigits', path(m?.fonts?.digits)),
      labels: loadFont('DefuseLabels', path(m?.fonts?.labels)),
      morse: loadFont('DefuseMorse', path(m?.fonts?.morse)),
      manual: loadFont('DefuseManual', path(m?.fonts?.manual), 'ui-serif, Georgia, serif'),
    },
  };
}
