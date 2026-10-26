import { type Page, expect } from '@playwright/test';
import { fillerTurn, order, pick, pickTime, readyAll, settle, table } from './conveyor-play.ts';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The e2e server's rig deals known hands every round (see conveyor-play.ts).

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };

test('2 players on phones: a miso clash, a menu, a special order and three rounds to the standings', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = (await table(browser, ['Ana', 'Ben'], { viewport: PHONE })) as [Page, Page];
  const [ana, ben] = pages;
  // The menu for two: uramaki, onigiri, tofu, miso, menu, special order, fruit.
  await ana.locator('[data-menu="two"]').click();
  await expect(ben.getByText(/Table for two/).first()).toBeVisible();
  await ana.getByRole('button', { name: 'Start the game' }).click();

  // Turn 1: both pick a miso soup; Ben sees only that Ana has picked.
  await pickTime(ana, 1, 1);
  await pick(ana, 'miso');
  await expect(ben.getByText('✓ picked')).toBeVisible();
  await pick(ben, 'miso');
  for (const p of pages) await expect(p.getByText(/clash!/).first()).toBeVisible();

  // Turn 2: onigiri each (hands swapped).
  await pickTime(ana, 1, 2);
  await pick(ana, 'onigiri-triangle');
  await pick(ben, 'onigiri-circle');

  // Turn 3: Ana orders from the menu; only she sees the four cards drawn.
  await pickTime(ana, 1, 3);
  await pick(ana, 'menu-7');
  await pick(ben, 'tofu');
  await expect(ben.getByText(/Ana is ordering from the/)).toBeVisible();
  await expect(ben.locator('button[data-k]')).toHaveCount(7);
  await order(ana);
  await settle(pages, 1, 3, 10);

  // Turn 4, then turn 5: Ana's special order copies her onigiri ▲.
  await pick(ana, 'nigiri-squid');
  await pick(ben, 'tofu');
  await pickTime(ana, 1, 5);
  await pick(ana, 'order', 'onigiri-triangle');
  await pickTime(ben, 1, 5);
  await ben.locator('button[data-k]').first().click();
  await ben.getByTestId('cv-lock').click();
  await settle(pages, 1, 5, 10);
  await expect(
    ben.getByRole('region', { name: 'Turn 5 reveal' }).getByLabel('copied'),
  ).toBeVisible();

  for (let turn = 6; turn <= 10; turn++) await fillerTurn(pages, 1, turn, 10);
  await expect(ana.getByRole('heading', { name: 'Round 1 scores' })).toBeVisible();
  await readyAll(pages);

  for (const round of [2, 3]) {
    for (let turn = 1; turn <= 10; turn++) await fillerTurn(pages, round, turn, 10);
    if (round < 3) await readyAll(pages);
  }
  await expect(ana.getByRole('heading', { name: 'Final standings' })).toBeVisible();
  await expect(ben.getByText('Desserts at the end')).toBeVisible();
  await ana.getByRole('button', { name: 'Play again' }).click();
  await pickTime(ben, 1, 1);
});
