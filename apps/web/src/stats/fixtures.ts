import type {
  FunFact,
  GameFigure,
  GameStats,
  LiveStats,
  PlayerProfile,
  PlayerSummary,
  SeriesPoint,
  StatsBucket,
  StatsFun,
  StatsOverview,
  StatsPlayers,
  StatsRange,
  StatsTotals,
  StatsWindow,
  StatsWords,
  WordKind,
} from '@vt/protocol';

// Typed sample responses for every stats endpoint, used while the page is built (dev with
// VITE_STATS_FIXTURES=1) and by the e2e specs, which serve them through `page.route`. Everything is
// deterministic: a seeded generator and a fixed "now". Type-only imports keep this file loadable
// from Playwright without a bundler. Never imported by production code paths.

export const FIXTURE_NOW = Date.UTC(2026, 9, 10, 18, 30);
const TODAY = '2026-10-10';
const DAY_MS = 86_400_000;
const FIRST_DAY = '2026-04-02';

export const FIXTURE_GAMES = ['codenames', 'enigma', 'echo', 'reverie', 'hoodwink'] as const;
const FIXTURE_NAMES: Record<string, string> = {
  codenames: 'Codenames',
  enigma: 'Enigma',
  echo: 'Echo',
  reverie: 'Reverie',
  hoodwink: 'Hoodwink',
};
const named = (ids: readonly string[]) => ids.map((id) => ({ id, name: FIXTURE_NAMES[id] ?? id }));

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => dayOf(dayMs(d) + n * DAY_MS);

function windowFor(q: URLSearchParams): StatsWindow {
  const range = (q.get('range') ?? '30d') as StatsRange;
  let from = TODAY;
  let to = TODAY;
  const back: Partial<Record<StatsRange, number>> = { '7d': 6, '30d': 29, '90d': 89, '1y': 364 };
  if (range === 'custom') {
    from = q.get('from') ?? addDays(TODAY, -29);
    to = q.get('to') ?? TODAY;
  } else if (range === 'all') from = FIRST_DAY;
  else if (back[range] !== undefined) from = addDays(TODAY, -back[range]);
  const days = Math.round((dayMs(to) - dayMs(from)) / DAY_MS) + 1;
  const bucket =
    (q.get('bucket') as StatsBucket | null) ?? (days <= 2 ? 'hour' : days <= 180 ? 'day' : 'week');
  return { from, to, bucket, previousFrom: addDays(from, -days), previousTo: addDays(from, -1) };
}

/** "Today" is the empty case: nothing has been played yet, so every card shows its empty state. */
const isEmpty = (q: URLSearchParams) => q.get('range') === 'today';

/** Games started on a day, per game: busier at weekends, Reverie only now and then. */
function dayGames(day: string, game: string): number {
  const r = rng(hash(day + game))();
  const weekday = (new Date(dayMs(day)).getUTCDay() + 6) % 7;
  const weekend = weekday >= 4 ? 2.2 : 1;
  const base: Record<string, number> = {
    codenames: 2.4,
    enigma: 1.2,
    echo: 1.8,
    reverie: 0.5,
    hoodwink: 0.7,
  };
  if (dayMs(day) < dayMs(FIRST_DAY)) return 0;
  return Math.floor(r * (base[game] ?? 1) * weekend * 1.6);
}

function bucketStarts(w: StatsWindow): string[] {
  const out: string[] = [];
  if (w.bucket === 'hour') {
    for (let d = w.from; d <= w.to; d = addDays(d, 1))
      for (let h = 0; h < 24; h++) out.push(`${d}T${String(h).padStart(2, '0')}`);
  } else if (w.bucket === 'day') {
    for (let d = w.from; d <= w.to; d = addDays(d, 1)) out.push(d);
  } else if (w.bucket === 'week') {
    const wd = (new Date(dayMs(w.from)).getUTCDay() + 6) % 7;
    for (let d = addDays(w.from, -wd); d <= w.to; d = addDays(d, 7)) out.push(d);
  } else {
    let [y, m] = w.from.split('-').map(Number) as [number, number];
    for (;;) {
      const d = `${y}-${String(m).padStart(2, '0')}-01`;
      if (d > w.to) break;
      out.push(d);
      m++;
      if (m > 12) [y, m] = [y + 1, 1];
    }
  }
  return out;
}

