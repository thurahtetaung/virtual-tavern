import type { CodenamesView } from '@vt/game-codenames/logic';
import type { EchoView } from '@vt/game-echo/logic';
import type { EnigmaView } from '@vt/game-enigma/logic';
import type { MasqueradeView } from '@vt/game-masquerade/logic';
import type { RoomSnapshot } from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { playerIdFromToken } from './rooms/ids.ts';
import type { RoyalPostView } from '@vt/private-royal-post/logic';
import { type TestClient, bareRealtime, connect, tempDb, testApp, token } from './test/helpers.ts';
import { playNightfall } from './test/nightfall.ts';
import { playRoyalPostTurn, royalPostView } from './test/royal-post.ts';

const view = (s: RoomSnapshot) => s.game as CodenamesView;

describe('realtime rooms', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  async function start(databasePath: string) {
    const app = testApp({ databasePath });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    return { app, url };
  }

  async function joinAll(url: string, roomId: string, names: string[]) {
    const clients: TestClient[] = [];
    for (const [i, name] of names.entries()) {
      const c = await connect(url);
      cleanups.push(() => void c.close());
      expect(await c.call('room:join', { roomId, token: token(i), name })).toEqual({ ok: true });
      clients.push(c);
    }
    await Promise.all(clients.map((c) => c.until((s) => s.players.length === names.length)));
    return clients;
  }

  it('plays a game across a server restart without losing state', async () => {
    const db = tempDb();
    cleanups.push(db.cleanup);
    let server = await start(db.path);
    const { roomId } = (
      await server.app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'codenames', token: token(0) },
      })
    ).json<{ roomId: string }>();

    const names = ['Host', 'Ana', 'Ben', 'Cy'];
    let [host, ana, ben, cy] = await joinAll(server.url, roomId, names);
    expect(host!.latest()!.hostId).toBe(host!.latest()!.you);
    expect(host!.latest()!.players.every((p) => p.connected)).toBe(true);

    expect(await ana!.call('game:action', { type: 'start' })).toMatchObject({
      ok: false,
      error: { code: 'not-host' },
    });
    expect(await host!.call('game:action', { type: 'explode' })).toMatchObject({
      ok: false,
      error: { code: 'bad-action' },
    });

    await host!.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
    await ana!.call('game:action', { type: 'join-team', team: 'red', role: 'operative' });
    await ben!.call('game:action', { type: 'join-team', team: 'blue', role: 'spymaster' });
    await cy!.call('game:action', { type: 'join-team', team: 'blue', role: 'operative' });
    expect(await host!.call('game:action', { type: 'start' })).toEqual({ ok: true });

    const hostView = view(await host!.until((s) => view(s).phase === 'playing'));
    const anaView = view(await ana!.until((s) => view(s).phase === 'playing'));
    expect(hostView.board.every((c) => c.kind !== null)).toBe(true);
    expect(anaView.board.every((c) => c.kind === null)).toBe(true);

    const first = hostView.turn!.team;
    const [spy, op] = first === 'red' ? [host!, ana!] : [ben!, cy!];
    expect(await spy.call('game:action', { type: 'give-clue', word: 'hint', count: 1 })).toEqual({
      ok: true,
    });
    await op.until((s) => view(s).turn?.stage === 'guess');

    // Restart the server mid-turn.
    for (const c of [host, ana, ben, cy]) c!.close();
    await server.app.close();
    server = await start(db.path);
    cleanups.push(() => server.app.close());
    [host, ana, ben, cy] = await joinAll(server.url, roomId, names);

    const resumed = view(host!.latest()!);
    expect(resumed).toMatchObject({ phase: 'playing', turn: { team: first, stage: 'guess' } });
    expect(resumed.board.map((c) => c.word)).toEqual(hostView.board.map((c) => c.word));

    const assassin = view(host!.latest()!).board.findIndex((c) => c.kind === 'assassin');
    const opAfter = first === 'red' ? ana! : cy!;
    expect(await opAfter.call('game:action', { type: 'guess', card: assassin })).toEqual({
      ok: true,
    });
    const over = view(await ben!.until((s) => view(s).phase === 'over'));
    expect(over.winner).toBe(first === 'red' ? 'blue' : 'red');
  });

  it('tracks presence, kicks, and hands over hosting', async () => {
    const db = tempDb();
    cleanups.push(db.cleanup);
    const server = await start(db.path);
    cleanups.push(() => server.app.close());
    const { roomId } = (
      await server.app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'codenames', token: token(0) },
      })
    ).json<{ roomId: string }>();
    const [host, ana, ben] = await joinAll(server.url, roomId, ['Host', 'Ana', 'Ben']);
    const anaId = ana!.latest()!.you;
    const benId = ben!.latest()!.you;

    ben!.close();
    await host!.until((s) => s.players.find((p) => p.id === benId)?.connected === false);

    expect(await ana!.call('room:kick', benId)).toMatchObject({
      ok: false,
      error: { code: 'not-host' },
    });
    const kicked = new Promise<void>((resolve) => host!.once('room:kicked', () => resolve()));
    await host!.call('room:make-host', anaId);
    await host!.until((s) => s.hostId === anaId);
    await ana!.call('room:kick', host!.latest()!.you);
    await kicked;
    await ana!.until((s) => s.players.length === 2);

    expect(await ana!.call('room:rename', 'Anabel')).toEqual({ ok: true });
    const renamed = await ana!.until((s) => s.players.some((p) => p.name === 'Anabel'));
    expect(renamed.players.map((p) => p.name)).toEqual(['Anabel', 'Ben']);
  });

  it('keeps a socket in its room when a later join fails, and moves it when one succeeds', async () => {
    const server = await start(':memory:');
    cleanups.push(() => server.app.close());
    const create = async () =>
      (
        await server.app.inject({
          method: 'POST',
          url: '/api/rooms',
          payload: { gameId: 'codenames', token: token(0) },
        })
      ).json<{ roomId: string }>().roomId;
    const roomA = await create();
    const roomB = await create();
    const [host, ana] = await joinAll(server.url, roomA, ['Host', 'Ana']);
    const anaId = ana!.latest()!.you;

    expect(
      await ana!.call('room:join', { roomId: 'amber-fox-owl-0000', token: token(1), name: 'Ana' }),
    ).toMatchObject({ ok: false, error: { code: 'no-room' } });
    // Still a connected member of room A, and still receiving its snapshots.
    await host!.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
    const seen = view(await ana!.until((s) => view(s).seats.some((seat) => seat.team === 'red')));
    expect(seen).toBeDefined();
    expect(host!.latest()!.players.find((p) => p.id === anaId)).toMatchObject({ connected: true });
    expect(
      await ana!.call('game:action', { type: 'join-team', team: 'blue', role: 'operative' }),
    ).toEqual({ ok: true });

    expect(await ana!.call('room:join', { roomId: roomB, token: token(1), name: 'Ana' })).toEqual({
      ok: true,
    });
    await ana!.until((s) => s.id === roomB);
    await host!.until((s) => s.players.find((p) => p.id === anaId)?.connected === false);
  });

  it('sends every tab of a player the same snapshot', async () => {
    const server = await start(':memory:');
    cleanups.push(() => server.app.close());
    const { roomId } = (
      await server.app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'codenames', token: token(0) },
      })
    ).json<{ roomId: string }>();
    const [host] = await joinAll(server.url, roomId, ['Host']);
    const tab = await connect(server.url);
    cleanups.push(() => void tab.close());
    expect(await tab.call('room:join', { roomId, token: token(0), name: 'Host' })).toEqual({
      ok: true,
    });
    await host!.call('game:action', { type: 'join-team', team: 'blue', role: 'spymaster' });
    const inTab = await tab.until((s) => view(s).seats.some((seat) => seat.team === 'blue'));
    const inHost = await host!.until((s) => view(s).seats.some((seat) => seat.team === 'blue'));
    expect(inTab.players).toEqual(inHost.players);
    expect(inTab.players).toHaveLength(1);
    expect(inTab.you).toBe(inHost.you);
  });

  it('rate-limits chatty sockets and drops persistent flooders', async () => {
    const server = await bareRealtime({ limits: { perSecond: 1, burst: 2, disconnectAfter: 3 } });
    cleanups.push(server.close);
    const roomId = server.rooms.create('codenames', playerIdFromToken(token(0)));
    const c = await connect(server.url);
    cleanups.push(() => void c.close());
    const dropped = new Promise<string>((resolve) => c.once('disconnect', resolve));

    expect(await c.call('room:join', { roomId, token: token(0), name: 'Host' })).toEqual({
      ok: true,
    });
    expect(await c.call('room:rename', 'Hosty')).toEqual({ ok: true });
    expect(await c.call('room:rename', 'Hostess')).toMatchObject({
      ok: false,
      error: { code: 'rate-limited' },
    });
    expect(await c.call('game:action', { type: 'start' })).toMatchObject({
      ok: false,
      error: { code: 'rate-limited' },
    });
    void c.call('room:kick', 'nobody');
    expect(await dropped).toBe('io server disconnect');
    expect(server.rooms.snapshot(roomId, playerIdFromToken(token(0)))!.players).toEqual([
      { id: playerIdFromToken(token(0)), name: 'Hosty', connected: false },
    ]);
  });

  it('rejects joins to unknown rooms and invalid names', async () => {
    const server = await start(':memory:');
    cleanups.push(() => server.app.close());
    const c = await connect(server.url);
    cleanups.push(() => void c.close());
    expect(
      await c.call('room:join', { roomId: 'amber-fox-owl-0000', token: token(1), name: 'X' }),
    ).toMatchObject({ ok: false, error: { code: 'no-room' } });
    expect(
      await c.call('room:join', { roomId: 'amber-fox-owl-0000', token: token(1), name: ' ' }),
    ).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    expect(await c.call('game:action', { type: 'start' })).toMatchObject({
      ok: false,
      error: { code: 'not-joined' },
    });
  });
});

