import { escapeRegExp } from '@vt/game-sdk';
import { PLACEHOLDER_NAMES } from '@vt/private-hydra/logic';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateGames } from './private.ts';
import { clientGames } from './registry.ts';

/** Every back-room game's code name and listed name, which players may not know. */
const codeNames = privateGames.flatMap((g) => [g.id.replace(/-/g, ' '), g.name]);

describe('game emoji', () => {
  // The recap and the stats page tell games apart by them; 🍺 is the tavern's own, 🎲 the unknown.
  it('every game has its own, never the tavern’s or the fallback', () => {
    const icons = [...clientGames, ...privateGames].map((g) => g.icon);
    expect(new Set(icons).size).toBe(icons.length);
    expect(icons).not.toContain('🍺');
    expect(icons).not.toContain('🍻');
    expect(icons).not.toContain('🎲');
  });
});

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
    // The same words (its room hook is a fresh function, so compare what it says).
    expect(JSON.stringify(await seance.namedGuide!())).toBe(JSON.stringify(seance.guide));
  });
});

/**
 * Every name a manifest can give, as a made-up word («…»), so the test can tell whether any of
 * the plain guide's stand-in words survive in a named guide.
 */
describe('named guides use only the manifest’s words', () => {
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
  const named = async (id: string, manifest: unknown) => {
    serve({ [id]: manifest });
    // Each test gets fresh manifests (the page caches them by game).
    vi.resetModules();
    const { privateGames: games } = await import('./private.ts');
    return JSON.stringify(await games.find((g) => g.id === id)!.namedGuide!());
  };
  const all = <K extends string>(ids: readonly K[], value: (id: K) => unknown) =>
    Object.fromEntries(ids.map((id) => [id, value(id)]));
  const word = (w: string) => new RegExp(`(?<![\\w«-])${escapeRegExp(w)}(?![\\w»])`);

  it('Nightfall: roles, sets, Marks and artifacts', async () => {
    const nf = await import('@vt/private-nightfall/logic');
    const text = await named('nightfall', {
      roles: all(nf.ROLE_IDS, (id) => ({ name: `«${id}»`, text: `«text ${id}»` })),
      sets: all(nf.SET_IDS, (id) => ({ name: `«set ${id}»` })),
      marks: all(nf.MARK_IDS, (id) => ({ name: `«mark ${id}»` })),
      artifacts: all(nf.ARTIFACT_IDS, (id) => ({ name: `«artifact ${id}»` })),
    });
    // Team words (a Werewolf, the vampires) are rules words, not card names.
    const generic = new Set(['werewolf', 'vampire', 'alien']);
    for (const id of nf.ROLE_IDS.filter((r) => !generic.has(r)))
      expect(text, id).not.toMatch(word(nf.roleLabel(id)));
    for (const m of nf.MARK_IDS) expect(text, m).not.toContain(nf.markLabel(m));
    for (const s of ['Base set', 'Daybreak', 'Bonus pack 1', 'Bonus pack 2', 'Bonus pack 3'])
      expect(text, s).not.toContain(s);
    expect(text).toContain('«text seer»');
  });

  it('Inquest: event tiles and the Location tile', async () => {
    const { EVENT_NAMES } = await import('@vt/private-inquest/logic');
    const tiles: Record<string, unknown> = { '2': { title: '«location»' } };
    for (const n of [27, 28, 29, 30, 31, 32, 41]) tiles[String(n)] = { title: `«event ${n}»` };
    const text = await named('inquest', { tiles });
    for (const name of Object.values(EVENT_NAMES)) expect(text, name).not.toContain(name);
    expect(text).toContain('«location» tile');
  });

  it('Séance: the psychics', async () => {
    const colours = ['blue', 'white', 'red', 'yellow', 'purple', 'brown'];
    const text = await named('seance', {
      psychics: all(colours, (c) => ({ name: `«${c}»` })),
    });
    expect(text).not.toMatch(/\b(Blue|White|Red|Yellow|Purple|Brown) psychic/i);
    expect(text).not.toContain('(colour)');
    expect(text).toContain('«purple»');
  });

  it('Tavern Brawl: the heroes and their sets', async () => {
    const { HEROES, SETS } = await import('@vt/private-tavern-brawl/logic');
    const ids = Object.keys(HEROES) as (keyof typeof HEROES)[];
    const text = await named('tavern-brawl', {
      heroes: all(ids, (h) => ({ name: `«${h}»`, class: `«class ${h}»` })),
      sets: all(Object.keys(SETS), (id) => ({ name: `«set ${id}»` })),
    });
    expect(text).toContain('"subtitle":"«class mage»"');
    for (const h of ids) {
      expect(text, h).not.toMatch(word(HEROES[h].label));
      expect(text, h).not.toMatch(new RegExp(`the ${escapeRegExp(h)}\\b`, 'i'));
    }
    for (const { label } of Object.values(SETS)) expect(text, label).not.toContain(label);
    expect(text).toContain('«set x2»');
  });

  it('Short Fuse: card names, with a/an to fit them', async () => {
    const { PLACEHOLDER_CARDS } = await import('@vt/private-short-fuse/logic');
    const cards = all(Object.keys(PLACEHOLDER_CARDS), (t) => `«${t}»`);
    const text = await named('short-fuse', { names: { cards, bomb: 'Ember', bombs: 'Embers' } });
    for (const name of ['Cat A', 'Cat B', 'Cat E', 'Black Hole', 'Wild Cat', 'Peek (3)'])
      expect(text, name).not.toContain(name);
    expect(text).toContain('an Ember');
    expect(text).not.toMatch(/\ba Ember/);
  });

  it.each(['hydra', 'hogwarts'])('%s: teams, offices and powers', async (id) => {
    const { PLACEHOLDER_NAMES } = await import('@vt/private-hydra/logic');
    const names = all(Object.keys(PLACEHOLDER_NAMES), (k) => `«${k}»`);
    const powers = all(['investigate', 'special', 'peek', 'execute'], (p) => ({ name: `«${p}»` }));
    const text = await named(id, { names, powers });
    for (const w of ['Loyalist', 'Conspirator', 'Usurper', 'President', 'Chancellor'])
      expect(text, w).not.toMatch(word(w));
    for (const w of ['Investigate loyalty', 'Special election', 'Execution', 'investigate, peek'])
      expect(text, w).not.toContain(w);
    expect(text).not.toMatch(/\{\w+\}/);
  });
});
