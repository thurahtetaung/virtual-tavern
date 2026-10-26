import { type Page, expect } from '@playwright/test';
import { keepAll, localArt, myTurn, readyAll, recruit, show, table } from './encore-play.ts';
import { test } from './fixtures.ts';
import { type Look, openBackroom, visitor } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/encore-shots.spec.ts
// With ENCORE_ART=<folder holding manifest.json and the art> the pages get that manifest and art
// from disk, to preview the real cards locally; without it, cards are drawn from their numbers.
// The e2e rig (playwright.config.ts) deals known hands, so the game plays the same every time.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1440, height: 900 }, 'light'],
  ['desktop-dark', { width: 1440, height: 900 }, 'dark'],
] as const) {
  test(`encore screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = async (p: Page, name: string) => {
      await p.waitForTimeout(400);
      await p.screenshot({ path: `test-results/encore-shots/${label}-${name}.png` });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const pages = (await table(browser, ['Ana', 'Ben', 'Cy'], look)) as [Page, Page, Page];
    const [ana, ben, cy] = pages;
    await shot(ana, '01-lobby');
    await ana.getByRole('button', { name: 'Start the game' }).click();
    await expect(ana.getByTestId('en-flip-turned')).toBeVisible();
    await shot(ana, '02-flip');
    await keepAll(pages, 1, 3);
    await show(ana, 0, /^Show 1/);

    // Ben's turn: the ✦ marks, then the pair picked with its reason on the button.
    await myTurn(ben);
    await shot(ben, '03-your-turn');
    await ben
      .getByRole('list', { name: 'Your hand' })
      .locator('button[data-hand-index="0"]')
      .click();
    await shot(ben, '04-selected');
    await ben.getByTestId('en-show').click();
    await expect(cy.getByTestId('en-table').locator('[data-card]')).toHaveCount(2);
    await cy.waitForTimeout(150);
    await cy.screenshot({ path: `test-results/encore-shots/${label}-05-show.png` });

    // Cy recruits: the floating card, turned, previewed in a gap.
    await myTurn(cy);
    await cy.locator('[data-table-end="left"]').click();
    await cy.getByRole('button', { name: /^↻ Turn it/ }).click();
    await cy.locator('[data-gap="3"]').click();
    await shot(cy, '06-recruiting');
    await cy.getByRole('button', { name: /^Recruit it here/ }).click();
    await myTurn(ana);
    await shot(ana, '07-last-chance');
    await recruit(ana, 0);
    await expect(ana.getByTestId('en-round-end')).toBeVisible();
    await shot(ana, '08-round-scores');
    await readyAll(pages);

    // Round 2: a Recruit & Show.
    await keepAll(pages, 2, 3);
    await show(ben, 2, /^Show 6/);
    await myTurn(cy);
    await cy.getByTestId('en-recruit-show').click();
    await cy.locator('[data-gap="1"]').click();
    await cy
      .getByRole('list', { name: 'Your hand' })
      .locator('button[data-hand-index="0"]')
      .click();
    await shot(cy, '09-recruit-and-show');
    await cy.getByRole('button', { name: /^🎪 Recruit & show/ }).click();
    await recruit(ana, 0);
    await recruit(ben, 0);
    await readyAll(pages);
    await keepAll(pages, 3, 3);
    await show(cy, 8, /^Show 9-9-9-9/);
    await recruit(ana, 0);
    await recruit(ben, 0);
    await expect(ana.getByRole('heading', { name: 'Final standings' })).toBeVisible();
    await shot(ana, '10-end');
    await ana.screenshot({
      path: `test-results/encore-shots/${label}-10-end-full.png`,
      fullPage: true,
    });
  });
}
