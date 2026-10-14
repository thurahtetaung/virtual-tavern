import { type Page, expect, test } from '@playwright/test';
import { openBackroom } from './inquest-play.ts';
import { draw, play, riggedStart, settle, sfTable, sfVisitor } from './short-fuse-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

// Every peek opens its sheet, in the first game of a room and the next one: the memory ids a
// game counts from restart, so a later game's peek once stayed hidden under Me (phones too).
// SCREENSHOTS=1 also saves each sheet to test-results/shots.
const shots = !!process.env.SCREENSHOTS;

/** The peeked cards show in their sheet, on screen, and the sheet closes. */
async function seesPeek(p: Page, n: number, shot: string | null) {
  const cards = p.getByTestId('peek-cards');
  await expect(cards).toBeVisible();
  await expect(cards.getByRole('listitem')).toHaveCount(n);
  await expect(cards.getByRole('listitem').last()).toBeInViewport();
  if (shot) {
    await p.waitForTimeout(800); // the cards flip in
    await p.screenshot({ path: `test-results/shots/${shot}.png` });
  }
  await p.getByTestId('peek-close').click();
  await expect(cards).toHaveCount(0);
}

// A phone in both themes and one desktop: each plays two full games with three browsers, so every
// extra run costs a CI shard about 40 s.
for (const [device, viewport, scheme] of [
  ['phone', { width: 390, height: 844 }, 'light'],
  ['phone', { width: 390, height: 844 }, 'dark'],
  ['desktop', { width: 1280, height: 900 }, 'light'],
] as const)
  test(`Short Fuse peeks show their cards game after game (${device}, ${scheme})`, async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    const name = (s: string) => (shots ? `short-fuse-peek-${device}-${scheme}-${s}` : null);
    await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
    const [hana, ana] = await sfTable(browser, ['Hana', 'Ana'], pageErrors, {
      viewport,
      colorScheme: scheme,
    });
    const host = hana!.page;
    const A = ana!.page;
    await host.getByTestId('toggle-x1').click();
    await host.getByTestId('toggle-x2').click();
    await host.getByTestId('toggle-x3').click();

    for (const round of [1, 2]) {
      await riggedStart(host, {
        hands: [['peek3', 'peek5', 'alter3', 'share3', 'cat1'], ['cat2']],
        top: ['bomb', 'cat3', 'cat4', 'cat5', 'skip', 'cat1'],
      });
      await play(host, ['peek3']);
      await settle(host);
      await seesPeek(host, 3, name(`${round}-see3`));
      await play(host, ['peek5']);
      await settle(host);
      await seesPeek(host, 5, name(`${round}-see5`));
      await play(host, ['alter3']);
      await settle(host);
      await expect(
        host.getByRole('dialog', { name: 'Rearrange the top of the pile' }),
      ).toBeVisible();
      if (shots)
        await host.screenshot({ path: `test-results/shots/${name(`${round}-alter`)}.png` });
      await host.getByTestId('order-confirm').click();
      await play(host, ['share3']);
      await settle(host);
      await expect(
        host.getByRole('dialog', { name: 'Rearrange the top of the pile' }),
      ).toBeVisible();
      await host.getByTestId('order-confirm').click();
      await seesPeek(A, 3, name(`${round}-shared`));

      // Hana draws the Bomb with no Defuse: Ana wins, and they go round again.
      await draw(host);
      await expect(host.getByTestId('winner')).toBeVisible({ timeout: 10_000 });
      // The end screen doesn't bring back a peek that was already seen.
      await expect(host.getByTestId('peek-cards')).toHaveCount(0);
      await expect(A.getByTestId('peek-cards')).toHaveCount(0);
      if (round === 1) {
        await host.getByRole('button', { name: 'Change the deck' }).click();
        await expect(host.getByTestId('start')).toBeVisible();
      }
    }
  });