describe('realtime Enigma', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  it('plays a round over sockets with each player seeing only their own secrets', async () => {
    const app = testApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    cleanups.push(() => app.close());
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'enigma', token: token(0) },
      })
    ).json<{ roomId: string }>();

    const clients: TestClient[] = [];
    for (const [i, name] of ['Host', 'Ana', 'Ben', 'Cy'].entries()) {
      const c = await connect(url);
      cleanups.push(() => void c.close());
      await c.call('room:join', { roomId, token: token(i), name });
      clients.push(c);
    }
    const [host, ana, ben, cy] = clients as [TestClient, TestClient, TestClient, TestClient];
    await host.call('game:action', { type: 'join-team', team: 'red' });
    await ana.call('game:action', { type: 'join-team', team: 'red' });
    await ben.call('game:action', { type: 'join-team', team: 'blue' });
    await cy.call('game:action', { type: 'join-team', team: 'blue' });
    expect(await host.call('game:action', { type: 'start' })).toEqual({ ok: true });

    type V = EnigmaView;
    const ev = (s: RoomSnapshot) => s.game as V;
    const views = await Promise.all(clients.map((c) => c.until((s) => ev(s).phase === 'playing')));
    // Red sees its keywords, Blue doesn't, and vice versa.
    expect(ev(views[0]!).teams.red.keywords).toHaveLength(4);
    expect(ev(views[0]!).teams.blue.keywords).toBeNull();
    expect(ev(views[2]!).teams.red.keywords).toBeNull();

    for (const team of ['red', 'blue'] as const) {
      const members = team === 'red' ? [host, ana] : [ben, cy];
      const me = (c: TestClient) => c.latest()!.you;
      const encId = ev(members[0]!.latest()!).transmissions.find((t) => t.team === team)!.encryptor;
      const enc = members.find((c) => me(c) === encId)!;
      const decoder = members.find((c) => c !== enc)!;
      const code = ev(enc.latest()!).transmissions.find((t) => t.team === team)!.code!;
      expect(ev(decoder.latest()!).transmissions.find((t) => t.team === team)!.code).toBeNull();
      expect(await enc.call('game:action', { type: 'give-clues', clues: ['a', 'b', 'c'] })).toEqual(
        { ok: true },
      );
      await decoder.until((s) => ev(s).transmissions.find((t) => t.team === team)!.clues !== null);
      (decoder as TestClient & { code?: number[] }).code = code;
    }
    await host.until((s) => ev(s).stage === 'guess');
    for (const team of ['red', 'blue'] as const) {
      const members = team === 'red' ? [host, ana] : [ben, cy];
      const decoder = members.find((c) => (c as TestClient & { code?: number[] }).code)!;
      const code = (decoder as TestClient & { code?: number[] }).code!;
      await decoder.call('game:action', { type: 'set-guess', team, draft: code });
      expect(await decoder.call('game:action', { type: 'lock-guess', team })).toEqual({ ok: true });
    }
    const revealed = ev(await cy.until((s) => ev(s).stage === 'reveal'));
    expect(revealed.transmissions.every((t) => t.result?.decoded)).toBe(true);
    expect(revealed.teams.red.history).toHaveLength(1);
  });
});

