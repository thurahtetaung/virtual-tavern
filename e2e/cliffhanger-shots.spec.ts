import { type Browser, type Page, expect } from '@playwright/test';
import {
  describe as describeCards,
  faceOff,
  importPacks,
  localArt,
  lockIn,
  table,
} from './cliffhanger-play.ts';
import { test } from './fixtures.ts';
import { type Look, visitor } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/cliffhanger-shots.spec.ts
// With CLIFFHANGER_ART=<folder holding manifest.json and the art> the pages get that manifest and
// art from disk; without it, tapes are drawn in each genre's colour. SHOTS_DIR picks the folder.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const DIR = process.env.SHOTS_DIR ?? 'test-results/cliffhanger-shots';

const cleanup: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
});

/** The host pairs a table screen; returns its page, on the room's lobby. */
async function pairTableScreen(browser: Browser, host: Page, look: Look) {
  await host.getByRole('button', { name: /^Players/ }).click();
  const panel = host
    .getByRole('dialog', { name: 'Players' })
    .getByRole('region', { name: /Table screen/ });
  await panel.getByRole('button', { name: 'Show a pairing code' }).click();
  const code = (await panel.getByTestId('stage-code').textContent())!;
  await host.keyboard.press('Escape');
  const tv = await visitor(browser, 'TV', look);
  await localArt(tv);
  await tv.goto('/stage');
  await tv.getByLabel('Pairing code').fill(code);
  await tv.getByRole('button', { name: 'Pair this screen' }).click();
  await tv.getByRole('button', { name: '▶ Start the show' }).click();
  await expect(tv.getByTestId('cl-stage')).toBeVisible();
  return tv;
}

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1440, height: 900 }, 'light'],
  ['desktop-dark', { width: 1440, height: 900 }, 'dark'],
] as const) {
  test(`cliffhanger screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme };
    const shot = async (p: Page, name: string, fullPage = false) => {
      await p.waitForTimeout(700);
      await p.screenshot({ path: `${DIR}/${label}-${name}.png`, fullPage });
    };
    cleanup.push(await importPacks(browser));
    const [ana, ben, cleo, dev] = (await table(browser, ['Ana', 'Ben', 'Cleo', 'Dev'], look)) as [
      Page,
      Page,
      Page,
      Page,
    ];
    await shot(ana, '01-lobby');
    await shot(ana, '02-lobby-full', true);
    // A genre the packs have no titles of: flagged on its chip.
    await ana.getByTestId('genre-heart').click();
    await expect(ana.getByTestId('genre-short')).toBeVisible();
    await ana.getByTestId('setting-genres').scrollIntoViewIfNeeded();
    await shot(ana, '02b-lobby-genres');
    await shot(cleo, '02c-lobby-genres-guest');
    await ana.getByTestId('genre-heart').click();
    await expect(ana.getByTestId('genre-short')).toHaveCount(0);
    await ana.getByTestId('start').click();
    await expect(ana.getByTestId('said-it')).toBeVisible({ timeout: 15_000 });
    await ana.waitForTimeout(1500);
    await shot(ana, '03-faceoff-player');
    await shot(cleo, '04-faceoff-watching');
    await faceOff([ana, ben, cleo, dev], ana);
    await shot(ana, '05-keep');
    await lockIn(ana);
    await expect(ana.getByTestId('describer')).toBeVisible({ timeout: 15_000 });
    await ana.waitForTimeout(1200);
    await shot(ana, '06-describer');
    await shot(cleo, '07-guesser');
    await shot(ben, '08-other-team-placing');
    await describeCards(ana, 1);
    await shot(dev, '09-other-team');
    await shot(ana, '10-describer-after-got');
    // Phones show the board on a tab; desktops beside the play.
    if (viewport.width < 1024) {
      await cleo.getByTestId('tab-board').click();
      await shot(cleo, '11-board-tab');
      await cleo.getByTestId('tab-play').click();
    }
    await describeCards(ana, 5);
    await faceOff([ana, ben, cleo, dev], cleo);
    await lockIn(cleo);
    await describeCards(cleo, 6);
    await expect(ana.getByTestId('winner')).toBeVisible({ timeout: 15_000 });
    await shot(ana, '12-end');
    await shot(ben, '13-end-losers', true);
  });
}

test('cliffhanger table screen (tv-dark)', async ({ browser }) => {
  test.setTimeout(300_000);
  const phone: Look = { viewport: { width: 390, height: 844 }, colorScheme: 'dark' };
  const tvLook: Look = { viewport: { width: 1920, height: 1080 }, colorScheme: 'dark' };
  const shot = async (p: Page, name: string) => {
    await p.screenshot({ path: `${DIR}/tv-dark-${name}.png` });
  };
  cleanup.push(await importPacks(browser));
  const [ana, ben, cleo, dev] = (await table(browser, ['Ana', 'Ben', 'Cleo', 'Dev'], phone)) as [
    Page,
    Page,
    Page,
    Page,
  ];
  const tv = await pairTableScreen(browser, ana, tvLook);
  await shot(tv, '01-lobby');
  await ana.getByTestId('start').click();
  await expect(tv.getByText(/face-off/i).first()).toBeVisible({ timeout: 15_000 });
  await shot(tv, '02-round-title');
  await expect(ana.getByTestId('said-it')).toBeVisible({ timeout: 15_000 });
  await tv.waitForTimeout(1200);
  await shot(tv, '03-faceoff');
  await ana.getByTestId('said-it').click();
  await expect(tv.getByTestId('stage-press')).toBeVisible();
  await shot(tv, '04-faceoff-press');
  await expect(ana.getByTestId('keep')).toBeVisible({ timeout: 30_000 });
  await lockIn(ana);
  await expect(ana.getByTestId('describer')).toBeVisible({ timeout: 15_000 });
  await tv.waitForTimeout(1500);
  await shot(tv, '05-turn');
  await describeCards(ana, 1);
  await tv.waitForTimeout(300);
  await shot(tv, '06-turn-got');
  await describeCards(ana, 5);
  await expect(tv.getByTestId('stage-news')).toBeVisible();
  await shot(tv, '07-tape-in');
  await faceOff([ana, ben, cleo, dev], cleo);
  await lockIn(cleo);
  await expect(tv.getByTestId('stage-match-point')).toBeVisible({ timeout: 15_000 });
  await shot(tv, '08-match-point');
  await describeCards(cleo, 6);
  await expect(tv.getByTestId('stage-finale')).toBeVisible({ timeout: 15_000 });
  await tv.waitForTimeout(1500);
  await shot(tv, '09-finale');
});
