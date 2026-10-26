import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  drawAndSend,
  importPacks,
  like,
  localArt,
  pairTableScreen,
  pick,
  results,
  table,
  writeLie,
} from './sketchy-play.ts';
import type { Look } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/sketchy-shots.spec.ts
// Phone and desktop, light and dark: drawing, writing, picking, the reveal, the results and the
// standings, on the rigged deal with made-up prompts.
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
  test(`sketchy screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme };
    const shot = (p: Page, name: string) =>
      p.screenshot({ path: `test-results/sketchy-shots/${label}-${name}.png`, fullPage: true });
    cleanup.push(await importPacks(browser));
    const [hana, ben, cleo] = (await table(browser, ['Hana', 'Ben', 'Cleo'], look)) as [
      Page,
      Page,
      Page,
    ];
    await hana.getByText('Timers', { exact: true }).click();
    await shot(hana, '01-lobby');
    await hana.getByRole('button', { name: 'Start game' }).click();
    await expect(ben.getByTestId('sketchy-prompt')).toBeVisible();
    await shot(ben, '02-drawing');
    for (const p of [hana, ben, cleo]) await drawAndSend(p);
    await writeLie(ben, 'grape monster');
    await shot(cleo, '03-writing');
    await shot(hana, '04-artist-waiting');
    await writeLie(cleo, 'violet hippo');
    await pick(ben, 'purple elephant');
    await like(ben, 'violet hippo');
    await shot(ben, '05-picking');
    await pick(cleo, 'grape monster');
    await expect(cleo.getByTestId('reveal-sequence')).toBeVisible();
    await cleo.waitForTimeout(1800);
    await shot(cleo, '06-reveal');
    await results([hana, ben, cleo], 'purple elephant');
    await shot(ben, '07-results');
    // The rest, quickly: the rigged prompts are known, so every writer finds the real title.
    const pages = [hana, ben, cleo];
    const play = async (drawings: [number, string][]) => {
      for (const [artist, prompt] of drawings) {
        const writers = pages.filter((_, i) => i !== artist);
        for (const [i, p] of writers.entries()) await writeLie(p, `fake ${i} ${prompt}`);
        for (const p of writers) await pick(p, prompt);
        await results(pages, prompt);
        await hana.getByTestId('sketchy-next').click();
      }
    };
    await hana.getByTestId('sketchy-next').click();
    await play([
      [1, 'flying toaster'],
      [2, 'sad robot'],
    ]);
    for (const p of pages) await drawAndSend(p);
    await play([
      [0, 'happy cloud'],
      [1, 'tiny castle'],
      [2, 'loud fish'],
    ]);
    await expect(hana.getByTestId('sketchy-over')).toBeVisible({ timeout: 60_000 });
    await shot(hana, '08-standings');
  });
}

// The show: the table screen at every phase (1920 x 1080) with quiet phones, and full phones with no
// table screen, light and dark. SKETCHY_ART=<private folder with manifest.json, show/, audio/>
// serves the original's rigs; without it the plain rooms are shot.
for (const colorScheme of ['light', 'dark'] as const) {
  for (const withTv of [true, false]) {
    test(`sketchy show screenshots (${withTv ? 'table screen + quiet' : 'full'} phones, ${colorScheme})`, async ({
      browser,
    }) => {
      test.setTimeout(400_000);
      const dir = `test-results/sketchy-show/${withTv ? 'quiet' : 'full'}-${colorScheme}`;
      const look: Look = { viewport: { width: 390, height: 844 }, colorScheme, setup: localArt };
      cleanup.push(await importPacks(browser));
      const pages = (await table(browser, ['Hana', 'Ben', 'Cleo'], look)) as [Page, Page, Page];
      const [hana, ben, cleo] = pages;
      const tv = withTv
        ? await pairTableScreen(browser, hana, {
            viewport: { width: 1920, height: 1080 },
            setup: localArt,
          })
        : null;
      const shot = async (name: string, phone: Page = cleo) => {
        if (tv) await tv.screenshot({ path: `${dir}/tv-${name}.png` });
        await phone.screenshot({ path: `${dir}/phone-${name}.png` });
      };
      await hana.waitForTimeout(1500);
      await shot('01-lobby', hana);
      await hana.getByRole('button', { name: 'Start game' }).click();
      await hana.waitForTimeout(1200);
      await shot('02a-countdown', ben);
      await hana.waitForTimeout(3000);
      await shot('02b-drawing-time', ben);
      await drawAndSend(hana);
      await hana.waitForTimeout(800);
      await shot('03-drawing-sent', hana);
      for (const p of [ben, cleo]) await drawAndSend(p);
      await hana.waitForTimeout(1800);
      await shot('04-writing');
      await writeLie(ben, 'grape monster');
      await hana.waitForTimeout(800);
      await shot('05-lie-in', ben);
      await writeLie(cleo, 'violet hippo');
      await hana.waitForTimeout(1500);
      await shot('06-choices');
      await pick(ben, 'violet hippo');
      await like(ben, 'violet hippo');
      await pick(cleo, 'purple elephant');
      // Step 1 (Cleo's lie fooled Ben): before the flip, then after; step 2 the truth.
      await hana.waitForTimeout(900);
      await shot('07a-reveal-names', ben);
      await hana.waitForTimeout(900);
      await shot('07b-reveal-flip-lie', ben);
      await hana.waitForTimeout(400);
      await shot('07c-reveal-fooler', cleo);
      await hana.waitForTimeout(2600);
      await shot('08-reveal-truth', cleo);
      await results(pages, 'purple elephant');
      await hana.waitForTimeout(1500);
      await shot('09-board', ben);
      const play = async (drawings: [number, string][]) => {
        for (const [artist, prompt] of drawings) {
          const writers = pages.filter((_, i) => i !== artist);
          for (const [i, p] of writers.entries()) await writeLie(p, `fake ${i} ${prompt}`);
          for (const p of writers) await pick(p, prompt);
          await results(pages, prompt);
          await hana.getByTestId('sketchy-next').click();
        }
      };
      await hana.getByTestId('sketchy-next').click();
      await play([
        [1, 'flying toaster'],
        [2, 'sad robot'],
      ]);
      for (const p of pages) await drawAndSend(p);
      await play([
        [0, 'happy cloud'],
        [1, 'tiny castle'],
        [2, 'loud fish'],
      ]);
      await expect(hana.getByTestId('sketchy-over')).toBeVisible({ timeout: 60_000 });
      await hana.waitForTimeout(2500);
      await shot('10a-end-likes', hana);
      await hana.waitForTimeout(5000);
      await shot('10b-end-winner', hana);
    });
  }
}
