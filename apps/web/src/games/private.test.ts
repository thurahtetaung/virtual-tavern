import { PLACEHOLDER_NAMES } from '@vt/private-hydra/logic';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateGames } from './private.ts';

/** Every back-room game's code name and listed name, which players may not know. */
const codeNames = privateGames.flatMap((g) => [g.id.replace(/-/g, ' '), g.name]);

describe('back-room plain guides', () => {
  // The plain guide shows until the manifest loads, or for good without asset storage.
  it.each(privateGames.map((g) => [g.id, g] as const))(
    "%s's tagline names no other game and no placeholder word",
    (id, game) => {
      const tagline = game.guide.tagline.toLowerCase();
      for (const other of codeNames.filter((n) => n !== game.name && n !== id))
        expect(tagline, `${id} names ${other}`).not.toContain(other.toLowerCase());
      expect(tagline).not.toMatch(/[{}]/);
      // Hydra's stand-in team and role words, which its editions rename.
      const { blue, red, leader, president, chancellor } = PLACEHOLDER_NAMES;
      for (const word of [blue, red, leader.replace(/^the /, ''), president, chancellor])
        expect(tagline).not.toContain(word.toLowerCase());
    },
  );

  it('every game with art in private storage has a named guide', () => {
    expect(privateGames.filter((g) => !g.namedGuide).map((g) => g.id)).toEqual(['hoodwink']);
  });
});

describe('named guides', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const serve = (manifests: Record<string, unknown>) =>
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const body = manifests[url.split('/').pop()!];
        return Promise.resolve(
          body ? new Response(JSON.stringify(body)) : new Response('', { status: 404 }),
        );
      }),
    );
  const named = (id: string) => privateGames.find((g) => g.id === id)!.namedGuide!();

  it("use the manifest's words in the tagline", async () => {
    serve({
      hydra: { names: { leader: 'the Archon' } },
      hogwarts: { guide: { tagline: 'Glows against Dusks.' } },
      reverie: { guide: { tagline: 'A dreamy tagline.' } },
    });
    expect((await named('hydra')).tagline).toContain('the Archon');
    expect((await named('hogwarts')).tagline).toBe('Glows against Dusks.');
    expect((await named('reverie')).tagline).toBe('A dreamy tagline.');
  });

  it('fall back to the plain guide without a manifest', async () => {
    serve({});
    const seance = privateGames.find((g) => g.id === 'seance')!;
    expect(await seance.namedGuide!()).toEqual(seance.guide);
  });
});
