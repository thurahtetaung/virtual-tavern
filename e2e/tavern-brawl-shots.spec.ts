import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import {
  type Look,
  dock,
  move,
  openBackroom,
  pickHero,
  playToEnd,
  table,
  visitor,
} from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/tavern-brawl-shots.spec.ts
// With TAVERN_BRAWL_ART=<folder holding manifest.json and the art> the pages get that manifest and
// art from disk, to preview the real cards locally; without it, cards show as placeholders.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const ART = process.env.TAVERN_BRAWL_ART;
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/tavern-brawl', async (route) =>
    route.fulfill({
      json: JSON.parse(await readFile(join(ART, 'manifest.json'), 'utf8')) as unknown,
    }),
  );
  await page.route('**/api/backroom/assets/tavern-brawl/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/tavern-brawl\//,
      '',
    );
    try {
      await route.fulfill({
        body: await readFile(join(ART, path)),
        contentType: TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream',
      });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
}

const hand = (p: Page) => p.getByRole('region', { name: 'Your hand' });
const playCard = async (p: Page, card: string) => {
  await hand(p)
    .locator(`[data-hand="${card}"]`)
    .first()
    .click({ position: { x: 14, y: 90 } });
  await dock(p).click();
};

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1280, height: 860 }, 'light'],
  ['desktop-dark', { width: 1280, height: 860 }, 'dark'],
] as const) {
  test(`tavern brawl screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/shots/tavern-brawl-${label}-${name}.png`,
        fullPage: true,
      });
    await openBackroom(await visitor(browser, 'Admin'));
    const [hana, ana] = (await table(browser, ['Hana', 'Ana'], look)) as [Page, Page];
    await pickHero(hana, 'druid', true);
    await shot(hana, '01-lobby');
    await pickHero(ana, 'mage', true);
    await hana.getByRole('button', { name: 'Start the brawl' }).click();
    await expect(hana.getByText('Your turn: play a card')).toBeVisible();
    await hand(hana)
      .locator('[data-hand]')
      .first()
      .click({ position: { x: 14, y: 90 } });
    await shot(hana, '02-your-turn');
    await hand(hana)
      .getByRole('button', { name: /^Read / })
      .first()
      .click();
    await expect(hana.getByRole('dialog')).toBeVisible();
    await hana.waitForTimeout(400);
    await shot(hana, '03-zoom');
    await hana.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    // The scripted turn (see playwright.config.ts): chain, howl, two shields.
    await dock(hana).click();
    await playCard(hana, 'druid.08');
    await expect(hana.getByRole('region', { name: 'Animal noise' })).toBeVisible();
    await shot(hana, '04-howl');
    await shot(ana, '05-waiting');
    await hana.getByRole('button', { name: /I made an animal noise/ }).click();
    await playCard(hana, 'druid.05');
    await playCard(hana, 'druid.02');
    await expect(ana.getByText('Your turn: play a card')).toBeVisible();
    await playCard(ana, 'mage.10');
    await playCard(ana, 'mage.06');
    await ana
      .getByRole('region', { name: 'Your choice' })
      .getByRole('button', { name: /^Hana \(/ })
      .click();
    await expect(ana.getByRole('region', { name: 'Your choice' })).toContainText('which of Hana');
    await shot(ana, '06-shield-order');
    await ana.getByRole('region', { name: 'Your choice' }).getByRole('button').first().click();
    await shot(hana, '07-table');
    if (label.startsWith('phone')) {
      await hana.getByRole('tab', { name: 'Log' }).click();
      await shot(hana, '08-log-tab');
      await hana.getByRole('tab', { name: 'Discards' }).click();
      await shot(hana, '09-discards-tab');
      await hana.getByRole('tab', { name: 'Table' }).click();
    }
    await playToEnd([hana, ana]);
    await hana.waitForTimeout(500);
    await shot(hana, '10-end');
    await shot(ana, '11-end-other');

    // Four at the table.
    const four = await table(browser, ['Hana', 'Ana', 'Ben', 'Cy'], look);
    await four[0]!.getByRole('button', { name: /Random for everyone/ }).click();
    await expect(four[0]!.getByRole('list', { name: 'Seats' })).not.toContainText('Picking a hero');
    await four[0]!.getByRole('button', { name: 'Start the brawl' }).click();
    for (let i = 0; i < 14; i++) {
      for (const p of four) if (await move(p)) break;
    }
    await shot(four[0]!, '12-four-table');
  });
}
