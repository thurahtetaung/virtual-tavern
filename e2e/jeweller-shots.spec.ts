import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  localArt,
  marketCard,
  myTurn,
  openCard,
  options,
  sheet,
  table,
  take,
} from './jeweller-play.ts';
import { type Look, openBackroom, visitor } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/jeweller-shots.spec.ts
// With JEWELLER_ART=<folder holding manifest.json and the art> the pages get that manifest and
// art from disk, to preview the real cards locally; without it, cards are drawn from their numbers.
// The e2e rig (playwright.config.ts) gives the first seat a head start, so one game reaches a
// noble visit and the end in a few turns.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1440, height: 900 }, 'light'],
  ['desktop-dark', { width: 1440, height: 900 }, 'dark'],
] as const) {
  test(`jeweller screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    // What is on screen (phones must fit their play without scrolling far).
    const shot = async (p: Page, name: string) => {
      await p.waitForTimeout(500);
      await p.screenshot({ path: `test-results/jeweller-shots/${label}-${name}.png` });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const [hana, ana] = (await table(browser, ['Hana', 'Ana'], look)) as [Page, Page];
    await shot(hana, '01-lobby');
    await hana.getByRole('button', { name: 'Start the game' }).click();
    await myTurn(hana);
    await shot(hana, '02-your-turn');
    for (const g of ['green', 'red', 'white']) await hana.locator(`[data-pile="${g}"]`).click();
    await shot(hana, '03-taking-gems');
    await hana.getByTestId('jw-take').click();

    await myTurn(ana);
    await ana
      .getByRole('region', { name: 'Cards for sale' })
      .locator('[data-card]')
      .first()
      .click();
    await shot(ana, '04-card-sheet');
    await sheet(ana).getByTestId('jw-reserve').click();

    await myTurn(hana);
    await openCard(hana, 'L1-35');
    await shot(hana, '05-buying');
    await sheet(hana).getByTestId('jw-buy').click();
    await expect(hana.getByRole('status').filter({ hasText: 'A noble visits Hana' })).toBeVisible();
    await shot(hana, '06-noble-visit');
    await expect(ana.getByText(/Final round/).first()).toBeVisible();
    await shot(ana, '07-final-round');
    await take(ana, ['white', 'blue', 'black']);
    await expect(ana.getByText('Hana wins with 15 points!')).toBeVisible();
    await shot(ana, '08-end');
    await ana.screenshot({
      path: `test-results/jeweller-shots/${label}-08-end-full.png`,
      fullPage: true,
    });

    // A second game: Hana takes four times while Ana reserves, then hands two back.
    await hana.getByRole('button', { name: 'Play again' }).click();
    const reserve = async () => {
      await myTurn(ana);
      await ana.locator('[data-deck="1"]').click();
      await sheet(ana).getByTestId('jw-reserve-deck').click();
      await expect(sheet(ana)).toHaveCount(0);
    };
    await take(hana, ['white', 'blue', 'green']);
    await reserve();
    await take(hana, ['red', 'black', 'white']);
    await reserve();
    await take(hana, ['blue', 'green', 'red']);
    await reserve();
    await take(hana, ['black', 'white', 'blue']);
    await expect(hana.getByRole('group', { name: 'Pieces to hand back' })).toBeVisible();
    await shot(hana, '09-return-pieces');
    await shot(ana, '10-opponent-view');
  });
}

// Wave 2: Cities and Strongholds together. The rig's first City (C3a) is met by buying L2-11, and
// two of the first seat's strongholds start on L1-35.
for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1440, height: 900 }, 'light'],
  ['desktop-dark', { width: 1440, height: 900 }, 'dark'],
] as const) {
  test(`jeweller wave 2 screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = async (p: Page, name: string) => {
      await p.waitForTimeout(500);
      await p.screenshot({ path: `test-results/jeweller-shots/${label}-w2-${name}.png` });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const [hana, ana] = (await table(browser, ['Hana', 'Ana'], look)) as [Page, Page];
    await options(hana, ['jw-cities', 'jw-strongholds']);
    await shot(hana, '01-lobby');
    await hana.getByRole('button', { name: 'Start the game' }).click();
    await take(hana, ['white', 'red', 'green']);
    await myTurn(ana);
    await expect(marketCard(ana, 'L1-35')).toHaveAttribute('aria-label', /Hana’s 2 strongholds/);
    await shot(ana, '02-stronghold-market');
    await openCard(ana, 'L1-35');
    await shot(ana, '03-held-card-sheet');
    await ana.keyboard.press('Escape');
    await take(ana, ['white', 'blue', 'black']);

    await myTurn(hana);
    await openCard(hana, 'L2-11');
    await sheet(hana).getByTestId('jw-buy').click();
    const picker = hana.getByRole('group', { name: 'Place a stronghold' });
    await expect(picker).toBeVisible();
    await shot(hana, '04-place-stronghold');
    await marketCard(hana, 'L1-35').click();
    await expect(hana.getByRole('group', { name: 'Conquest' })).toBeVisible();
    await shot(hana, '05-conquest');
    await hana.getByRole('button', { name: 'Not now' }).click();
    await expect(ana.getByText(/Final round: Hana met a City/).first()).toBeVisible();
    await shot(hana, '06-city-met');
    await shot(ana, '07-final-round');
    await hana.getByRole('region', { name: 'Cities' }).locator('[data-city="C3a"]').click();
    await shot(hana, '08-city-sheet');
    await hana.keyboard.press('Escape');
    await hana.getByRole('button', { name: 'Rules', exact: true }).click();
    const drawer = hana.getByRole('dialog');
    await drawer.getByRole('tab', { name: 'Rules' }).click();
    const nobles = drawer
      .locator('details')
      .filter({ has: hana.locator('summary', { hasText: 'Nobles' }) });
    await nobles.scrollIntoViewIfNeeded();
    await shot(hana, '09-rules-nobles');
  });
}
