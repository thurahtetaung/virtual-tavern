import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_WORDS_PER_LIST } from '@vt/protocol';
import { z } from 'zod';

/** Longest entry allowed in a built-in pack, so cards stay readable on a phone-sized board. */
export const MAX_PACK_WORD_LENGTH = 20;
/** Longest entry in a pack made only for games that use whole phrases. */
export const MAX_PACK_PHRASE_LENGTH = 40;
/** Games whose words may be phrases (shown one at a time, never on a grid of cards). */
export const PHRASE_GAMES: readonly string[] = ['iconic'];

const wordPack = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200),
    /** The games that offer the pack; without it, every word-list game. */
    games: z
      .array(z.string().regex(/^[a-z0-9-]+$/))
      .min(1)
      .optional(),
    words: z
      .array(z.string().trim().min(1).max(MAX_PACK_PHRASE_LENGTH))
      .min(25)
      .max(MAX_WORDS_PER_LIST),
  })
  .superRefine((pack, ctx) => {
    const phrases = !!pack.games?.every((g) => PHRASE_GAMES.includes(g));
    const max = phrases ? MAX_PACK_PHRASE_LENGTH : MAX_PACK_WORD_LENGTH;
    const long = pack.words.find((w) => w.trim().length > max);
    if (long)
      ctx.addIssue({ code: 'custom', message: `"${long}" is longer than ${max} characters` });
  });

export type WordPack = z.infer<typeof wordPack>;

/** Reads every `*.json` pack in `folder`, sorted by file name. Throws on any invalid pack. */
export function loadWordPacks(folder: string): WordPack[] {
  const packs = readdirSync(folder)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => {
      const parsed = wordPack.safeParse(JSON.parse(readFileSync(join(folder, file), 'utf8')));
      if (!parsed.success) {
        throw new Error(`Invalid word pack ${file}: ${parsed.error.issues[0]?.message}`);
      }
      if (`${parsed.data.slug}.json` !== file) {
        throw new Error(`Word pack ${file} must be named after its slug "${parsed.data.slug}"`);
      }
      return parsed.data;
    });
  const names = new Set<string>();
  for (const p of packs) {
    if (names.has(p.name)) throw new Error(`Duplicate word pack name "${p.name}"`);
    names.add(p.name);
  }
  return packs;
}
