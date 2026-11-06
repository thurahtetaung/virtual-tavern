import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  accuse,
  localArt,
  playCard,
  playLaps,
  roundOrder,
  talk,
  showTab,
  table,
  writeWord,
} from './red-herring-play.ts';
import { type Look, openBackroom, visitor } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/red-herring-shots.spec.ts
// With RED_HERRING_ART=<folder holding manifest.json and the art> the pages get that manifest and
// art from disk; without it, cards are numbered. SHOTS_DIR picks where the pictures go. Each seat
// has its own look (phone and desktop, light and dark), so one game covers all four.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const DIR = process.env.SHOTS_DIR ?? 'test-results/red-herring-shots';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };
const LOOKS: [string, Look][] = [
  ['phone-light', { viewport: PHONE, colorScheme: 'light', setup: localArt }],
  ['phone-dark', { viewport: PHONE, colorScheme: 'dark', setup: localArt }],
  ['desktop-light', { viewport: DESKTOP, colorScheme: 'light', setup: localArt }],
  ['desktop-dark', { viewport: DESKTOP, colorScheme: 'dark', setup: localArt }],
];
const NAMES = ['Ana', 'Ben', 'Cy', 'Dee'];

test('red herring screenshots', async ({ browser }) => {
  test.setTimeout(420_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = (await table(
    browser,
    NAMES,
    LOOKS.map(([, l]) => l),
  )) as [Page, Page, Page, Page];
  const [ana] = pages;
  const shot = async (p: Page, name: string) => {
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${DIR}/${LOOKS[pages.indexOf(p)]![0]}-${name}.png` });
  };
  const all = async (name: string) => {
    for (const p of pages) await shot(p, name);
  };
  await all('01-lobby');
  await ana.getByRole('button', { name: 'Start the game' }).click();
  await shot(ana, '02-tips');
  for (const p of pages) {
    // Phones fold the tips away: open the fold first.
    const tips = p.getByTestId('rh-tips');
    if (await tips.locator('summary').count()) await tips.locator('summary').click();
    await tips.getByRole('button', { name: 'Got it' }).click();
  }
  await all('03-first-card');

  for (let k = 0; k < 8; k++) {
    const order = roundOrder(pages, k % 4);
    const picker = order[0]!;
    if (k < 4) {
      await playCard(picker);
      await shot(picker, '04-word');
      await picker.getByLabel('Your secret word').fill(`Lantern ${k + 1}`);
      await picker.getByRole('button', { name: 'Send' }).click();
      await expect(picker.getByTestId('rh-word-form')).toHaveCount(0);
    } else await writeWord(picker, `Lantern ${k + 1}`);
    if (k === 0) {
      // Everyone's notebook open: Cy's is the blank page.
      for (const p of order.slice(1)) {
        await showTab(p, 'Me');
        await p.getByRole('button', { name: 'Show your notebook' }).click();
      }
      await all('05-notebook');
      for (const p of order.slice(1)) {
        await p.getByRole('button', { name: 'Hide your notebook' }).click();
        await showTab(p, 'Table');
      }
      for (const p of order.slice(1, 3)) await playCard(p);
      await all('06-plays');
      // A card full screen.
      await ana.getByTestId('rh-table').locator('button[data-card]').first().click();
      await shot(ana, '07-zoom');
      await ana.keyboard.press('Escape');
      for (const p of [...order.slice(3), ...order]) await playCard(p);
      await expect(ana.getByTestId('rh-discuss')).toBeVisible();
      await all('08-talk');
    } else await playLaps(order);
    if (k === 0) {
      await ana.getByRole('button', { name: 'Start the vote' }).click();
    } else await talk(pages, ana);
    const voters = order.slice(1);
    const conspirator = NAMES[(k + 2) % 4]!;
    for (const [i, v] of voters.entries()) {
      const me = NAMES[pages.indexOf(v)]!;
      const target =
        i === 0 && me !== conspirator
          ? conspirator
          : NAMES.find((n) => n !== me && n !== NAMES[k % 4])!;
      await accuse(v, target);
      if (k === 0 && i === 0) await all('10-vote');
    }
    await expect(
      ana.getByTestId('rh-reveal').getByRole('button', { name: 'Show all' }),
    ).toHaveCount(0);
    if (k === 0) await all('11-reveal');
    await ana.getByTestId('rh-next').click();
  }
  await all('12-scores');
  for (const p of pages.slice(0, 2)) await p.getByRole('tab', { name: /Rounds/ }).click();
  await shot(pages[0], '13-rounds');
  await shot(pages[1], '13-rounds');
});
