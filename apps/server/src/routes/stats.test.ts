import type { CodenamesView } from '@vt/game-codenames/logic';
import type { EchoView } from '@vt/game-echo/logic';
import { locationById } from '@vt/game-masquerade/content';
import type { MasqueradeView } from '@vt/game-masquerade/logic';
import type { InquestView } from '@vt/private-inquest/logic';
import type { RoyalPostView } from '@vt/private-royal-post/logic';
import {
  type GameStats,
  type LiveStats,
  type PlayerProfile,
  STATS_RESET_CONFIRM,
  type StatsFun,
  type StatsHeatmap,
  type StatsOverview,
  type StatsPlayers,
  type StatsSettings,
  type StatsTimeseries,
  type StatsWords,
  type StatsGames,
} from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { playerIdFromToken } from '../rooms/ids.ts';
import { type TestClient, connect, testApp, token } from '../test/helpers.ts';
import { playNightfall } from '../test/nightfall.ts';
import { playRoundTable } from '../test/round-table.ts';
import { playRoyalPostTurn, royalPostView } from '../test/royal-post.ts';

const DAY = '2026-10-10';

describe('admin stats', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  let clock = Date.parse(`${DAY}T19:00:00Z`);
  const tick = (ms: number) => {
    clock += ms;
  };

  async function start() {
    clock = Date.parse(`${DAY}T19:00:00Z`);
    const app = testApp({ now: () => clock });
    cleanups.push(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const get = async <T>(path: string) => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/admin/stats/${path}`,
        headers: { cookie },
      });
      return {
        status: res.statusCode,
        headers: res.headers,
        body: (String(res.headers['content-type']).includes('application/json')
          ? res.json<T>()
          : null) as T,
        raw: res.body,
      };
    };
    return { app, url, cookie, get };
  }

  async function room(
    app: Awaited<ReturnType<typeof start>>['app'],
    url: string,
    gameId: string,
    names: string[],
    first = 0,
  ) {
    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId, token: token(first) },
      })
    ).json<{ roomId: string }>();
    const clients: TestClient[] = [];
    for (const [i, name] of names.entries()) {
      const c = await connect(url);
      cleanups.push(() => void c.close());
      expect(await c.call('room:join', { roomId, token: token(first + i), name })).toEqual({
        ok: true,
      });
      clients.push(c);
    }
    await Promise.all(clients.map((c) => c.until((s) => s.players.length === names.length)));
    return { roomId, clients };
  }

  it('records play over sockets and serves it to admins', async () => {
    const { app, url, get } = await start();

    // A Codenames game that the assassin ends after four minutes.
    const { roomId, clients } = await room(app, url, 'codenames', ['Host', 'Ana', 'Ben', 'Cy']);
    const [host, ana, ben, cy] = clients as [TestClient, TestClient, TestClient, TestClient];
    await host.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
    await ana.call('game:action', { type: 'join-team', team: 'red', role: 'operative' });
    await ben.call('game:action', { type: 'join-team', team: 'blue', role: 'spymaster' });
    await cy.call('game:action', { type: 'join-team', team: 'blue', role: 'operative' });
    expect(await host.call('game:action', { type: 'start' })).toEqual({ ok: true });
    const view = (await host.until((s) => (s.game as CodenamesView).phase === 'playing'))
      .game as CodenamesView;
    const [spy, op] = view.turn!.team === 'red' ? [host, ana] : [ben, cy];
    tick(60_000);
    expect(await spy.call('game:action', { type: 'give-clue', word: 'zyzzyva', count: 1 })).toEqual(
      { ok: true },
    );
    tick(180_000);
    const assassin = view.board.findIndex((c) => c.kind === 'assassin');
    expect(await op.call('game:action', { type: 'guess', card: assassin })).toEqual({ ok: true });
    await host.until((s) => (s.game as CodenamesView).phase === 'over');

    // An Echo game the host takes back to the lobby: abandoned.
    const echo = await room(app, url, 'echo', ['Dee', 'Eve', 'Fay'], 10);
    tick(60_000);
    expect(await echo.clients[0]!.call('game:action', { type: 'start' })).toEqual({ ok: true });
    await echo.clients[0]!.until((s) => (s.game as EchoView).phase === 'playing');
    tick(120_000);
    expect(await echo.clients[0]!.call('game:action', { type: 'back-to-lobby' })).toEqual({
      ok: true,
    });
    await echo.clients[0]!.until((s) => (s.game as EchoView).phase === 'lobby');

    // Live: both rooms, everyone connected.
    const live = await get<LiveStats>('live');
    expect(live.status).toBe(200);
    expect(live.headers['cache-control']).toBe('private, no-store');
    expect(live.body.sockets).toBe(7);
    expect(live.body.playersOnline).toBe(7);
    expect(live.body.playersRecent).toBe(7);
    expect(live.body.rooms.map((r) => r.id).sort()).toEqual([roomId, echo.roomId].sort());
    expect(live.body.rooms.find((r) => r.id === roomId)).toMatchObject({
      gameId: 'codenames',
      phase: 'over',
    });
    expect(live.body.byGame).toEqual(
      expect.arrayContaining([
        { gameId: 'codenames', rooms: 1, playing: 0, players: 4 },
        { gameId: 'echo', rooms: 1, playing: 0, players: 3 },
      ]),
    );
    expect(live.body.lastHour).toHaveLength(60);
    expect(live.body.lastHour.at(-1)!.players).toBe(7);

    const today = 'range=today';
    const overview = (await get<StatsOverview>(`overview?${today}`)).body;
    expect(overview.window).toMatchObject({ from: DAY, to: DAY, bucket: 'hour' });
    expect(overview.totals).toEqual({
      roomsCreated: 2,
      gamesStarted: 2,
      gamesFinished: 1,
      gamesAbandoned: 1,
      uniquePlayers: 7,
      minutesPlayed: 6,
    });
    expect(overview.activity).toHaveLength(24);
    expect(overview.activity[19]!.values).toMatchObject({ codenames: 1, echo: 1, _all: 2 });

    const games = (await get<StatsGames>('games')).body.games;
    expect(games.find((g) => g.gameId === 'codenames')).toMatchObject({
      averageMinutes: 4,
      averagePlayers: 4,
      totals: { gamesFinished: 1 },
    });

    const cn = (await get<GameStats>(`games/codenames?${today}`)).body;
    expect(cn).toMatchObject({ gameId: 'codenames', playerCounts: [{ players: 4, games: 1 }] });
    expect(cn.settings.map((s) => s.key)).toEqual(
      expect.arrayContaining(['wordList', 'timerMode']),
    );
    expect(cn.settings.find((s) => s.key === 'wordList')!.label).not.toBe('');
    // Figures come from the real Codenames insights: one clue of 1, one guess, the assassin.
    const loser = view.turn!.team;
    const winner = loser === 'red' ? 'blue' : 'red';
    const figs = Object.fromEntries(cn.figures.map((f) => [f.id, f]));
    expect(figs.wins).toMatchObject({
      kind: 'split',
      parts: [
        { label: 'Red', value: winner === 'red' ? 1 : 0 },
        { label: 'Blue', value: winner === 'blue' ? 1 : 0 },
      ],
    });
    expect(figs['assassin-rate']).toMatchObject({ kind: 'percent', value: 100 });
    expect(figs['average-clue']).toMatchObject({ kind: 'number', value: 1 });
    expect(figs['guess-accuracy']).toMatchObject({ kind: 'percent', value: 0 });
    const assassinWord = view.board[assassin]!.word.toLowerCase();
    expect((await get<StatsWords>('words?game=codenames&kind=assassin')).body.words).toEqual([
      { word: assassinWord, count: 1 },
    ]);

    const echoStats = (await get<GameStats>('games/echo')).body;
    expect(echoStats.totals).toMatchObject({ gamesStarted: 1, gamesAbandoned: 1 });

    const series = (await get<StatsTimeseries>('timeseries?metric=games_started&range=7d')).body;
    expect(series.series).toHaveLength(7);
    expect(series.series.at(-1)!.values).toMatchObject({ codenames: 1, echo: 1, _all: 2 });

    const players = (await get<StatsPlayers>('players')).body.players;
    expect(players).toHaveLength(7);
    const anaId = playerIdFromToken(token(1));
    expect(players.find((p) => p.id === anaId)).toMatchObject({
      name: 'Ana',
      games: 1,
      minutes: 4,
    });
    const profile = (await get<PlayerProfile>(`players/${anaId}`)).body;
    expect(profile).toMatchObject({
      name: 'Ana',
      aliases: ['Ana'],
      calendar: [{ day: DAY, games: 1 }],
    });
    expect((await get(`players/nobody`)).status).toBe(404);

    expect((await get<StatsWords>('words?game=codenames&kind=clue')).body).toMatchObject({
      gameId: 'codenames',
      kind: 'clue',
    });
    expect(
      (await get<StatsSettings>('settings?game=echo')).body.settings.map((s) => s.key),
    ).toContain('deckSize');
    const heat = (await get<StatsHeatmap>('heatmap')).body;
    expect(heat.calendar.at(-1)).toEqual({ day: DAY, games: 2 });
    // 2026-10-10 is a Saturday (5); both games started in the 19:00 UTC hour.
    expect(heat.weekHour.find((c) => c.weekday === 5 && c.hour === 19)!.games).toBe(2);
    const fun = (await get<StatsFun>('fun')).body;
    expect(fun.facts.map((f) => f.id)).toEqual(
      expect.arrayContaining(['most-games', 'longest-game']),
    );
    const facts = Object.fromEntries(fun.facts.map((f) => [f.id, f]));
    const opName = op === ana ? 'Ana' : 'Cy';
    expect(facts['assassin-magnet']).toMatchObject({
      text: `${opName} found the assassin once`,
      gameId: 'codenames',
    });
    expect(facts['top-clue']).toMatchObject({ text: '"zyzzyva" was given as a clue once' });
    expect(facts['riskiest-word']).toMatchObject({
      text: `"${assassinWord}" was the assassin once`,
    });

    // The raw events export, then a reset.
    const exported = await get<unknown>('export');
    expect(exported.headers['content-type']).toMatch(/application\/x-ndjson/);
    const lines = exported.raw
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { type: string });
    expect(lines.filter((e) => e.type === 'game.started')).toHaveLength(2);
  });

  it('turns a whole Echo game into figures, words and fun facts', async () => {
    const { app, url, get } = await start();
    const { clients } = await room(app, url, 'echo', ['Dee', 'Eve', 'Fay'], 20);
    const [host] = clients as [TestClient];
    const names = new Map(clients.map((c, i) => [c, ['Dee', 'Eve', 'Fay'][i]!]));
    expect(await host.call('game:action', { type: 'update-settings', deckSize: 8 })).toEqual({
      ok: true,
    });
    expect(await host.call('game:action', { type: 'start' })).toEqual({ ok: true });
    const echoView = (c: TestClient) => c.latest()!.game as EchoView;
    const guessers: string[] = [];

    // Eight cards: seven guessed right, the last one passed. On the first card both clue
    // writers send "qxzv", so those two clues cancel each other.
    for (let card = 0; card < 8; card++) {
      const at = (await host.until((s) => (s.game as EchoView).turn?.stage === 'pick'))
        .game as EchoView;
      const turn = at.turn!;
      const guesser = clients.find((c) => echoView(c).me?.id === turn.guesser)!;
      const givers = clients.filter((c) => c !== guesser);
      guessers.push(names.get(guesser)!);
      expect(await guesser.call('game:action', { type: 'pick', index: 0 })).toEqual({ ok: true });
      for (const [i, giver] of givers.entries()) {
        const clues = card === 0 ? ['qxzv', `qxzw${i}`] : [`qxa${card}${i}`, `qxb${card}${i}`];
        expect(await giver.call('game:action', { type: 'give-clues', clues })).toEqual({
          ok: true,
        });
      }
      const word = (await givers[0]!.until((s) => (s.game as EchoView).turn?.stage === 'guess'))
        .game as EchoView;
      // Dee answers in 2 s, everyone else in 5 s.
      tick(names.get(guesser) === 'Dee' ? 2000 : 5000);
      const answer = card === 7 ? { type: 'pass' } : { type: 'guess', word: word.turn!.word! };
      expect(await guesser.call('game:action', answer)).toEqual({ ok: true });
      await host.until((s) => (s.game as EchoView).turn?.stage === 'reveal');
      expect(await host.call('game:action', { type: 'next-card' })).toEqual({ ok: true });
    }
    await host.until((s) => (s.game as EchoView).phase === 'over');
    expect(guessers.slice(0, 3)).toEqual(['Dee', 'Eve', 'Fay']);

    const echo = (await get<GameStats>('games/echo?range=today')).body;
    expect(echo.totals).toMatchObject({ gamesStarted: 1, gamesFinished: 1 });
    const figs = Object.fromEntries(echo.figures.map((f) => [f.id, f]));
    expect(figs['right-rate']).toEqual({
      id: 'right-rate',
      label: 'Cards guessed right',
      kind: 'percent',
      value: 87.5,
    });
    expect(figs['pass-rate']).toMatchObject({ kind: 'percent', value: 12.5 });
    expect(figs['best-score']).toMatchObject({ kind: 'number', value: 7 });
    expect(figs['average-score']).toMatchObject({ kind: 'number', value: 7 });
    expect(figs['perfect-games']).toMatchObject({ kind: 'number', value: 0 });
    expect(figs.scores).toMatchObject({ kind: 'histogram' });
    expect((figs.scores as { bins: { label: string; value: number }[] }).bins.at(-1)).toEqual({
      label: '7',
      value: 1,
    });

    const words = (kind: string) =>
      get<StatsWords>(`words?game=echo&kind=${kind}&range=today`).then((r) => r.body.words);
    expect(await words('cancelled')).toEqual([{ word: 'qxzv', count: 2 }]);
    expect((await words('clue')).map((w) => w.word)).toEqual(
      expect.arrayContaining(['qxzv', 'qxzw0', 'qxzw1', 'qxa10']),
    );
    expect(await words('guess')).toHaveLength(7);

    const facts = Object.fromEntries(
      (await get<StatsFun>('fun?range=today')).body.facts.map((f) => [f.id, f]),
    );
    // Eve and Fay wrote the matching clues; ties go to the first name.
    expect(facts['the-echo']).toMatchObject({
      title: 'The echo',
      text: "Eve's clues matched someone else's once",
      gameId: 'echo',
      playerId: playerIdFromToken(token(21)),
    });
    expect(facts['fastest-guesser']).toMatchObject({
      text: 'Dee guessed in 2 s on average',
      playerId: playerIdFromToken(token(20)),
    });
    expect(facts['great-minds']).toMatchObject({ text: '"qxzv" cancelled itself out 2 times' });
    expect(facts['perfect-echo']).toBeUndefined();

    // Winners of a finished cooperative game are everyone who played.
    const players = (await get<StatsPlayers>('players?range=today')).body.players;
    expect(players.map((p) => [p.name, p.games, p.wins]).sort()).toEqual([
      ['Dee', 1, 1],
      ['Eve', 1, 1],
      ['Fay', 1, 1],
    ]);
    const overview = (await get<StatsOverview>('overview?range=today')).body;
    expect(overview.games).toEqual(
      expect.arrayContaining([
        { id: 'echo', name: 'Echo' },
        { id: 'reverie', name: 'Reverie' },
      ]),
    );
    const live = (await get<LiveStats>('live')).body;
    expect(live.games).toEqual([{ id: 'echo', name: 'Echo' }]);
  });

  it('plays Inquest behind the back room, hiding the crime, and reports its figures', async () => {
    const { app, url, cookie: admin, get } = await start();
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers: { cookie: admin },
      payload: { password: 'speakeasy' },
    });
    const unlocked = await app.inject({
      method: 'POST',
      url: '/api/backroom/unlock',
      payload: { password: 'speakeasy' },
    });
    const cookie = `vt_backroom=${unlocked.cookies.find((c) => c.name === 'vt_backroom')!.value}`;
    const locked = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { gameId: 'inquest', token: token(60) },
    });
    expect(locked.statusCode).toBe(400);
    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: { cookie },
        payload: { gameId: 'inquest', token: token(60) },
      })
    ).json<{ roomId: string }>();
    const names = ['Kit', 'Lee', 'Mo', 'Ned'];
    const clients: TestClient[] = [];
    const seen = new Map<TestClient, string[]>();
    for (const [i, name] of names.entries()) {
      const c = await connect(url, cookie);
      cleanups.push(() => void c.close());
      seen.set(c, []);
      c.on('room:state', (snap) => seen.get(c)!.push(JSON.stringify(snap.game)));
      expect(await c.call('room:join', { roomId, token: token(60 + i), name })).toEqual({
        ok: true,
      });
      clients.push(c);
    }
    await Promise.all(clients.map((c) => c.until((snap) => snap.players.length === 4)));
    const [host] = clients as [TestClient];
    const iv = (c: TestClient) => c.latest()!.game as InquestView;
    const act = async (c: TestClient, action: Record<string, unknown>) =>
      expect(await c.call('game:action', action)).toEqual({ ok: true });
    await act(host, {
      type: 'update-settings',
      fsMode: 'host',
      fsPick: playerIdFromToken(token(60)),
    });
    await act(host, { type: 'start' });
    await Promise.all(
      clients.map((c) => c.until((snap) => (snap.game as InquestView).phase === 'playing')),
    );
    const murderer = clients.find((c) => iv(c).game!.myRole === 'murderer')!;
    const me = iv(murderer).game!.players.find((p) => p.id === iv(murderer).me!.id)!;
    await act(murderer, { type: 'commit-crime', clue: me.clue[2], means: me.means[1] });
    await host.until((snap) => (snap.game as InquestView).game!.stage === 'collect');
    await act(host, { type: 'pick-location', tile: 3 });
    for (let slot = 0; slot < 6; slot++) {
      tick(3000);
      await act(host, { type: 'place-bullet', slot, item: slot });
    }
    const solver = clients.find((c) => c !== host && c !== murderer)!;
    await solver.until((snap) => (snap.game as InquestView).game!.stage === 'present');
    await act(solver, { type: 'solve', target: me.id, clue: me.clue[2], means: me.means[1] });
    await Promise.all(
      clients.map((c) => c.until((snap) => (snap.game as InquestView).phase === 'over')),
    );
    expect(iv(host).game!.result).toMatchObject({ winner: 'investigators', how: 'solved' });

    // Until the end, only the Forensic Scientist and the Murderer were ever sent the crime.
    for (const c of clients) {
      const before = seen.get(c)!.filter((g) => !g.includes('"phase":"over"'));
      for (const g of before) expect(g).not.toContain('"pile"');
      const sawCrime = before.some((g) => g.includes('"solution":{'));
      expect(sawCrime, iv(c).me!.name).toBe(c === host || c === murderer);
    }

    const stats = (await get<GameStats>('games/inquest?range=today')).body;
    expect(stats.totals).toMatchObject({ gamesStarted: 1, gamesFinished: 1 });
    const figs = Object.fromEntries(stats.figures.map((f) => [f.id, f]));
    expect(figs['solve-rate']).toMatchObject({ kind: 'percent', value: 100 });
    expect(figs['murderer-win-rate']).toMatchObject({ value: 0 });
    expect(figs['solves-by-round']).toMatchObject({
      parts: [
        { label: 'Round 1', value: 1 },
        { label: 'Round 2', value: 0 },
        { label: 'Round 3', value: 0 },
      ],
    });
    expect(figs['bullets-before-solve']).toMatchObject({ value: 6 });
    expect(figs['top-means']).toMatchObject({
      parts: [{ label: `{card:means-${me.means[1]}}`, value: 1 }],
    });
    expect(figs['top-clues']).toMatchObject({
      parts: [{ label: `{card:clue-${me.clue[2]}}`, value: 1 }],
    });
    // Card names never reach stats storage: only ids.
    expect(JSON.stringify(stats)).not.toMatch(/"name":"[^"]*(Knife|Rope)/);
    const facts = (await get<StatsFun>('fun?range=today')).body.facts;
    expect(facts.find((f) => f.id === 'case-closer')).toMatchObject({
      gameId: 'inquest',
      text: `${iv(solver).me!.name} named the killer’s exact cards once`,
    });
  });

  it('turns a whole Royal Post game into figures and fun facts', async () => {
    const { app, url, cookie: admin, get } = await start();
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers: { cookie: admin },
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
        payload: { gameId: 'royal-post', token: token(30) },
      })
    ).json<{ roomId: string }>();
    const names = ['Gil', 'Hal', 'Ida'];
    const clients: TestClient[] = [];
    for (const [i, name] of names.entries()) {
      const c = await connect(url, cookie);
      cleanups.push(() => void c.close());
      expect(await c.call('room:join', { roomId, token: token(30 + i), name })).toEqual({
        ok: true,
      });
      clients.push(c);
    }
    await Promise.all(clients.map((c) => c.until((s) => s.players.length === 3)));
    const [host] = clients as [TestClient];
    expect(await host.call('game:action', { type: 'start' })).toEqual({ ok: true });
    await host.until((s) => (s.game as RoyalPostView).phase === 'playing');

    // Tally the public log as the game goes, to check the figures against.
    const tally = { guards: 0, hits: 0, rounds: 0, spy: 0, kills: new Map<string, number>() };
    const hitsBy = new Map<string, number>();
    const princessBy = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    let lastId = 0;
    const read = () => {
      for (const e of royalPostView(host).log) {
        if (e.id <= lastId) continue;
        lastId = e.id;
        if (e.kind === 'play' && e.card === 'guard' && e.guess) {
          tally.guards++;
          if (e.hit) {
            tally.hits++;
            bump(hitsBy, e.by);
          }
        }
        if (e.kind === 'out' && e.cause !== 'left') {
          bump(tally.kills, e.cause);
          if (e.cause === 'princess' || e.cards.includes('princess')) bump(princessBy, e.player);
        }
        if (e.kind === 'round-end') {
          tally.rounds++;
          if (e.spy) tally.spy++;
        }
      }
    };
    for (let step = 0; step < 400 && royalPostView(host).phase === 'playing'; step++) {
      const v = royalPostView(host);
      if (v.round!.stage === 'over') {
        read();
        expect(await host.call('game:action', { type: 'next-round' })).toEqual({ ok: true });
        await Promise.all(
          clients.map((c) =>
            c.until((s) => (s.game as RoyalPostView).round?.number === v.round!.number + 1),
          ),
        );
        continue;
      }
      // Everyone guesses with a Guard first, so there are plenty of guesses to count.
      await playRoyalPostTurn(clients, ['guard', 'priest', 'handmaid']);
      read();
    }
    const final = royalPostView(host);
    expect(final.phase).toBe('over');
    expect(tally.guards).toBeGreaterThan(0);

    const stats = (await get<GameStats>('games/royal-post?range=today')).body;
    expect(stats.totals).toMatchObject({ gamesStarted: 1, gamesFinished: 1 });
    const figs = Object.fromEntries(stats.figures.map((f) => [f.id, f]));
    expect(figs['wins-by-edition']).toEqual({
      id: 'wins-by-edition',
      label: 'Wins by edition',
      kind: 'split',
      parts: [
        { label: 'Classic', value: 1 },
        { label: '2019', value: 0 },
      ],
    });
    expect(figs['rounds-per-game']).toMatchObject({ kind: 'number', value: tally.rounds });
    expect(figs['guard-accuracy']).toMatchObject({
      kind: 'percent',
      value: Math.round((tally.hits / tally.guards) * 1000) / 10,
    });
    const kills = [...tally.kills].sort(([, a], [, b]) => b - a);
    expect(
      (figs['knockouts-by-card'] as { parts: { label: string; value: number }[] }).parts.map(
        (p) => [p.label.toLowerCase(), p.value],
      ),
    ).toEqual(expect.arrayContaining(kills));
    expect(figs['spy-bonuses']).toMatchObject({ value: 0 });

    const facts = Object.fromEntries(
      (await get<StatsFun>('fun?range=today')).body.facts.map((f) => [f.id, f]),
    );
    const top = (m: Map<string, number>) => {
      const best = Math.max(0, ...m.values());
      const ids = [...m].filter(([, n]) => n === best).map(([id]) => id);
      return { best, names: ids.map((id) => final.seats.find((s) => s.id === id)!.name) };
    };
    const lucky = top(hitsBy);
    if (lucky.best > 0) {
      expect(facts['lucky-guesser']).toMatchObject({
        title: 'Lucky guesser',
        gameId: 'royal-post',
      });
      expect(lucky.names).toContain(facts['lucky-guesser']!.text.split(' named')[0]);
    } else expect(facts['lucky-guesser']).toBeUndefined();
    const fumble = top(princessBy);
    if (fumble.best > 0) {
      expect(facts['princess-fumbler']).toMatchObject({
        title: 'Princess fumbler',
        gameId: 'royal-post',
      });
      expect(fumble.names).toContain(facts['princess-fumbler']!.text.split(' was')[0]);
    } else expect(facts['princess-fumbler']).toBeUndefined();

    // Only the game's winners are credited with a win, not every round winner.
    const players = (await get<StatsPlayers>('players?range=today')).body.players;
    expect(
      players
        .filter((p) => p.wins > 0)
        .map((p) => p.name)
        .sort(),
    ).toEqual(final.winners.map((id) => final.seats.find((s) => s.id === id)!.name).sort());
  }, 20_000);

  it('turns a Masquerade game into figures and fun facts', async () => {
    const { app, url, get } = await start();
    const { clients } = await room(app, url, 'masquerade', ['Mo', 'Nia', 'Oz'], 70);
    const [host] = clients as [TestClient];
    const mv = (c: TestClient) => c.latest()!.game as MasqueradeView;
    const idOf = (c: TestClient) => c.latest()!.you;
    expect(await host.call('game:action', { type: 'update-settings', rounds: 2 })).toEqual({
      ok: true,
    });
    expect(await host.call('game:action', { type: 'start' })).toEqual({ ok: true });

    const hits = new Map<string, number>();
    const received = new Map<string, number>();
    const spyWins = new Map<string, number>();
    const places: string[] = [];
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    const vote = async (c: TestClient, target: string, spyId: string) => {
      expect(await c.call('game:action', { type: 'vote', target })).toEqual({ ok: true });
      bump(received, target);
      if (target === spyId) bump(hits, idOf(c));
    };
    for (const number of [1, 2]) {
      await Promise.all(
        clients.map((c) =>
          c.until((s) => {
            const r = (s.game as MasqueradeView).round;
            return r?.number === number && r.stage === 'talk';
          }),
        ),
      );
      const spy = clients.find((c) => mv(c).round!.role === 'spy')!;
      const [a, b] = clients.filter((c) => c !== spy) as [TestClient, TestClient];
      const location = mv(a).round!.location!;
      places.push(locationById(location)!.name.toLowerCase());
      for (const c of clients) await c.call('game:action', { type: 'ready-to-vote', ready: true });
      await Promise.all(
        clients.map((c) => c.until((s) => (s.game as MasqueradeView).round?.stage === 'vote')),
      );
      if (number === 1) {
        // Caught, then steals the round with the right guess.
        await vote(a, idOf(spy), idOf(spy));
        await vote(b, idOf(spy), idOf(spy));
        await vote(spy, idOf(a), idOf(spy));
        await spy.until((s) => (s.game as MasqueradeView).round?.canGuess === true);
        expect(await spy.call('game:action', { type: 'spy-guess', location })).toEqual({
          ok: true,
        });
      } else {
        // The table names a local: the spy escapes.
        await vote(a, idOf(spy), idOf(spy));
        await vote(b, idOf(a), idOf(spy));
        await vote(spy, idOf(a), idOf(spy));
      }
      bump(spyWins, idOf(spy));
      await host.until((s) => (s.game as MasqueradeView).round?.stage === 'reveal');
      if (number === 1)
        expect(await host.call('game:action', { type: 'next-round' })).toEqual({ ok: true });
    }
    await host.until((s) => (s.game as MasqueradeView).phase === 'over');

    const stats = (await get<GameStats>('games/masquerade?range=today')).body;
    expect(stats.totals).toMatchObject({ gamesStarted: 1, gamesFinished: 1 });
    const figs = Object.fromEntries(stats.figures.map((f) => [f.id, f]));
    expect(figs['round-outcomes']).toEqual({
      id: 'round-outcomes',
      label: 'How spies ended their rounds',
      kind: 'split',
      parts: [
        { label: 'Escaped the vote', value: 1 },
        { label: 'Caught, then stole it', value: 1 },
        { label: 'Caught for good', value: 0 },
      ],
    });
    expect(figs['spy-win-rate']).toMatchObject({ kind: 'percent', value: 100 });
    expect(figs['vote-accuracy']).toMatchObject({ kind: 'percent', value: 50 });
    expect(figs['rounds-per-game']).toMatchObject({ kind: 'number', value: 2 });

    const names = (c: string) => mv(host).seats.find((s) => s.id === c)!.name;
    const top = (m: Map<string, number>) => {
      const best = Math.max(...m.values());
      return [...m].filter(([, n]) => n === best).map(([id]) => names(id));
    };
    const facts = Object.fromEntries(
      (await get<StatsFun>('fun?range=today')).body.facts.map((f) => [f.id, f]),
    );
    expect(facts['master-of-disguise']).toMatchObject({
      title: 'Master of disguise',
      gameId: 'masquerade',
    });
    expect(top(spyWins)).toContain(facts['master-of-disguise']!.text.split(' won')[0]);
    expect(facts.bloodhound).toMatchObject({ title: 'Bloodhound', gameId: 'masquerade' });
    expect(top(hits)).toContain(facts.bloodhound!.text.split(' voted')[0]);
    expect(top(received)).toContain(facts['usual-suspect']!.text.split(' drew')[0]);
    // Both rounds went to the spy; the tie goes to the first name alphabetically.
    expect(facts['trickiest-location']).toMatchObject({
      title: 'Trickiest location',
      text: `The spy won at "${[...places].sort()[0]}" once`,
    });

    const words = (await get<StatsWords>('words?game=masquerade&kind=clue&range=today')).body.words;
    expect(words.reduce((n, w) => n + w.count, 0)).toBe(2);
  });

  it('turns a Nightfall game into figures, words and fun facts', async () => {
    // The night runs on real timers, so this app keeps the real clock.
    const app = testApp();
    cleanups.push(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    const admin = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const get = async <T>(path: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/admin/stats/${path}`,
          headers: { cookie: admin },
        })
      ).json<T>();
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers: { cookie: admin },
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
        payload: { gameId: 'nightfall', token: token(80) },
      })
    ).json<{ roomId: string }>();
    const clients: TestClient[] = [];
    for (const [i, name] of ['Pia', 'Quin', 'Rex'].entries()) {
      const c = await connect(url, cookie);
      cleanups.push(() => void c.close());
      expect(await c.call('room:join', { roomId, token: token(80 + i), name })).toEqual({
        ok: true,
      });
      clients.push(c);
    }
    await Promise.all(clients.map((c) => c.until((s) => s.players.length === 3)));
    const roles = ['werewolf', 'werewolf', 'seer', 'robber', 'troublemaker', 'villager'];
    // Quin and Rex vote for Pia; Pia votes for Quin.
    const { final, ids } = await playNightfall(clients, roles as never, (i) => (i === 0 ? 1 : 0));
    const result = final[0]!.reveal!.result;
    const name = (id: string) => final[0]!.table!.find((p) => p.id === id)!.name;

    // Give the recorder a moment to write.
    await new Promise((r) => setTimeout(r, 2500));
    const stats = await get<GameStats>('games/nightfall?range=today');
    expect(stats.totals).toMatchObject({ gamesStarted: 1, gamesFinished: 1 });
    const figs = Object.fromEntries(stats.figures.map((f) => [f.id, f]));
    const won = (team: string) => (result.teams.some((t) => t.team === team && t.won) ? 1 : 0);
    const parts = (figs['wins-by-team'] as { parts: { label: string; value: number }[] }).parts;
    expect(parts).toContainEqual({ label: 'Village', value: won('village') });
    expect(parts).toContainEqual({ label: 'Werewolves', value: won('werewolf') });
    expect(parts).toContainEqual({ label: 'Nobody', value: result.winners.length ? 0 : 1 });
    const endings = figs.endings as { parts: { value: number }[] };
    expect(endings.parts.reduce((n, p) => n + p.value, 0)).toBe(1);
    const wolf = (id: string) => ['werewolf'].includes(String(result.identities[id]!.role));
    const onWolves = ids.filter((v) => wolf(result.votes[v]!)).length;
    expect(figs['vote-accuracy']).toMatchObject({
      kind: 'percent',
      value: Math.round((onWolves / 3) * 1000) / 10,
    });
    const matrix = figs.roles as { kind: string; rows: { label: string; values: number[] }[] };
    expect(matrix.kind).toBe('matrix');
    expect(matrix.rows.map((r) => r.label).sort()).toEqual([
      'Robber',
      'Seer',
      'Troublemaker',
      'Villager',
      'Werewolf',
    ]);
    for (const row of matrix.rows) expect(row.values[0]).toBe(1);
    expect(figs['win-rate-by-players']).toMatchObject({ kind: 'matrix', columns: ['3 players'] });
    expect(figs['night-length']).toMatchObject({ kind: 'number', unit: 's' });
    expect((figs['night-length'] as { value: number }).value).toBeGreaterThan(4);

    const dealt = await get<StatsWords>('words?game=nightfall&kind=clue&range=today');
    expect(dealt.words.reduce((n, w) => n + w.count, 0)).toBe(3);

    const facts = Object.fromEntries(
      (await get<StatsFun>('fun?range=today')).facts.map((f) => [f.id, f]),
    );
    const villagerDied = result.deaths.some((d) => result.identities[d.player]!.team === 'village');
    if (villagerDied) {
      expect(facts['village-idiot']).toMatchObject({ title: 'Village Idiot', gameId: 'nightfall' });
      expect(facts['village-idiot']!.text).toContain(name(result.deaths[0]!.player));
    } else expect(facts['village-idiot']).toBeUndefined();
    if (onWolves > 0) expect(facts['werewolf-whisperer']).toMatchObject({ gameId: 'nightfall' });
    else expect(facts['werewolf-whisperer']).toBeUndefined();
    const players = (await get<StatsPlayers>('players?range=today')).players;
    expect(
      players
        .filter((p) => p.wins > 0)
        .map((p) => p.name)
        .sort(),
    ).toEqual(result.winners.map(name).sort());
  }, 60_000);

  it('turns a Round Table game into figures and fun facts', async () => {
    const { app, url, get } = await start();
    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'round-table', token: token(110) },
      })
    ).json<{ roomId: string }>();
    const clients: TestClient[] = [];
    for (const [i, name] of ['Ula', 'Vic', 'Wes', 'Xan', 'Yul'].entries()) {
      const c = await connect(url);
      cleanups.push(() => void c.close());
      expect(await c.call('room:join', { roomId, token: token(110 + i), name })).toEqual({
        ok: true,
      });
      clients.push(c);
    }
    await clients[0]!.until((s) => s.players.length === 5);
    const { assassin } = await playRoundTable(clients, true);
    await new Promise((r) => setTimeout(r, 2500));
    const stats = (await get<GameStats>('games/round-table?range=today')).body;
    expect(stats.totals).toMatchObject({ gamesStarted: 1, gamesFinished: 1 });
    const figs = Object.fromEntries(stats.figures.map((f) => [f.id, f]));
    expect(figs['wins-by-side']).toMatchObject({
      kind: 'split',
      parts: [
        { label: 'Good', value: 0 },
        { label: 'Evil', value: 1 },
      ],
    });
    expect(figs['evil-wins']).toMatchObject({
      parts: [
        { label: 'Three quests sunk', value: 0 },
        { label: 'Five rejections', value: 0 },
        { label: 'Merlin assassinated', value: 1 },
      ],
    });
    expect(figs['merlin-survival']).toMatchObject({ kind: 'percent', value: 0 });
    // One rejected team, then three approved ones.
    expect(figs['approval-rate']).toMatchObject({ kind: 'percent', value: 75 });
    expect(figs['quest-success']).toMatchObject({ value: 100 });
    expect(figs['win-rate-by-players']).toMatchObject({ kind: 'matrix', columns: ['5 players'] });
    const roles = figs.roles as { rows: { label: string; values: number[] }[] };
    expect(roles.rows.map((r) => r.label).sort()).toEqual(
      ['Assassin', 'Loyal Servant', 'Merlin', 'Morgana', 'Percival'].sort(),
    );
    const facts = Object.fromEntries(
      (await get<StatsFun>('fun?range=today')).body.facts.map((f) => [f.id, f]),
    );
    expect(facts['most-suspected']).toMatchObject({ gameId: 'round-table' });
    const players = (await get<StatsPlayers>('players?range=today')).body.players;
    expect(players.filter((p) => p.wins > 0)).toHaveLength(2);
    expect(players.find((p) => p.id === assassin)?.wins).toBe(1);
  }, 60_000);

  it('requires an admin and validates parameters', async () => {
    const { app, cookie, get } = await start();
    for (const path of ['live', 'overview', 'players/x', 'export']) {
      const res = await app.inject({ method: 'GET', url: `/api/admin/stats/${path}` });
      expect(res.statusCode).toBe(401);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/stats/reset',
          payload: { confirm: STATS_RESET_CONFIRM },
        })
      ).statusCode,
    ).toBe(401);

    for (const bad of [
      'overview?range=forever',
      'overview?range=custom&from=2026-10-01',
      'overview?range=custom&from=2026-10-05&to=2026-10-01',
      'overview?bucket=minute',
      'overview?game=chess',
      'timeseries?metric=fun',
      'words?game=codenames',
      'words?game=codenames&kind=clue&limit=1000',
      'settings',
      'export?from=yesterday',
    ]) {
      const res = await get<{ error: { code: string } }>(bad);
      expect([bad, res.status, res.body.error.code]).toEqual([bad, 400, 'bad-request']);
    }
    expect((await get('games/chess')).status).toBe(404);
    expect((await get('overview?range=custom&from=2026-10-01&to=2026-10-05')).status).toBe(200);

    const reset = (payload: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/api/admin/stats/reset', payload, headers: { cookie } });
    expect((await reset({ confirm: 'yes' })).statusCode).toBe(400);
    expect((await reset({ confirm: STATS_RESET_CONFIRM })).json()).toEqual({ ok: true });
  });

  it('rate-limits stats reads to 120 a minute', async () => {
    const { get } = await start();
    for (let i = 0; i < 120; i++) expect((await get('live')).status).toBe(200);
    expect((await get('live')).status).toBe(429);
  });

  it('forgets everything on reset', async () => {
    const { app, url, cookie, get } = await start();
    await room(app, url, 'codenames', ['Host']);
    expect((await get<StatsOverview>('overview')).body.totals.roomsCreated).toBe(1);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/stats/reset',
      payload: { confirm: STATS_RESET_CONFIRM },
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect((await get<StatsOverview>('overview')).body.totals.roomsCreated).toBe(0);
    expect((await get<StatsPlayers>('players')).body.players).toEqual([]);
  });
});
