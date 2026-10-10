import { describe, expect, it } from 'vitest';
import { clientGames, offeredPrivateGames } from './registry.ts';

describe('offeredPrivateGames', () => {
  const known = [
    { ...clientGames[0]!, id: 'switched-off' },
    { ...clientGames[0]!, id: 'secret-game' },
  ];

  it('hides private games the server does not offer (e.g. the demo in production)', () => {
    expect(
      offeredPrivateGames([{ id: 'codenames' }, { id: 'enigma' }, { id: 'echo' }], known),
    ).toEqual([]);
  });

  it('shows only private games the server lists', () => {
    const offered = [{ id: 'codenames' }, { id: 'secret-game', private: true }];
    expect(offeredPrivateGames(offered, known).map((g) => g.id)).toEqual(['secret-game']);
  });
});
