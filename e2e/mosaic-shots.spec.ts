import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { localArt, myTurn, option, pick, place, sheet, table, take } from './mosaic-play.ts';
import { type Look, openBackroom, visitor } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/mosaic-shots.spec.ts
// With MOSAIC_ART=<folder holding manifest.json and the art> the pages get that manifest and art
// from disk, to preview the real tiles locally; without it, tiles are plain colours with symbols.
// The e2e rig (playwright.config.ts) fixes the factories and gives the first seat a nearly full
// top row, so the first game ends after one round.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1440, height: 900 }, 'light'],
  ['desktop-dark', { width: 1440, height: 900 }, 'dark'],
] as const) {
  test(`mosaic screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const phone = viewport.width < 1024;
    const shot = async (p: Page, name: string, wait = 500) => {
      await p.waitForTimeout(wait);
      await p.screenshot({ path: `test-results/mosaic-shots/${label}-${name}.png` });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const [hana, ana] = (await table(browser, ['Hana', 'Ana'], look)) as [Page, Page];
    await shot(hana, '01-lobby');
    await hana.getByRole('button', { name: 'Start the game' }).click();
    await myTurn(hana);
    await shot(hana, '02-your-turn');
    await pick(hana, 'blue', 1);
    await sheet(hana).locator('button[data-target="0"]').click();
    await shot(hana, '03-pick-sheet');
    await sheet(hana).getByTestId('mo-place').click();
    await expect(sheet(hana)).toHaveCount(0);
    await shot(ana, '04-opponent-view', 900);
    if (phone) {
      await ana.getByRole('tab', { name: 'Boards' }).click();
      await shot(ana, '05-boards-tab');
      await ana.getByRole('tab', { name: 'Scores' }).click();
      await shot(ana, '06-scores-tab');
      await ana.getByRole('tab', { name: 'Play' }).click();
    }
    await take(ana, 'red', 2, 4);
    await take(hana, 'black', 3, 4);
    await take(ana, 'light blue', 4, 5);
    await pick(hana, 'yellow', 5);
    await place(hana, 'floor');
    await expect(ana.getByTestId('mo-ouch')).toBeVisible();
    await shot(ana, '07-ouch', 200);
    await take(ana, 'yellow', 'centre', 2);
    await expect(hana.getByText('You win with 2 points!')).toBeVisible();
    await shot(hana, '08-end', 4000);
    await hana.screenshot({
      path: `test-results/mosaic-shots/${label}-08-end-full.png`,
      fullPage: true,
    });

    // A second game whose round ends without a full row: the wall-tiling between rounds.
    await hana.getByRole('button', { name: 'Play again' }).click();
    await take(hana, 'blue', 1, 2);
    await take(ana, 'red', 2, 4);
    await take(hana, 'black', 3, 4);
    await take(ana, 'light blue', 4, 5);
    await take(hana, 'yellow', 5, 5);
    await take(ana, 'yellow', 'centre', 2);
    await expect(hana.getByTestId('mo-tiling')).toBeVisible();
    await shot(hana, '09-tiling-mid', 900);
    await shot(hana, '10-tiling-done', 2500);
  });
}

// The wave 2 options, one game each: the take and the round's end.
for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1440, height: 900 }, 'light'],
  ['desktop-dark', { width: 1440, height: 900 }, 'dark'],
] as const) {
  test(`mosaic option screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(400_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = async (p: Page, name: string, wait = 500) => {
      await p.waitForTimeout(wait);
      await p.screenshot({ path: `test-results/mosaic-shots/${label}-opt-${name}.png` });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const [hana, ana] = (await table(browser, ['Hana', 'Ana'], look)) as [Page, Page];

    // The grey wall.
    await option(hana, 'mo-grey');
    await option(hana, 'mo-jokers');
    await option(hana, 'mo-specials');
    await shot(hana, '01-lobby-options');
    await hana.getByTestId('mo-jokers').click();
    await hana.getByTestId('mo-specials').click();
    await hana.getByRole('button', { name: 'Start the game' }).click();
    await pick(hana, 'blue', 1);
    await sheet(hana).locator('button[data-target="0"]').click();
    await shot(hana, '02-grey-pick');
    await sheet(hana).getByTestId('mo-place').click();
    await take(ana, 'red', 2, 2);
    await take(hana, 'black', 3, 4);
    await take(ana, 'light blue', 4, 5);
    await take(hana, 'yellow', 5, 5);
    await take(ana, 'yellow', 'centre', 3);
    await expect(hana.getByTestId('mo-wall-choice')).toBeVisible();
    await hana.getByTestId('mo-wall-choice').locator('[data-cell="3:0"] button').click();
    await shot(hana, '03-grey-wall-choice');
    await hana.getByTestId('mo-wall-place').click();
    await shot(hana, '04-grey-waiting');
    await ana.getByTestId('mo-wall-choice').locator('[data-cell="1:4"] button').click();
    await ana.getByTestId('mo-wall-place').click();
    await expect(hana.getByText(/You win/)).toBeVisible();
    await shot(hana, '05-grey-end', 4000);

    // Jokers.
    await hana.getByRole('button', { name: 'Change setup' }).click();
    await hana.getByTestId('mo-grey').click();
    await option(hana, 'mo-jokers');
    await hana.getByRole('button', { name: 'Start the game' }).click();
    await pick(hana, 'joker', 1);
    await sheet(hana).getByRole('radio', { name: 'jokers + 1 blue' }).click();
    await sheet(hana).locator('button[data-target="1"]').click();
    await shot(hana, '06-joker-pick');
    await sheet(hana).getByRole('radio', { name: '1 joker alone' }).click();
    await place(hana, 1);
    await take(ana, 'red', 2, 4);
    await take(hana, 'black', 3, 4);
    await take(ana, 'light blue', 4, 5);
    await take(hana, 'yellow', 5, 5);
    await take(ana, 'yellow', 'centre', 3);
    await take(hana, 'blue', 'centre', 2);
    await expect(hana.getByText(/You win/)).toBeVisible();
    await shot(hana, '07-joker-end', 4000);

    // Special factories.
    await hana.getByRole('button', { name: 'Change setup' }).click();
    await hana.getByTestId('mo-jokers').click();
    await option(hana, 'mo-specials');
    await hana.getByRole('button', { name: 'Start the game' }).click();
    await myTurn(hana);
    await shot(hana, '08-specials-table');
    await pick(hana, 'blue', 1);
    await sheet(hana).locator('button[data-target="0"]').click();
    await shot(hana, '09-specials-split');
    await sheet(hana).getByTestId('mo-place').click();
    await take(ana, 'red', 2, 4);
    await take(hana, 'black', 3, 4);
    await take(ana, 'light blue', 4, 5);
    await pick(hana, 'yellow', 5);
    await sheet(hana).locator('button[data-target="floor"]').click();
    await shot(hana, '10-specials-shield-pick');
    await sheet(hana).getByTestId('mo-place').click();
    await shot(ana, '11-specials-opponent', 900);
    await take(ana, 'yellow', 'centre', 3);
    await expect(hana.getByText(/You win/)).toBeVisible();
    await shot(hana, '12-specials-end', 4500);
  });
}
