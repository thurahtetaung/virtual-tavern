import { type ContentProvider, narrationLengths } from '@vt/game-sdk';
import { type GameRegistry, isPrivate } from './games/registry.ts';

/** How often a game's narration lengths are read again from its manifest. */
export const NARRATION_REFRESH_MS = 10 * 60_000;

/**
 * Each private game's narration-line lengths, from its manifest in asset storage, for the games
 * that time their night by the narrator (`ctx.content.narrationLengths`). Games read them
 * synchronously, so this answers from memory and reads the manifest again in the background when
 * the copy is missing or old: until the first read lands, a game gets null and keeps its plain
 * timing.
 */
export class NarrationLengths {
  private readonly known = new Map<
    string,
    { at: number; lengths: Record<string, number> | null }
  >();
  private readonly loading = new Set<string>();

  private readonly store: { json(key: string): Promise<unknown> };
  private readonly now: () => number;
  private readonly onError: (err: unknown, gameId: string) => void;

  constructor(
    store: { json(key: string): Promise<unknown> },
    now: () => number = Date.now,
    onError: (err: unknown, gameId: string) => void = () => {},
  ) {
    this.store = store;
    this.now = now;
    this.onError = onError;
  }

  /** The lengths for a game, as last read (null while unknown); reads again when due. */
  get(gameId: string): Record<string, number> | null {
    const hit = this.known.get(gameId);
    if (!hit || this.now() - hit.at >= NARRATION_REFRESH_MS) void this.load(gameId);
    return hit?.lengths ?? null;
  }

  /** Reads the game's manifest now (once at a time per game). */
  async load(gameId: string): Promise<void> {
    if (this.loading.has(gameId)) return;
    this.loading.add(gameId);
    try {
      const manifest = await this.store.json(`${gameId}/manifest.json`);
      this.known.set(gameId, { at: this.now(), lengths: narrationLengths(manifest) });
    } catch (err) {
      this.onError(err, gameId);
    } finally {
      this.loading.delete(gameId);
    }
  }
}

/** The per-room content, with each private game's narration lengths added. */
export function withNarration(
  content: { forGame(gameId: string): ContentProvider },
  games: GameRegistry,
  narration: NarrationLengths | null,
): { forGame(gameId: string): ContentProvider } {
  if (!narration) return content;
  return {
    forGame: (gameId) => {
      const base = content.forGame(gameId);
      return isPrivate(games.get(gameId))
        ? { ...base, narrationLengths: () => narration.get(gameId) }
        : base;
    },
  };
}
