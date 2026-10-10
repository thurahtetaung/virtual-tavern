import { expect, test } from '@playwright/test';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

test('the theme switch overrides the system setting and survives a reload', async ({ browser }) => {
  const page = await (await browser.newContext({ colorScheme: 'light' })).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'light');

  const toDark = page.getByRole('button', { name: 'Switch to dark theme' });
  await expect(toDark).toHaveAttribute('aria-pressed', 'false');
  await toDark.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => localStorage.getItem('vt.theme'))).toBe('dark');

  // The boot script applies the saved choice before React mounts, so it holds across a reload
  // even though the system still prefers light.
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(html).toHaveCSS('color-scheme', 'dark');

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('vt.theme'))).toBe('light');
});

test('with nothing saved the theme follows the system preference', async ({ browser }) => {
  const page = await (await browser.newContext({ colorScheme: 'dark' })).newPage();
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('vt.theme'))).toBeNull();
});

test('the Players drawer shows the room code, and the room announces joins and hand-offs', async ({
  browser,
}) => {
  const player = async (name: string, url = '/') => {
    const page = await (
      await browser.newContext({ viewport: { width: 390, height: 844 } })
    ).newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
    await page.goto(url);
    return page;
  };
  const hana = await player('Hana');
  await hana.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(hana).toHaveURL(/\/r\//);
  const code = hana.url().split('/r/')[1]!;
  await expect(hana).toHaveTitle('Codenames · Virtual Tavern');

  const ana = await player('Ana', hana.url());
  await expect(hana.getByRole('status').filter({ hasText: 'Ana joined' })).toBeVisible();

  await hana.getByRole('button', { name: /^Players/ }).click();
  const drawer = hana.getByRole('dialog', { name: 'Players' });
  await expect(drawer.getByText(code, { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Copy room code' })).toBeVisible();
  if (process.env.SCREENSHOTS)
    await hana.screenshot({ path: 'test-results/shots/phone-players.png' });

  // The host leaves: Ana is told she is in charge now, and Hana's landing page forgets the room.
  hana.on('dialog', (d) => void d.accept());
  await drawer.getByRole('button', { name: 'Leave room' }).click();
  await expect(ana.getByRole('status').filter({ hasText: "You're the host now" })).toBeVisible();
  await expect(hana).toHaveURL('/');
  await expect(hana.getByRole('link', { name: /^Rejoin your/ })).toHaveCount(0);

  // Ana's landing page offers a way back to the room she is still in.
  await ana.goto('/');
  await expect(ana.getByRole('link', { name: 'Rejoin your Codenames room' })).toHaveAttribute(
    'href',
    `/r/${code}`,
  );
});

test('a server error on the room page shows a retry panel rather than a blank page', async ({
  browser,
}) => {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('vt.playerName', 'Hana'));
  let fail = true;
  await page.route('**/api/rooms/*', async (route) => {
    if (fail) await route.fulfill({ status: 503, body: 'down' });
    else await route.continue();
  });
  await page.goto('/r/misty-brass-lantern-ab12');
  await expect(page.getByRole('heading', { name: "Couldn't open the room" })).toBeVisible();

  // The server is back, but the room never existed: a retry gets the usual not-found page.
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('This room does not exist or has expired')).toBeVisible();
});
