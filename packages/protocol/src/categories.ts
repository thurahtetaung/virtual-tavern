import { z } from 'zod';

/**
 * Game categories: the filter chips on the game lists. They live only in the database: the admin
 * adds, renames, orders and deletes them and ticks each game's categories (`/tavern-keeper`, or
 * `scripts/set-game-categories.mjs`). With none set, the lists show no chips.
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

/** A game's categories on the admin page. */
export interface AdminGameCategories {
  gameId: string;
  /** A back-room game's admin-set title where there is one, else its name. */
  name: string;
  private: boolean;
  /** Category ids, in category order. */
  categories: string[];
}

export interface AdminCategoriesResponse {
  /** Every category, in the order the chips show them. */
  categories: GameCategoryDef[];
  games: AdminGameCategories[];
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

export const gameCategoriesBody = z.object({
  /** The game's category ids; empty takes it out of every category. */
  categories: z.array(categoryId).max(MAX_CATEGORIES),
});
export type GameCategoriesBody = z.infer<typeof gameCategoriesBody>;
