import { type Browser, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';
import { readCards, readyUp, votes } from './masquerade-play.ts';
import { openSettings } from './lobby-settings.ts';

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
    extraHTTPHeaders: { 'cf-connecting-ip': `10.9.${worker}.${(nextIp++ % 250) + 1}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  return page;
}

async function openBackroom(page: Page) {
  await ownLoginLimit(page);
  await page.goto('/tavern-keeper');
  await page.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: /Open the back room|Change password/ }).click();
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
}

async function unlock(page: Page, url = '/backroom') {
  await page.goto(url);
  await page.getByLabel('The word').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: 'Knock' }).click();
}

test('three friends play Masquerade Originals behind the back room, with placeholders', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));

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
  await expect(host.getByText('Players (3/12)')).toBeVisible();
  // Both editions are in play by default; the host can drop one.
  await expect(host.getByText('50 locations in play')).toBeVisible();
  await host.getByRole('button', { name: /^Edition 2/ }).click();
  await openSettings(others[0]!);
  await expect(others[0]!.getByText('30 locations in play')).toBeVisible();
  await host.getByRole('button', { name: /^Edition 2/ }).click();
  await expect(others[0]!.getByText('50 locations in play')).toBeVisible();
  await host.getByLabel('Rounds').selectOption('1');
  await host.getByRole('button', { name: 'Start game' }).click();

  // Without asset storage, locations are numbered placeholders, and the board still works.
  const names = new Map(players.map((p, i) => [p, ['Hana', 'Ana', 'Ben'][i]!]));
  const dealt = await readCards(players, names);
  expect(dealt.location).toMatch(/^Location \d+$/);
  const board = dealt.spy.getByRole('region', { name: 'Locations' });
  await expect(board.getByRole('button', { name: 'Location 1', exact: true })).toBeVisible();
  await expect(board.getByRole('button', { name: 'Location 50', exact: true })).toBeVisible();
  await expect(dealt.spy.getByTestId('still-possible')).toContainText('Still possible: 50');
  // The spy's notes: a star on one place and another crossed off, both still there for the guess.
  const crossed = dealt.location === 'Location 1' ? 'Location 2' : 'Location 1';
  await board.getByRole('button', { name: `Star ${dealt.location}`, exact: true }).click();
  await board.getByRole('button', { name: crossed, exact: true }).click();
  await expect(dealt.spy.getByTestId('still-possible')).toContainText('Still possible: 49');

  await readyUp(players);
  const [a, b] = dealt.locals as [Page, Page];
  const spyName = names.get(dealt.spy)!;
  await votes([
    [a, spyName],
    [b, spyName],
    [dealt.spy, names.get(a)!],
  ]);
  await expect(board.getByText('You were caught! Pick your one guess.')).toBeVisible();
  await expect(board.getByLabel('Starred')).toHaveCount(1);
  await expect(board.getByRole('button', { name: `Pick ${crossed}`, exact: true })).toHaveClass(
    /opacity-40/,
  );
  await board.getByRole('button', { name: `Pick ${dealt.location}`, exact: true }).click();
  await board.getByRole('button', { name: `Guess ${dealt.location}`, exact: true }).click();
  for (const p of players)
    await expect(p.getByTestId('revealed-location')).toHaveText(dealt.location);
  await expect(host.getByLabel('Podium')).toBeVisible();
});