describe('realtime Echo', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  it('plays a card over sockets without the word ever reaching the guesser early', async () => {
    const app = testApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    cleanups.push(() => app.close());
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'echo', token: token(0) },
      })
    ).json<{ roomId: string }>();

    const clients: TestClient[] = [];
    const seen = new Map<TestClient, string[]>();
    for (const [i, name] of ['Host', 'Ana', 'Ben', 'Cy'].entries()) {
      const c = await connect(url);
      cleanups.push(() => void c.close());
      const log: string[] = [];
      c.on('room:state', (snap) => log.push(JSON.stringify(snap)));
      seen.set(c, log);
      await c.call('room:join', { roomId, token: token(i), name });
      clients.push(c);
    }
    const ev = (s: RoomSnapshot) => s.game as EchoView;
    const host = clients[0]!;
    await host.until((s) => ev(s).seats.filter((p) => p.playing).length === 4);
    // A fresh room opens on the seeded Starter list, which is tagged for Echo.
    const lists = (await app.inject({ method: 'GET', url: '/api/word-lists?game=echo' })).json<
      { id: string; name: string }[]
    >();
    expect(lists.map((l) => l.name)).toEqual(['Starter']);
    expect(ev(host.latest()!).settings.wordListIds).toEqual([lists[0]!.id]);

    expect(await host.call('game:action', { type: 'update-settings', deckSize: 8 })).toEqual({
      ok: true,
    });
    expect(await host.call('game:action', { type: 'start' })).toEqual({ ok: true });
    await Promise.all(clients.map((c) => c.until((s) => ev(s).turn?.stage === 'pick')));
    const guesserId = ev(host.latest()!).turn!.guesser;
    const guesser = clients.find((c) => c.latest()!.you === guesserId)!;
    const givers = clients.filter((c) => c !== guesser);

    expect(await guesser.call('game:action', { type: 'pick', index: 2 })).toEqual({ ok: true });
    const word = ev(await givers[0]!.until((s) => ev(s).turn?.stage === 'clues')).turn!.word!;
    expect(word).toBeTruthy();
    expect(ev(await guesser.until((s) => ev(s).turn?.stage === 'clues')).turn!.word).toBeNull();

    // Two clues match (and cancel); the third survives.
    const clues = ['Qzxv', 'qzxvs', 'Wvkpj'];
    for (const [i, c] of givers.entries()) {
      expect(await c.call('game:action', { type: 'give-clues', clues: [clues[i]] })).toEqual({
        ok: true,
      });
    }
    const guessing = ev(await guesser.until((s) => ev(s).turn?.stage === 'guess')).turn!;
    expect(guessing.clues).toEqual([
      { by: null, name: null, text: 'Wvkpj', cancelled: false, sameAs: [] },
    ]);
    expect(guessing.cancelledCount).toBe(2);
    const giverView = ev(givers[0]!.latest()!).turn!;
    expect(giverView.clues.filter((c) => c.cancelled).map((c) => c.text)).toEqual([
      'Qzxv',
      'qzxvs',
    ]);

    // Nothing the guesser was sent before the reveal names the word or the cancelled clues.
    const beforeReveal = seen.get(guesser)!.join('\n');
    expect(beforeReveal).not.toContain(`"${word}"`);
    expect(beforeReveal).not.toContain('zxv');

    expect(await guesser.call('game:action', { type: 'guess', word })).toEqual({ ok: true });
    const revealed = ev(await guesser.until((s) => ev(s).turn?.stage === 'reveal'));
    expect(revealed.turn).toMatchObject({ word, outcome: 'right' });
    // At the reveal everyone sees every clue with its author.
    expect(revealed.turn!.clues.map((c) => c.text).sort()).toEqual([...clues].sort());
    expect(revealed.turn!.clues.every((c) => c.name !== null)).toBe(true);
    expect(revealed.score).toBe(1);
    expect(revealed.cardsLeft).toBe(7);
  });
});

