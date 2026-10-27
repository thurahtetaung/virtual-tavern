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
    await hana.getByTestId('sketchy-announcer').getByRole('button', { name: 'Animated' }).click();
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

/**
 * With SOUND_LOG set, every sound the page's audio engine starts is logged (when, how long), so a
 * run shows which device made which sound.
 */
async function logSound(page: Page) {
  if (!process.env.SOUND_LOG) return;
  await page.addInitScript(() => {
    const w = window as unknown as { __plays: { at: number; s: number }[] };
    w.__plays = [];
    const proto = AudioBufferSourceNode.prototype;
    const start = Object.getOwnPropertyDescriptor(proto, 'start')!.value as (
      this: AudioBufferSourceNode,
      ...args: number[]
    ) => void;
    proto.start = function (this: AudioBufferSourceNode, ...args: number[]) {
      if (this.buffer && this.buffer.length > 1)
        w.__plays.push({ at: Date.now(), s: Math.round(this.buffer.duration * 100) / 100 });
      start.apply(this, args);
    };
  });
}

// The show: the table screen at every phase (1920 x 1080) with quiet phones, and full phones with no
// table screen, light and dark. SKETCHY_ART=<private folder with manifest.json, show/, audio/>
// serves the original's rigs; without it the plain rooms are shot. SHOTS_DIR=<folder> says where.
for (const colorScheme of ['light', 'dark'] as const) {
  for (const withTv of [true, false]) {
    test(`sketchy show screenshots (${withTv ? 'table screen + quiet' : 'full'} phones, ${colorScheme})`, async ({
      browser,
    }) => {
      test.setTimeout(400_000);
      const dir = `${process.env.SHOTS_DIR ?? 'test-results/sketchy-show'}/${withTv ? 'quiet' : 'full'}-${colorScheme}`;
      const setup = async (page: Page) => {
        await localArt(page);
        await logSound(page);
      };
      const look: Look = { viewport: { width: 390, height: 844 }, colorScheme, setup };
      cleanup.push(await importPacks(browser));
      const pages = (await table(browser, ['Hana', 'Ben', 'Cleo'], look)) as [Page, Page, Page];
      const [hana, ben, cleo] = pages;
      const tv = withTv
        ? await pairTableScreen(browser, hana, {
            viewport: { width: 1920, height: 1080 },
            setup,
          })
        : null;
      const shot = async (name: string, phone: Page = cleo) => {
        if (tv) await tv.screenshot({ path: `${dir}/tv-${name}.png` });
        await phone.screenshot({ path: `${dir}/phone-${name}.png` });
      };
      await hana.waitForTimeout(1500);
      await shot('01-lobby', hana);
      // The narrator too, when the sound is being logged.
      if (process.env.SOUND_LOG) {
        // Each device's own narrator slider (and the table screen's, which the host sets).
        await hana.getByTestId('lobby-sound').locator('summary').click();
        for (const slider of await hana.getByTestId('sound-slider-voice').all())
          await slider.fill('100');
      }
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
      // Step 1 (Cleo's lie fooled Ben): before the flip, then after; step 2 the truth. The shots
      // wait for the table screen's card (or, without it, the phone's step) rather than a guess.
      const face = (f: string) =>
        tv
          ? expect(tv.locator(`[data-face="${f}"]`).first()).toBeAttached({ timeout: 10_000 })
          : expect(ben.getByTestId('reveal-sequence')).toBeVisible();
      // A number on the table screen once it can really be seen (every layer above it shown).
      const shown = (text: string, count = 1) =>
        tv
          ? expect
              .poll(
                () =>
                  tv.evaluate((t) => {
                    const seen = (e: Element) => {
                      let o = 1;
                      for (let n: Element | null = e; n; n = n.parentElement)
                        o *= Number(getComputedStyle(n).opacity);
                      return o > 0.9;
                    };
                    return [...document.querySelectorAll('span,div')].filter(
                      (e) => e.childElementCount === 0 && e.textContent === t && seen(e),
                    ).length;
                  }, text),
                { timeout: 10_000, intervals: [50] },
              )
              .toBeGreaterThanOrEqual(count)
          : Promise.resolve();
      await face('up');
      await hana.waitForTimeout(1000);
      await shot('07a-reveal-names', ben);
      await face('lie');
      await hana.waitForTimeout(300);
      await shot('07b-reveal-flip-lie', ben);
      await shown('+500');
      await shot('07c-reveal-fooler', cleo);
      await face('truth');
      // The finder's chip and the artist both get +1,000.
      await shown('+1,000', 2);
      await shot('08-reveal-truth', cleo);
      if (process.env.SOUND_LOG) {
        const { writeFile } = await import('node:fs/promises');
        const log: Record<string, unknown> = {};
        for (const [who, p] of [
          ['tv', tv],
          ['hana', hana],
          ['ben', ben],
          ['cleo', cleo],
        ] as const)
          if (p)
            log[who] = await p.evaluate(
              () => (window as unknown as { __plays?: unknown }).__plays ?? [],
            );
        await writeFile(`${dir}/sound.json`, JSON.stringify(log, null, 1));
      }
      await results(pages, 'purple elephant');
      // The board as the original's: the points gained pop up on the balloons, then the balloons
      // flip round to the score bars.
      await shown('+1,500');
      await shot('09a-board-gains', ben);
      await hana.waitForTimeout(5000);
      await shot('09b-board-scores', ben);
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
      // The end's beats, as the original's: the scores (last place first), the winner, then the
      // likes cup and its crown.
      await hana.waitForTimeout(3500);
      await shot('10a-end-scores', hana);
      await hana.waitForTimeout(1500);
      await shot('10b-end-winner', hana);
      await hana.waitForTimeout(8000);
      await shot('10c-end-likes', hana);
    });
  }
}
