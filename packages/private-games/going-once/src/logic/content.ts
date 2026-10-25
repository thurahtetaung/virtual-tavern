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

/**
 * What the host says, by moment (`host.ts` names the moments): lines that name nobody, or name a
 * player as `{player}`. Shown as on-screen text, one moment at a time.
 */
export const hostPack = z
  .record(
    z.string().regex(/^[a-z][a-z0-9-]{0,40}$/),
    z.array(z.string().trim().min(1).max(300)).min(1).max(200),
  )
  .refine((r) => Object.keys(r).length > 0 && Object.keys(r).length <= 300, 'one to 300 moments');
export type HostPack = z.output<typeof hostPack>;

export const PACK_KINDS = { groups: groupsPack, lines: linesPack, host: hostPack } as const;

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
      // House pictures are keyed by the title's prompt id, `<group id>_<index>`, unless the pack says.
      house: g.titles.map((_, i) => g.house?.[i] ?? `${g.id}_${i}`),
    }));
  });
}

/** Host lines per moment from every enabled host pack, merged. */
export function hostLinesOf(content: ContentProvider): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const pack of content.contentPacks?.('host') ?? []) {
    const parsed = hostPack.safeParse(pack.data);
    if (!parsed.success) continue;
    for (const [moment, lines] of Object.entries(parsed.data))
      out[moment] = [...(out[moment] ?? []), ...lines];
  }
  return out;
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
