import { type Browser, expect, test } from '@playwright/test';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

async function visitor(browser: Browser, name?: string) {
  const page = await (await browser.newContext()).newPage();
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
  await expect(stranger.getByText('From the back room')).toHaveCount(0);
  await expect(stranger.getByText('Peek')).toHaveCount(0);
  const games = await stranger.request.get('/api/games');
  expect(JSON.stringify(await games.json())).not.toContain('backroom-demo');

  // Before an admin sets a password, the door stays shut.
  await door.click();
  await expect(stranger.getByText('The door is locked and nobody answers')).toBeVisible();

  // The admin opens the back room.
  const admin = await visitor(browser);
  await admin.goto('/admin');
  await admin.getByLabel('Admin password').fill('e2e-admin');
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByLabel('Back room password').fill('speakeasy');
  await admin.getByRole('button', { name: 'Open the back room' }).click();
  await expect(admin.getByRole('button', { name: 'Change password' })).toBeVisible();

  // A member knocks with the wrong word, then the right one.
  const host = await visitor(browser, 'Hana');
  await host.goto('/backroom');
  await host.getByLabel('The word').fill('please');
  await host.getByRole('button', { name: 'Knock' }).click();
  await expect(host.getByText("That's not the word")).toBeVisible();
  await host.getByLabel('The word').fill('speakeasy');
  await host.getByRole('button', { name: 'Knock' }).click();
  await expect(host.getByText('From the back room')).toBeVisible();
  await host.getByRole('button', { name: 'Create a Peek room' }).click();
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
  await friend.getByLabel('The word').fill('speakeasy');
  await friend.getByRole('button', { name: 'Knock' }).click();
  await expect(friend).toHaveURL(roomUrl);
  await expect(host.getByText(/2 in the back room/)).toBeVisible();

  await host.getByRole('button', { name: 'Start' }).click();
  await expect(friend.getByRole('button', { name: 'Next card' })).toBeVisible();
  // No R2 in tests: the game says so rather than breaking.
  await expect(friend.getByText(/not configured/)).toBeVisible();

  // Signing everyone out bounces players back to the door on their next move.
  admin.on('dialog', (d) => void d.accept());
  await admin.getByRole('button', { name: 'Sign everyone out' }).click();
  await expect(admin.getByText('Everyone has been signed out')).toBeVisible();
  await friend.getByRole('button', { name: 'Next card' }).click();
  await expect(friend).toHaveURL(/\/backroom\?next=/);
  await expect(friend.getByText("What's the word?")).toBeVisible();
});
