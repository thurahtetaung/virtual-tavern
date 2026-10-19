import { z } from 'zod';

/**
 * Per-game settings (on/off, categories, a back-room title, music) and the game categories, the
 * filter chips on the game lists. They live only in the database: the admin edits them on the
 * Games page (`/tavern-keeper/games`) or with `scripts/set-game-title.mjs` and
 * `scripts/set-game-categories.mjs`. With no categories set, the lists show no chips.
 */
export interface GameCategoryDef {
  id: string;
  name: string;
  emoji: string;
}

/**
 * A category as a game list sends it: `order` is its place among the categories this viewer's
 * games use (so chips keep the admin's order without hinting at categories the viewer can't see).
 */
export interface GameCategory extends GameCategoryDef {
  order: number;
}

/** A phase a game plays music in (`GameDefinition.music`), as the admin page names it. */
export interface MusicPhase {
  id: string;
  label: string;
}

/** The admin's music choice: track paths (the manifest's `musicTracks.*.file`) per phase id. */
export type MusicMap = Record<string, string[]>;

/**
 * One game's settings, as the admin edits them. Fields that don't apply to a game are absent:
 * `title` only for back-room games, `music` only for games that play music.
 */
export interface GameSettings {
  /** On by default; off hides the game from the lists and refuses new rooms. */
  enabled: boolean;
  /** Category ids, in category order. */
  categories: string[];
  /** A back-room game's title for unlocked players (null: its code name). */
  title?: string | null;
  /** The admin's per-phase music, replacing the manifest's defaults (null: the defaults). */
  music?: MusicMap | null;
}

/** A game on the admin's Games page. */
export interface AdminGame {
  gameId: string;
  /** The game's code name. */
  name: string;
  private: boolean;
  settings: GameSettings;
  /** The phases it plays music in, for games with music. */
  musicPhases?: MusicPhase[];
}

export interface AdminGamesResponse {
  /** Every category, in the order the chips show them. */
  categories: GameCategoryDef[];
  games: AdminGame[];
}

/** A game's music on the admin page: the manifest's defaults and tracks, and what plays. */
export interface AdminGameMusic {
  override: MusicMap | null;
  defaults: MusicMap | null;
  effective: MusicMap | null;
  tracks: Record<string, { name?: string; file: string; duration?: number }> | null;
}

export const MAX_CATEGORY_NAME = 24;
export const MAX_CATEGORIES = 40;

export const categoryId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Category ids are lowercase words joined by hyphens.')
  .max(32, 'Category ids are at most 32 characters.');

export const categoryName = z
  .string()
  .trim()
  .min(1, 'Give the category a name.')
  .max(MAX_CATEGORY_NAME, `Category names are at most ${MAX_CATEGORY_NAME} characters.`);

/** One emoji (a few code points at most: flags, skin tones and joined emoji included). */
export const categoryEmoji = z
  .string()
  .trim()
  .min(1, 'Pick an emoji.')
  .max(16, 'Pick one emoji.')
  .refine((s) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s) && !/\s/u.test(s), {
    message: 'Pick one emoji.',
  });

export const categoryBody = z.object({ name: categoryName, emoji: categoryEmoji });
export type CategoryBody = z.infer<typeof categoryBody>;

/** A new category; without an `id`, one is made from its name. */
export const newCategoryBody = categoryBody.extend({ id: categoryId.optional() });
export type NewCategoryBody = z.infer<typeof newCategoryBody>;

export const categoryOrderBody = z.object({
  /** Every category id, in the new order. */
  ids: z.array(categoryId).max(MAX_CATEGORIES),
});

const trackPath = z.string().min(1).max(200);

/** A change to one game's settings: only the fields sent change. */
export const gameSettingsBody = z
  .object({
    enabled: z.boolean(),
    /** Category ids; empty takes the game out of every category. */
    categories: z.array(categoryId).max(MAX_CATEGORIES),
    /** Back-room games only; null or empty clears it. */
    title: z.string().trim().max(80, 'Titles are at most 80 characters.').nullable(),
    /** Games with music only; a missing phase plays the manifest's default, null clears all. */
    music: z.record(z.string().max(32), z.array(trackPath).max(40)).nullable(),
  })
  .partial()
  .strict();
export type GameSettingsBody = z.infer<typeof gameSettingsBody>;
