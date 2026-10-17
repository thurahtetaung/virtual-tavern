import { createHash } from 'node:crypto';
import type { GameSummary } from '@vt/protocol';
import type { FastifyRequest } from 'fastify';
import { type GameRegistry, isPrivate } from '../games/registry.ts';
import type { WordListRepo } from '../word-lists.ts';

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
  /** Admin-set titles for private games, sent only to unlocked browsers. */
  titles?: { title(gameId: string): string | null };
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
    const title = this.opts.titles?.title(gameId);
    return title ? { title } : {};
  }

  /** Private games behave as if they don't exist for anyone without the back room. */
  visible(req: FastifyRequest, gameId: string): boolean {
    const game = this.opts.games.get(gameId);
    return !!game && (!isPrivate(game) || this.opts.hasBackroom(req));
  }

  games(req: FastifyRequest): GameSummary[] {
    return [...this.opts.games.values()]
      .filter((g) => this.visible(req, g.id))
      .map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        minPlayers: g.minPlayers,
        maxPlayers: g.maxPlayers,
        private: g.access === 'private',
        wordLists: g.usesWordLists === true,
        questionDecks: g.usesQuestionDecks === true,
        ...this.titleOf(g.id),
      }));
  }

  /** The enabled lists, or only those `gameId` offers. */
  wordLists(gameId?: string) {
    return this.opts.wordLists.listEnabled(gameId);
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

  wordListsVersion(gameId?: string): string {
    return this.version(this.wordLists(gameId));
  }
}
