import { z } from 'zod';

// Content packs: private content for back-room games that need more than word lists or question
// decks (Going Once's title groups and hint lines). A pack belongs to one game and one of the kinds
// that game declares (`contentPacks` on its definition), whose schema checks `data` on import. Packs
// live only in the server's database (imported with `scripts/import-content-pack.mjs`), are never
// committed, and no HTTP response carries their data except the admin detail and export.

export const contentPackBody = z.object({
  gameId: z.string().min(1).max(40),
  kind: z.string().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  data: z.unknown(),
  enabled: z.boolean().optional(),
});
export type ContentPackBody = z.input<typeof contentPackBody>;

/** Switches a pack on or off without resending its data. */
export const contentPackEnabledBody = z.object({ enabled: z.boolean() });

/** New data for an existing pack (same game, kind, name and id). */
export const contentPackDataBody = z.object({ data: z.unknown() });

/** A pack as the admin list shows it (no data). */
export interface ContentPackSummary {
  id: string;
  gameId: string;
  kind: string;
  name: string;
  enabled: boolean;
  /** Characters of JSON data. */
  size: number;
  /** Entries in the data (array length or key count). */
  entries: number;
  updatedAt: number;
}

export interface ContentPackDetail extends ContentPackSummary {
  data: unknown;
}