describe('realtime back room', () => {
  async function openBackRoom() {
    const app = testApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const admin = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    const adminCookie = `vt_admin=${admin.cookies.find((c) => c.name === 'vt_admin')!.value}`;
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers: { cookie: adminCookie },
      payload: { password: 'speakeasy' },
    });
    const unlock = async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/backroom/unlock',
        payload: { password: 'speakeasy' },
      });
      return `vt_backroom=${res.cookies.find((c) => c.name === 'vt_backroom')!.value}`;
    };
    const cookie = await unlock();
    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: { cookie },
        payload: { gameId: 'reverie', token: token(0) },
      })
    ).json<{ roomId: string }>();
    const signOutAll = () =>
      app.inject({
        method: 'POST',
        url: '/api/admin/backroom/sign-out-all',
        headers: { cookie: adminCookie },
      });
    return { app, url, cookie, roomId, unlock, signOutAll };
  }

  it('drops signed-out players on the next broadcast, before they act', async () => {
    const { app, url, cookie, roomId, unlock, signOutAll } = await openBackRoom();
    const member = await connect(url, cookie);
    let newcomer: TestClient | undefined;
    try {
      expect(await member.call('room:join', { roomId, token: token(0), name: 'In' })).toEqual({
        ok: true,
      });
      const memberId = member.latest()!.you;
      const locked = new Promise<void>((resolve) => member.once('room:locked', () => resolve()));
      let statesAfterSignOut = 0;
      await signOutAll();
      member.on('room:state', () => statesAfterSignOut++);

      // Someone with a fresh unlock joins: that broadcast must not reach the stale member.
      newcomer = await connect(url, await unlock());
      expect(await newcomer.call('room:join', { roomId, token: token(1), name: 'New' })).toEqual({
        ok: true,
      });
      await locked;
      expect(statesAfterSignOut).toBe(0);
      expect(member.latest()!.players).toHaveLength(1);
      const seen = await newcomer.until((s) => s.players.length === 2);
      expect(seen.players.find((p) => p.id === memberId)).toMatchObject({ connected: false });
      expect(await member.call('game:action', { type: 'sit', playing: true })).toMatchObject({
        ok: false,
        error: { code: 'not-joined' },
      });
    } finally {
      member.close();
      newcomer?.close();
      await app.close();
    }
  });

  it('keeps locked players out of private rooms and drops them when everyone is signed out', async () => {
    const { app, url, cookie, roomId, signOutAll } = await openBackRoom();

    const outsider = await connect(url);
    const member = await connect(url, cookie);
    try {
      expect(
        await outsider.call('room:join', { roomId, token: token(1), name: 'Out' }),
      ).toMatchObject({
        ok: false,
        error: { code: 'backroom-locked' },
      });
      expect(await member.call('room:join', { roomId, token: token(0), name: 'In' })).toEqual({
        ok: true,
      });
      expect(await member.call('game:action', { type: 'sit', playing: false })).toEqual({
        ok: true,
      });

      await signOutAll();
      expect(await member.call('game:action', { type: 'sit', playing: true })).toMatchObject({
        ok: false,
        error: { code: 'backroom-locked' },
      });
    } finally {
      outsider.close();
      member.close();
      await app.close();
    }
  });
});

