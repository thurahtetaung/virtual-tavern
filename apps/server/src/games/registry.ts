import type { AnyGameDefinition } from '@vt/game-sdk';
import { codenames } from '@vt/game-codenames/logic';
import { echo } from '@vt/game-echo/logic';
import { enigma } from '@vt/game-enigma/logic';
import { hoodwink } from '@vt/private-hoodwink/logic';
import { reverie } from '@vt/private-reverie/logic';

export type GameRegistry = ReadonlyMap<string, AnyGameDefinition>;

/**
 * Every playable game. Add new games here (and in the web app's registry; private games go in
 * `apps/web/src/games/private.ts`).
 */
export function buildGames(): GameRegistry {
  const list: AnyGameDefinition[] = [codenames, enigma, echo, reverie, hoodwink];
  return new Map(list.map((g) => [g.id, g]));
}

export const isPrivate = (game: AnyGameDefinition | undefined) => game?.access === 'private';

/** Ids of the registered games that draw words from word lists, in registry order. */
export const wordListGameIds = (games: GameRegistry): string[] =>
  [...games.values()].filter((g) => g.usesWordLists).map((g) => g.id);

/** Ids of the registered games that draw questions from question decks, in registry order. */
export const questionDeckGameIds = (games: GameRegistry): string[] =>
  [...games.values()].filter((g) => g.usesQuestionDecks).map((g) => g.id);
