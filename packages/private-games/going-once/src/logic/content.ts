import type { ContentProvider } from '@vt/game-sdk';
import { z } from 'zod';
import { HINT_KINDS, type HintKind } from './types.ts';

// The private content: title groups and hint lines, imported as content packs (never in the repo).
// Tests use small made-up packs.

/** Titles that draw alike: every game deals two groups, one title to each player from each. */
export const groupsPack = z
  .array(
    z.object({
      id: z.union([z.string().min(1).max(40), z.number().int()]).transform(String),
      titles: z.array(z.string().trim().min(1).max(60)).min(7).max(12),
      /** The house picture for each title (manifest keys), in title order. */
      house: z.array(z.string().trim().min(1).max(120)).optional(),
    }),
  )
  .min(1)
  .max(2000);
export type GroupsPack = z.output<typeof groupsPack>;

/**
 * Message lines per hint kind. `{player}` is the player a line names, `{value}` an amount and
 * `{random}` a string of random characters.
 */
export const linesPack = z.partialRecord(
  z.enum(HINT_KINDS),
  z.array(z.string().trim().min(1).max(300)).min(1).max(300),
);
export type LinesPack = z.output<typeof linesPack>;

export const PACK_KINDS = { groups: groupsPack, lines: linesPack } as const;

export interface TitleGroup {
  /** `<pack id>:<group id>`. */
  key: string;
  titles: string[];
  house: string[];
}

/** Every title group on offer, from every enabled pack. */
export function titleGroups(content: ContentProvider): TitleGroup[] {
  const packs = content.contentPacks?.('groups') ?? [];
  return packs.flatMap((pack) => {
    const parsed = groupsPack.safeParse(pack.data);
    if (!parsed.success) return [];
    return parsed.data.map((g) => ({
      key: `${pack.id}:${g.id}`,
      titles: g.titles,
      house: g.titles.map((_, i) => g.house?.[i] ?? `${g.id}:${i}`),
    }));
  });
}

/** Lines per kind from every enabled lines pack, merged. */
export function hintLines(content: ContentProvider): Partial<Record<HintKind, string[]>> {
  const out: Partial<Record<HintKind, string[]>> = {};
  for (const pack of content.contentPacks?.('lines') ?? []) {
    const parsed = linesPack.safeParse(pack.data);
    if (!parsed.success) continue;
    for (const [kind, lines] of Object.entries(parsed.data) as [HintKind, string[]][])
      out[kind] = [...(out[kind] ?? []), ...lines];
  }
  return out;
}