describe('realtime Nightfall', () => {
  it('plays a whole game behind the back room, keeping every card secret until the reveal', async () => {
    const app = testApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const clients: TestClient[] = [];
    try {
      const admin = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { password: 'hunter2' },
      });
      await app.inject({
        method: 'PUT',
        url: '/api/admin/backroom/password',
        headers: { cookie: `vt_admin=${admin.cookies.find((c) => c.name === 'vt_admin')!.value}` },
        payload: { password: 'speakeasy' },
      });
      const unlocked = await app.inject({
        method: 'POST',
        url: '/api/backroom/unlock',
        payload: { password: 'speakeasy' },
      });
      const cookie = `vt_backroom=${unlocked.cookies.find((c) => c.name === 'vt_backroom')!.value}`;
      const { roomId } = (
        await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers: { cookie },
          payload: { gameId: 'nightfall', token: token(60) },
        })
      ).json<{ roomId: string }>();
      const outsider = await connect(url);
      clients.push(outsider);
      expect(
        await outsider.call('room:join', { roomId, token: token(69), name: 'Out' }),
      ).toMatchObject({ ok: false, error: { code: 'backroom-locked' } });
      for (const [i, name] of ['Ana', 'Ben', 'Cy'].entries()) {
        const c = await connect(url, cookie);
        clients.push(c);
        expect(await c.call('room:join', { roomId, token: token(60 + i), name })).toEqual({
          ok: true,
        });
      }
      const players = clients.slice(1);
      await Promise.all(players.map((c) => c.until((s) => s.players.length === 3)));
      const roles = ['werewolf', 'werewolf', 'seer', 'robber', 'villager', 'troublemaker'] as const;
      // Ben and Cy vote for Ana; Ana votes for Ben.
      const { seen, final } = await playNightfall(players, [...roles], (i) => (i === 0 ? 1 : 0));

      const result = final[0]!.reveal!.result;
      expect(result.deaths.map((d) => d.player)).toEqual([final[0]!.me!.id]);
      for (const v of final) expect(v.reveal!.result).toEqual(result);
      for (const [c, views] of seen) {
        const me = final[players.indexOf(c)]!.me!.id;
        for (const v of views) {
          if (v.phase === 'reveal') continue;
          const json = JSON.stringify({
            ...v,
            settings: null,
            notes: null,
            myRole: null,
            night: v.night && { ...v.night, acting: null },
          });
          for (const r of roles) expect(json).not.toContain(`"${r}"`);
          for (const key of ['"cards":', '"center":', '"timeline":', '"seed":', '"dealt":'])
            expect(json).not.toContain(key);
        }
        // Notes are each player's own: no id appears in two players' notes.
        const mine = new Set(final[players.indexOf(c)]!.notes.map((n) => n.id));
        for (const other of final.filter((v) => v.me!.id !== me))
          for (const n of other.notes) expect(mine.has(n.id)).toBe(false);
      }
    } finally {
      for (const c of clients) c.close();
      await app.close();
    }
  }, 60_000);
});

