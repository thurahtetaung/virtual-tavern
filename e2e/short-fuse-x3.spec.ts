import { expect, test } from '@playwright/test';
import { openBackroom } from './inquest-play.ts';
import { draw, play, riggedStart, select, settle, sfTable, sfVisitor } from './short-fuse-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

test('expansion 3: the Vault, a NOW rearrange, Mine!, Share, Potluck, a Stash steal and the Twin Bombs', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
  const [hana, ana, ben] = await sfTable(browser, ['Hana', 'Ana', 'Ben'], pageErrors);
  const host = hana!.page;
  const A = ana!.page;
  const B = ben!.page;
  await host.getByTestId('toggle-x3').click();

  await riggedStart(host, {
    hands: [
      ['vault', 'mine', 'share3', 'potluck', 'cat1'],
      ['alter3now', 'cat2', 'cat2', 'cat2', 'twin'],
      ['twin', 'defuse', 'bury', 'self3'],
    ],
    top: ['cat3', 'cat4', 'cat5', 'skip'],
  });

  // Hana puts on the Vault: everyone sees the crown and the Stash count on her seat.
  await play(host, ['vault']);
  await settle(host);
  await expect(
    B.locator('[data-seat]').filter({ hasText: 'Hana' }).getByTestId('vault'),
  ).toContainText('6');

  // Off her turn, Ana plays her NOW rearrange.
  await select(A, ['alter3now']);
  await A.getByTestId('play-now').click();
  await settle(A);
  await expect(A.getByRole('dialog', { name: 'Rearrange the top of the pile' })).toBeVisible();
  await A.getByTestId('order-confirm').click();

  // Mine! in front of Ben: his next draw goes to Hana, and Bury is blocked meanwhile.
  await play(host, ['mine'], 'Ben');
  await settle(host);
  await expect(
    A.locator('[data-seat]').filter({ hasText: 'Ben' }).getByTestId('mine'),
  ).toBeVisible();

  // Share: Hana rearranges, then Ana (next in turn) is shown the same cards.
  await play(host, ['share3']);
  await settle(host);
  await expect(host.getByRole('dialog')).toContainText('Ana will see them too');
  await host.getByTestId('order-confirm').click();
  await expect(A.getByRole('dialog', { name: 'Hana shows you the top of the pile' })).toBeVisible();
  await A.getByTestId('peek-close').click();

  // Potluck: everyone puts a card face down on top, in turn order.
  await play(host, ['potluck']);
  await settle(host);
  await host.getByRole('dialog').locator('[data-card="cat1"]').click();
  await host.getByTestId('pick-confirm').click();
  await A.getByRole('dialog').locator('[data-card="cat2"]').first().click();
  await A.getByTestId('pick-confirm').click();
  await B.getByRole('dialog').locator('[data-card="self3"]').click();
  await B.getByTestId('pick-confirm').click();
  await expect(A.getByTestId('last-action')).toContainText('3 cards went face down on top');
  await draw(host);

  // Ana's pair on Hana takes a card from the Vault's Stash, not her hand.
  await play(A, ['cat2', 'cat2'], 'Hana');
  await settle(A);
  await expect(B.getByTestId('last-action')).toContainText('Hana’s Vault Stash');
  await expect(
    B.locator('[data-seat]').filter({ hasText: 'Hana' }).getByTestId('vault'),
  ).toContainText('5');

  // A Twin Bomb barks at Ben, who holds the other: his Defuse saves him and hides nothing.
  await play(A, ['twin']);
  await expect(B.getByTestId('bomb-strip')).toContainText('barked at you');
  await B.getByTestId('defuse-button').click();
  await expect(B.getByRole('dialog')).toHaveCount(0);
  await draw(A);

  // Ben can't bury with a Mine! in front of him; his draw goes to Hana.
  await select(B, ['bury']);
  await expect(B.getByTestId('dock')).toContainText('Bury is blocked');
  await select(B, ['bury']);
  await draw(B);
  await expect(A.getByTestId('last-action')).toContainText('Hana took Ben’s draw');
  await expect(host.locator('[data-testid="memory"]:visible')).toContainText('from Ben');
});
