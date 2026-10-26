import { type Page, expect } from '@playwright/test';
import { fillerTurn, localArt, pickTime, readyAll, table } from './conveyor-play.ts';
import { test } from './fixtures.ts';
import { type Look, openBackroom, visitor } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/conveyor-shots.spec.ts
// With CONVEYOR_ART=<folder holding manifest.json and the art> the pages get that manifest and
// art from disk, to preview the real cards locally; without it, cards are drawn from their dish.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1440, height: 900 }, 'light'],
  ['desktop-dark', { width: 1440, height: 900 }, 'dark'],
] as const) {
  test(`conveyor screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(400_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = async (p: Page, name: string, fullPage = false) => {
      await p.waitForTimeout(600);
      await p.screenshot({ path: `test-results/conveyor-shots/${label}-${name}.png`, fullPage });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const pages = (await table(browser, ['Ana', 'Ben', 'Cy'], look)) as [Page, Page, Page];
    const [ana, ben] = pages;
    await ana.locator('[data-menu="sampler"]').click();
    await shot(ana, '01-lobby');
    await ana.locator('[data-menu="custom"]').click();
    await shot(ana, '02-own-menu', true);
    await ana.locator('[data-menu="sampler"]').click();
    await ana.getByRole('button', { name: 'Start the game' }).click();
    await pickTime(ana, 1, 1);
    await shot(ana, '03-first-turn');
    await ana.locator('button[data-k]').first().click();
    await shot(ana, '04-selected');
    await fillerTurn(pages, 1, 1, 10);
    await fillerTurn(pages, 1, 2, 10);
    await fillerTurn(pages, 1, 3, 10);
    await shot(ben, '05-reveal');
    await ben.locator('button[data-k]').nth(1).click();
    await ben.getByTestId('cv-lock').click();
    await shot(ben, '06-locked');
    await ana.getByRole('region', { name: 'Other players' }).getByRole('button').first().click();
    await shot(ana, '07-other-tray');
    await ana.keyboard.press('Escape');
    for (const p of [ana, pages[2]]) {
      await p.locator('button[data-k]').first().click();
      await p.getByTestId('cv-lock').click();
    }
    for (let turn = 5; turn <= 10; turn++) await fillerTurn(pages, 1, turn, 10);
    await expect(ana.getByRole('heading', { name: 'Round 1 scores' })).toBeVisible();
    await shot(ana, '08-round-scores', true);
    await readyAll(pages);
    for (const round of [2, 3]) {
      for (let turn = 1; turn <= 10; turn++) await fillerTurn(pages, round, turn, 10);
      if (round < 3) await readyAll(pages);
    }
    await expect(ana.getByRole('heading', { name: 'Final standings' })).toBeVisible();
    await shot(ana, '09-end');
    await shot(ana, '10-end-full', true);
  });
}