describe('realtime Royal Post', () => {
  it('plays rounds behind the back room, sending nobody else’s hand or notes', async () => {
    const app = testApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const clients: TestClient[] = [];
    try {
      const admin = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { password: 'hunter2' },
      });
      await app.inject({
        method: 'PUT',
        url: '/api/admin/backroom/password',
        headers: { cookie: `vt_admin=${admin.cookies.find((c) => c.name === 'vt_admin')!.value}` },
        payload: { password: 'speakeasy' },
      });
      const unlocked = await app.inject({
        method: 'POST',
        url: '/api/backroom/unlock',
        payload: { password: 'speakeasy' },
      });
      const cookie = `vt_backroom=${unlocked.cookies.find((c) => c.name === 'vt_backroom')!.value}`;
      const created = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'royal-post', token: token(40) },
      });
      expect(created.statusCode).toBe(400);
      const { roomId } = (
        await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers: { cookie },
          payload: { gameId: 'royal-post', token: token(40) },
        })
      ).json<{ roomId: string }>();
      const outsider = await connect(url);
      clients.push(outsider);
      expect(
        await outsider.call('room:join', { roomId, token: token(49), name: 'Out' }),
      ).toMatchObject({ ok: false, error: { code: 'backroom-locked' } });

      for (const [i, name] of ['Ana', 'Ben', 'Cy'].entries()) {
        const c = await connect(url, cookie);
        clients.push(c);
        expect(await c.call('room:join', { roomId, token: token(40 + i), name })).toEqual({
          ok: true,
        });
      }
      const players = clients.slice(1);
      await Promise.all(players.map((c) => c.until((s) => s.players.length === 3)));
      // Everything each player is sent, checked once play is done.
      const seen = new Map<TestClient, RoyalPostView[]>(players.map((c) => [c, []]));
      for (const c of players)
        c.on('room:state', (s) => seen.get(c)!.push(s.game as RoyalPostView));

      expect(await players[0]!.call('game:action', { type: 'start' })).toEqual({ ok: true });
      await Promise.all(
        players.map((c) => c.until((s) => (s.game as RoyalPostView).phase === 'playing')),
      );
      // Play rounds (and games) until someone has used a Priest; with two in every deck that
      // takes a round or two.
      let priests = 0;
      let rounds = 0;
      while (priests === 0 && rounds < 12) {
        for (let turn = 0; turn < 40; turn++) {
          const v = royalPostView(players[0]!);
          if (v.phase !== 'playing' || v.round!.stage === 'over') break;
          const turn = await playRoyalPostTurn(players);
          if (!turn) break;
          const { mover, action } = turn;
          if (action.type === 'play' && action.card === 'priest' && action.target) {
            priests++;
            // The peek reaches the player who played the Priest, and nobody else.
            const note = royalPostView(mover).notes.at(-1)!;
            expect(note).toMatchObject({ kind: 'peek', target: action.target });
            for (const other of players.filter((c) => c !== mover)) {
              expect(royalPostView(other).notes.map((n) => n.id)).not.toContain(note.id);
            }
          }
        }
        rounds++;
        const v = royalPostView(players[1]!);
        expect(v.round!.result).not.toBeNull();
        const next = v.phase === 'over' ? 'start' : 'next-round';
        const number = v.phase === 'over' ? 1 : v.round!.number + 1;
        expect(await players[0]!.call('game:action', { type: next })).toEqual({ ok: true });
        await Promise.all(
          players.map((c) =>
            c.until((s) => {
              const g = s.game as RoyalPostView;
              return g.phase === 'playing' && g.round?.number === number && !g.round.result;
            }),
          ),
        );
      }
      expect(priests).toBeGreaterThan(0);

      for (const [c, views] of seen) {
        expect(views.length).toBeGreaterThan(5);
        for (const v of views) {
          const json = JSON.stringify(v);
          expect(json).not.toContain('"deck"');
          expect(json).not.toContain('seed');
          if (v.round) {
            expect(typeof v.round.setAside).toBe('boolean');
            for (const p of v.round.players) expect(p).not.toHaveProperty('hand');
            expect(v.hand.length).toBe(
              v.round.players.find((p) => p.id === v.me!.id)?.handCount ?? 0,
            );
          }
        }
        // Each player's notes are theirs alone.
        const ids = new Set(royalPostView(c).notes.map((n) => n.id));
        for (const other of players.filter((o) => o !== c))
          for (const n of royalPostView(other).notes) expect(ids.has(n.id)).toBe(false);
      }
    } finally {
      for (const c of clients) c.close();
      await app.close();
    }
  });
});

