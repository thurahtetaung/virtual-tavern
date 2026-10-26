import type { GuideFooter } from '@vt/game-sdk';
import { type Names, PLACEHOLDER_NAMES } from './names.ts';

/**
 * The private `going-once/manifest.json` (asset storage, never the repo):
 * `{ names?: { bank?, buyers?: [3 names] }, house?: { "<house key>": "house/<key>.webp" },
 * ui?: { "buyer-0".."buyer-2", bank, "bank-bite", gallery, easel, lot, handle, paddles: [...] },
 * audio?: { music, sfx, voice, durations, text }, credit? }`. House keys are the title groups'
 * `house` entries (by default a title's prompt id, `<group id>_<index>`); paths are relative to
 * the game's folder. `audio` lists clips by key (`ui/audio.ts` names the keys the sound plays),
 * their lengths in ms and what each voice clip says. Without the manifest, house pictures show as
 * a "House picture" placeholder, the buyers go by their placeholder names, the game is silent and
 * the rest falls back to emoji and plain screens.
 */
export interface Manifest {
  names?: { bank?: string; buyers?: string[] };
  house?: Record<string, string>;
  ui?: Record<string, string | string[]>;
  audio?: {
    music?: Record<string, string[]>;
    sfx?: Record<string, string[]>;
    voice?: Record<string, string[]>;
    durations?: Record<string, number>;
    text?: Record<string, string>;
  };
  credit?: { text?: string; url?: string };
}

const text = (v: unknown, max = 60) =>
  typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : undefined;

export function namesOf(manifest: unknown): Names {
  const m = (manifest && typeof manifest === 'object' ? manifest : {}) as Manifest;
  const buyers = PLACEHOLDER_NAMES.buyers.map(
    (fallback, i) => text(m.names?.buyers?.[i], 40) ?? fallback,
  ) as Names['buyers'];
  return { bank: text(m.names?.bank) ?? PLACEHOLDER_NAMES.bank, buyers };
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
