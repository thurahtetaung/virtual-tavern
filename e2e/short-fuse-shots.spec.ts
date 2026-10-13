import { type Page, expect, test } from '@playwright/test';
import { openBackroom, unlock } from './inquest-play.ts';
import { draw, play, riggedStart, select, settle, sfTable, sfVisitor } from './short-fuse-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/short-fuse-shots.spec.ts
// (SHORT_FUSE_ART=<private art folder> previews the real art). Shots land in test-results/shots.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 900 },
} as const;

for (const device of ['phone', 'desktop'] as const)
  for (const scheme of ['light', 'dark'] as const)
    test(`Short Fuse screenshots (${device}, ${scheme})`, async ({ browser }) => {
      test.setTimeout(240_000);
      const opts = { viewport: VIEWPORTS[device], colorScheme: scheme };
      const shot = (p: Page, name: string, full = false) =>
        p.screenshot({
          path: `test-results/shots/short-fuse-${device}-${scheme}-${name}.png`,
          fullPage: full,
        });
      await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
      const [hana, ana, ben] = await sfTable(browser, ['Hana', 'Ana', 'Ben'], pageErrors, opts);
      const host = hana!.page;
      const A = ana!.page;
      const B = ben!.page;
      await host.getByTestId('toggle-x1').click();
      await shot(host, '01-lobby', true);
      await host.getByTestId('preset-adult').click();
      await shot(A, '02-lobby-adult');
      await host.getByTestId('preset-classic').click();

      await riggedStart(host, {
        hands: [
          ['favor', 'peek3', 'cat1', 'cat1', 'attack', 'skip', 'shuffle'],
          ['nope', 'cat2', 'defuse', 'alter3', 'aim', 'cat3'],
          ['nope', 'cat4', 'reverse', 'bottom'],
        ],
        top: ['void', 'bomb', 'cat5', 'bomb'],
      });
      await select(host, ['favor']);
      await shot(host, '03-your-turn');

      await host.getByTestId('play').click();
      await host.getByTestId('targets').getByRole('button', { name: /^Ana/ }).click();
      await expect(B.getByTestId('nope-button')).toBeVisible();
      await shot(B, '04-nope-holder');
      await shot(host, '05-nope-watcher');
      await settle(host);
      await A.getByRole('dialog').locator('[data-card="cat2"]').click();
      await shot(A, '06-give-sheet');
      await A.getByTestId('pick-confirm').click();

      await play(host, ['peek3']);
      await settle(host);
      await expect(host.getByTestId('peek-cards').getByRole('listitem')).toHaveCount(3);
      await host.waitForTimeout(800); // the cards flip in one by one
      await shot(host, '07-peek');
      await host.getByTestId('peek-close').click();

      // The Black Hole comes up and goes back third, face up: everyone sees the stripe.
      await draw(host);
      await host.getByRole('button', { name: '3rd', exact: true }).click();
      await shot(host, '08-place-void');
      await host.getByTestId('place-confirm').click();
      await expect(A.getByTestId('void-stripe')).toBeVisible();

      // Ana draws a Bomb, defuses it and hides it on top.
      await draw(A);
      await expect(A.getByTestId('bomb-strip')).toBeVisible();
      await shot(A, '09-bomb-drawn');
      await shot(B, '10-bomb-watcher');
      await A.getByTestId('defuse-button').click();
      await A.getByRole('button', { name: 'Top', exact: true }).click();
      await shot(A, '11-place-bomb');
      await A.getByTestId('place-confirm').click();

      // Ben draws it and explodes.
      await draw(B);
      await expect(B.getByTestId('explosion')).toBeVisible();
      await shot(B, '12-explosion');
      await expect(B.getByRole('status').filter({ hasText: 'You’re out' })).toBeVisible({
        timeout: 10_000,
      });
      await shot(B, '13-spectator', true);
      if (device === 'phone') {
        await host.getByRole('tab', { name: /Me/ }).click();
        await shot(host, '14-me-tab');
        await host.getByRole('tab', { name: /Log/ }).click();
        await shot(host, '15-log-tab');
        await host.getByRole('tab', { name: /Table/ }).click();
      }

      // Hana draws safely; Ana finds the Black Hole face up on top and falls in.
      await draw(host);
      await expect(A.getByTestId('pile')).toContainText('face up on top!');
      await shot(A, '16-void-on-top');
      await draw(A);
      await expect(host.getByTestId('winner')).toBeVisible({ timeout: 10_000 });
      await shot(host, '17-end', true);
      await shot(A, '18-end-loser');
    });

test('Short Fuse screenshots: ten seats on a phone', async ({ browser }) => {
  test.setTimeout(240_000);
  for (const scheme of ['light', 'dark'] as const) {
    const names = ['Hana', 'Ana', 'Bartholomew', 'Cy', 'Dee', 'Eve', 'Fin', 'Gus', 'Hal', 'Ivy'];
    const opts = { viewport: VIEWPORTS.phone, colorScheme: scheme };
    if (scheme === 'light') await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
    const host = await sfVisitor(browser, names[0]!, pageErrors, opts);
    await unlock(host);
    await host.getByRole('button', { name: 'Create a Short Fuse room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const path = new URL(host.url()).pathname;
    for (const n of names.slice(1)) {
      const p = await sfVisitor(browser, n, pageErrors, { colorScheme: scheme });
      await unlock(p, `/backroom?next=${encodeURIComponent(path)}`);
    }
    await expect(host.getByText('Players (10/10)')).toBeVisible();
    await host.getByTestId('preset-party').click();
    await expect(host.getByTestId('readout')).toContainText('10 players');
    await host.getByTestId('start').click();
    await expect(host.getByTestId('seats')).toBeVisible();
    await host.screenshot({
      path: `test-results/shots/short-fuse-phone-${scheme}-20-ten-seats.png`,
    });
  }
});