describe('realtime Masquerade', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  it('plays a round over sockets: the spy never sees the location, votes stay secret', async () => {
    const app = testApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    cleanups.push(() => app.close());
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'masquerade', token: token(60) },
      })
    ).json<{ roomId: string }>();

    const clients: TestClient[] = [];
    const seen = new Map<TestClient, MasqueradeView[]>();
    for (const [i, name] of ['Host', 'Ana', 'Ben', 'Cy'].entries()) {
      const c = await connect(url);
      cleanups.push(() => void c.close());
      const log: MasqueradeView[] = [];
      c.on('room:state', (snap) => log.push(snap.game as MasqueradeView));
      seen.set(c, log);
      expect(await c.call('room:join', { roomId, token: token(60 + i), name })).toEqual({
        ok: true,
      });
      clients.push(c);
    }
    const mv = (s: RoomSnapshot) => s.game as MasqueradeView;
    const host = clients[0]!;
    await host.until((s) => mv(s).seats.filter((p) => p.playing).length === 4);
    expect(await host.call('game:action', { type: 'start' })).toEqual({ ok: true });
    const dealt = await Promise.all(
      clients.map(async (c) => mv(await c.until((s) => mv(s).round?.stage === 'talk')).round!),
    );
    const spies = clients.filter((_, i) => dealt[i]!.role === 'spy');
    const locals = clients.filter((_, i) => dealt[i]!.role === 'local');
    expect(spies).toHaveLength(1);
    expect(locals).toHaveLength(3);
    const spy = spies[0]!;
    const spyId = spy.latest()!.you;
    const location = mv(locals[0]!.latest()!).round!.location!;
    expect(locals.map((c) => mv(c.latest()!).round!.location)).toEqual([
      location,
      location,
      location,
    ]);
    expect(mv(spy.latest()!).round!.location).toBeNull();

    // Everyone is ready, so the vote starts early.
    for (const c of clients)
      expect(await c.call('game:action', { type: 'ready-to-vote', ready: true })).toEqual({
        ok: true,
      });
    await Promise.all(clients.map((c) => c.until((s) => mv(s).round?.stage === 'vote')));
    // The locals vote for the spy; the spy votes for a local.
    for (const c of locals)
      expect(await c.call('game:action', { type: 'vote', target: spyId })).toEqual({ ok: true });
    const counted = mv(await spy.until((s) => mv(s).round?.votedCount === 3)).round!;
    expect(counted.votes).toBeNull();
    const spyVote = locals[0]!.latest()!.you;
    expect(await spy.call('game:action', { type: 'vote', target: spyVote })).toEqual({ ok: true });
    const guessing = mv(await spy.until((s) => mv(s).round?.stage === 'guess')).round!;
    expect(guessing.canGuess).toBe(true);
    // Only the caught spy may guess.
    expect(
      await locals[0]!.call('game:action', { type: 'spy-guess', location: 'bakery' }),
    ).toMatchObject({ ok: false });
    const wrong = location === 'bakery' ? 'gym' : 'bakery';
    expect(await spy.call('game:action', { type: 'spy-guess', location: wrong })).toEqual({
      ok: true,
    });
    const revealed = mv(await host.until((s) => mv(s).round?.stage === 'reveal')).round!;
    expect(revealed.result).toMatchObject({ location, spies: [spyId], named: [spyId] });
    expect(revealed.result!.spyResults).toEqual([{ id: spyId, outcome: 'caught', guess: wrong }]);
    for (const c of locals) expect(revealed.result!.points[c.latest()!.you]).toBe(2);

    // Before the reveal, the spy was never sent the location, and nobody saw another's vote.
    for (const [c, views] of seen) {
      const secret = views.filter((v) => v.round && v.round.stage !== 'reveal');
      expect(secret.length).toBeGreaterThan(0);
      for (const v of secret) {
        const json = JSON.stringify({ ...v, locations: [] });
        expect(json).not.toContain('"spies"');
        expect(json).not.toContain('seed');
        if (c === spy) expect(json).not.toContain(`"${location}"`);
        if (v.round!.stage === 'talk' || v.round!.stage === 'vote')
          expect(v.round!.votes).toBeNull();
      }
    }
  });
});
