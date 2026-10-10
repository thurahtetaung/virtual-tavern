import type { AnyGameDefinition } from '@vt/game-sdk';
import { codenames } from '@vt/game-codenames/logic';
import { enigma } from '@vt/game-enigma/logic';

/** Every playable game. Add new games here (and in the web app's registry). */
export const games: ReadonlyMap<string, AnyGameDefinition> = new Map(
  [codenames, enigma].map((g) => [g.id, g]),
);
