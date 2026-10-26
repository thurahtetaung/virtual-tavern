import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { bid, drawWithMouse, importPacks, localArt, lotIs, table } from './going-once-play.ts';
import type { Look } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/going-once-shots.spec.ts
// Phone and desktop, light and dark: the lobby (and its sound settings), drawing, the practice
// lot's tip and bidding, a lot's intro with its tip bubble, an auction going once, the screw
// picker, the bank, the Sold card, half-time and the end gallery. With GOING_ONCE_ART and GOING_ONCE_PACKS
// (`going-once-play.ts`) it previews the real art and lines locally; without, placeholders.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const cleanup: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
});

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1280, height: 860 }, 'light'],
  ['desktop-dark', { width: 1280, height: 860 }, 'dark'],
] as const) {
  test(`going once screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = (p: Page, name: string) =>
      p.screenshot({ path: `test-results/going-once-shots/${label}-${name}.png`, fullPage: true });
    cleanup.push(await importPacks(browser));
    const pages = (await table(browser, ['Hana', 'Ben', 'Cleo'], look)) as [Page, Page, Page];
    const [hana, ben, cleo] = pages;
    await shot(hana, '01-lobby');
    await hana
      .getByTestId('go-sound-settings')
      .screenshot({ path: `test-results/going-once-shots/${label}-01b-sound-settings.png` });
    // The voice on: the auctioneer sets the pace (greyed); then off again for this game.
    await hana.getByTestId('go-voice').click();
    await expect(hana.getByTestId('go-pace-help')).toContainText('The auctioneer sets the pace');
    await shot(hana, '01c-lobby-voice-on');
    await hana.getByTestId('go-voice').click();
    await expect(hana.getByTestId('go-pace-help')).not.toContainText('auctioneer');
    // The colour picker offers the auctioneer's seven colours.
    await ben.getByRole('button', { name: /^Players/ }).click();
    const drawer = ben.getByRole('dialog', { name: 'Players' });
    await drawer.getByRole('button', { name: 'Change name or colour' }).click();
    await expect(drawer.getByRole('radiogroup', { name: 'Your colour' })).toBeVisible();
    await shot(ben, '01d-colour-picker');
    await ben.keyboard.press('Escape');
    await hana.getByTestId('go-start').click();

    for (const [seat, p] of pages.entries()) {
      let last = '';
      for (let i = 0; i < 2; i++) {
        const title = p.getByTestId('go-title');
        await expect(title).not.toHaveText(last);
        last = (await title.textContent()) ?? '';
        await drawWithMouse(p);
        if (seat === 2) await shot(p, '02-drawing');
        await p.getByTestId('drawing-send').click();
      }
    }

    // The practice lot: the tip, then its bidding; then Cleo skips the rest.
    await expect(hana.getByTestId('go-practice')).toBeVisible();
    await shot(hana, '02b-practice-tip');
    await expect(
      ben.getByTestId('go-practice').getByTestId('go-bid-400').filter({ visible: true }),
    ).toBeEnabled({ timeout: 20_000 });
    await shot(ben, '02c-practice-bid');
    await cleo.getByTestId('go-skip-practice').click();

    // Lot 1 opens with its number and each player's tip, before the picture.
    await expect(hana.getByTestId('go-lot-intro')).toBeVisible();
    await shot(hana, '02d-lot-intro-tip');

    // Lot 1: a bid, then "Going once" on screen.
    await lotIs(ben, 1);
    await bid(ben, 500);
    await expect(cleo.getByTestId('go-close')).toHaveAttribute('data-close', 'once');
    await shot(cleo, '03-auction-going-once');
    await expect(cleo.getByTestId('go-sold')).toBeVisible();
    await shot(cleo, '04-sold');

    // Ben is at $900: the bank.
    await expect(ben.getByTestId('go-bank')).toBeVisible();
    await shot(ben, '05-bank');
    for (const p of pages) await p.getByRole('button', { name: 'No thanks' }).click();

    await expect(hana.getByTestId('go-halftime')).toBeVisible({ timeout: 60_000 });
    await shot(hana, '06-halftime');
    await lotIs(cleo, 5);
    await cleo.getByTestId('go-screw').click();
    await expect(cleo.getByTestId('go-screw-picker')).toBeVisible();
    await shot(cleo, '07-screw');
    await cleo.getByTestId('go-screw-picker').getByRole('button', { name: /Ben/ }).click();
    await expect(hana.getByTestId('go-top-bid')).toContainText('🔩 by Cleo');
    await shot(hana, '08-screwed-bid');

    await expect(hana.getByTestId('go-gallery')).toBeVisible({ timeout: 90_000 });
    await shot(hana, '09-end-gallery');
  });
}
