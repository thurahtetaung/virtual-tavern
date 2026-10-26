import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { drawAndSend, importPacks, like, pick, results, table, writeLie } from './sketchy-play.ts';
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
