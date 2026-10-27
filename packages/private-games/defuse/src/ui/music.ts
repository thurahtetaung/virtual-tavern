/**
 * When the bomb's music changes, as the original's `GameplayMusicController` and post-game state
 * time it. Pure, so a simulated clock can play a whole bomb through it.
 */

/** The last section takes over (cut in at once) for the final 30 s of the bomb's clock. */
export const LAST_SECTION_MS = 30_000;
/** The stinger plays once, this long (in bomb time, so faster after strikes) before the last 30 s. */
export const STINGER_MS = 7_000;
/** The win and lose music start after the original's fades: 6 + 3 + 1 s defused, 0 + 0 + 4 s otherwise. */
export const WIN_MUSIC_AFTER_MS = 10_000;
export const LOSE_MUSIC_AFTER_MS = 4_000;

export interface Section {
  /** The playlist's clip to play. */
  index: number;
  /** Cut in now (the last section) rather than after the clip that is playing. */
  now: boolean;
}

/**
 * The section for `left` of `total` on a playlist of `length` clips. The first clip opens the bomb
 * and the next ones queue behind it as the time left falls; the last is kept for the final 30 s.
 */
export function musicSection(left: number, total: number, length: number): Section {
  if (length <= 1) return { index: 0, now: false };
  if (left < LAST_SECTION_MS) return { index: length - 1, now: true };
  const raw = Math.trunc(length - (left / total) * (length - 1));
  return { index: Math.min(length - 2, Math.max(0, raw)), now: false };
}

/** Whether the stinger is due at `left` with the clock's `rate`. */
export const stingerDue = (left: number, rate: number) =>
  left < LAST_SECTION_MS + STINGER_MS * rate;

/** The end's sound and when its music starts. */
export function endCues(end: { how: 'defused' | 'strikes' | 'time'; at: number }) {
  const defused = end.how === 'defused';
  return {
    effects: defused ? (['bomb-defused', 'gameover-fanfare'] as const) : (['explode'] as const),
    music: defused ? 'gameover-win' : 'gameover-lose',
    musicAt: end.at + (defused ? WIN_MUSIC_AFTER_MS : LOSE_MUSIC_AFTER_MS),
  };
}
