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

for (const device of ['phone', 'desktop'] as const)
  for (const scheme of ['light', 'dark'] as const)
    test(`Short Fuse screenshots: expansions 2 and 3 (${device}, ${scheme})`, async ({
      browser,
    }) => {
      test.setTimeout(480_000);
      const opts = { viewport: VIEWPORTS[device], colorScheme: scheme };
      const shot = (p: Page, name: string, full = false) =>
        p.screenshot({
          path: `test-results/shots/short-fuse-${device}-${scheme}-${name}.png`,
          fullPage: full,
        });
      await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
      const [hana, ana, ben, cy] = await sfTable(
        browser,
        ['Hana', 'Ana', 'Ben', 'Cy'],
        pageErrors,
        opts,
      );
      const host = hana!.page;
      const A = ana!.page;
      const B = ben!.page;
      const C = cy!.page;
      await host.getByTestId('toggle-x2').click();
      await host.getByTestId('toggle-x3').click();
      await shot(host, '21-lobby-x23', true);

      await riggedStart(host, {
        hands: [
          ['vault', 'mark', 'blind', 'blind', 'mine', 'share3', 'potluck', 'bury', 'cat1'],
          ['alter3now', 'twin', 'cat2', 'nope', 'peek5'],
          ['twin', 'defuse', 'cat3', 'cat4', 'skip', 'cat2'],
          ['shelter', 'cat5', 'skip'],
        ],
        top: ['cat1', 'cat2', 'skip', 'bomb', 'cat3'],
      });
      await play(host, ['vault']);
      await settle(host);
      await play(host, ['mark'], 'Ana');
      await settle(host);
      await play(host, ['blind'], 'Cy');
      await settle(host);
      await play(host, ['mine'], 'Ben');
      await settle(host);
      await shot(host, '22-seats');
      await shot(C, '23-blind-hand');

      // Ana's NOW rearrange, off her turn.
      await select(A, ['alter3now']);
      await shot(A, '24-now-dock');
      await A.getByTestId('play-now').click();
      await settle(A);
      await expect(A.getByRole('dialog', { name: 'Rearrange the top of the pile' })).toBeVisible();
      await A.waitForTimeout(600); // the sheet slides in
      await shot(A, '25-alter-now');
      await A.getByTestId('order-confirm').click();

      // Share: Hana rearranges, Ana is shown the same cards.
      await play(host, ['share3']);
      await settle(host);
      await expect(
        host.getByRole('dialog', { name: 'Rearrange the top of the pile' }),
      ).toBeVisible();
      await host.waitForTimeout(600);
      await shot(host, '26-share-sheet');
      await host.getByTestId('order-confirm').click();
      await expect(A.getByTestId('peek-cards')).toBeVisible();
      await A.waitForTimeout(800);
      await shot(A, '27-shared-peek');
      await A.getByTestId('peek-close').click();

      // Potluck: everyone puts a card on top; Cy picks blind.
      await play(host, ['potluck']);
      await settle(host);
      await host.getByRole('dialog').locator('[data-card="cat1"]').click();
      await host.waitForTimeout(400);
      await shot(host, '28-potluck-sheet');
      await host.getByTestId('pick-confirm').click();
      await A.getByRole('dialog').locator('[data-card="cat2"]').click();
      await A.getByTestId('pick-confirm').click();
      await B.getByRole('dialog').locator('[data-card="cat3"]').click();
      await B.getByTestId('pick-confirm').click();
      await C.getByRole('dialog').getByRole('button', { name: 'Face-down card 2' }).click();
      await shot(C, '29-blind-pick');
      await C.getByTestId('pick-confirm').click();

      // Now Ben is blindfolded too.
      await play(host, ['blind'], 'Ben');
      await settle(host);

      // Bury: the placement sheet with "2nd" picked (only that chip is highlighted).
      await play(host, ['bury']);
      await settle(host);
      await host.getByTestId('place-2nd').click();
      await expect(host.getByTestId('place-top')).toHaveAttribute('aria-pressed', 'false');
      await host.waitForTimeout(400);
      await shot(host, '30-bury-2nd');
      await host.getByTestId('place-confirm').click();

      // Ana's Twin Bomb barks at blindfolded Ben: he turns cards over looking for his Defuse.
      await play(A, ['twin']);
      await expect(B.getByTestId('search')).toBeVisible();
      await B.waitForTimeout(600);
      await shot(B, '31-search');
      await shot(C, '32-search-watcher');
      // Turn cards over until the Defuse shows up (each try waits for the sheet to change).
      const search = B.getByTestId('search');
      const left = async () =>
        (await search.isVisible()) ? search.getByRole('button').count() : 0;
      for (let n = await left(); n > 0; n = await left()) {
        await search.getByRole('button').last().click();
        await expect.poll(left).toBeLessThan(n);
      }
      await expect(search).toBeHidden();
      await draw(A);

      // Ben, still blindfolded, picks a face-down card to play.
      // (The search may have used up his whole hand: the order is random.)
      await expect(B.getByTestId('draw')).toBeVisible();
      if (await B.getByTestId('blind-hand').count())
        await B.getByTestId('blind-hand').getByRole('button').first().click();
      await shot(B, '33-blind-turn');
      await shot(B, '34-blind-turn-full', true);
    });
