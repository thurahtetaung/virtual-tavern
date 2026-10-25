import type { ContentProvider } from '@vt/game-sdk';
import { z } from 'zod';

// Sketchy's private content lives in content packs (`content_packs`), never in the repository:
// `prompts` packs hold the titles players draw (with the other spellings a lie may not use), and
// `decoys` packs the house titles that pad a small board. Tests use small made-up packs.

export const MAX_PROMPT_LENGTH = 80;
/** A prompt's `{player}` slot, filled at the deal with another player's name. */
export const PLAYER_SLOT = '{player}';

const text = z.string().trim().min(1).max(MAX_PROMPT_LENGTH);

const promptSchema = z.object({
  prompt: text,
  /** Other ways of writing the title: a lie matching one is refused like the title itself. */
  alternates: z.array(text).max(20).default([]),
  adult: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

const decoySchema = z.object({ text, adult: z.boolean().default(false) });

export const PACK_KINDS = {
  prompts: z.array(promptSchema).min(1).max(5000),
  decoys: z.array(decoySchema).min(1).max(2000),
};

export type PromptEntry = z.output<typeof promptSchema>;
export type DecoyEntry = z.output<typeof decoySchema>;

/** A prompt pack as the lobby lists it (names only reach players in an unlocked room). */
export interface PackSummary {
  id: string;
  name: string;
  /** Prompts that aren't adult-only. */
  count: number;
  /** Adult-only prompts. */
  adult: number;
}

/** A prompt as dealt: `id` is `<packId>:<index>`, stable while the pack is unchanged. */
export interface Prompt {
  id: string;
  packId: string;
  text: string;
  alternates: string[];
  adult: boolean;
}

function parsed<T>(content: ContentProvider, kind: keyof typeof PACK_KINDS) {
  return (content.contentPacks?.(kind) ?? []).flatMap((pack) => {
    const data = PACK_KINDS[kind].safeParse(pack.data);
    return data.success ? [{ id: pack.id, name: pack.name, items: data.data as T[] }] : [];
  });
}

/** The prompt packs this room is offered. */
export function promptPacks(content: ContentProvider): PackSummary[] {
  return parsed<PromptEntry>(content, 'prompts').map((p) => ({
    id: p.id,
    name: p.name,
    count: p.items.filter((i) => !i.adult).length,
    adult: p.items.filter((i) => i.adult).length,
  }));
}

/** Every prompt in the chosen packs (adult ones only when allowed), lowercased. */
export function promptsFrom(
  content: ContentProvider,
  packIds: readonly string[],
  adult: boolean,
): Prompt[] {
  const chosen = new Set(packIds);
  return parsed<PromptEntry>(content, 'prompts')
    .filter((p) => chosen.has(p.id))
    .flatMap((p) =>
      p.items.flatMap((item, i) =>
        item.adult && !adult
          ? []
          : [
              {
                id: `${p.id}:${i}`,
                packId: p.id,
                text: lower(item.prompt),
                alternates: item.alternates.map(lower),
                adult: item.adult,
              },
            ],
      ),
    );
}

/** The house titles from every enabled decoys pack (adult ones only when allowed), lowercased. */
export function decoysFrom(content: ContentProvider, adult: boolean): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const pack of parsed<DecoyEntry>(content, 'decoys')) {
    for (const d of pack.items) {
      const t = lower(d.text);
      if ((d.adult && !adult) || seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Everything on the board is lowercase, so the real title never stands out by its polish. */
export const lower = (s: string) => s.replace(/\s+/g, ' ').trim().toLocaleLowerCase('en');
