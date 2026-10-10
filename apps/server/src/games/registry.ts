import type { AnyGameDefinition } from '@vt/game-sdk';
import { codenames } from '@vt/game-codenames/logic';
import { enigma } from '@vt/game-enigma/logic';
import { reverie } from '@vt/private-reverie/logic';

export type GameRegistry = ReadonlyMap<string, AnyGameDefinition>;

/**
 * Every playable game. Add new games here (and in the web app's registry; private games go in
 * `apps/web/src/games/private.ts`).
 */
export function buildGames(): GameRegistry {
  const list: AnyGameDefinition[] = [codenames, enigma, reverie];
  return new Map(list.map((g) => [g.id, g]));
}

export const isPrivate = (game: AnyGameDefinition | undefined) => game?.access === 'private';

/** Ids of the registered games that draw words from word lists, in registry order. */
export const wordListGameIds = (games: GameRegistry): string[] =>
  [...games.values()].filter((g) => g.usesWordLists).map((g) => g.id);