function activity(w: StatsWindow, games: readonly string[], empty: boolean): SeriesPoint[] {
  const starts = bucketStarts(w);
  return starts.map((t, i) => {
    const values: Record<string, number> = {};
    let all = 0;
    for (const g of games) {
      let v = 0;
      if (!empty) {
        if (w.bucket === 'hour') {
          const hour = Number(t.slice(11, 13));
          const evening = hour >= 18 && hour <= 23 ? 1 : hour >= 12 ? 0.35 : 0.05;
          v = Math.floor(rng(hash(t + g))() * 2.4 * evening);
        } else {
          const end = starts[i + 1] ?? addDays(w.to, 1);
          for (let d = t < w.from ? w.from : t; d < end && d <= w.to; d = addDays(d, 1))
            v += dayGames(d, g);
        }
      }
      values[g] = v;
      all += v;
    }
    values._all = all;
    return { t, values };
  });
}

function calendar(w: StatsWindow, empty: boolean) {
  const out: { day: string; games: number }[] = [];
  for (let d = w.from; d <= w.to; d = addDays(d, 1)) {
    out.push({ day: d, games: empty ? 0 : FIXTURE_GAMES.reduce((s, g) => s + dayGames(d, g), 0) });
  }
  return out;
}

function totalsFor(
  w: StatsWindow,
  games: readonly string[],
  empty: boolean,
  from = w.from,
  to = w.to,
): StatsTotals {
  if (empty) {
    return {
      roomsCreated: 0,
      gamesStarted: 0,
      gamesFinished: 0,
      gamesAbandoned: 0,
      uniquePlayers: 0,
      minutesPlayed: 0,
    };
  }
  let started = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) for (const g of games) started += dayGames(d, g);
  const finished = Math.round(started * 0.82);
  return {
    roomsCreated: Math.round(started * 0.55) + 1,
    gamesStarted: started,
    gamesFinished: finished,
    gamesAbandoned: started - finished,
    uniquePlayers: Math.min(14, 4 + Math.round(Math.sqrt(started))),
    minutesPlayed: started * 21,
  };
}

export function fixtureOverview(q: URLSearchParams): StatsOverview {
  const w = windowFor(q);
  const empty = isEmpty(q);
  const weekHour: StatsOverview['weekHour'] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    for (let hour = 0; hour < 24; hour++) {
      const evening = hour >= 18 && hour <= 23 ? 1 : hour >= 13 ? 0.3 : 0;
      const weekend = weekday >= 4 ? 1.8 : 1;
      const games = empty
        ? 0
        : Math.floor(rng(hash(`${weekday}-${hour}`))() * 6 * evening * weekend);
      weekHour.push({ weekday, hour, games });
    }
  }
  const totals = totalsFor(w, FIXTURE_GAMES, empty);
  return {
    window: w,
    totals,
    previous: totalsFor(w, FIXTURE_GAMES, empty, w.previousFrom, w.previousTo),
    activity: activity(w, FIXTURE_GAMES, empty),
    calendar: calendar(w, empty),
    weekHour,
    gameMix: FIXTURE_GAMES.map((gameId) => {
      const t = totalsFor(w, [gameId], empty);
      return { gameId, games: t.gamesStarted, minutes: t.minutesPlayed };
    }),
    games: named(FIXTURE_GAMES),
  };
}

// The same figures, ids and labels the server builds (`apps/server/src/stats/figures.ts`).
// Percents are 0–100, as in the contract.
const wins = (red: number, blue: number, draw?: number): GameFigure => ({
  id: 'wins',
  label: 'Wins by team',
  kind: 'split',
  parts: [
    { label: 'Red', value: red },
    { label: 'Blue', value: blue },
    ...(draw === undefined ? [] : [{ label: 'Draw', value: draw }]),
  ],
});

