import { type GameRegistry, isPrivate } from '../games/registry.ts';
import { type PrivateGameSettings, effectiveMusic } from '../private-games.ts';
import type { R2Assets } from '../r2.ts';
import type { Lists } from './lists.ts';

/**
 * Back-room games' manifests as `/api/backroom/manifest/:gameId` sends them (the bucket's file
 * with the admin's music choices), and their versions for unlocked pages. A version comes only
 * from the server's short in-memory copy, so the room lookup and the status never wait on the
 * bucket; without one, the page asks for the plain URL, which revalidates.
 */
export class Manifests {
  private readonly opts: {
    games: GameRegistry;
    assets: R2Assets | null;
    privateGames?: PrivateGameSettings;
    lists: Lists;
  };
  constructor(opts: Manifests['opts']) {
    this.opts = opts;
  }

  /** The manifest to send, or null when the game has none. Callers check the gate first. */
  async body(gameId: string): Promise<unknown> {
    const manifest = await this.opts.assets?.json(`${gameId}/manifest.json`);
    return manifest === undefined || manifest === null ? null : this.merged(gameId, manifest);
  }

  /** The current version, if the manifest is in memory. Callers check the gate first. */
  cachedVersion(gameId: string): string | undefined {
    const manifest = this.opts.assets?.cachedJson(`${gameId}/manifest.json`);
    if (manifest === undefined || manifest === null) return undefined;
    return this.opts.lists.version(this.merged(gameId, manifest));
  }

  /** Reads the manifest into memory in the background, ahead of the page asking for it. */
  warm(gameId: string): void {
    this.body(gameId).catch(() => {});
  }

  /** The versions of every back-room game's manifest in memory. Callers check the gate first. */
  versions(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const game of this.opts.games.values()) {
      if (!isPrivate(game)) continue;
      const v = this.cachedVersion(game.id);
      if (v) out[game.id] = v;
    }
    return out;
  }

  /** The admin's music choices replace the manifest's defaults, phase by phase. */
  private merged(gameId: string, manifest: unknown): unknown {
    const override = this.opts.privateGames?.music(gameId) ?? null;
    if (override && typeof manifest === 'object' && !Array.isArray(manifest)) {
      const m = manifest as { music?: unknown };
      return { ...m, music: effectiveMusic(m.music, override) };
    }
    return manifest;
  }
}
