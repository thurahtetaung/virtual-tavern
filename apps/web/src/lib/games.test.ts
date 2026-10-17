import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGames, fetchWordLists, noteVersions, resetVersions } from './games.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  resetVersions();
});

describe('versioned lists', () => {
  it('ask for the version the page was given, and revalidate without one', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('[]')));
    vi.stubGlobal('fetch', fetch);
    await fetchGames();
    noteVersions({ games: 'g1', wordLists: 'w1' });
    await fetchGames();
    await fetchWordLists('codenames', 'w1');
    await fetchWordLists('codenames');
    // An unlock gives the page a new version, so a new URL the cache can't answer from.
    noteVersions({ games: 'g2' });
    await fetchGames();
    expect(fetch.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      '/api/games',
      '/api/games?v=g1',
      '/api/word-lists?game=codenames&v=w1',
      '/api/word-lists?game=codenames',
      '/api/games?v=g2',
    ]);
  });
});