const FIGURES: Record<string, GameFigure[]> = {
  codenames: [
    wins(30, 25),
    { id: 'assassin-rate', label: 'Games ended by the assassin', kind: 'percent', value: 18.2 },
    { id: 'average-clue', label: 'Average clue number', kind: 'number', value: 2.1 },
    {
      id: 'guess-accuracy',
      label: 'Guesses that found their own agent',
      kind: 'percent',
      value: 71.4,
    },
  ],
  enigma: [
    wins(12, 14, 2),
    { id: 'decode-rate', label: 'Codes decoded by their own team', kind: 'percent', value: 78 },
    {
      id: 'intercept-rate',
      label: 'Interception attempts that worked',
      kind: 'percent',
      value: 21.3,
    },
    { id: 'rounds-per-game', label: 'Rounds per game', kind: 'number', value: 6.4 },
  ],
  echo: [
    {
      id: 'scores',
      label: 'Scores',
      kind: 'histogram',
      bins: [0, 0, 1, 1, 2, 3, 5, 6, 4, 2, 1, 0, 1, 0].map((value, n) => ({
        label: String(n),
        value,
      })),
    },
    { id: 'best-score', label: 'Best score', kind: 'number', value: 12 },
    { id: 'average-score', label: 'Average score', kind: 'number', value: 7.2 },
    { id: 'perfect-games', label: 'Perfect games', kind: 'number', value: 1 },
    { id: 'right-rate', label: 'Cards guessed right', kind: 'percent', value: 74.9 },
    { id: 'pass-rate', label: 'Cards passed', kind: 'percent', value: 12 },
  ],
  reverie: [
    {
      id: 'all-or-none',
      label: 'Stories everyone or nobody found',
      kind: 'percent',
      value: 27,
    },
    {
      id: 'found-rate',
      label: "Votes that found the storyteller's card",
      kind: 'percent',
      value: 46.5,
    },
    { id: 'average-target', label: 'Average target score', kind: 'number', value: 30 },
  ],
  hoodwink: [
    { id: 'truth-rate', label: 'Votes that found the truth', kind: 'percent', value: 41.3 },
    { id: 'fooling-rate', label: 'Lies that fooled someone', kind: 'percent', value: 58 },
    { id: 'fooled-per-lie', label: 'Players fooled per lie', kind: 'number', value: 0.9 },
  ],
};

export function fixtureGame(gameId: string, q: URLSearchParams): GameStats {
  const w = windowFor(q);
  const empty = isEmpty(q);
  const totals = totalsFor(w, [gameId], empty);
  const settings: GameStats['settings'] = empty
    ? []
    : [
        {
          key: 'wordList',
          value: 'starter',
          label: 'Starter words',
          games: Math.round(totals.gamesStarted * 0.6),
        },
        {
          key: 'wordList',
          value: 'tavern',
          label: 'Tavern classics',
          games: Math.round(totals.gamesStarted * 0.3),
        },
        {
          key: 'wordList',
          value: 'mixed',
          label: 'Both lists',
          games: Math.round(totals.gamesStarted * 0.1),
        },
        {
          key: 'timerMode',
          value: 'off',
          label: 'No timer',
          games: Math.round(totals.gamesStarted * 0.7),
        },
        {
          key: 'timerMode',
          value: 'relaxed',
          label: 'Relaxed timer',
          games: Math.round(totals.gamesStarted * 0.3),
        },
      ];
  return {
    gameId,
    window: w,
    totals,
    activity: activity(w, [gameId], empty),
    averageMinutes: empty ? 0 : 18 + (hash(gameId) % 9),
    averagePlayers: empty ? 0 : 4 + (hash(gameId) % 3) / 2,
    playerCounts: empty
      ? []
      : [3, 4, 5, 6, 7, 8].map((players, i) => ({ players, games: [2, 9, 7, 5, 2, 1][i]! })),
    settings,
    figures: empty ? [] : (FIGURES[gameId] ?? []),
  };
}

const WORDS = [
  'Lantern',
  'Anchor',
  'Harbor',
  'Comet',
  'Velvet',
  'Thistle',
  'Ember',
  'Marble',
  'Orchard',
  'Kettle',
  'Glacier',
  'Compass',
  'Falcon',
  'Meadow',
  'Saffron',
  'Tundra',
  'Whistle',
  'Copper',
  'Riddle',
  'Pepper',
  'Canyon',
  'Willow',
  'Beacon',
  'Pebble',
  'Cobalt',
  'Juniper',
  'Mosaic',
  'Quarry',
  'Satchel',
  'Thunder',
  'Echo',
  'Banjo',
  'Cactus',
  'Dynamo',
  'Fable',
  'Gondola',
  'Hammock',
  'Igloo',
  'Jigsaw',
  'Kayak',
];

