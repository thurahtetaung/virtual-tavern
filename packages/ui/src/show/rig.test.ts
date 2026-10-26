import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The loader keeps module-level caches, so every test imports a fresh copy.
const load = () => import('./rig.ts');

const RIG = {
  fps: 30,
  stage: [1280, 720],
  symbols: { disc: '<image href="tex-disc.webp"/>', slab: '<path d="M0 0"/>' },
  tracks: {},
  places: {},
};

let fetched: string[];
let stored: Map<string, Response>;

beforeEach(() => {
  vi.resetModules();
  fetched = [];
  stored = new Map();
  vi.stubGlobal('fetch', (url: string) => {
    fetched.push(url);
    if (url.endsWith('.rig.json')) return Promise.resolve(new Response(JSON.stringify(RIG)));
    if (url.endsWith('missing.json')) return Promise.resolve(new Response('', { status: 404 }));
    return Promise.resolve(new Response('bytes'));
  });
  vi.stubGlobal('caches', {
    open: () =>
      Promise.resolve({
        match: (url: string) => Promise.resolve(stored.get(url)?.clone()),
        put: (url: string, res: Response) => {
          stored.set(url, res);
          return Promise.resolve();
        },
      }),
  });
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${++n}`);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rig loading', () => {
  it('fetches the rig and its textures once, from the game folder, into Cache Storage', async () => {
    const { loadRig } = await load();
    const rig = await loadRig('going-once', 'show/g.phone.rig.json');
    expect(rig?.textures).toEqual({ 'tex-disc.webp': 'blob:1' });
    expect(fetched).toEqual([
      '/api/backroom/assets/going-once/show/g.phone.rig.json',
      '/api/backroom/assets/going-once/show/tex-disc.webp',
    ]);
    expect([...stored.keys()]).toHaveLength(2);
    await loadRig('going-once', 'show/g.phone.rig.json');
    expect(fetched).toHaveLength(2);
  });

  it('reads a second visit from Cache Storage, downloading nothing', async () => {
    await (await load()).loadRig('going-once', 'show/g.phone.rig.json');
    vi.resetModules();
    fetched = [];
    const rig = await (await load()).loadRig('going-once', 'show/g.phone.rig.json');
    expect(rig).not.toBeNull();
    expect(fetched).toEqual([]);
  });

  it('answers null for a missing rig and asks again next time', async () => {
    const { loadRig } = await load();
    expect(await loadRig('g', 'show/missing.json')).toBeNull();
    await loadRig('g', 'show/missing.json');
    expect(fetched.filter((u) => u.endsWith('missing.json'))).toHaveLength(2);
  });

  it('prefetches only the phase asked for', async () => {
    const { prefetchShow } = await load();
    prefetchShow(
      'g',
      { rig: 'show/r.json', phases: { lobby: ['ui/a.webp'], end: ['ui/b.webp'] } },
      'lobby',
    );
    await vi.waitFor(() => expect(fetched).toEqual(['/api/backroom/assets/g/ui/a.webp']));
  });

  it('reads the manifest show block only when it is well formed', async () => {
    const { showFilesOf } = await load();
    const phone = { rig: 'show/p.json', phases: { auction: ['show/p.json'] } };
    expect(showFilesOf({ show: { phone } }, 'phone')).toBe(phone);
    expect(showFilesOf({ show: { phone } }, 'stage')).toBeUndefined();
    expect(showFilesOf({ show: { phone: { rig: 3 } } }, 'phone')).toBeUndefined();
    expect(showFilesOf(null, 'phone')).toBeUndefined();
  });
});
