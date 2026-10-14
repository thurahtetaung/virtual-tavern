import { type Browser, type Locator, type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD } from './credentials.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

let nextIp = 1;
async function visitor(browser: Browser, name?: string, colorScheme?: 'light' | 'dark') {
  // The back-room knock is rate-limited per address, so each browser gets its own.
  const context = await browser.newContext({
    colorScheme,
    extraHTTPHeaders: { 'cf-connecting-ip': `10.2.0.${nextIp++}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  if (name) await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  return page;
}

test('the back room: hidden door, password, private rooms and sign-out', async ({ browser }) => {
  test.setTimeout(90_000);

  // Outsiders see only a text-free door, and no private game anywhere.
  const stranger = await visitor(browser, 'Stranger');
  await stranger.goto('/');
  const door = stranger.getByRole('link', { name: 'The back room' });
  await expect(door).toBeVisible();
  await expect(door).toHaveText('🚪');
  await expect(stranger.getByText('Reverie')).toHaveCount(0);
  const games = await stranger.request.get('/api/games');
  expect(JSON.stringify(await games.json())).not.toContain('reverie');

  // Before an admin sets a password, the door stays shut.
  await door.click();
  await expect(stranger.getByText('The door is locked and nobody answers')).toBeVisible();

  // The admin opens the back room.
  const admin = await visitor(browser);
  await admin.goto('/tavern-keeper');
  await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
  await admin.getByRole('button', { name: 'Open the back room' }).click();
  await expect(admin.getByRole('button', { name: 'Change password' })).toBeVisible();

  // A member knocks with the wrong word, then the right one.
  const host = await visitor(browser, 'Hana');
  await host.goto('/backroom');
  await host.getByLabel('The word').fill('please');
  await host.getByRole('button', { name: 'Knock' }).click();
  // Said under the field too (until the next keystroke), and the word stays, selected, to retype.
  const field = host.getByLabel('The word');
  await expect(field).toHaveAccessibleDescription(/That's not the word/);
  await expect(field).toHaveValue('please');
  expect(
    await field.evaluate(
      (el: HTMLInputElement) => (el.selectionEnd ?? 0) - (el.selectionStart ?? 0),
    ),
  ).toBe(6);
  await field.press('Backspace');
  await expect(field).not.toHaveAccessibleDescription(/not the word/);
  await field.fill(TEST_BACKROOM_WORD);
  await host.getByRole('button', { name: 'Knock' }).click();
  // The back room is its own screen with its own game list; the home page stays unchanged.
  await expect(host).toHaveURL(/\/backroom$/);
  await expect(host.getByText("You're on the list")).toBeVisible();
  await expect(
    host.getByRole('region', { name: 'Back room games' }).getByRole('heading', { name: 'Reverie' }),
  ).toBeVisible();
  await host.getByRole('button', { name: 'Create a Reverie room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const roomUrl = host.url();

  // The private code chunk is only served to members.
  const chunk = await host.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .find((n) => n.includes('/backroom-assets/')),
  );
  expect(chunk).toBeTruthy();
  expect((await stranger.request.get(chunk!)).status()).toBe(404);
  expect((await host.request.get(chunk!)).status()).toBe(200);

  // A friend with only the link is sent to the door, then straight back into the room.
  const friend = await visitor(browser, 'Ana');
  await friend.goto(roomUrl);
  await expect(friend).toHaveURL(/\/backroom\?next=/);
  // The door says why they're here, and who has the word.
  await expect(friend.getByTestId('invite-note')).toContainText(
    "Your friend's table is through this door. They know the word",
  );
  await friend.getByLabel('The word').fill(TEST_BACKROOM_WORD);
  await friend.getByRole('button', { name: 'Knock' }).click();
  await expect(friend).toHaveURL(roomUrl);
  await expect(host.getByText('Players (2/8)')).toBeVisible();

  // Rules: members see a back-room section, and a private game's rules lead back to the back room.
  await host.goto('/rules');
  const backRoomRules = host.getByRole('region', { name: 'The back room' });
  await expect(backRoomRules.getByRole('link', { name: /Reverie/ })).toBeVisible();
  await backRoomRules.getByRole('link', { name: /Reverie/ }).click();
  await expect(host.getByRole('link', { name: '← Back room' })).toHaveAttribute(
    'href',
    '/backroom',
  );
  await expect(host.getByRole('link', { name: '← All games' })).toHaveCount(0);
  await stranger.goto('/rules');
  await expect(stranger.getByRole('heading', { name: 'How to play' })).toBeVisible();
  await expect(stranger.getByRole('heading', { name: /back room/i })).toHaveCount(0);
  await expect(stranger.getByText('Reverie')).toHaveCount(0);
  await host.goto(roomUrl);
  await expect(host.getByText('Players (2/8)')).toBeVisible();

  // While the door is open, the friend's landing page offers the way back to the room.
  await friend.goto('/');
  await expect(friend.getByRole('link', { name: 'Rejoin your Reverie room' })).toBeVisible();
  await friend.goto(roomUrl);
  await expect(friend.getByRole('button', { name: 'Sit out (watch)' })).toBeVisible();

  // Signing everyone out bounces players back to the door straight away, saying why.
  admin.on('dialog', (d) => void d.accept());
  await admin.getByRole('button', { name: 'Sign everyone out' }).click();
  await expect(admin.getByText('Everyone has been signed out')).toBeVisible();
  await expect(friend).toHaveURL(/\/backroom\?next=/);
  await expect(friend.getByText('The word has changed — ask for the new one.')).toBeVisible();
  await expect(friend.getByText("What's the word?")).toBeVisible();

  // Locked out again, the landing page no longer offers the way back into the private room.
  const status = friend.waitForResponse('**/api/backroom/status');
  await friend.goto('/');
  await status;
  await expect(friend.getByText('Pull up a chair.')).toBeVisible();
  await expect(friend.getByRole('link', { name: /^Rejoin your/ })).toHaveCount(0);
});

test('the back room follows the light and dark themes', async ({ browser, request }) => {
  const login = await request.post('/api/admin/login', { data: { password: TEST_ADMIN_PASSWORD } });
  const admin = login
    .headersArray()
    .find((h) => h.name.toLowerCase() === 'set-cookie')!
    .value.split(';')[0]!;
  await request.put('/api/admin/backroom/password', {
    headers: { cookie: admin },
    data: { password: TEST_BACKROOM_WORD },
  });
  // Whether the background of the heading's nearest `selector` ancestor is light (canvas turns any CSS
  // colour, oklch included, into RGB).
  const lightBehind = (heading: Locator, selector: string) =>
    heading.evaluate((h, sel) => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.fillStyle = getComputedStyle(h.closest(sel)!).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return (r! + g! + b!) / 3 > 200;
    }, selector);
  // The page's own surface and a game card: candlelit stone in the dark theme, warm parchment and
  // cards in the light one.
  const surface = (page: Page) =>
    lightBehind(page.getByRole('heading', { name: 'The Back Room' }), '.min-h-dvh');
  const card = (page: Page) =>
    lightBehind(
      page
        .getByRole('region', { name: 'Back room games' })
        .getByRole('heading', { name: 'Reverie' }),
      '.rounded-2xl',
    );

  for (const scheme of ['light', 'dark'] as const) {
    const page = await visitor(browser, 'Hana', scheme);
    await page.goto('/backroom');
    await expect(page.getByLabel('The word')).toBeVisible();
    await expect.poll(() => surface(page)).toBe(scheme === 'light');
    await page.getByLabel('The word').fill(TEST_BACKROOM_WORD);
    await page.getByRole('button', { name: 'Knock' }).click();
    await expect(page.getByText("You're on the list")).toBeVisible();
    await expect.poll(() => surface(page)).toBe(scheme === 'light');
    await expect.poll(() => card(page)).toBe(scheme === 'light');
    await page.context().close();
  }
});