export function fixtureWords(gameId: string, kind: WordKind, q: URLSearchParams): StatsWords {
  const w = windowFor(q);
  const limit = Number(q.get('limit') ?? 50);
  const r = rng(hash(gameId + kind));
  const words = isEmpty(q)
    ? []
    : WORDS.map((word) => ({ word, count: Math.max(1, Math.round(r() ** 2.4 * 28)) }))
        .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
        .slice(0, Math.min(limit, kind === 'assassin' ? 9 : 40));
  return { gameId, kind, window: w, words };
}

const PLAYERS: { id: string; names: string[] }[] = [
  { id: 'p-hana', names: ['Hana', 'Hana B.'] },
  { id: 'p-ana', names: ['Ana'] },
  { id: 'p-ben', names: ['Ben', 'Benny', 'B'] },
  { id: 'p-cy', names: ['Cy'] },
  { id: 'p-dara', names: ['Dara', 'DJ'] },
  { id: 'p-eli', names: ['Eli'] },
  { id: 'p-fen', names: ['Fen', 'Fenwick'] },
  { id: 'p-gus', names: ['Gus'] },
  { id: 'p-ivy', names: ['Ivy', 'Ivy the Terrible'] },
  { id: 'p-jo', names: ['Jo'] },
  { id: 'p-kai', names: ['Kai'] },
  { id: 'p-lou', names: ['Lou'] },
].map((p) => ({ ...p, id: `${p.id}-${'0'.repeat(8)}` }));

function summary(p: (typeof PLAYERS)[number], i: number): PlayerSummary {
  const r = rng(hash(p.id));
  const byGame: Record<string, number> = {};
  let games = 0;
  for (const g of FIXTURE_GAMES) {
    const n = Math.round(r() * (g === 'reverie' || g === 'hoodwink' ? 6 : 24) * (1 - i / 16));
    if (n) byGame[g] = n;
    games += n;
  }
  return {
    id: p.id,
    name: p.names[0]!,
    aliases: p.names,
    firstSeen: dayMs(FIRST_DAY) + Math.round(r() * 30) * DAY_MS,
    lastSeen: FIXTURE_NOW - Math.round(r() * 9 * DAY_MS),
    games,
    wins: Math.round(games * (0.3 + r() * 0.35)),
    minutes: games * (16 + Math.round(r() * 10)),
    byGame,
  };
}

export function fixturePlayers(q: URLSearchParams): StatsPlayers {
  return {
    window: windowFor(q),
    players: isEmpty(q) ? [] : PLAYERS.map(summary).sort((a, b) => b.games - a.games),
  };
}

export function fixturePlayer(id: string): PlayerProfile | undefined {
  const i = PLAYERS.findIndex((p) => p.id === id);
  const p = PLAYERS[i];
  if (!p) return undefined;
  const s = summary(p, i);
  const r = rng(hash(p.id + 'cal'));
  const cal: { day: string; games: number }[] = [];
  for (let d = addDays(TODAY, -364); d <= TODAY; d = addDays(d, 1)) {
    cal.push({ day: d, games: d < FIRST_DAY ? 0 : r() < 0.18 ? 1 + Math.floor(r() * 4) : 0 });
  }
  return {
    ...s,
    names: p.names.map((name, k) => ({
      name,
      uses: Math.max(1, Math.round(s.games / (k + 1.5))),
      firstSeen: s.firstSeen + k * 20 * DAY_MS,
      lastSeen: s.lastSeen - k * 11 * DAY_MS,
    })),
    calendar: cal,
    facts: [
      {
        id: 'fastest',
        title: 'Fastest guesser',
        text: `${s.name} guessed in 3.2 s on average.`,
        gameId: 'codenames',
        playerId: p.id,
      },
      {
        id: 'echo',
        title: 'The echo',
        text: `${s.name} matched a teammate's clue 9 times.`,
        gameId: 'echo',
        playerId: p.id,
      },
      {
        id: 'magnet',
        title: 'Assassin magnet',
        text: `${s.name} found the assassin twice. Bold.`,
        gameId: 'codenames',
        playerId: p.id,
      },
    ],
  };
}

