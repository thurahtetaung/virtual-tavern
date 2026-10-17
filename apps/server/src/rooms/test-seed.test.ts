import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config.ts';
import { openDb } from '../db/index.ts';
import { buildGames } from '../games/registry.ts';
import { MIGRATIONS, connect, testApp, token } from '../test/helpers.ts';
import { WordListRepo } from '../word-lists.ts';
import { RoomManager } from './manager.ts';
import { SqliteRoomStore } from './store.ts';
import { TEST_SEED_HEADER, TestSeeds } from './test-seed.ts';

const games = buildGames();

function manager(testSeeds: TestSeeds | null) {
  const db = openDb(':memory:', MIGRATIONS);
  const content = new WordListRepo(db);
  content.seedIfEmpty();
  return new RoomManager({
    store: new SqliteRoomStore(db),
    games,
    content,
    events: { changed: vi.fn(), kicked: vi.fn() },
    logger: { warn: vi.fn(), error: vi.fn() },
    testSeeds,
  });
}

/** A started Codenames game; what the deal, the colours and the first team came out as. */
function play(rooms: RoomManager, testSeed?: string) {
  const id = rooms.create('codenames', 'h', testSeed ? { testSeed } : {});
  for (const p of ['h', 'a', 'b', 'c']) rooms.join(id, p, p.toUpperCase());
  rooms.act(id, 'h', { type: 'join-team', team: 'red', role: 'spymaster' });
  rooms.act(id, 'a', { type: 'join-team', team: 'red', role: 'operative' });
  rooms.act(id, 'b', { type: 'join-team', team: 'blue', role: 'spymaster' });
  rooms.act(id, 'c', { type: 'join-team', team: 'blue', role: 'operative' });
  rooms.act(id, 'h', { type: 'start' });
  const snap = rooms.snapshot(id, 'h')!;
  // Word list ids are new in every database.
  const { settings: _, ...game } = snap.game as { settings: unknown };
  return { id, colors: snap.players.map((p) => p.color), game };
}

describe('test seeds', () => {
  it('replays a room from its seed, whatever else the server did first', () => {
    const one = manager(new TestSeeds('base'));
    const other = manager(new TestSeeds('base'));
    // Other rooms opened in between (as parallel specs do) draw nothing from this one's seed.
    play(other, 'noise');
    play(other);
    const a = play(one, 'spec-1');
    const b = play(other, 'spec-1');
    expect(b.colors).toEqual(a.colors);
    expect(b.game).toEqual(a.game);
    expect(play(one, 'spec-2').game).not.toEqual(a.game);
  });

  it('derives a room without its own seed from the base seed and the room id', () => {
    const seeds = new TestSeeds('base');
    expect(seeds.draw('room-a', 'game:1')).toBe(new TestSeeds('base').draw('room-a', 'game:1'));
    expect(seeds.draw('room-a', 'game:1')).not.toBe(seeds.draw('room-b', 'game:1'));
    expect(seeds.draw('room-a', 'game:1')).not.toBe(seeds.draw('room-a', 'game:2'));
    expect(seeds.draw('room-a', 'game:1')).not.toBe(
      new TestSeeds('other').draw('room-a', 'game:1'),
    );
    // An asked-for seed stands alone: neither the base seed nor the room id changes it.
    const other = new TestSeeds('other');
    seeds.assign('room-a', 'mine');
    other.assign('room-z', 'mine');
    expect(seeds.draw('room-a', 'game:1')).toBe(other.draw('room-z', 'game:1'));
  });

  it('keeps rooms random without test seeds', () => {
    const rooms = manager(null);
    const deals = Array.from({ length: 4 }, () => JSON.stringify(play(rooms, 'spec-1').game));
    expect(new Set(deals).size).toBeGreaterThan(1);
  });

  it('reads VT_TEST_SEED, but never in production', () => {
    expect(loadConfig({}).testSeed).toBeNull();
    expect(loadConfig({ VT_TEST_SEED: ' e2e ' }).testSeed).toBe('e2e');
    expect(loadConfig({ VT_TEST_SEED: 'e2e', NODE_ENV: 'production' }).testSeed).toBeNull();
  });

  describe('over HTTP', () => {
    let close: (() => Promise<unknown>) | undefined;
    afterEach(async () => {
      await close?.();
      close = undefined;
    });

    /** Opens a room asking for `seed` and returns the colour its first joiner gets. */
    async function firstColor(testSeed: string | null) {
      const app = testApp({ testSeed });
      close = () => app.close();
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address();
      const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
      const colors = [];
      for (let i = 0; i < 6; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers: { [TEST_SEED_HEADER]: 'spec-1' },
          payload: { gameId: 'codenames', token: token(i) },
        });
        const { roomId } = res.json<{ roomId: string }>();
        const client = await connect(url);
        await client.call('room:join', { roomId, token: token(i), name: 'Ana' });
        colors.push((await client.until((s) => s.players.length === 1)).players[0]!.color);
        client.close();
      }
      await app.close();
      close = undefined;
      return colors;
    }

    it('seeds a room from the header only in a test build', async () => {
      const seeded = await firstColor('base');
      expect(new Set(seeded).size).toBe(1);
      expect(await firstColor('base')).toEqual(seeded);
      // Six rooms all getting one colour out of sixteen by chance is about one in a million.
      expect(new Set(await firstColor(null)).size).toBeGreaterThan(1);
    });
  });
});
