import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { seatLimit } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { buildGames, isPrivate } from './registry.ts';

const WEB_GAMES = new URL('../../../web/src/games/', import.meta.url);

/**
 * The ids a web registry file declares. The file is read rather than imported: its lazy UI
 * imports are React, which the server's TypeScript project cannot compile. Ids are either
 * literals (`id: 'codenames'`) or taken from the game's logic module (`id: reverie.id`).
 */
async function webGameIds(file: string): Promise<string[]> {
  const source = readFileSync(fileURLToPath(new URL(file, WEB_GAMES)), 'utf8');
  const ids: string[] = [];
  for (const [, literal, ref] of source.matchAll(/^\s+id:\s*(?:'([^']+)'|(\w+)\.id),/gm)) {
    if (literal) {
      ids.push(literal);
      continue;
    }
    const from = source.match(new RegExp(`import \\{[^}]*\\b${ref}\\b[^}]*\\} from '([^']+)'`));
    expect(from, `${file}: where ${ref} is imported from`).not.toBeNull();
    const mod = (await import(from![1]!)) as Record<string, { id: string }>;
    ids.push(mod[ref!]!.id);
  }
  expect(ids, `${file} declares games`).not.toHaveLength(0);
  return ids;
}

describe('game registries', () => {
  const server = buildGames();

  it('offer the same games on the server and in the web app', async () => {
    const publicIds = await webGameIds('registry.ts');
    const privateIds = await webGameIds('private.ts');
    const web = [...publicIds, ...privateIds].sort();
    expect([...server.keys()].sort()).toEqual(web);
    expect(new Set(web).size).toBe(web.length);
    for (const id of publicIds) expect(isPrivate(server.get(id)), `${id} is public`).toBe(false);
    for (const id of privateIds) expect(isPrivate(server.get(id)), `${id} is private`).toBe(true);
  });

  it('seat at most the room limit and at least the fewest who can play', () => {
    for (const game of server.values()) {
      expect(seatLimit(game), `${game.id} seats`).toBeLessThanOrEqual(game.maxPlayers);
      expect(seatLimit(game), `${game.id} seats`).toBeGreaterThanOrEqual(game.minPlayers);
    }
  });
});
