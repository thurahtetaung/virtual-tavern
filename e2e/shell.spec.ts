import { expect } from '@playwright/test';
import { test } from './fixtures.ts';

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

  // The label names the action, so the button is not a pressed/unpressed toggle.
  const toDark = page.getByRole('button', { name: 'Switch to dark theme' });
  await expect(toDark).not.toHaveAttribute('aria-pressed');
  // It shows the current setting: following the device at first, then the choice.
  await expect(toDark).toHaveText(/Auto/);
  await toDark.click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toHaveText(/Dark/);
  expect(await page.evaluate(() => localStorage.getItem('vt.theme'))).toBe('dark');

  // The boot script applies the saved choice before React mounts, so it holds across a reload
  // even though the system still prefers light.
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(html).toHaveCSS('color-scheme', 'dark');

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('vt.theme'))).toBe('light');

  // One more tap goes back to following the device.
  await page.getByRole('button', { name: "Follow your device's theme" }).click();
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vt.theme'))).toBeNull();
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
  await drawer.getByRole('button', { name: 'Leave room' }).click();
  await hana
    .getByRole('dialog', { name: 'Leave this room?' })
    .getByRole('button', { name: 'Leave', exact: true })
    .click();
  await expect(ana.getByRole('status').filter({ hasText: "You're the host now" })).toBeVisible();
  await expect(hana).toHaveURL('/');
  await expect(hana.getByRole('status').filter({ hasText: 'You left the room.' })).toBeVisible();
  await expect(hana).toHaveTitle('Virtual Tavern');
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
  await expect(page.getByRole('heading', { name: 'No such room' })).toBeVisible();
  await expect(page).toHaveTitle('No such room · Virtual Tavern');
});

test('a rules page names the tab and ends with a way to start playing', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/rules');
  await expect(page).toHaveTitle('How to play · Virtual Tavern');
  await page.getByRole('link', { name: /Echo/ }).click();
  await expect(page).toHaveTitle('How to play Echo · Virtual Tavern');
  // No name yet: the button asks for one first, then opens the room.
  await page.getByRole('button', { name: 'Create an Echo room' }).click();
  await expect(page.getByLabel('Your name')).toBeFocused();
  await page.getByLabel('Your name').fill('Hana');
  await page.getByRole('button', { name: 'Create an Echo room' }).click();
  await expect(page).toHaveURL(/\/r\//);
  await expect(page).toHaveTitle('Echo · Virtual Tavern');
});

test('a room code typed with spaces joins the room, and a taken name gets a number', async ({
  browser,
}) => {
  const player = async (name: string) => {
    const page = await (await browser.newContext()).newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
    await page.goto('/');
    return page;
  };
  const host = await player('Kim');
  await host.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const code = host.url().split('/r/')[1]!;

  const friend = await player('Kim');
  const invite = friend.getByLabel('Got an invite link or room code?');
  await invite.fill('not a code');
  await friend.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(friend.getByRole('alert')).toContainText('like "');

  // Read out loud and typed with spaces, in capitals.
  await invite.fill(code.replaceAll('-', ' ').toUpperCase());
  await friend.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(friend).toHaveURL(`/r/${code}`);
  await expect(
    friend
      .getByRole('status')
      .filter({ hasText: "Someone here is already called Kim, so you're Kim 2" }),
  ).toBeVisible();

  // Renaming to a name that's taken is refused next to the form.
  await friend.getByRole('button', { name: /^Players/ }).click();
  const drawer = friend.getByRole('dialog', { name: 'Players' });
  await expect(drawer.getByText('Kim 2', { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Change name or colour' }).click();
  await drawer.getByRole('textbox').fill('kim');
  await drawer.getByRole('button', { name: 'Save' }).click();
  await expect(drawer.getByRole('alert')).toHaveText(
    'Someone here is already called kim. Pick another name.',
  );
});

test('on a phone the header buttons are labelled, and an away host is announced', async ({
  browser,
}) => {
  const player = async (name: string, url = '/') => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
    await page.goto(url);
    return page;
  };
  const hana = await player('Hana');
  await hana.getByRole('button', { name: 'Create an Echo room' }).click();
  await expect(hana).toHaveURL(/\/r\//);
  for (const label of ['Invite', 'Players', 'Rules']) {
    await expect(hana.getByRole('button').getByText(label, { exact: true })).toBeVisible();
  }
  await hana.getByRole('button', { name: 'Invite friends' }).click();
  await expect(hana.getByRole('status').filter({ hasText: 'Link copied' })).toBeVisible();

  const ana = await player('Ana', hana.url());
  const ben = await player('Ben', hana.url());
  await expect(ana.getByText('Hana (host) to start')).toBeVisible();
  await expect(ana.getByRole('button', { name: /^Players/ })).toHaveAccessibleName(
    'Players (3 online)',
  );

  // The host's browser goes away: everyone sees who and how long until someone takes over.
  await hana.context().close();
  const away = ana.getByRole('status').filter({ hasText: 'Hana (host) is away' });
  await expect(away).toContainText(/takes over in 1:\d\d/);
  await expect(ben.getByText('Hana', { exact: true }).first()).toBeVisible();
  if (process.env.SCREENSHOTS)
    await ana.screenshot({ path: 'test-results/shots/phone-host-away.png' });

  // Sitting out shows the shared "You're watching" banner, whose button takes the seat again.
  await ben.getByRole('button', { name: 'Sit out (watch)' }).click();
  const watching = ben.getByRole('status', { name: "You're watching" });
  await expect(watching).toBeVisible();
  await watching.getByRole('button', { name: 'Take a seat' }).click();
  await expect(watching).toHaveCount(0);
});

test('on a touch phone toasts stay clear of the room header and tap bands stop at 44 px', async ({
  browser,
}) => {
  // No clipboard permission and no share sheet: Invite falls back to a toast.
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('vt.playerName', 'Hana');
    Object.defineProperty(navigator, 'share', { value: undefined });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an Echo room' }).click();
  await expect(page).toHaveURL(/\/r\//);
  // A long address (as in production) must not make the toast taller.
  await page.goto(`${page.url()}?from=${'x'.repeat(40)}`);
  const invite = page.getByRole('button', { name: 'Invite friends' });
  await invite.click();
  const toast = page.getByRole('status').filter({ hasText: "Couldn't copy the link" });
  await expect(toast).toBeVisible();
  const toastBox = await toast.boundingBox();
  const inviteBox = await invite.boundingBox();
  expect(toastBox!.y + toastBox!.height).toBeLessThan(inviteBox!.y);

  // The invisible touch band makes a small button 44 px tall, never more.
  const band = (el: Element) => {
    const after = getComputedStyle(el, '::after');
    return { height: el.getBoundingClientRect().height, band: after.height };
  };
  expect(await invite.evaluate(band)).toEqual({ height: 44, band: '44px' });
  await invite.evaluate((el: HTMLElement) => el.style.setProperty('min-height', '0'));
  expect(await invite.evaluate(band)).toEqual({ height: 32, band: '44px' });
});
