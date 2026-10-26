import { defineConfig, devices } from '@playwright/test';
import {
  TEST_ADMIN_PASSWORD,
  TEST_SESSION_SECRET,
  TEST_STATS_IGNORE_TOKEN,
} from './e2e/credentials.ts';

const PORT = 4321;
export const SHARED_STATE = [
  /backroom\.spec\.ts$/,
  /reverie\.spec\.ts$/,
  /hoodwink\.spec\.ts$/,
  /royal-post\.spec\.ts$/,
  /nightfall\.spec\.ts$/,
  /nightfall-vampire\.spec\.ts$/,
  /nightfall-alien\.spec\.ts$/,
  /masquerade-originals\.spec\.ts$/,
  /question-decks\.spec\.ts$/,
  /screenshots\.spec\.ts$/,
  /recap-backroom\.spec\.ts$/,
  /inquest\.spec\.ts$/,
  /inquest-allies\.spec\.ts$/,
  /playtest\.spec\.ts$/,
  /seance\.spec\.ts$/,
  /hydra\.spec\.ts$/,
  /hogwarts\.spec\.ts$/,
  /tavern-brawl[\w-]*\.spec\.ts$/,
  /short-fuse(-\w+)?\.spec\.ts$/,
  /starlight\.spec\.ts$/,
  /thorns[\w-]*\.spec\.ts$/,
  /iconic\.spec\.ts$/,
  /stampede[\w-]*\.spec\.ts$/,
  /jeweller[\w-]*\.spec\.ts$/,
  /going-once[\w-]*\.spec\.ts$/,
  /sketchy[\w-]*\.spec\.ts$/,
  /mosaic[\w-]*\.spec\.ts$/,
  /games-admin\.spec\.ts$/,
  /guide-shots\.spec\.ts$/,
];

/** Every game, for `introsSeen`. */
const GAME_IDS = [
  'codenames',
  'enigma',
  'echo',
  'masquerade',
  'round-table',
  'reverie',
  'hoodwink',
  'royal-post',
  'masquerade-originals',
  'nightfall',
  'inquest',
  'seance',
  'hydra',
  'hogwarts',
  'tavern-brawl',
  'short-fuse',
  'starlight',
  'thorns',
  'iconic',
  'stampede',
  'jeweller',
  'going-once',
  'sketchy',
  'mosaic',
];

/**
 * Every game's first-time lobby intro counts as seen, so it never sits over a spec's lobby
 * (`guides.spec.ts` clears it to test it).
 */
export const introsSeen = (origin: string) => ({
  cookies: [],
  origins: [
    {
      origin,
      localStorage: GAME_IDS.map((id) => ({ name: `vt.guide.intro.${id}`, value: '1' })),
    },
  ],
});

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One retry gives a trace for debugging, but a test that only passes on retry still fails the run:
  // flaky tests must be fixed, not hidden.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  // CI keeps a JSON report too: its timings rebalance the shards (`node e2e/shards.ts --update`).
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['json', { outputFile: 'e2e-timings.json' }]]
    : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    storageState: introsSeen(`http://127.0.0.1:${PORT}`),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: SHARED_STATE },
    // These specs share server-wide state: the back-room password (setting it or signing everyone
    // out ends every unlock), the question decks a new Hoodwink room offers and the content packs
    // Going Once deals from. One at a time.
    {
      name: 'back-room',
      use: { ...devices['Desktop Chrome'] },
      testMatch: SHARED_STATE,
      workers: 1,
    },
  ],
  // Runs the production build: `pnpm build` first.
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATABASE_PATH: ':memory:',
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      SESSION_SECRET: TEST_SESSION_SECRET,
      STATS_IGNORE_TOKEN: TEST_STATS_IGNORE_TOKEN,
      // Every browser shares one address, so the suite would trip the per-address room limit.
      ROOM_CREATE_LIMIT: '1000',
      LOG_LEVEL: 'warn',
      // Rooms draw their randomness from this seed and the one each test's browsers send
      // (`e2e/fixtures.ts`), so a test deals the same cards, roles and colours on every run.
      VT_TEST_SEED: 'e2e',
      // Inquest's events specs need these events first when the pile gets its events (the
      // Allies expansion's perfect-crime only counts in games with the expansion on).
      INQUEST_TEST_EVENTS: 'perfect-crime,ruled-out,erroneous,countdown',
      // Hydra's specs reach the powers with red policies on top of every deck.
      HYDRA_TEST_DECK: 'rrrrrrrrrrr',
      // Tavern Brawl's spec scripts its first two turns: these cards start the druid's and the
      // mage's decks (and the dragon's, for its everyone-chooses), and the first seat goes first.
      TAVERN_BRAWL_TEST_DECK:
        'druid:druid.09,druid.05,druid.02,druid.08;mage:mage.06,mage.02,mage.10,mage.01;dragon:dragon.03',
      // Its full games of three or more start on fewer hit points, so each ends in a few rounds.
      TAVERN_BRAWL_TEST_HP: '3:3,4:3,5:3,6:3',
      // Nightfall's specs click through 8-second night steps: a step waits (up to 30 s more) for a
      // choice still to be made, so a busy machine's clicks aren't beaten by the step's clock.
      NIGHTFALL_TEST_HOLD: '30',
      // Short Fuse's specs fix hands and the top of the pile from the lobby (`rig`).
      SHORT_FUSE_TEST_RIG: '1',
      // Iconic's spec knows the answer: every card's first word.
      ICONIC_TEST_WORD: 'Paper Lantern',
      // Jeweller's specs: the first seat starts owning 4 white, 3 black and three level-III blue
      // cards (12 points), one black card it can finish with tops the level-I deck, and only one
      // noble on the table fits it, so a game reaches a noble visit and the end in a few turns.
      // With Cities, a blue 2-point card (one white gem) meets the first City; with Strongholds,
      // two of the first seat's sit on that black card and a free blue card lies beside it.
      JEWELLER_TEST_DECK:
        '1:L1-35,L1-09;2:L2-11;n:N09,N01,N03;c:C3a,C2a,C7b;h:L1-35,L1-35;own:L1-01,L1-02,L1-03,L1-04,L1-33,L1-34,L1-36,L3-05,L3-06,L3-08',
      // Going Once's spec fixes the deal and halves its clocks from the lobby (`rig`).
      GOING_ONCE_TEST_RIG: '1',
      // Sketchy's spec knows each player's prompt: packs dealt in order, drawings in seat order.
      SKETCHY_TEST_RIG: '1',
      // Mosaic's spec knows the deal: two blues, then a run of single colours, top the bag, and
      // the first seat's top wall row lacks only its blue, so the first round ends the game.
      MOSAIC_TEST_BAG: 'top:bbyyrrrrkkkkaaaayyyy;wall0:yrka',
    },
  },
});
