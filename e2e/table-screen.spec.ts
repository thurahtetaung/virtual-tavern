import { type Browser, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';

const pageErrors: string[] = [];
/** Console errors per page, such as a request answered with an error status. */
const consoleErrors = new Map<Page, string[]>();
test.afterEach(() => {
  consoleErrors.clear();
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };
const shots = !!process.env.SCREENSHOTS;
const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/shots/${name}.png` });

async function open(
  browser: Browser,
  url: string,
  { name, viewport }: { name?: string; viewport?: { width: number; height: number } } = {},
) {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const logged: string[] = [];
  consoleErrors.set(page, logged);
  page.on('console', (m) => {
    if (m.type() === 'error') logged.push(`${m.text()} ${m.location().url}`);
  });
  if (name) await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

const drawerOf = (page: Page) => page.getByRole('dialog', { name: 'Players' });
async function openPlayers(page: Page) {
  await page.getByRole('button', { name: /^Players/ }).click();
  await expect(drawerOf(page)).toBeVisible();
}

test('the host pairs a table screen, the phones hear of it, and the host removes it', async ({
  browser,
}) => {
  const hana = await open(browser, '/', { name: 'Hana', viewport: PHONE });
  await hana.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(hana).toHaveURL(/\/r\//);
  const roomId = new URL(hana.url()).pathname.split('/').pop()!;
  const ana = await open(browser, hana.url(), { name: 'Ana', viewport: PHONE });
  await expect(hana.getByRole('status').filter({ hasText: 'Ana joined' })).toBeVisible();

  // Only the host gets the controls.
  await openPlayers(ana);
  await expect(drawerOf(ana).getByRole('heading', { name: /Table screen/ })).toHaveCount(0);
  await ana.keyboard.press('Escape');

  await openPlayers(hana);
  const panel = drawerOf(hana).getByRole('region', { name: /Table screen/ });
  await expect(panel.getByTestId('stage-status')).toHaveText('Not connected');
  await panel.getByRole('button', { name: 'Show a pairing code' }).click();
  const code = (await panel.getByTestId('stage-code').textContent())!;
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  if (shots) {
    await panel.scrollIntoViewIfNeeded();
    await shot(hana, 'table-screen-host-light');
    await hana.emulateMedia({ colorScheme: 'dark' });
    await shot(hana, 'table-screen-host-dark');
    await hana.emulateMedia({ colorScheme: 'light' });
  }

  // The TV pairs on /stage and starts the show.
  const tv = await open(browser, '/stage', { viewport: { width: 1280, height: 720 } });
  await expect(tv.getByRole('heading', { name: 'Table screen' })).toBeVisible();
  await expect(tv.getByLabel('Pairing code')).toBeVisible();
  // Asking "am I paired?" on a fresh screen is not an error.
  expect(consoleErrors.get(tv)).toEqual([]);
  if (shots) {
    await tv.getByLabel('Pairing code').fill(code);
    await shot(tv, 'table-screen-pairing-desktop');
    await tv.setViewportSize({ width: 1920, height: 1080 });
    await shot(tv, 'table-screen-pairing-tv');
    await tv.setViewportSize({ width: 1280, height: 720 });
  }
  await tv.getByLabel('Pairing code').fill(code.toLowerCase());
  await tv.getByRole('button', { name: 'Pair this screen' }).click();
  await tv.getByRole('button', { name: '▶ Start the show' }).click();
  await expect(tv).toHaveURL(new RegExp(`/stage/${roomId}$`));
  const scene = tv.getByTestId('scene');
  await expect(
    scene.getByText('This game has no table screen yet', { exact: false }),
  ).toBeVisible();
  await expect(scene.getByText('Hana', { exact: true })).toBeVisible();
  await expect(scene.getByText('Ana', { exact: true })).toBeVisible();
  if (shots) {
    await shot(tv, 'table-screen-generic-desktop');
    // "Start the show" went full screen; a window can only be resized out of it.
    await tv.evaluate(() => document.exitFullscreen().catch(() => {}));
    await tv.setViewportSize({ width: 1920, height: 1080 });
    await shot(tv, 'table-screen-generic-tv');
  }

  // Every phone hears a table screen is here; it is never a player.
  await expect(panel.getByTestId('stage-status')).toHaveText('Connected');
  await expect(drawerOf(hana).getByRole('listitem')).toHaveCount(2);
  await openPlayers(ana);
  await expect(drawerOf(ana).getByText('A table screen is showing this room.')).toBeVisible();
  await ana.keyboard.press('Escape');

  // The code is used up: another screen can't pair with it.
  const late = await open(browser, '/stage');
  await late.getByLabel('Pairing code').fill(code);
  await late.getByRole('button', { name: 'Pair this screen' }).click();
  await expect(late.getByRole('alert')).toHaveText(/didn’t work/);

  // Pairing another screen while one is connected shows the new code.
  await panel.getByRole('button', { name: 'Pair another screen' }).click();
  const again = (await panel.getByTestId('stage-code').textContent())!;
  expect(again).toMatch(/^[A-Z0-9]{6}$/);
  expect(again).not.toBe(code);
  await expect(panel.getByTestId('stage-status')).toHaveText('Connected');
  await expect(
    panel.getByText('The screen showing now leaves when the new one pairs.'),
  ).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Remove table screen' })).toBeVisible();
  if (shots) {
    await panel.scrollIntoViewIfNeeded();
    await shot(hana, 'table-screen-repair-light');
    await hana.emulateMedia({ colorScheme: 'dark' });
    await shot(hana, 'table-screen-repair-dark');
    await hana.emulateMedia({ colorScheme: 'light' });
  }
  await late.getByLabel('Pairing code').fill(again);
  await late.getByRole('button', { name: 'Pair this screen' }).click();
  await expect(
    tv.getByRole('heading', { name: "This screen isn't paired any more" }),
  ).toBeVisible();
  await late.getByRole('button', { name: '▶ Start the show' }).click();
  await expect(late.getByTestId('scene').getByText('Hana', { exact: true })).toBeVisible();
  await expect(panel.getByTestId('stage-status')).toHaveText('Connected');
  // The code is used: the panel goes back to its buttons.
  await expect(panel.getByTestId('stage-code')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Pair another screen' })).toBeVisible();

  // The host removes it: the TV is told at once, and the phones go back to normal.
  await panel.getByRole('button', { name: 'Remove table screen' }).click();
  await hana
    .getByRole('dialog', { name: 'Remove the table screen?' })
    .getByRole('button', { name: 'Remove table screen' })
    .click();
  await expect(
    late.getByRole('heading', { name: "This screen isn't paired any more" }),
  ).toBeVisible();
  await expect(panel.getByTestId('stage-status')).toHaveText('Not connected');
  await openPlayers(ana);
  await expect(drawerOf(ana).getByText('A table screen is showing this room.')).toHaveCount(0);
});
