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
  await page.goto('/tavern-keeper/stats');
  await expect(page.getByText('The stats are for the tavern keeper')).toBeVisible();
  await page.getByRole('link', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/tavern-keeper$/);
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
  await expect(card(page, 'Scores').locator('svg').first()).toBeVisible();
  await expect(page.getByText('Best score')).toBeVisible();
  // Percents arrive as 0–100.
  await expect(page.getByRole('meter', { name: 'Cards guessed right' })).toHaveAttribute(
    'aria-valuenow',
    '75',
  );
  const words = card(page, 'Words');
  await expect(
    words.getByRole('list', { name: 'Clues' }).getByRole('listitem').first(),
  ).toBeVisible();
  await words.getByRole('button', { name: 'Cancelled clues' }).click();
  await expect(words.getByRole('list', { name: 'Cancelled clues' })).toBeVisible();
  await words.getByRole('button', { name: 'Show as table' }).click();
  await expect(words.getByRole('columnheader', { name: 'Times' })).toBeVisible();
  await games.getByRole('button', { name: /Codenames/ }).click();
  await expect(card(page, 'Wins by team')).toBeVisible();
  // Private games are named from the stats data, without unlocking the back room.
  await expect(games.getByRole('button', { name: /Reverie/ })).toBeVisible();
  // Each game's Words card offers only the word kinds it reports, defaulting to the first.
  const kinds = (name: string) =>
    words.getByRole('group', { name: 'Word kind' }).getByRole('button', { name });
  await expect(words.getByRole('group', { name: 'Word kind' }).getByRole('button')).toHaveText([
    'Clues',
    'Guesses',
    'Assassin hits',
  ]);
  await games.getByRole('button', { name: /Reverie/ }).click();
  await expect(words.getByRole('group', { name: 'Word kind' }).getByRole('button')).toHaveText([
    'Story clues',
  ]);
  await expect(kinds('Story clues')).toHaveAttribute('aria-pressed', 'true');
  await expect(words.getByRole('list', { name: 'Story clues' })).toBeVisible();
  await games.getByRole('button', { name: /Hoodwink/ }).click();
  await expect(words.getByRole('group', { name: 'Word kind' }).getByRole('button')).toHaveText([
    'Lies',
  ]);
  await expect(words.getByRole('list', { name: 'Lies' })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Votes that found the truth' })).toBeVisible();

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
  await expect(exportLink).toHaveAttribute(
    'href',
    /^\/api\/admin\/stats\/export\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/,
  );
  await expect(exportLink).toHaveAttribute('download', /\.ndjson$/);
  await page.getByRole('button', { name: 'Reset stats' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset all stats?' });
  const confirm = dialog.getByRole('button', { name: 'Reset stats' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel('Type reset to confirm').fill('reset');
  await confirm.click();
  await expect(page.getByText('Stats reset.')).toBeVisible();
  await expect.poll(() => calls.reset).toEqual([{ confirm: 'reset all stats' }]);
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

// ---- Against the real server: no mocks ----

async function player(browser: Browser, name: string, url = '/') {
  const page = await newPage(browser);
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

const YOUR_TURN = /^● Your turn/;

/** With three players, each clue writer sends two clues. */
async function sendClues(page: Page, clues: [string, string]) {
  await page.getByLabel('Clue 1').fill(clues[0]);
  await page.getByLabel('Clue 2').fill(clues[1]);
  await page.getByRole('button', { name: 'Send clues' }).click();
  await expect(
    page.getByRole('button', { name: '✓ Sent' }).or(page.getByRole('list', { name: 'Clues' })),
  ).toBeVisible();
}

test('a real Echo card shows up on the stats page', async ({ browser }) => {
  test.setTimeout(90_000);
  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create an Echo room' }).click();
  await expect(host.getByText('Almost ready: Echo needs at least 3 players')).toBeVisible();
  const url = host.url();
  const writers: Page[] = [];
  for (const name of ['Ana', 'Ben']) {
    writers.push(await player(browser, name, url));
    await expect(
      host.getByRole('region', { name: 'Players' }).getByText(name, { exact: true }),
    ).toBeVisible();
  }
  const [ana, ben] = writers as [Page, Page];
  await expect(host.getByText('Everyone is in')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  // Hana guesses first. Made-up clues can't give the secret word away.
  await expect(host).toHaveTitle(YOUR_TURN);
  await host.getByRole('button', { name: 'Pick word 1' }).click();
  const secret = ana.getByTestId('secret-word');
  await expect(secret).toBeVisible();
  const word = await secret.innerText();
  await sendClues(ana, ['Aaqqxv', 'Bbqqxv']);
  await sendClues(ben, ['Aaqqxv', 'Ccqqxv']);
  await expect(host).toHaveTitle(YOUR_TURN);
  await host.getByLabel('Your guess').fill(word.toLowerCase());
  await host.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(ana.getByText('🎉 Got it!')).toBeVisible();

  const admin = await newPage(browser);
  await openStatsAsAdmin(admin);

  // Live: the room, with its players.
  const rooms = admin.getByRole('heading', { name: 'Live rooms' }).locator('..');
  const room = rooms.getByRole('listitem').filter({ hasText: 'Echo' }).first();
  await expect(room).toBeVisible();
  await expect(room.getByRole('list', { name: 'Players' })).toContainText('Hana');

  // Overview: the game started.
  const started = (page: Page) =>
    page
      .locator('span', { hasText: /^Games started$/ })
      .first()
      .locator('..');
  await tab(admin, 'Overview').click();
  await expect(started(admin)).toHaveText(/^Games started[1-9]/);

  // Games → Echo: the game, and a clue word.
  await tab(admin, 'Games').click();
  await admin.getByRole('group', { name: 'Game' }).getByRole('button', { name: /Echo/ }).click();
  await expect(started(admin)).toHaveText(/^Games started[1-9]/);
  const words = card(admin, 'Words');
  await expect(words.getByRole('list', { name: 'Clues' })).toContainText('bbqqxv');
  await words.getByRole('button', { name: 'Cancelled clues' }).click();
  await expect(words.getByRole('list', { name: 'Cancelled clues' })).toContainText('aaqqxv');
});
