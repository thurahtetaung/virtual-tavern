import { defineConfig, devices } from '@playwright/test';
import {
  TEST_ADMIN_PASSWORD,
  TEST_SESSION_SECRET,
  TEST_STATS_IGNORE_TOKEN,
} from './e2e/credentials.ts';

const PORT = 4321;
const SHARED_STATE = [
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
];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // One retry gives a trace for debugging, but a test that only passes on retry still fails the run:
  // flaky tests must be fixed, not hidden.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, testIgnore: SHARED_STATE },
    // These specs share server-wide state: the back-room password (setting it or signing everyone
    // out ends every unlock) and the question decks a new Hoodwink room offers. One at a time.
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
      // Inquest's events spec needs these events first when the pile gets its events.
      INQUEST_TEST_EVENTS: 'ruled-out,erroneous,countdown',
    },
  },
});
