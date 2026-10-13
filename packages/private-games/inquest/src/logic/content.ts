/**
 * Inquest's cards and tiles, by number only. Names, item text and art live in the private
 * `inquest/manifest.json` in asset storage (`clue/<n>.webp`, `means/<n>.webp`, `tiles/<id>.webp`),
 * so the rules never need any I/O and the repository never holds a card name.
 */

export const CLUE_COUNT = 200;
export const MEANS_COUNT = 90;

const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

/** Clue cards 1–200 and Means cards 1–90. */
export const CLUE_CARDS: readonly number[] = range(1, CLUE_COUNT);
export const MEANS_CARDS: readonly number[] = range(1, MEANS_COUNT);

/** The Allies expansion's cards: Clue 201–289 and Means 91–144, shuffled in when it's on. */
export const ALLIES_CLUE_CARDS: readonly number[] = range(201, 89);
export const ALLIES_MEANS_CARDS: readonly number[] = range(91, 54);
/** The highest card number of either deck (the action schema's bound). */
export const MAX_CARD = 289;

/** Every tile has six items, numbered 0–5. */
export const ITEMS_PER_TILE = 6;

/** The Cause of Death tile: always on the table. */
export const CAUSE_TILE = 1;
/** The Location tiles: the Forensic Scientist picks one. */
export const LOCATION_TILES: readonly number[] = [2, 3, 4, 5];
/** The scene tiles: four start on the table, the rest form the draw pile. */
export const SCENE_TILES: readonly number[] = range(6, 21);
/** The Allies expansion's seven scene tiles, mixed into the pile when it's on. */
export const ALLIES_SCENE_TILES: readonly number[] = range(33, 7);
/** The Allies expansion's Location tile: with the Unknown Location variant it replaces the four. */
export const UNKNOWN_LOCATION_TILE = 40;
export const MAX_TILE = 41;

export const EVENT_KINDS = [
  'useful-clue',
  'good-twist',
  'ruled-out',
  'erroneous',
  'countdown',
  'testimony',
  'perfect-crime',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** The six base event tiles, 27–32, in `EVENT_KINDS` order, and the Allies expansion's 41. */
export const EVENT_TILES: Readonly<Record<EventKind, number>> = {
  'useful-clue': 27,
  'good-twist': 28,
  'ruled-out': 29,
  erroneous: 30,
  countdown: 31,
  testimony: 32,
  'perfect-crime': 41,
};

/** Events that only come with the Allies expansion. */
export const ALLIES_EVENTS: readonly EventKind[] = ['perfect-crime'];

export const eventOfTile = (tile: number): EventKind | null =>
  EVENT_KINDS.find((k) => EVENT_TILES[k] === tile) ?? null;

export const isSceneTile = (tile: number) =>
  SCENE_TILES.includes(tile) || ALLIES_SCENE_TILES.includes(tile);

/** Table slots: 0 is the Cause of Death, 1 the Location, 2–5 the scene tiles. */
export const SLOT_COUNT = 6;
export const CAUSE_SLOT = 0;
export const LOCATION_SLOT = 1;
export const SCENE_SLOTS: readonly number[] = [2, 3, 4, 5];

/** Card ids as the night recap names them: `clue-17`, `means-4` (the manifest has the names). */
export const clueKey = (n: number) => `clue-${n}`;
export const meansKey = (n: number) => `means-${n}`;
