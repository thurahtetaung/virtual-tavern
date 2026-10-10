import { type Browser, type Page, expect, test } from '@playwright/test';
import { mockStatsApi, openStatsAsAdmin } from './stats-mock.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

async function newPage(browser: Browser, colorScheme: 'light' | 'dark' = 'light') {
  const page = await (await browser.newContext({ colorScheme })).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  return page;
}

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const card = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test('the stats page asks visitors to sign in first', async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto('/admin/stats');
  await expect(page.getByText('The stats are for the tavern keeper')).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByLabel('Admin password')).toBeVisible();
});

test('admins browse live, overview, games, players and fun stats', async ({ browser }) => {
  test.setTimeout(60_000);
  const page = await newPage(browser);
  const calls = await mockStatsApi(page);
  await openStatsAsAdmin(page);

  // Live: tiles, rooms and the sparkline, with no range picker.
  await expect(page.getByText('Players online', { exact: true })).toBeVisible();
  const rooms = page.getByRole('heading', { name: 'Live rooms' }).locator('..');
  await expect(rooms.getByRole('listitem').filter({ hasText: 'Hana' }).first()).toBeVisible();
  await expect(card(page, 'Players online, last hour').locator('svg').first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Time range' })).toHaveCount(0);

  // Overview: KPI tiles, charts, and a table view.
  await tab(page, 'Overview').click();
  await expect(page).toHaveURL(/tab=overview/);
  await expect(page.getByText('Rooms created')).toBeVisible();
  const activity = card(page, 'Games started');
  await expect(activity.locator('svg').first()).toBeVisible();
  const mix = card(page, 'Game mix');
  await mix.getByRole('button', { name: 'Show as table' }).click();
  await expect(mix.getByRole('table')).toBeVisible();
  await expect(mix.getByRole('rowheader', { name: 'Codenames' })).toBeVisible();
  await mix.getByRole('button', { name: 'Show as chart' }).click();
  await expect(mix.getByRole('table')).toHaveCount(0);

  // The range lives in the URL and empty windows say so.
  await page
    .getByRole('group', { name: 'Time range' })
    .getByRole('button', { name: 'Today' })
    .click();
  await expect(page).toHaveURL(/range=today/);
  await expect(activity.getByText('No games in this range yet')).toBeVisible();
  await page
    .getByRole('group', { name: 'Time range' })
    .getByRole('button', { name: '90 days' })
    .click();
  await page.getByLabel('Group by').selectOption('week');
  await expect(page).toHaveURL(/range=90d&bucket=week/);
  await expect(activity.locator('svg').first()).toBeVisible();

  // Games: one sub-tab per game, generic figures and the word cloud.
  await tab(page, 'Games').click();
  const games = page.getByRole('group', { name: 'Game' });
  await games.getByRole('button', { name: /Echo/ }).click();
  await expect(page).toHaveURL(/game=echo/);
  await expect(card(page, 'Card outcomes')).toBeVisible();
  await expect(card(page, 'Score distribution').locator('svg').first()).toBeVisible();
  await expect(page.getByText('Best run')).toBeVisible();
  const words = card(page, 'Words');
  await expect(
    words.getByRole('list', { name: 'Clues' }).getByRole('listitem').first(),
  ).toBeVisible();
  await words.getByRole('button', { name: 'Cancelled clues' }).click();
  await expect(words.getByRole('list', { name: 'Cancelled clues' })).toBeVisible();
  await words.getByRole('button', { name: 'Show as table' }).click();
  await expect(words.getByRole('columnheader', { name: 'Times' })).toBeVisible();
  await games.getByRole('button', { name: /Codenames/ }).click();
  await expect(card(page, 'How games end')).toBeVisible();

  // Players: leaderboard with aliases, then a profile.
  await tab(page, 'Players').click();
  await expect(page.getByText('aka Benny, B')).toBeVisible();
  await page.getByRole('button', { name: /^Ivy/ }).click();
  await expect(page).toHaveURL(/player=/);
  await expect(page.getByRole('heading', { name: 'Ivy', exact: true })).toBeVisible();
  await expect(page.getByText('Also known as')).toBeVisible();
  await expect(card(page, 'Names used').getByText('Ivy the Terrible')).toBeVisible();
  await expect(page.getByText('Fastest guesser')).toBeVisible();
  await page.getByRole('button', { name: '← All players' }).click();
  await expect(page.getByRole('table')).toBeVisible();

  // Fun.
  await tab(page, 'Fun').click();
  await expect(page.getByRole('heading', { name: '📜 Tavern tales' })).toBeVisible();
  await expect(page.getByText('Most dramatic finish')).toBeVisible();

  // Charts follow the theme switch.
  await tab(page, 'Overview').click();
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(activity.locator('svg').first()).toBeVisible();
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');

  // Export and reset go to the contract endpoints.
  // The browser saves the export straight from the server, so check where the link points.
  const exportLink = page.getByRole('link', { name: 'Export events (NDJSON)' });
  await expect(exportLink).toHaveAttribute('href', '/api/admin/stats/export?range=90d');
  await expect(exportLink).toHaveAttribute('download', /\.ndjson$/);
  await page.getByRole('button', { name: 'Reset stats' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset all stats?' });
  const confirm = dialog.getByRole('button', { name: 'Reset stats' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type reset to confirm').fill('reset');
  await confirm.click();
  await expect(page.getByText('Stats reset.')).toBeVisible();
  await expect.poll(() => calls.reset).toBe(1);
  await expect(dialog).toBeHidden();
});

test('the stats page fits a phone without sideways scrolling', async ({ browser }) => {
  const page = await (
    await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' })
  ).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await mockStatsApi(page);
  await openStatsAsAdmin(page);
  for (const name of ['Live', 'Overview', 'Games', 'Players', 'Fun']) {
    await tab(page, name).click();
    await expect(page.getByRole('tabpanel', { name })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
  }
});
