import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { YOUR_TURN, pick, place, sheet, table, take } from './mosaic-play.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The e2e server's rig (playwright.config.ts): the first seat starts; the factories hold
// blue blue yellow yellow / red ×4 / black ×4 / light blue ×4 / yellow ×4; and the first seat's
// top wall row has every colour but blue, so a blue in line 1 ends the game after this round.

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };

test('a 2-player game on phones: the pick sheet, the marker, an Ouch, the wall-tiling and the end', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [hana, ana] = (await table(browser, ['Hana', 'Ana'], { viewport: PHONE })) as [Page, Page];
  await hana.getByRole('button', { name: 'Start the game' }).click();

  // Two blues: the sheet says line 1 fills with one spilling, and what is left behind.
  await pick(hana, 'blue', 1);
  const line1 = sheet(hana).locator('button[data-target="0"]');
  await expect(line1).toContainText('1 here, fills it ✓, 1 spill');
  await expect(line1).toContainText('+5 at round end');
  await expect(sheet(hana).getByTestId('mo-leaves')).toContainText('Leaves 2 yellow → centre.');
  await place(hana, 1);
  await expect(
    hana.getByRole('region', { name: 'Your board' }).getByLabel(/^Floor: 1 of 7/),
  ).toBeVisible();

  await take(ana, 'red', 2, 4);
  await take(hana, 'black', 3, 4);
  await take(ana, 'light blue', 4, 5);

  // Four yellows on the floor: the sheet warns, and everyone sees the Ouch.
  await pick(hana, 'yellow', 5);
  await sheet(hana).locator('button[data-target="floor"]').click();
  await expect(sheet(hana).getByText(/That spills 4 tiles; line 5 would spill 0\./)).toBeVisible();
  await sheet(hana).getByTestId('mo-place').click();
  await expect(ana.getByTestId('mo-ouch')).toHaveText(/Ouch: Hana ate -7!/);

  // The centre's yellows bring the first-player marker with them.
  await pick(ana, 'yellow', 'centre');
  await expect(sheet(ana).getByText(/\+ the first-player marker/)).toBeVisible();
  await place(ana, 2);

  // The round's wall-tiling ends the game: Hana's top row is full.
  for (const p of [hana, ana]) await expect(p.getByTestId('mo-tiling')).toBeVisible();
  await expect(hana.getByText('You win with 2 points!')).toBeVisible();
  await expect(ana.getByText('Hana wins with 2 points!')).toBeVisible();
  await expect(ana.getByRole('heading', { name: 'Final standings' })).toBeVisible();
  await expect(hana.getByTestId('mo-bonus').first()).toContainText('Rows 1 × 2', {
    timeout: 10_000,
  });
  await hana.getByRole('button', { name: 'Play again' }).click();
  await expect(hana.getByText(YOUR_TURN)).toBeVisible();
});
