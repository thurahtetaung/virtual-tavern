import type { GuideFooter } from '@vt/game-sdk';
import type { Kind } from './types.ts';

/**
 * The private `defuse/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; without it, the bomb is plain styled panels and words, and the game is silent.
 *
 * Pictures are a path or `{ art, thumb }`. Module layers are each the module's full canvas with
 * transparency, stacked at 0,0; `box` is a part's hit area as fractions [x, y, w, h] of the canvas.
 * Part ids are the original model's part names, lower-cased, so a 3D view can map them back.
 *
 * {
 *   title, credit,
 *   names: { modules: { wires: "…", … }, game? },
 *   casing: { front, rear, top, bottom, left, right, blank },
 *   timer: { backing, size, parts: { "strike-1-on", … }, defaults },
 *   modules: { "<kind>": { base, size: [w, h], parts: { "<part>": { art, box? } }, defaults: { "<layer>": "<part>" },
 *              anchors?: { "<text node>": [x, y] }, glyphBoxes?, grid?, dialCentre? } },
 *   widgets: { serial, "battery-d", "battery-aa", indicator, "indicator-lit", plate,
 *              "port-parallel", "port-serial", "port-dvi", "port-ps2", "port-rj45", "port-rca" },
 *   glyphs: { "1": …, …, "31": … },
 *   manual: { pages: { "1": …, …, "23": … }, modulePages: { wires: [5], … } },
 *   stamps: { defused, exploded },
 *   fonts: { digits, manual },
 *   scene: "3d/",   (the 3D bomb's pack: scene.json, scene.bin, tex/, basis/)
 *   room: "3d/room/",   (the room's pack: room.json, room.bin, tex/; it uses the bomb's basis/)
 *   extras: { results: { "freeplay-exploded": …, "freeplay-defused": … } }   (the binder's pages)
 *   audio: { effects: { "<name>": "audio/….ogg" }, music: { "<playlist>": ["…"], win, lose },
 *            durations: { "<path>": ms } }
 * }
 */
export type ArtRef = string | { art?: string; thumb?: string };

export interface Part {
  art?: string;
  box?: [number, number, number, number];
}

export interface ModuleArt {
  base?: ArtRef;
  size?: [number, number];
  parts?: Record<string, Part>;
  /** The part each layer shows before anything happens (a layer missing here shows nothing). */
  defaults?: Record<string, string>;
  /** Where the original draws text (its text nodes' origins), as [x, y] fractions. */
  anchors?: Record<string, [number, number]>;
  /** Keypad: where each key's symbol sits. */
  glyphBoxes?: Record<string, [number, number, number, number]>;
  /** Maze: cell (0, 0)'s place and the step between cells, as fractions. */
  grid?: { cell00?: [number, number]; pitch?: [number, number] };
  /** Knob: the point the dial turns about. */
  dialCentre?: [number, number];
}

export interface Manifest {
  title?: string;
  names?: { modules?: Partial<Record<Kind, string>>; game?: string };
  casing?: Partial<
    Record<'front' | 'rear' | 'top' | 'bottom' | 'left' | 'right' | 'blank', ArtRef>
  >;
  timer?: {
    backing?: ArtRef;
    size?: [number, number];
    parts?: Record<string, Part>;
    defaults?: Record<string, string>;
  };
  modules?: Partial<Record<Kind, ModuleArt>>;
  widgets?: Record<string, ArtRef>;
  glyphs?: Record<string, ArtRef>;
  manual?: {
    pages?: Record<string, ArtRef>;
    modulePages?: Partial<Record<Kind | 'appendix', number[]>>;
  };
  stamps?: Partial<Record<'defused' | 'exploded', ArtRef>>;
  fonts?: Partial<Record<'digits' | 'manual' | 'labels' | 'morse', string>>;
  /** The 3D bomb's folder (scene graph, geometry, textures, the texture transcoder). */
  scene?: string;
  /** The room around the 3D bomb (its own pack, beside the bomb's). */
  room?: string;
  audio?: {
    effects?: Record<string, string | string[]>;
    music?: Record<string, string | string[]>;
    durations?: Record<string, number>;
  };
  guide?: { tagline?: string };
  credit?:
    string | { title?: string; paragraphs?: string[]; links?: { label?: string; href?: string }[] };
}

export const clean = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined;

export const artOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? clean(ref) : clean(ref?.art);

export const thumbOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? undefined : clean(ref?.thumb);

/** Plain names for the modules, until the manifest names them. */
export const PLAIN_NAMES: Record<Kind, string> = {
  wires: 'Wires',
  button: 'Big button',
  keypad: 'Symbol keypad',
  simon: 'Colour flashes',
  'whos-on-first': 'Word buttons',
  memory: 'Number buttons',
  morse: 'Blinking light',
  'complicated-wires': 'Marked wires',
  'wire-sequence': 'Wire panels',
  maze: 'Maze',
  password: 'Letter dials',
  'venting-gas': 'Gas vent',
  capacitor: 'Capacitor',
  knob: 'Knob',
};

/** Module names: the manifest's where it has them. */
export function namesOf(m: Manifest | null | undefined): Record<Kind, string> {
  const out = { ...PLAIN_NAMES };
  const given = m?.names?.modules;
  if (given && typeof given === 'object')
    for (const k of Object.keys(out) as Kind[]) {
      const n = clean(given[k]);
      if (n) out[k] = n.slice(0, 40);
    }
  return out;
}

/** The original game's credit, for the guide's footer (unlocked browsers only). */
export function footerOf(m: Manifest | null | undefined): GuideFooter | undefined {
  const raw = m?.credit;
  if (typeof raw === 'string')
    return clean(raw) ? { title: 'Credits', paragraphs: [raw.trim()] } : undefined;
  const paragraphs = (raw?.paragraphs ?? []).flatMap((p) => (clean(p) ? [p.trim()] : []));
  if (!paragraphs.length) return undefined;
  const links = (raw?.links ?? []).flatMap((l) =>
    clean(l.label) && typeof l.href === 'string' && /^https:\/\//.test(l.href)
      ? [{ label: l.label!.trim(), href: l.href }]
      : [],
  );
  return { title: clean(raw?.title) ?? 'Credits', paragraphs, ...(links.length ? { links } : {}) };
}
