/**
 * The cover fields any back-room game's private `manifest.json` may carry. The back-room lobby
 * shows `cover` in the game's card; a game without one shows its emoji emblem there instead.
 * Paths are inside the game's own asset folder (`/api/backroom/assets/<gameId>/<path>`).
 */
export interface ManifestCover {
  /** The cover cropped to 16:9 (800×450), e.g. `"cover.webp"`. */
  cover?: string;
  /** The whole cover at its own shape, for a larger view, e.g. `"cover-full.webp"`. */
  coverFull?: string;
  /** A mostly white cover, dimmed a little in dark mode only so it doesn't glare. */
  coverDarkDim?: boolean;
}
