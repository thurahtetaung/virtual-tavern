import { type Browser, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { TEST_ADMIN_PASSWORD } from './credentials.ts';
import { openAdminSection } from './admin-sections.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

// Admin sign-in is rate-limited per address, so each sign-in comes from its own address.
let nextIp = 1;
async function signedInAdmin(browser: Browser) {
  const context = await browser.newContext({
    extraHTTPHeaders: { 'cf-connecting-ip': `10.7.0.${nextIp++}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/tavern-keeper');
  await page.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Games', exact: true }).click();
  await openAdminSection(page, 'Categories');
  return page;
}

/** Deletes the categories this spec made (their ids start with `e2e-`) and turns games on. */
async function cleanUp(admin: Page) {
  const { categories } = (await (await admin.request.get('/api/admin/games')).json()) as {
    categories: { id: string }[];
  };
  for (const c of categories.filter((c) => c.id.startsWith('e2e-')))
    await admin.request.delete(`/api/admin/games/categories/${c.id}`);
  await admin.request.put('/api/admin/games/thorns', { data: { enabled: true } });
}

const card = (page: Page, name: string) => page.getByRole('heading', { name, exact: true });

test('admins make categories and players filter the game list by them', async ({ browser }) => {
  test.setTimeout(90_000);
  const admin = await signedInAdmin(browser);
  try {
    const section = admin.getByRole('region', { name: 'Categories' });
    const add = async (emoji: string, name: string) => {
      await section.getByLabel('New category emoji').fill(emoji);
      await section.getByLabel('New category name').fill(name);
      await section.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(section.getByLabel(`${name} name`)).toHaveValue(name);
    };
    await add('📣', 'E2E Loud');
    await add('🤫', 'E2E Quiet');
    await add('🗝️', 'E2E Hush');

    const tick = async (game: string, category: string) => {
      const chip = admin
        .getByRole('group', { name: game, exact: true })
        .getByRole('button', { name: category });
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
    };
    await tick('Codenames', 'E2E Loud');
    await tick('Echo', 'E2E Quiet');
    await tick('Reverie', 'E2E Quiet');
    await tick('Reverie', 'E2E Hush');

    // A player: the chips their games have, never one only back-room games use.
    const player = await (await browser.newContext()).newPage();
    player.on('pageerror', (e) => pageErrors.push(e.message));
    await player.goto('/');
    const chips = player.getByRole('group', { name: 'Filter games by category' });
    const loud = chips.getByRole('button', { name: 'E2E Loud' });
    await expect(loud).toBeVisible();
    await expect(chips.getByRole('button', { name: 'E2E Quiet' })).toBeVisible();
    await expect(chips.getByRole('button', { name: 'E2E Hush' })).toHaveCount(0);
    await expect(chips.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await loud.click();
    await expect(loud).toHaveAttribute('aria-pressed', 'true');
    await expect(card(player, 'Codenames')).toBeVisible();
    await expect(card(player, 'Echo')).toHaveCount(0);
    // Several chips narrow the list: a game shows only with all of them.
    const quiet = chips.getByRole('button', { name: 'E2E Quiet' });
    await quiet.click();
    await expect(player.getByText('No game has all of those categories.')).toBeVisible();
    await expect(card(player, 'Codenames')).toHaveCount(0);
    await expect(card(player, 'Echo')).toHaveCount(0);
    // The choice is remembered in this browser.
    await player.reload();
    await expect(loud).toHaveAttribute('aria-pressed', 'true');
    await expect(quiet).toHaveAttribute('aria-pressed', 'true');
    await expect(player.getByText('No game has all of those categories.')).toBeVisible();
    await quiet.click();
    await expect(card(player, 'Codenames')).toBeVisible();
    await expect(card(player, 'Enigma')).toHaveCount(0);

    // A rename and a new tick reach the list.
    await section.getByLabel('E2E Loud emoji').fill('🎺');
    await section.getByLabel('E2E Loud name').fill('E2E Rowdy');
    await section.getByRole('button', { name: 'Save E2E Loud' }).click();
    await expect(section.getByLabel('E2E Rowdy name')).toHaveValue('E2E Rowdy');
    await tick('Enigma', 'E2E Rowdy');
    await player.reload();
    await expect(chips.getByRole('button', { name: 'E2E Rowdy' })).toContainText('🎺');
    await expect(card(player, 'Enigma')).toBeVisible();
    await chips.getByRole('button', { name: 'All' }).click();
    await expect(card(player, 'Masquerade')).toBeVisible();

    // The back room has its own chips (the admin always has the back room).
    await admin.goto('/backroom');
    const backroomChips = admin.getByRole('group', { name: 'Filter games by category' });
    await backroomChips.getByRole('button', { name: 'E2E Hush' }).click();
    await expect(card(admin, 'Reverie')).toBeVisible();
    await expect(card(admin, 'Hoodwink')).toHaveCount(0);

    // Switched off: gone from the list, the rules say so, and no new rooms open. A back-room
    // game, so the switch never reaches a spec running beside this one (only this project's
    // specs, one at a time, play back-room games); the admin always has the back room.
    await admin.goto('/tavern-keeper/games');
    const thorns = admin.getByRole('switch', { name: 'Thorns on' });
    await thorns.click();
    await expect(thorns).toHaveAttribute('aria-checked', 'false');
    // The admin's cookies only, so no chip chosen above filters this list.
    const { cookies } = await admin.context().storageState();
    const viewer = await (
      await browser.newContext({ storageState: { cookies, origins: [] } })
    ).newPage();
    viewer.on('pageerror', (e) => pageErrors.push(e.message));
    await viewer.goto('/backroom');
    await expect(card(viewer, 'Reverie')).toBeVisible();
    await expect(card(viewer, 'Thorns')).toHaveCount(0);
    await viewer.goto('/rules/thorns');
    await expect(viewer.getByText(/Thorns isn’t available right now/)).toBeVisible();
    await expect(viewer.getByRole('button', { name: /Create an? Thorns room/ })).toHaveCount(0);
    const refused = await viewer.request.post('/api/rooms', {
      data: { gameId: 'thorns', token: 'e2e-off-token-000000000000000000000' },
    });
    expect(refused.status()).toBe(409);
    await thorns.click();
    await expect(thorns).toHaveAttribute('aria-checked', 'true');
    await viewer.goto('/backroom');
    await expect(card(viewer, 'Thorns')).toBeVisible();
  } finally {
    await cleanUp(admin);
  }
});
