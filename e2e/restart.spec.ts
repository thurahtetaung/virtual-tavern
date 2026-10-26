import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, expect } from '@playwright/test';
import { introsSeen } from '../playwright.config.ts';
import { TEST_ADMIN_PASSWORD, TEST_SESSION_SECRET } from './credentials.ts';
import { test } from './fixtures.ts';

// This spec restarts a server, so it runs its own (the production build) instead of the shared one.
const PORT = 4398;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'vt-restart-'));

function startServer(): ChildProcess {
  return spawn('node', ['apps/server/dist/index.js'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATABASE_PATH: join(dir, 'tavern.db'),
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
      SESSION_SECRET: TEST_SESSION_SECRET,
      LOG_LEVEL: 'warn',
      VT_TEST_SEED: 'e2e',
    },
  });
}

async function healthy() {
  await expect
    .poll(
      () =>
        fetch(`${ORIGIN}/healthz`).then(
          (r) => r.ok,
          () => false,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
}

async function stopServer(server: ChildProcess) {
  if (server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  await exited;
}

let server: ChildProcess | null = null;
test.afterAll(async () => {
  if (server) await stopServer(server);
  rmSync(dir, { recursive: true, force: true });
});

async function player(browser: Browser, name: string, url = `${ORIGIN}/`) {
  const page = await (await browser.newContext({ storageState: introsSeen(ORIGIN) })).newPage();
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

test('every tab in a room reconnects by itself after the server restarts', async ({ browser }) => {
  server = startServer();
  await healthy();
  const hana = await player(browser, 'Hana');
  await hana.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(hana).toHaveURL(/\/r\//);
  const ana = await player(browser, 'Ana', hana.url());
  await expect(ana.getByText('Pick a team below')).toBeVisible();

  await stopServer(server);
  const lost = 'Connection lost. Reconnecting…';
  await expect(hana.getByText(lost)).toBeVisible();
  await expect(ana.getByText(lost)).toBeVisible();
  // Down for a few seconds, as during a deploy.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  server = startServer();
  await healthy();

  // Both are back in the room within seconds, and their taps reach each other.
  await expect(hana.getByText(lost)).toBeHidden({ timeout: 15_000 });
  await expect(ana.getByText(lost)).toBeHidden({ timeout: 15_000 });
  await ana.getByRole('button', { name: 'Join Red as Operative' }).click();
  await expect(hana.getByRole('region', { name: 'Red team' }).getByText('Ana')).toBeVisible();
  await hana.getByRole('button', { name: 'Join Blue as Operative' }).click();
  await expect(ana.getByRole('region', { name: 'Blue team' }).getByText('Hana')).toBeVisible();
});
