import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  claim,
  claimCard,
  dive,
  importPacks,
  localArt,
  play,
  table,
} from './mission-control-play.ts';
import type { Look } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/mission-control-shots.spec.ts
// Phone and desktop, light and dark: the logbook, the briefing, the draft, a trick with legal
// cards lit and task chips, a signal, the task stamp, the failure and its replay, on the test deal.
// MISSION_CONTROL_ART=<folder> serves a local manifest and art (`localArt`).
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
  test(`mission control screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/mission-control-shots/${label}-${name}.png`,
        fullPage: true,
      });
    cleanup.push(await importPacks(browser));
    const [hana, ben, cleo] = (await table(browser, ['Hana', 'Ben', 'Cleo'], look)) as [
      Page,
      Page,
      Page,
    ];
    const all = [hana, ben, cleo];
    await shot(hana, '01-lobby-logbook');
    await hana.getByTestId('mc-start').click();
    await expect(ben.getByTestId('mc-briefing')).toBeVisible();
    await shot(ben, '02-briefing');
    for (const p of all) await p.getByTestId('mc-ready').click();
    for (const p of all) await expect(p.getByTestId('mc-draft')).toBeVisible();
    await claim(hana, 'Take trick one');
    await shot(ben, '03-draft');
    await claim(ben, 'Take the pink 3');
    for (const p of all) await p.getByTestId('mc-draft-ready').click();
    await expect(hana.getByTestId('mc-distress')).toBeVisible();
    await shot(hana, '03b-distress');
    for (const p of all) await p.getByTestId('mc-dive').click();
    for (const p of all) await expect(p.getByTestId('mc-trick')).toBeVisible();
    await ben.getByTestId('mc-signal').click();
    await expect(ben.getByTestId('mc-signal-b9-top')).toBeVisible();
    await shot(ben, '04-signal-dialog');
    await ben.getByTestId('mc-signal-b9-top').click();
    await expect(hana.getByText('▲ highest').first()).toBeVisible();
    await shot(hana, '05-trick-legal-cards');
    await play(hana, 'p3');
    await shot(ben, '06-follow-suit');
    await play(ben, 'b2');
    await play(cleo, 'g6');
    await expect(cleo.getByTestId('mc-debrief')).toHaveAttribute('data-result', 'failure');
    await shot(cleo, '07-failure');
    await cleo.getByTestId('mc-replay-open').click();
    await expect(cleo.getByTestId('mc-replay')).toBeVisible();
    await shot(cleo, '08-replay');
    // Retry, and this time Hana takes both: one trick and it's done.
    await ben.getByTestId('mc-retry-same').click();
    for (const p of all) await expect(p.getByTestId('mc-draft')).toBeVisible();
    await claim(hana, 'Take trick one');
    await claim(hana, 'Take the pink 3');
    await dive(all);
    await play(hana, 'p3');
    await play(ben, 'b2');
    await play(cleo, 'g6');
    await expect(hana.getByTestId('mc-stamp')).toBeVisible();
    await shot(hana, '09-debrief-stamp');
    await hana.getByRole('button', { name: '📘 Logbook and settings' }).click();
    await expect(hana.getByTestId('logbook-1')).toContainText('✅');
    await shot(hana, '10-logbook');
  });
}

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1280, height: 860 }, 'light'],
  ['desktop-dark', { width: 1280, height: 860 }, 'dark'],
] as const) {
  test(`mission control one-card screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = (p: Page, name: string) =>
      p.screenshot({
        path: `test-results/mission-control-shots/${label}-${name}.png`,
        fullPage: true,
      });
    cleanup.push(await importPacks(browser));
    const [hana, ben, cleo] = (await table(browser, ['Hana', 'Ben', 'Cleo'], look)) as [
      Page,
      Page,
      Page,
    ];
    const all = [hana, ben, cleo];
    await hana.getByTestId('mc-voyage-voyage-1').click();
    await expect(hana.getByTestId('logbook')).toContainText('In order');
    await shot(hana, '11-voyage-pick');
    await shot(ben, '11b-voyage-summary');
    await hana.getByTestId('mc-start').click();
    for (const p of all) await p.getByTestId('mc-ready').click();
    for (const p of all) await expect(p.getByTestId('mc-draft')).toBeVisible();
    await claimCard(hana, 'pink 3');
    await shot(ben, '12-token-draft');
    await claimCard(hana, 'pink 2');
    await dive(all);
    await shot(hana, '13-tokens-in-play');
    await play(hana, 'p2');
    await play(ben, 'b2');
    await play(cleo, 'g6');
    await expect(hana.getByTestId('mc-debrief')).toHaveAttribute('data-result', 'failure');
    await shot(hana, '14-order-failure');
    // A custom mission: the captain's question round and pick.
    await hana.getByRole('button', { name: '📘 Logbook and settings' }).click();
    // Phones list only the chosen mission until the whole logbook is opened.
    if (viewport.width < 640) await hana.getByRole('button', { name: /All missions/ }).click();
    await hana.getByTestId('logbook-2').getByRole('button').click();
    await hana.getByTestId('mc-start').click();
    for (const p of all) await p.getByTestId('mc-ready').click();
    await expect(ben.getByTestId('mc-pick')).toBeVisible();
    await shot(ben, '15-pick-question');
    await ben.getByTestId('mc-reply').first().click();
    await cleo.getByTestId('mc-reply').last().click();
    await expect(hana.getByTestId('mc-choose').first()).toBeVisible();
    await shot(hana, '16-pick-choose');
    // The sick crew member's condition names them.
    await hana.getByTestId('mc-choose').filter({ hasText: 'Cleo' }).click();
    for (const p of all) await p.getByTestId('mc-dive').click();
    for (const p of all) await expect(p.getByTestId('mc-trick')).toBeVisible();
    await expect(hana.getByTestId('mc-task').filter({ hasText: 'sick' }).last()).toContainText(
      'Cleo',
    );
    await shot(hana, '17-sick-named');
  });
}
