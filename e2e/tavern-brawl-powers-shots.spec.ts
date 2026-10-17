import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  type Look,
  localArt,
  openBackroom,
  pickHero,
  table,
  unlock,
  visitor,
} from './tavern-brawl-play.ts';

// Opt-in visual check of where heroes, their cards and their powers show: the guide (rules page
// and drawer), the lobby's hero pick and the table.
// SCREENSHOTS=1 TAVERN_BRAWL_ART=<art folder> pnpm exec playwright test e2e/tavern-brawl-powers-shots.spec.ts
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');
test.use({ actionTimeout: 15_000 });

const OUT = process.env.SHOTS_DIR ?? 'test-results/shots';

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1280, height: 860 }, 'light'],
  ['desktop-dark', { width: 1280, height: 860 }, 'dark'],
] as const) {
  test(`tavern brawl powers screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = (p: Page, name: string, fullPage = true) =>
      p.screenshot({ path: `${OUT}/tb-powers-${label}-${name}.png`, fullPage });
    const settle = (p: Page) => p.waitForTimeout(600);

    await openBackroom(await visitor(browser, 'Admin'));
    // The rules page: the Heroes tab and one hero's sheet.
    const reader = await visitor(browser, 'Reader', look);
    await unlock(reader);
    await reader.goto('/rules/tavern-brawl');
    const tabs = reader.getByRole('tablist', { name: 'Guide' });
    await tabs.getByRole('tab', { name: 'Heroes' }).click();
    await settle(reader);
    await shot(reader, '01-rules-heroes');
    await reader.locator('#guide-role-sutha-the-skullcrusher, #guide-role-brute').first().click();
    await expect(reader.getByTestId('guide-sheet')).toBeVisible();
    await settle(reader);
    await shot(reader, '02-rules-hero-sheet', false);
    // The sheet links to the hero's cards.
    await reader.getByRole('button', { name: /See every card/ }).click();
    await settle(reader);
    await shot(reader, '03-rules-cards', false);
    await shot(reader, '03b-rules-cards-full');
    // The jump chips and group headings: each hero's face, zoomed in.
    await reader.evaluate(() => window.scrollTo(0, 0));
    await reader.getByRole('navigation', { name: 'Jump to' }).screenshot({
      path: `${OUT}/tb-powers-${label}-03c-rules-cards-chips.png`,
    });
    await reader.locator('#guide-cards-brute button').first().click();
    await expect(reader.getByTestId('guide-card-sheet')).toBeVisible();
    await settle(reader);
    await shot(reader, '04-rules-card-sheet', false);
    await reader.keyboard.press('Escape');
    await tabs.getByRole('tab', { name: 'Cheat sheet' }).click();
    await settle(reader);
    await shot(reader, '05-rules-cheat-sheet');

    // A room: the lobby's hero pick, the drawer, and the table.
    const [hana, ana] = (await table(browser, ['Hana', 'Ana'], look)) as [Page, Page];
    await pickHero(hana, 'druid', true);
    await pickHero(ana, 'mage', true);
    await settle(hana);
    await shot(hana, '06-lobby');
    await hana.locator('[data-powers="slime"]').click();
    await expect(hana.getByTestId('tb-hero-sheet')).toBeVisible();
    await settle(hana);
    await shot(hana, '07-lobby-hero-sheet', false);
    await hana.getByText(/The whole deck/).click();
    await settle(hana);
    await shot(hana, '08-lobby-hero-deck', false);
    await hana.keyboard.press('Escape');
    await hana.getByRole('button', { name: 'Rules', exact: true }).first().click();
    const drawer = hana.getByRole('dialog', { name: /How to play/ });
    await drawer.getByRole('tab', { name: 'Heroes' }).click();
    await drawer.locator('#guide-role-jaheira, #guide-role-druid').first().click();
    await expect(hana.getByTestId('guide-sheet')).toBeVisible();
    await settle(hana);
    await shot(hana, '09-drawer-hero-sheet', false);
    await hana.keyboard.press('Escape');
    await drawer.getByRole('tab', { name: 'Cards' }).click();
    await settle(hana);
    await shot(hana, '10-drawer-cards', false);
    await hana.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    await hana.getByRole('button', { name: 'Start the brawl' }).click();
    await expect(hana.locator('[data-seq]')).toBeVisible();
    await settle(hana);
    await shot(hana, '11-table');
    await hana.locator('[data-seat-hero="mage"]').click();
    await settle(hana);
    await shot(hana, '12-table-seat-sheet', false);
    await hana.keyboard.press('Escape');
    // Your own seat: "played by you".
    await hana.locator('[data-seat-hero="druid"]').click();
    await settle(hana);
    await shot(hana, '12b-table-own-seat-sheet', false);
    await hana.keyboard.press('Escape');
    if (label.startsWith('phone')) await ana.getByRole('tab', { name: '✦ Powers' }).click();
    else await ana.getByText('✦ Mighty powers').click();
    await settle(ana);
    await shot(ana, '13-table-powers');
  });
}
