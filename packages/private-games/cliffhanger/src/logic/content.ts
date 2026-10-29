import { type ContentProvider, wordKey } from '@vt/game-sdk';
import { z } from 'zod';
import { type DeckKind, FILM_GENRE_IDS, TV_GENRE_IDS } from './genres.ts';

// Cliffhanger's titles and face-off categories live in content packs (`content_packs`), never in
// the repository: `films` and `shows` packs hold the cards, `categories` and `tv-categories` the
// face-off categories. Tests use small made-up packs.

export const MAX_TITLE_LENGTH = 40;
export const MAX_CATEGORY_LENGTH = 80;

const title = z.string().trim().min(1).max(MAX_TITLE_LENGTH);
const tier = z.enum(['easy', 'medium']).optional();
const filmGenre = z.enum(FILM_GENRE_IDS as [string, ...string[]]);
const tvGenre = z.enum(TV_GENRE_IDS as [string, ...string[]]);
const categories = z.object({
  categories: z.array(z.string().trim().min(1).max(MAX_CATEGORY_LENGTH)).min(1).max(5000),
});

export const PACK_KINDS = {
  films: z.object({
    films: z
      .array(z.object({ title, genre: filmGenre, tier }))
      .min(1)
      .max(10000),
  }),
  categories,
  shows: z.object({
    shows: z
      .array(z.object({ title, genre: tvGenre, tier }))
      .min(1)
      .max(10000),
  }),
  'tv-categories': categories,
};

export type PackKind = keyof typeof PACK_KINDS;
export type Tier = 'easy' | 'medium';

/** The pack kinds a deck uses: its cards and its categories. */
export const KINDS: Record<DeckKind, { cards: PackKind; categories: PackKind }> = {
  films: { cards: 'films', categories: 'categories' },
  tv: { cards: 'shows', categories: 'tv-categories' },
};

/** A pack as the lobby lists it (names only reach players in an unlocked room). */
export interface PackSummary {
  id: string;
  name: string;
  kind: PackKind;
  count: number;
}

/** A card as dealt: `id` is `<packId>:<index>`, stable while the pack is unchanged. */
export interface Card {
  id: string;
  title: string;
  genre: string;
  tier?: Tier;
}

export interface Category {
  id: string;
  text: string;
}

/** Only the packs are read, so a bot's `BotCtx` serves as well as a room's content. */
type Packs = Pick<ContentProvider, 'contentPacks'>;

interface Parsed {
  id: string;
  name: string;
  kind: PackKind;
  cards: Card[];
  categories: Category[];
}

function parsed(content: Packs, kind: PackKind): Parsed[] {
  return (content.contentPacks?.(kind) ?? []).flatMap((pack) => {
    const r = PACK_KINDS[kind].safeParse(pack.data);
    if (!r.success) return [];
    const data = r.data as {
      films?: Omit<Card, 'id'>[];
      shows?: Omit<Card, 'id'>[];
      categories?: string[];
    };
    const items = data.films ?? data.shows ?? [];
    return [
      {
        id: pack.id,
        name: pack.name,
        kind,
        cards: items.map((c, i) => ({
          id: `${pack.id}:${i}`,
          title: c.title,
          genre: c.genre,
          ...(c.tier && { tier: c.tier }),
        })),
        categories: (data.categories ?? []).map((text, i) => ({ id: `${pack.id}:${i}`, text })),
      },
    ];
  });
}

/** Every pack this room is offered, of every kind. */
export function packsOf(content: Packs): PackSummary[] {
  return (Object.keys(PACK_KINDS) as PackKind[]).flatMap((kind) =>
    parsed(content, kind).map((p) => ({
      id: p.id,
      name: p.name,
      kind,
      count: p.cards.length + p.categories.length,
    })),
  );
}

/** The cards of the chosen packs for a deck, in the goal's genres, each title once. */
export function cardsFrom(
  content: Packs,
  deck: DeckKind,
  packIds: readonly string[],
  genres: readonly string[],
): Card[] {
  const chosen = new Set(packIds);
  const allowed = new Set(genres);
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const pack of parsed(content, KINDS[deck].cards)) {
    if (!chosen.has(pack.id)) continue;
    for (const card of pack.cards) {
      const key = wordKey(card.title);
      if (!allowed.has(card.genre) || seen.has(key)) continue;
      seen.add(key);
      out.push(card);
    }
  }
  return out;
}

/** The face-off categories of the chosen packs for a deck, each once. */
export function categoriesFrom(
  content: Packs,
  deck: DeckKind,
  packIds: readonly string[],
): Category[] {
  const chosen = new Set(packIds);
  const seen = new Set<string>();
  const out: Category[] = [];
  for (const pack of parsed(content, KINDS[deck].categories)) {
    if (!chosen.has(pack.id)) continue;
    for (const c of pack.categories) {
      const key = c.text.toLocaleLowerCase('en');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

const TIER_RANK: Record<Tier, number> = { easy: 0, medium: 1 };
/** Easiest first; an untiered card counts as medium. */
export const tierRank = (c: Pick<Card, 'tier'>) => TIER_RANK[c.tier ?? 'medium'];
