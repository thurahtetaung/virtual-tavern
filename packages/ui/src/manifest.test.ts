import { afterEach, describe, expect, it, vi } from 'vitest';

/** A fresh copy of the module, as a new page load would have. */
async function page() {
  vi.resetModules();
  return import('./manifest.ts');
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadManifest', () => {
  it('asks once per game per page, however many readers', async () => {
    const fetch = vi.fn((url: string) => json({ game: url.split('/').pop() }));
    vi.stubGlobal('fetch', fetch);
    const { loadManifest } = await page();
    const [a, b] = await Promise.all([loadManifest('reverie'), loadManifest('reverie')]);
    expect(await loadManifest('reverie')).toBe(a);
    expect(b).toBe(a);
    expect(a).toEqual({ game: 'reverie' });
    expect(await loadManifest('nightfall')).toEqual({ game: 'nightfall' });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/backroom/manifest/reverie',
      '/api/backroom/manifest/nightfall',
    ]);

    // The next page load asks again (and the browser revalidates with the ETag).
    const next = await page();
    await next.loadManifest('reverie');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('is null without a manifest, and asks again after a dropped connection', async () => {
    const fetch = vi
      .fn<(url: string) => Promise<Response>>()
      .mockImplementationOnce(() => json({ error: {} }, 404))
      .mockImplementationOnce(() => Promise.reject(new TypeError('offline')))
      .mockImplementationOnce(() => json({ back: 'b.jpg' }));
    vi.stubGlobal('fetch', fetch);
    const { loadManifest } = await page();
    expect(await loadManifest('reverie')).toBeNull();
    expect(await loadManifest('reverie')).toBeNull();
    expect(await loadManifest('inquest')).toBeNull();
    expect(await loadManifest('inquest')).toEqual({ back: 'b.jpg' });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('asks for the version the page was given, and the plain URL without one', async () => {
    const fetch = vi.fn(() => json({}));
    vi.stubGlobal('fetch', fetch);
    const { loadManifest, noteManifestVersions } = await page();
    noteManifestVersions({ reverie: 'abc' });
    await loadManifest('reverie');
    await loadManifest('nightfall');
    expect(fetch.mock.calls.map((c: unknown[]) => c[0])).toEqual([
      '/api/backroom/manifest/reverie?v=abc',
      '/api/backroom/manifest/nightfall',
    ]);
  });
});

describe('coverOf', () => {
  it("names the cover in the game's own asset folder", async () => {
    const { coverOf } = await page();
    expect(coverOf('reverie', { cover: 'cover.webp' })).toEqual({
      src: '/api/backroom/assets/reverie/cover.webp',
    });
    expect(coverOf('iconic', { cover: 'box/cover.webp', coverDarkDim: true })).toEqual({
      src: '/api/backroom/assets/iconic/box/cover.webp',
      dimInDark: true,
    });
  });

  it('has none without a manifest, a cover, or with a path outside the folder', async () => {
    const { coverOf } = await page();
    expect(coverOf('reverie', null)).toBeNull();
    expect(coverOf('reverie', { title: 'x' })).toBeNull();
    expect(coverOf('reverie', { cover: 42 })).toBeNull();
    for (const cover of [
      '',
      '/cover.webp',
      '../nightfall/cover.webp',
      'a/../b.webp',
      'https://x/y',
    ])
      expect(coverOf('reverie', { cover })).toBeNull();
  });
});
