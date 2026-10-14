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
    test.setTimeout(600_000);
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
    await expect(hana.getByRole('region', { name: 'Honour prompt' })).toBeVisible();
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

    // Five at the table: the dragon makes everyone choose, each on a fixed 20-second clock.
    const five = await table(browser, ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'], look);
    for (const [i, hero] of ['dragon', 'owl', 'psychic', 'slime', 'eye'].entries())
      await pickHero(five[i]!, hero, true);
    await five[0]!.getByRole('button', { name: 'Start the brawl' }).click();
    await playCard(five[0]!, 'dragon.03');
    await expect(five[0]!.getByRole('region', { name: 'Your choice' })).toBeVisible();
    await shot(five[0]!, '12-five-choose');
    await five[0]!.getByRole('button', { name: /Heal 1/ }).click();
    // Going right, the seat before the dragon's chooses next, out of turn (seats join in any
    // order, so find whoever is asked).
    const asked = (p: Page) => p.getByRole('region', { name: 'Your choice' }).count();
    await expect.poll(async () => (await Promise.all(five.map(asked))).some(Boolean)).toBe(true);
    const counts = await Promise.all(five.map(asked));
    const other = five[counts.findIndex(Boolean)]!;
    const watcher = five.find((p, i) => i > 0 && p !== other)!;
    await other.waitForTimeout(400);
    await shot(other, '13-five-choose-other');
    await other.getByRole('button', { name: /Attack 1/ }).click();
    await shot(other, '14-five-target');
    await shot(watcher, '15-five-waiting');

    // Six at the table: neighbours only, and ghosts once someone is out.
    const six = await table(browser, ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eli'], look);
    await six[0]!.getByRole('button', { name: /Random for everyone/ }).click();
    await expect(six[0]!.getByRole('list', { name: 'Seats' })).not.toContainText('Picking a hero');
    await shot(six[0]!, '16-six-lobby');
    await six[0]!.getByRole('button', { name: 'Start the brawl' }).click();
    for (let i = 0; i < 12; i++) {
      for (const p of six) if (await move(p)) break;
    }
    await shot(six[0]!, '17-six-table');
    // Play on until the first ghost, and look at the table from a living seat.
    for (let i = 0; i < 400 && (await six[0]!.locator('[data-ghost]').count()) === 0; i++) {
      for (const p of six) if (await move(p)) break;
    }
    const names = ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eli'];
    await six[0]!.waitForTimeout(400);
    await shot(six[0]!, '18-six-ghost');
    // Then a choice screen of whoever's move it is.
    for (const [i, p] of six.entries()) {
      if (await p.getByRole('region', { name: /Your choice|Honour prompt/ }).count()) {
        await shot(p, `19-six-choice-${names[i]}`);
        break;
      }
    }
    await playToEnd(six);
    await six[0]!.waitForTimeout(400);
    await shot(six[0]!, '20-six-end');
  });
}
