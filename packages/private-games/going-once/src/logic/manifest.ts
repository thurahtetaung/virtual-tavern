import type { GuideFooter } from '@vt/game-sdk';
import { type Names, PLACEHOLDER_NAMES } from './names.ts';

/**
 * The private `going-once/manifest.json` (asset storage, never the repo):
 * `{ names?: { bank? }, house?: { "<house key>": "house/<key>.webp" }, ui?: { "buyer-0".."buyer-2",
 * bank, "bank-bite", gallery, easel, lot, handle, paddles: [...] }, audio?: {...}, credit? }`.
 * House keys are the title groups' `house` entries (by default a title's prompt id,
 * `<group id>_<index>`); paths are relative to the game's folder. `audio` (music, sfx, voice and
 * their durations) is read by the sound layer still to come. Without the manifest, house pictures
 * show as a "House picture" placeholder and the rest falls back to emoji and plain screens.
 */
export interface Manifest {
  names?: { bank?: string };
  house?: Record<string, string>;
  ui?: Record<string, string | string[]>;
  audio?: {
    music?: Record<string, string[]>;
    sfx?: Record<string, string[]>;
    voice?: Record<string, string[]>;
    durations?: Record<string, number>;
  };
  credit?: { text?: string; url?: string };
}

const text = (v: unknown, max = 60) =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;

export function namesOf(manifest: unknown): Names {
  const m = (manifest && typeof manifest === 'object' ? manifest : {}) as Manifest;
  return { bank: text(m.names?.bank) ?? PLACEHOLDER_NAMES.bank };
}

export function footerOf(manifest: unknown): GuideFooter | undefined {
  const m = (manifest && typeof manifest === 'object' ? manifest : {}) as Manifest;
  const credit = text(m.credit?.text, 400);
  if (!credit) return undefined;
  const url = text(m.credit?.url, 300);
  return {
    title: 'Credits',
    paragraphs: [credit],
    ...(url && /^https:\/\//.test(url) && { links: [{ label: 'Original game', href: url }] }),
  };
}
