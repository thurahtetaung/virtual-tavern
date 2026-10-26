import { type Page, expect } from '@playwright/test';
import { localArt, myTurn, table, useCard } from './skyfire-play.ts';
import { test } from './fixtures.ts';
import { type Look, openBackroom, visitor } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/skyfire-shots.spec.ts
// With SKYFIRE_ART=<folder holding manifest.json and the art> the pages get that manifest and art
// from disk, to preview the real cards locally; without it, cards are drawn from their colour,
// symbol and number. The e2e rig (playwright.config.ts) deals known hands.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1440, height: 900 }, 'light'],
  ['desktop-dark', { width: 1440, height: 900 }, 'dark'],
] as const) {
  test(`skyfire screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = async (p: Page, name: string) => {
      await p.waitForTimeout(400);
      await p.screenshot({ path: `test-results/skyfire-shots/${label}-${name}.png` });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const pages = await table(browser, ['Ana', 'Ben', 'Cy', 'Dee', 'Eve'], look);
    const [ana, ben] = pages as [Page, Page];
    await shot(ana, '01-lobby');
    await ana.getByRole('button', { name: 'Start the show' }).click();
    await myTurn(ana);
    await ana.getByRole('button', { name: 'Got it' }).click();
    await shot(ana, '02-your-turn');
    await ana.getByTestId('sf-clue-open').first().click();
    await ana.getByTestId('sf-clue-1').click();
    await shot(ana, '03-clue-sheet');
    await ana.getByTestId('sf-send-clue').click();
    await expect(ana.getByTestId('sf-send-clue')).toHaveCount(0);
    await ben.getByRole('button', { name: 'Got it' }).click();
    await shot(ben, '04-clued');
    // A teammate's card sheet: Cy’s first card (the white 5 with the rig) shown large.
    await ben.locator('[data-testid^="sf-hand-"]').first().locator('[data-card]').first().click();
    await expect(ben.getByTestId('sf-detail')).toBeVisible();
    await shot(ben, '04b-card-detail');
    await ben.keyboard.press('Escape');
    await ben.getByTestId('sf-my-hand').locator('[data-card]').first().click();
    await shot(ben, '05-card-sheet');
    await ben.keyboard.press('Escape');
    await useCard(
      ben,
      (await ben
        .getByTestId('sf-my-hand')
        .locator('[data-card]')
        .first()
        .getAttribute('data-card'))!,
      'discard',
    );
    // Phones show the discards in their own tab; desktop shows them beside the table.
    if (viewport.width < 1024) await ben.getByRole('tab', { name: /^Discards/ }).click();
    await shot(ben, '06-discards');
    await ana.getByTestId('sf-end-game').click();
    await ana.getByRole('dialog').getByRole('button', { name: 'End the show' }).click();
    await expect(ana.getByTestId('sf-end')).toBeVisible();
    await ana.getByTestId('sf-replay-next').click();
    await shot(ana, '07-end');
    await ana.screenshot({
      path: `test-results/skyfire-shots/${label}-07-end-full.png`,
      fullPage: true,
    });
  });
}
