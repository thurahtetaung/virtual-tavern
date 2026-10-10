import type { AnyGameDefinition } from '@vt/game-sdk';
import { codenames } from '@vt/game-codenames/logic';
import { enigma } from '@vt/game-enigma/logic';
import { peek } from '@vt/private-demo/logic';

export type GameRegistry = ReadonlyMap<string, AnyGameDefinition>;

/**
 * Every playable game. Add new games here (and in the web app's registry; private games go in
 * `apps/web/src/games/private.ts`). The Peek demo is a private test game, never enabled in production.
 */
export function buildGames(opts: { demoPrivateGame?: boolean } = {}): GameRegistry {
  const list: AnyGameDefinition[] = [codenames, enigma];
  if (opts.demoPrivateGame) list.push(peek);
  return new Map(list.map((g) => [g.id, g]));
}

export const isPrivate = (game: AnyGameDefinition | undefined) => game?.access === 'private';
