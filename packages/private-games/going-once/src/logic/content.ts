import type { ContentProvider } from '@vt/game-sdk';
import { z } from 'zod';
import { HINT_KINDS, type HintKind } from './types.ts';

// The private content: title groups and hint lines, imported as content packs (never in the repo).
// Tests use small made-up packs.

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

/**
 * Text with any markup taken out: tags stripped (keeping their words, so "The movie <i>Speed</i>"
 * is "The movie Speed"), entities decoded, spaces collapsed. Every pack string goes through it,
 * so markup in a source never reaches a screen. Keep in step with `plainText` in
 * scripts/import-content-pack.mjs.
 */
export function plainText(text: string): string {
  return text
    .replace(/<\/?[a-zA-Z][^<>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n =
          code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
        return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** A pack string: trimmed, markup out, then within `max` characters. */
const packText = (min: number, max: number) =>
  z.string().transform(plainText).pipe(z.string().min(min).max(max));

/** Titles that draw alike: every game deals two groups, one title to each player from each. */
export const groupsPack = z
  .array(
    z.object({
      id: z.union([z.string().min(1).max(40), z.number().int()]).transform(String),
      titles: z.array(packText(1, 60)).min(7).max(12),
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
  z.array(packText(1, 300)).min(1).max(300),
);
export type LinesPack = z.output<typeof linesPack>;

/**
 * What the host says, by moment (`host.ts` names the moments): lines that name nobody, or name a
 * player as `{player}`. Shown as on-screen text, one moment at a time.
 */
/**
 * Why a host line isn't a line someone would say (a cue or file name, a stage direction, a label
 * left in by a recording script), or null.
 */
export function hostLineProblem(line: string): string | null {
  if (/^(new (version|audio)|redo)\b/i.test(line)) return 'a recording label, not a line';
  if (/\.(ogg|wav|mp3|webp|png)\b|\b[A-Z]{3,}\d{2,}\b/.test(line)) return 'a file or cue name';
  if (/[[\]()]/.test(line)) return 'a stage direction in brackets';
  if (!/[A-Za-z]|\$\d/.test(line.replaceAll('{player}', ''))) return 'no words';
  if (!/[.!?…"”'’]$/.test(line)) return 'it needs to end like a sentence';
  return null;
}

const hostLine = packText(2, 300).superRefine((line, ctx) => {
  const problem = hostLineProblem(line);
  if (problem) ctx.addIssue({ code: 'custom', message: `"${line}": ${problem}` });
});

export const hostPack = z
  .record(z.string().regex(/^[a-z][a-z0-9-]{0,40}$/), z.array(hostLine).min(1).max(200))
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