export function fixtureFun(q: URLSearchParams): StatsFun {
  const facts: FunFact[] = [
    {
      id: 'drama',
      title: 'Most dramatic finish',
      text: 'Blue won on the last card with 4 s left on the clock.',
      gameId: 'codenames',
    },
    {
      id: 'longest-enigma',
      title: 'Longest Enigma',
      text: 'Eight rounds and 52 minutes before anyone cracked it.',
      gameId: 'enigma',
      value: 52,
    },
    {
      id: 'perfect-echo',
      title: 'Perfect Echo',
      text: 'Hana, Ben and Cy guessed all 13 cards without a single pass.',
      gameId: 'echo',
    },
    {
      id: 'cancelled',
      title: 'Great minds',
      text: '“Ocean” was cancelled 7 times: everyone thinks alike.',
      gameId: 'echo',
    },
    {
      id: 'night-owls',
      title: 'Night owls',
      text: 'The latest game started at 02:41 on a Sunday.',
    },
    {
      id: 'assassin',
      title: 'Riskiest word',
      text: '“Comet” has met the assassin 4 times.',
      gameId: 'codenames',
    },
    {
      id: 'regulars',
      title: 'Regulars',
      text: 'Ana has played every Friday this month.',
      playerId: PLAYERS[1]!.id,
    },
    {
      id: 'story',
      title: 'Favourite clue',
      text: '“Somewhere warm” was told three times.',
      gameId: 'reverie',
    },
    {
      id: 'best-liar',
      title: 'Best liar',
      text: 'Kai’s lies fooled 17 players.',
      gameId: 'hoodwink',
      playerId: PLAYERS[10]!.id,
    },
  ];
  return { window: windowFor(q), facts: isEmpty(q) ? [] : facts };
}

export function fixtureLive(): LiveStats {
  const now = FIXTURE_NOW;
  const r = rng(99);
  const lastHour = Array.from({ length: 60 }, (_, i) => ({
    ts: now - (59 - i) * 60_000,
    players: Math.max(0, Math.round(4 + i / 8 + (r() - 0.5) * 3)),
  }));
  const player = (id: string, name: string, connected = true) => ({ id, name, connected });
  return {
    now,
    sockets: 14,
    playersOnline: 11,
    playersRecent: 13,
    rooms: [
      {
        id: 'r-amber-fox',
        gameId: 'codenames',
        phase: 'playing',
        players: [
          player('p1', 'Hana'),
          player('p2', 'Ana'),
          player('p3', 'Ben'),
          player('p4', 'Cy', false),
          player('p5', 'Dara'),
        ],
        hostId: 'p1',
        createdAt: now - 42 * 60_000,
        updatedAt: now - 20_000,
      },
      {
        id: 'r-quiet-owl',
        gameId: 'echo',
        phase: 'lobby',
        players: [player('p6', 'Eli'), player('p7', 'Fen'), player('p8', 'Gus')],
        hostId: 'p6',
        createdAt: now - 6 * 60_000,
        updatedAt: now - 60_000,
      },
      {
        id: 'r-brass-key',
        gameId: 'enigma',
        phase: 'playing',
        players: [
          player('p9', 'Ivy'),
          player('p10', 'Jo'),
          player('p11', 'Kai'),
          player('p12', 'Lou'),
        ],
        hostId: 'p10',
        createdAt: now - 95 * 60_000,
        updatedAt: now - 5_000,
      },
    ],
    byGame: [
      { gameId: 'codenames', rooms: 1, playing: 1, players: 5 },
      { gameId: 'enigma', rooms: 1, playing: 1, players: 4 },
      { gameId: 'echo', rooms: 1, playing: 0, players: 3 },
    ],
    lastHour,
    games: named(['codenames', 'enigma', 'echo']),
  };
}

/**
 * The fixture for a stats API path (with its query), or undefined for an unknown path. This is
 * the whole fake server: the dev fixture source and the e2e `page.route` both call it.
 */
export function fixtureFor(pathWithQuery: string): unknown {
  const url = new URL(pathWithQuery, 'http://fixture.local');
  const q = url.searchParams;
  const path = url.pathname.replace(/^\/api\/admin\/stats\/?/, '');
  const [head, id] = path.split('/');
  switch (head) {
    case 'live':
      return fixtureLive();
    case 'overview':
      return fixtureOverview(q);
    case 'games':
      return id ? fixtureGame(decodeURIComponent(id), q) : undefined;
    case 'players':
      return id ? fixturePlayer(decodeURIComponent(id)) : fixturePlayers(q);
    case 'words':
      return fixtureWords(q.get('game') ?? '', (q.get('kind') ?? 'clue') as WordKind, q);
    case 'fun':
      return fixtureFun(q);
    default:
      return undefined;
  }
}
