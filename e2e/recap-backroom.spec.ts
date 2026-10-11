import { type Browser, type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';
import { expectStrips, playEscape, wrapUp } from './recap-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

// The back-room knock and admin sign-in are rate-limited per address, so each browser gets its
// own (a range no other spec uses).
let nextIp = 1;
async function visitor(browser: Browser, name: string) {
  const worker = Number(process.env.TEST_WORKER_INDEX ?? 0) % 200;
  const context = await browser.newContext({
    extraHTTPHeaders: { 'cf-connecting-ip': `10.11.${worker}.${(nextIp++ % 250) + 1}` },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => void d.accept());
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  return page;
}

async function unlock(page: Page, url = '/backroom') {
  await page.goto(url);
  await page.getByLabel('The word').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: 'Knock' }).click();
}

test('a back-room night names private locations on the card and in the chat text', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = await visitor(browser, 'Admin');
  await ownLoginLimit(admin);
  await admin.goto('/tavern-keeper');
  await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
  await admin.getByRole('button', { name: /Open the back room|Change password/ }).click();
  await expect(admin.getByRole('button', { name: 'Change password' })).toBeVisible();
  // The kill switch is on by default.
  await expect(admin.getByRole('switch', { name: 'Night recaps' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  const host = await visitor(browser, 'Hana');
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Masquerade Originals room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const others = await Promise.all(
    ['Ana', 'Ben'].map(async (n) => {
      const p = await visitor(browser, n);
      await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
      await expect(p).toHaveURL(url);
      return p;
    }),
  );
  const players = [host, ...others];
  const names = new Map(players.map((p, i) => [p, ['Hana', 'Ana', 'Ben'][i]!]));
  await expect(host.getByText('Players (3/12)')).toBeVisible();
  await host.getByLabel('Rounds').selectOption('1');
  await host.getByRole('button', { name: 'Start game' }).click();

  const dealt = await playEscape(players, names);
  await expectStrips(players);
  await wrapUp(host, players);

  // The location id the server sent is named on the card (a placeholder without asset storage).
  const sheet = host.getByRole('dialog', { name: /at the tavern/ });
  const rounds = sheet.getByRole('region', { name: 'Past rounds' });
  await expect(rounds).toContainText(dealt.location);
  await expect(sheet).not.toContainText(/\be[12]-\d\d\b/);

  await sheet.getByRole('button', { name: '📋 Copy for chat' }).click();
  await expect
    .poll(() => host.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/^🍻 Tavern night/);
  const text = await host.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Masquerade Originals ×1');
  expect(text).not.toMatch(/\{(p|loc):|\be[12]-\d\d\b/);
  // The admin switch is server-wide state, so it is covered by the server tests, not here.
});
