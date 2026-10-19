import { createHash } from 'node:crypto';
import type { GameSummary } from '@vt/protocol';
import type { FastifyRequest } from 'fastify';
import { type GameRegistry, isPrivate } from '../games/registry.ts';
import type { WordListRepo } from '../word-lists.ts';
import type { GameSettingsStore } from '../game-settings.ts';

/**
 * The game list and the word lists, as `/api/games` and `/api/word-lists` send them, with a
 * version of each: a hash of the build and the exact JSON this request would get. Every change
 * (an admin edit, a title, an unlock or lock, a deploy) is a new version, so the browser may keep
 * a versioned URL for a day. The versions ride on responses every page load fetches anyway (the
 * back-room status, the room lookup, the admin session).
 */
export interface ListsOptions {
  games: GameRegistry;
  wordLists: WordListRepo;
  /** Whether this request has the back room: a current unlock, or a current admin session. */
  hasBackroom: (req: FastifyRequest) => boolean;
  /**
   * The admin's game settings: private games' titles (sent only to unlocked browsers), on/off
   * and categories. Without it every game is on, with no categories.
   */
  settings?: Pick<GameSettingsStore, 'title' | 'enabled' | 'categoriesFor'>;
  /** The build (`APP_VERSION`), so a deploy is a new version too. */
  build: string;
}

export class Lists {
  private readonly opts: ListsOptions;
  constructor(opts: ListsOptions) {
    this.opts = opts;
  }

  /** A private game's title from the database; it only goes where the game itself is visible. */
  titleOf(gameId: string): { title?: string } {
    if (!isPrivate(this.opts.games.get(gameId))) return {};
    const title = this.opts.settings?.title(gameId);
    return title ? { title } : {};
  }

  /** Private games behave as if they don't exist for anyone without the back room. */
  visible(req: FastifyRequest, gameId: string): boolean {
    const game = this.opts.games.get(gameId);
    return !!game && (!isPrivate(game) || this.opts.hasBackroom(req));
  }

  /** Whether the admin has left the game on (new rooms may open). */
  enabled(gameId: string): boolean {
    return this.opts.settings?.enabled(gameId) ?? true;
  }

  games(req: FastifyRequest): GameSummary[] {
    const games = [...this.opts.games.values()].filter((g) => this.visible(req, g.id));
    // Only the categories of the games this browser can play: a locked browser learns nothing of
    // back-room games, and a game that is off adds no chip.
    const on = games.filter((g) => this.enabled(g.id)).map((g) => g.id);
    const categories = this.opts.settings?.categoriesFor(on);
    return games.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      minPlayers: g.minPlayers,
      maxPlayers: g.maxPlayers,
      private: g.access === 'private',
      wordLists: g.usesWordLists === true,
      questionDecks: g.usesQuestionDecks === true,
      ...this.titleOf(g.id),
      categories: categories?.get(g.id) ?? [],
      ...(!this.enabled(g.id) && { off: true as const }),
    }));
  }

  /**
   * The enabled lists, or only those `gameId` offers, as this request may see them. Without the
   * back room a private game's lists don't exist: asking for its lists gets none, a list made
   * only for back-room games is left out, and other lists never name a back-room game.
   */
  wordLists(req: FastifyRequest, gameId?: string) {
    if (gameId !== undefined && !this.visible(req, gameId)) return [];
    const lists = this.opts.wordLists.listEnabled(gameId);
    if (this.opts.hasBackroom(req)) return lists;
    return lists.flatMap((l) => {
      const games = l.games.filter((id) => !isPrivate(this.opts.games.get(id)));
      return games.length ? [{ ...l, games }] : [];
    });
  }

  version(body: unknown): string {
    return createHash('sha256')
      .update(`${this.opts.build}\n${JSON.stringify(body)}`)
      .digest('base64url')
      .slice(0, 16);
  }

  gamesVersion(req: FastifyRequest): string {
    return this.version(this.games(req));
  }

  wordListsVersion(req: FastifyRequest, gameId?: string): string {
    return this.version(this.wordLists(req, gameId));
  }
}
