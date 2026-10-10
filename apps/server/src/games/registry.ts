import type { AnyGameDefinition } from '@vt/game-sdk';
import { codenames } from '@vt/game-codenames/logic';

/** Every playable game. Add new games here (and in the web app's registry). */
export const games: ReadonlyMap<string, AnyGameDefinition> = new Map(
  [codenames].map((g) => [g.id, g]),
);
